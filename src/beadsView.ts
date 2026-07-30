import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

import { AgentArtifactStore, type AgentResponseArtifact } from "./agentArtifactStore";
import { buildAgentBeadUpdateArgs } from "./agentBeadUpdate";
import { AgentCredentialStore } from "./agentCredentialStore";
import { runBoundedAllSettled, WorkspaceSerialQueue } from "./agentExecutionCoordinator";
import {
  buildAgentModelOptions,
  DEFAULT_AGENT_MODEL,
  normalizeAgentModelName
} from "./agentModelSelection";
import {
  AGENT_PROVIDERS,
  type AgentExecutionOutcomeStatus,
  type AgentProviderId,
  getAgentProviderDefinition,
  resolveAgentProviderId
} from "./agentProvider";
import {
  AgentProviderError,
  normalizeOllamaBaseUrl,
  requestAgentProviderResponse,
  type TextResponseProviderId
} from "./agentProviderClient";
import { revalidateExecutionTargets } from "./agentReadiness";
import { persistGeneratedAgentResponse } from "./agentResponsePersistence";
import { runReadinessGuardedStart } from "./agentStartGuard";
import { buildAgentWorkPrompt } from "./agentWorkPrompt";
import {
  type BeadItem,
  beadsAsArray,
  deriveParallelMergeItems,
  diffBeadItems,
  extractBeadItems,
  inferReadyParallelizableItems,
  mergeBeadItems,
  toBeadItem
} from "./beadsData";
import {
  assertBeadsProcessTrusted,
  createBdSpawnOptions,
  resolveBdExecutableStatus
} from "./beadsProcess";
import {
  type BeadsExecutionSkip,
  type BeadsExecutionTarget,
  type BeadsHostMessage,
  isBeadsRequestMessage,
  MAX_BEADS_RENDER_UPDATE_LENGTH,
  type ParallelExecutionOutcome
} from "./beadsProtocol";
import { flushBeadsWorkspace, probeBeadsSyncCapability, syncBeadsWorkspace } from "./beadsSync";
import {
  type BeadGroup,
  type BeadLoadResult,
  type BeadWarning,
  type CliLoadResult,
  type EmptyBeadWorkspace
} from "./beadsViewTypes";
import { renderBeadsWebviewHtml } from "./beadsWebview";
import {
  type BeadsCapabilityCommandResult,
  probeBeadsAgentWriteCapability,
  probeBeadsWriteCapability
} from "./beadsWriteCapability";
import { BranchSwitchSyncCoordinator } from "./branchSwitchSync";
import { checkExecutable } from "./commandAvailability";
import { getConfig } from "./config";
import { GitGraphView } from "./gitGraphView";
import { parsePlanDraft } from "./planDraft";
import {
  buildPlanDraftGenerationPrompt,
  normalizePlanDraftGenerationGoal,
  parsePlanDraftGenerationResponse
} from "./planDraftGeneration";
import { executePlanImport, formatPlanMutation, projectPlanDraftMutations } from "./planImport";

type CreateBeadType = "task" | "feature" | "bug" | "epic" | "chore";
type CreateBeadStatus = "open" | "in_progress" | "blocked" | "closed";
type CreateBeadPriority = "P0" | "P1" | "P2" | "P3" | "P4";
const SSOT_USAGE_MANIFEST_CANDIDATES = [
  "ssot-usage.json",
  ".beads/ssot-usage.json",
  ".codex/ssot-usage.json"
];
const ASSIGN_CONTEXT_CANDIDATES = [
  "AGENTS.md",
  ".codex",
  ".agents",
  ".beads/issues.jsonl",
  "README.md",
  "CONTRIBUTING.md",
  "docs"
];
const COPILOT_ASSIGN_COMMAND_CANDIDATES = [
  "workbench.action.chat.openSessionWithPrompt.copilotcli",
  "workbench.action.chat.openSessionWithPrompt.copilot-cloud-agent"
];
const CHAT_FALLBACK_COMMAND_CANDIDATES = ["workbench.action.chat.open"];
const MAX_PARALLEL_TEXT_PROVIDER_REQUESTS = 20;

type AssignAgentOpenResult = AgentExecutionOutcomeStatus;
type WithoutRequestId<T> = T extends unknown ? Omit<T, "requestId"> : never;
type PlanDraftGenerationReply = WithoutRequestId<
  Extract<BeadsHostMessage, { command: "planDraftGenerationResult" }>
>;

type PreparedAgentExecution =
  | { kind: "copilot-worktree"; worktree: GitWorktreeInfo }
  | {
      kind: "text-response";
      artifact: AgentResponseArtifact;
      dependencyIds: readonly string[];
    };

interface GitWorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

interface WorktreeMergeCheck {
  worktree: GitWorktreeInfo;
  ok: boolean;
  reasons: string[];
}

interface PullRequestMergeCheck {
  worktree: GitWorktreeInfo;
  number: number;
  url: string;
  ok: boolean;
  reasons: string[];
}

export class BeadsViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = "beads-git-graph.beadsView";
  private static readonly refreshDebounceMs = 250;

  private webviewView: vscode.WebviewView | null = null;
  private panel: vscode.WebviewPanel | null = null;
  private webviewViewRenderSignature = "";
  private panelRenderSignature = "";
  private refreshGeneration = 0;
  private refreshTimer: NodeJS.Timeout | null = null;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly panelDisposables: vscode.Disposable[] = [];
  private readonly viewDisposables: vscode.Disposable[] = [];
  private readonly watchers: vscode.FileSystemWatcher[];
  private readonly branchWatchers = new Map<string, vscode.Disposable[]>();
  private readonly branchSyncCoordinator: BranchSwitchSyncCoordinator;
  private readonly extensionUri: vscode.Uri;
  private readonly credentialStore: AgentCredentialStore;
  private readonly artifactStore: AgentArtifactStore;
  private readonly agentExecutionQueue = new WorkspaceSerialQueue<string>();
  private readonly inFlightActions = new Set<string>();

  constructor(
    extensionUri: vscode.Uri,
    credentialStore: AgentCredentialStore,
    artifactStore: AgentArtifactStore
  ) {
    this.extensionUri = extensionUri;
    this.credentialStore = credentialStore;
    this.artifactStore = artifactStore;
    this.branchSyncCoordinator = new BranchSwitchSyncCoordinator(
      (workspacePath) => this.loadCurrentBranchKey(workspacePath),
      async (workspacePath) => {
        await syncBeadsWorkspace((args, cwd) => this.runBdCommand(args, cwd), workspacePath);
      },
      async () => {
        await this.refresh();
      },
      async (workspacePath, error) => {
        await this.refresh();
        const messageText =
          error instanceof Error ? error.message : "Unable to sync Beads data automatically.";
        vscode.window.showWarningMessage(
          `Automatic Beads sync after switching branches failed for ${path.basename(workspacePath)}: ${messageText}`
        );
      }
    );
    this.watchers = [
      vscode.workspace.createFileSystemWatcher("**/.beads/config.yaml"),
      vscode.workspace.createFileSystemWatcher("**/.beads/metadata.json"),
      vscode.workspace.createFileSystemWatcher("**/.beads/issues.json"),
      vscode.workspace.createFileSystemWatcher("**/.beads/issues.jsonl")
    ];

    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders((event) => {
        for (const folder of event.removed) {
          const workspacePath = folder.uri.fsPath;
          this.stopWatchingBranch(workspacePath);
          this.branchSyncCoordinator.forgetWorkspace(workspacePath);
        }

        void this.syncBranchWatchers();
        void this.refresh();
      })
    );

    for (const watcher of this.watchers) {
      this.disposables.push(
        watcher,
        watcher.onDidCreate(() => this.handleBeadsFilesChanged()),
        watcher.onDidChange(() => this.handleBeadsFilesChanged()),
        watcher.onDidDelete(() => this.handleBeadsFilesChanged())
      );
    }

    void this.syncBranchWatchers();
  }

  public dispose() {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    for (const workspacePath of this.branchWatchers.keys()) {
      this.stopWatchingBranch(workspacePath);
    }
    this.disposeScoped(this.viewDisposables);
    this.disposeScoped(this.panelDisposables);
    this.webviewView = null;
    this.panel = null;
    this.webviewViewRenderSignature = "";
    this.panelRenderSignature = "";
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
    this.inFlightActions.clear();
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this.disposeScoped(this.viewDisposables);
    this.webviewView = webviewView;
    this.webviewViewRenderSignature = "";
    webviewView.webview.options = { enableScripts: true };
    this.viewDisposables.push(
      webviewView.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message, webviewView.webview);
      })
    );

    void this.refresh();
  }

  public showPanel(column?: vscode.ViewColumn) {
    const targetColumn =
      column ??
      (vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined);

    if (this.panel) {
      this.panel.reveal(targetColumn);
      return;
    }

    const graphColumn = GitGraphView.closeCurrentPanel();
    this.panel = vscode.window.createWebviewPanel(
      "beads-git-graph.beadsPanel",
      "Beads",
      targetColumn ?? graphColumn ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    this.panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "resources", "webview-icon-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "resources", "webview-icon-dark.svg")
    };
    this.disposeScoped(this.panelDisposables);
    this.panelDisposables.push(
      this.panel.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message, this.panel?.webview);
      }),
      this.panel.onDidDispose(() => {
        this.panel = null;
        this.panelRenderSignature = "";
        this.disposeScoped(this.panelDisposables);
      })
    );
    void this.refresh();
  }

  public closePanel() {
    if (!this.panel) {
      return undefined;
    }

    const { viewColumn } = this.panel;
    this.panel.dispose();
    this.panel = null;
    return viewColumn;
  }

  private disposeScoped(disposables: vscode.Disposable[]) {
    while (disposables.length > 0) {
      disposables.pop()?.dispose();
    }
  }

  public async refresh() {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.webviewView === null && this.panel === null) {
      return;
    }

    const generation = ++this.refreshGeneration;
    const results = await this.loadBeads();
    if (generation !== this.refreshGeneration) {
      return;
    }
    const signature = this.getRenderSignature(results);
    const updates: Promise<void>[] = [];
    if (this.webviewView !== null) {
      updates.push(
        this.refreshWebviewHtml("view", this.webviewView.webview, results, signature, generation)
      );
    }
    if (this.panel !== null) {
      updates.push(
        this.refreshWebviewHtml("panel", this.panel.webview, results, signature, generation)
      );
    }
    await Promise.all(updates);
  }

  private getRenderSignature(result: BeadLoadResult) {
    return JSON.stringify(result);
  }

  private async refreshWebviewHtml(
    target: "view" | "panel",
    webview: vscode.Webview,
    result: BeadLoadResult,
    signature: string,
    generation: number
  ) {
    const currentSignature =
      target === "view" ? this.webviewViewRenderSignature : this.panelRenderSignature;
    if (currentSignature === signature || !this.isCurrentWebview(target, webview)) {
      return;
    }

    if (currentSignature === "") {
      webview.html = this.getHtml(webview, result);
      this.setRenderSignature(target, signature);
      return;
    }

    const html = this.getHtml(webview, result);
    if (html.length > MAX_BEADS_RENDER_UPDATE_LENGTH) {
      webview.html = html;
      this.setRenderSignature(target, signature);
      return;
    }

    const delivered = await webview.postMessage({
      command: "beadsRenderUpdate",
      generation,
      html
    } satisfies BeadsHostMessage);
    if (generation !== this.refreshGeneration || !this.isCurrentWebview(target, webview)) {
      return;
    }

    if (!delivered) {
      webview.html = html;
    }
    this.setRenderSignature(target, signature);
  }

  private isCurrentWebview(target: "view" | "panel", webview: vscode.Webview) {
    return target === "view"
      ? this.webviewView?.webview === webview
      : this.panel?.webview === webview;
  }

  private setRenderSignature(target: "view" | "panel", signature: string) {
    if (target === "view") {
      this.webviewViewRenderSignature = signature;
    } else {
      this.panelRenderSignature = signature;
    }
  }

  private handleBeadsFilesChanged() {
    void this.syncBranchWatchers();
    this.scheduleRefresh();
  }

  private scheduleRefresh() {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, BeadsViewProvider.refreshDebounceMs);
  }

  private async loadBeads(): Promise<BeadLoadResult> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const groups: BeadGroup[] = [];
    const emptyWorkspaces: EmptyBeadWorkspace[] = [];
    const unavailableWorkspaces: EmptyBeadWorkspace[] = [];
    const errors: { source: string; message: string }[] = [];
    const warnings: BeadWarning[] = [];
    const planImportCapabilities: NonNullable<BeadLoadResult["planImportCapabilities"]> = [];
    const agentWriteCapabilities: NonNullable<BeadLoadResult["agentWriteCapabilities"]> = [];
    const syncCapabilities: NonNullable<BeadLoadResult["syncCapabilities"]> = [];
    const bdExecutableStatus = await this.getBdExecutableStatus();

    for (const folder of workspaceFolders) {
      const workspaceInfo = {
        workspace: folder.name,
        workspacePath: folder.uri.fsPath
      };
      const legacyFiles = await this.findLegacyBeadFiles(folder);
      const beadsDirUri = vscode.Uri.joinPath(folder.uri, ".beads");
      const hasBeadsDirectory = await this.pathExists(beadsDirUri);

      if (hasBeadsDirectory) {
        agentWriteCapabilities.push({
          ...workspaceInfo,
          capability: await probeBeadsAgentWriteCapability(
            bdExecutableStatus.available,
            bdExecutableStatus.message,
            (args) => this.runBdCapabilityProbe(args, folder.uri.fsPath)
          )
        });
        planImportCapabilities.push({
          ...workspaceInfo,
          capability: await probeBeadsWriteCapability(
            bdExecutableStatus.available,
            bdExecutableStatus.message,
            (args) => this.runBdCapabilityProbe(args, folder.uri.fsPath)
          )
        });
        syncCapabilities.push({
          ...workspaceInfo,
          capability: bdExecutableStatus.available
            ? await probeBeadsSyncCapability(
                (args, cwd) => this.runBdCommand(args, cwd),
                folder.uri.fsPath
              )
            : {
                supported: false,
                reason: bdExecutableStatus.message?.trim() || "The Beads CLI is unavailable."
              }
        });
      }

      if (hasBeadsDirectory && bdExecutableStatus.available) {
        try {
          const cliResult = await this.loadBdItemsFromCli(folder.uri.fsPath);
          warnings.push(...cliResult.warnings);
          const cliItems = cliResult.items;
          if (cliItems.length > 0) {
            groups.push({
              ...workspaceInfo,
              items: deriveParallelMergeItems(cliItems)
            });
          } else {
            emptyWorkspaces.push(workspaceInfo);
          }
          continue;
        } catch (error) {
          if (legacyFiles.length === 0) {
            errors.push({
              source: vscode.workspace.asRelativePath(beadsDirUri, false),
              message:
                error instanceof Error ? error.message : "Unable to read Beads data via bd list"
            });
          }
        }
      }

      const legacyResult = await this.loadLegacyWorkspaceItems(legacyFiles);
      errors.push(...legacyResult.errors);

      if (legacyResult.items.length > 0) {
        groups.push({
          ...workspaceInfo,
          items: deriveParallelMergeItems(legacyResult.items)
        });
      } else if (legacyResult.hasFiles) {
        emptyWorkspaces.push(workspaceInfo);
      } else if (hasBeadsDirectory && !bdExecutableStatus.available) {
        unavailableWorkspaces.push(workspaceInfo);
      }
    }

    return {
      groups: groups.sort((a, b) => a.workspace.localeCompare(b.workspace)),
      emptyWorkspaces: emptyWorkspaces.sort((a, b) => a.workspace.localeCompare(b.workspace)),
      unavailableWorkspaces: unavailableWorkspaces.sort((a, b) =>
        a.workspace.localeCompare(b.workspace)
      ),
      bdExecutableStatus,
      errors,
      warnings,
      agentWriteCapabilities: agentWriteCapabilities.sort((a, b) =>
        a.workspace.localeCompare(b.workspace)
      ),
      planImportCapabilities: planImportCapabilities.sort((a, b) =>
        a.workspace.localeCompare(b.workspace)
      ),
      syncCapabilities: syncCapabilities.sort((a, b) => a.workspace.localeCompare(b.workspace))
    };
  }

  private getHtml(webview: vscode.Webview, result: BeadLoadResult) {
    return renderBeadsWebviewHtml(webview, this.extensionUri, result);
  }

  private beginAction(actionKey: string, label: string) {
    if (this.inFlightActions.has(actionKey)) {
      vscode.window.showWarningMessage(`${label} is already in progress.`);
      return false;
    }
    this.inFlightActions.add(actionKey);
    return true;
  }

  private finishAction(actionKey: string) {
    this.inFlightActions.delete(actionKey);
  }

  public async handleMessage(message: unknown, sourceWebview?: vscode.Webview) {
    if (!isBeadsRequestMessage(message)) {
      return;
    }
    if (message.command === "refresh") {
      await this.refresh();
      return;
    }

    if (message.command === "openGitGraph") {
      await vscode.commands.executeCommand("beads-git-graph.view");
      return;
    }

    if (message.command === "openAgentArtifact") {
      const openResult = await this.artifactStore.openRecordedUri(message.artifactUri);
      if (openResult.status === "invalid-reference") {
        vscode.window.showWarningMessage(
          "Refusing to open an AI response artifact outside this workspace's extension storage."
        );
      } else if (openResult.status === "could-not-open") {
        vscode.window.showWarningMessage(
          "The recorded AI response artifact is missing or could not be opened."
        );
      }
      return;
    }

    if (message.command === "generatePlanDraft") {
      await this.generatePlanDraft(message, sourceWebview);
      return;
    }

    if (
      message.command === "importPlanDraft" &&
      typeof message.workspacePath === "string" &&
      typeof message.draftText === "string"
    ) {
      const workspacePath = await this.resolveAuthorizedWorkspacePath(message.workspacePath.trim());
      if (workspacePath === null) {
        vscode.window.showWarningMessage(
          "Refusing to import a Plan Draft outside an initialized workspace folder."
        );
        return;
      }
      const actionKey = `import-plan:${workspacePath}`;
      if (!this.beginAction(actionKey, "Plan import")) {
        return;
      }
      try {
        if (message.draftText.length > 1_000_000) {
          vscode.window.showWarningMessage("The Plan Draft is too large to import.");
          return;
        }

        let parsedValue: unknown;
        try {
          parsedValue = JSON.parse(message.draftText);
        } catch (error) {
          vscode.window.showWarningMessage(
            error instanceof Error
              ? `Invalid Plan Draft JSON: ${error.message}`
              : "Invalid Plan Draft JSON."
          );
          return;
        }
        const parsed = parsePlanDraft(parsedValue);
        if (parsed.draft === null || parsed.errors.length > 0) {
          const details = parsed.errors
            .map((error) => `${error.path || "draft"}: ${error.message}`)
            .join("\n");
          vscode.window.showWarningMessage(
            `Plan Draft validation failed.${details === "" ? "" : `\n${details}`}`
          );
          return;
        }

        const executableStatus = await this.getBdExecutableStatus();
        const capability = await probeBeadsWriteCapability(
          executableStatus.available,
          executableStatus.message,
          (args) => this.runBdCapabilityProbe(args, workspacePath)
        );
        if (!capability.supported) {
          vscode.window.showWarningMessage(`Plan import is disabled: ${capability.reason}`);
          return;
        }

        const mutations = projectPlanDraftMutations(parsed.draft);
        const confirmation = await vscode.window.showWarningMessage(
          `Import ${parsed.draft.tasks.length} planned task(s) into ${path.basename(workspacePath)}?`,
          {
            modal: true,
            detail: `${mutations.map((mutation, index) => `${index + 1}. ${formatPlanMutation(mutation)}`).join("\n")}\n\nMutations stop on the first failure. No automatic rollback is attempted.`
          },
          "Import Plan"
        );
        if (confirmation !== "Import Plan") {
          return;
        }

        const importResult = await executePlanImport(mutations, (args) =>
          this.runBdCommand([...args], workspacePath)
        );
        await this.refresh();
        const createdSummary =
          importResult.createdIds.length === 0
            ? "No tasks were created."
            : `Created: ${importResult.createdIds.map(({ taskId, issueId }) => `${taskId} → ${issueId}`).join(", ")}.`;
        if (importResult.failed !== null) {
          vscode.window.showErrorMessage(
            `Plan import stopped after ${importResult.completed.length} operation(s). ${createdSummary} Failed: ${formatPlanMutation(importResult.failed.mutation)} — ${importResult.failed.error}. ${importResult.unexecuted.length} operation(s) were not executed. No rollback was attempted.`
          );
          return;
        }
        vscode.window.showInformationMessage(
          `Plan imported with ${importResult.completed.length} operation(s). ${createdSummary}`
        );
        return;
      } finally {
        this.finishAction(actionKey);
      }
    }

    if (message.command === "syncAllBeads") {
      const actionKey = "sync-all-beads";
      if (!this.beginAction(actionKey, "Beads sync")) {
        return;
      }
      try {
        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
        const syncedWorkspaces: string[] = [];
        const unsupportedWorkspaces: string[] = [];

        for (const folder of workspaceFolders) {
          const beadsDirUri = vscode.Uri.joinPath(folder.uri, ".beads");
          if (!(await this.pathExists(beadsDirUri))) {
            continue;
          }

          const result = await syncBeadsWorkspace(
            (args, cwd) => this.runBdCommand(args, cwd),
            folder.uri.fsPath
          );
          if (result.status === "synced") {
            syncedWorkspaces.push(folder.name);
          } else {
            unsupportedWorkspaces.push(folder.name);
          }
        }

        await this.refresh();

        if (syncedWorkspaces.length > 0) {
          vscode.window.showInformationMessage(
            `Synced Beads data for ${syncedWorkspaces.join(", ")}.`
          );
        }
        if (unsupportedWorkspaces.length > 0) {
          vscode.window.showWarningMessage(
            `The Beads CLI does not support sync; data was not synced for ${unsupportedWorkspaces.join(", ")}.`
          );
        } else if (syncedWorkspaces.length === 0) {
          vscode.window.showWarningMessage("No Beads workspace was found to sync.");
        }
      } finally {
        this.finishAction(actionKey);
      }
      return;
    }

    if (message.command === "syncBeads" && typeof message.workspacePath === "string") {
      const workspacePath = await this.resolveAuthorizedWorkspacePath(message.workspacePath.trim());
      if (workspacePath === null) {
        vscode.window.showWarningMessage(
          "Refusing to sync Beads data outside an initialized workspace folder."
        );
        return;
      }

      const actionKey = `sync-beads:${workspacePath}`;
      if (!this.beginAction(actionKey, `Beads sync for ${path.basename(workspacePath)}`)) {
        return;
      }
      try {
        const result = await syncBeadsWorkspace(
          (args, cwd) => this.runBdCommand(args, cwd),
          workspacePath
        );
        await this.refresh();
        if (result.status === "synced") {
          vscode.window.showInformationMessage(
            `Synced Beads data for ${path.basename(workspacePath)}.`
          );
        } else {
          vscode.window.showWarningMessage(
            "The Beads CLI does not support sync; data was not synced."
          );
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Unable to sync Beads data.";
        vscode.window.showErrorMessage(messageText);
      } finally {
        this.finishAction(actionKey);
      }
      return;
    }

    if (message.command === "openGitGraphForCommit" && typeof message.commitHash === "string") {
      const commitHash = message.commitHash.trim();
      if (!/^[0-9a-f]{7,40}$/i.test(commitHash)) {
        vscode.window.showWarningMessage("Invalid commit hash in Beads item.");
        return;
      }
      await vscode.commands.executeCommand("beads-git-graph.view");
      await vscode.env.clipboard.writeText(commitHash);
      vscode.window.showInformationMessage(
        `Opened Git Graph. Commit hash copied to clipboard: ${commitHash.substring(0, 8)}`
      );
      return;
    }

    if (
      message.command === "createBead" &&
      typeof message.workspacePath === "string" &&
      message.workspacePath.trim() !== ""
    ) {
      const workspacePath = await this.resolveAuthorizedWorkspacePath(message.workspacePath.trim());
      if (workspacePath === null) {
        vscode.window.showWarningMessage(
          "Refusing to create a bead outside an initialized workspace folder."
        );
        return;
      }

      const actionKey = `create-bead:${workspacePath}`;
      if (!this.beginAction(actionKey, "Bead creation")) {
        return;
      }
      try {
        await this.assertWorkspaceWriteCapability(workspacePath);
        await this.promptAndCreateBead(workspacePath);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Unable to create bead.";
        vscode.window.showErrorMessage(messageText);
      } finally {
        this.finishAction(actionKey);
      }
      return;
    }

    if (
      message.command === "closeBead" &&
      typeof message.issueId === "string" &&
      typeof message.workspacePath === "string"
    ) {
      const issueId = message.issueId.trim();
      const workspacePath = await this.resolveAuthorizedWorkspacePath(message.workspacePath.trim());
      if (issueId === "" || workspacePath === null) {
        if (workspacePath === null) {
          vscode.window.showWarningMessage(
            "Refusing to close a bead outside an initialized workspace folder."
          );
        }
        return;
      }

      const actionKey = `close-bead:${workspacePath}:${issueId}`;
      if (!this.beginAction(actionKey, `Closing bead ${issueId}`)) {
        return;
      }
      try {
        await this.assertWorkspaceWriteCapability(workspacePath);
        const confirmation = await vscode.window.showWarningMessage(
          `Close bead ${issueId}${message.title ? `: ${message.title}` : ""}?`,
          { modal: true },
          "Close"
        );
        if (confirmation !== "Close") {
          return;
        }
        await this.runBdCommand(["close", issueId], workspacePath);
        await flushBeadsWorkspace((args, cwd) => this.runBdCommand(args, cwd), workspacePath);
        await this.refresh();
        vscode.window.showInformationMessage(`Closed bead ${issueId}.`);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Unable to close bead.";
        vscode.window.showErrorMessage(messageText);
      } finally {
        this.finishAction(actionKey);
      }
      return;
    }

    if (
      message.command === "assignStartBead" &&
      typeof message.issueId === "string" &&
      typeof message.workspacePath === "string"
    ) {
      const issueId = message.issueId.trim();
      const workspacePath = await this.resolveAuthorizedWorkspacePath(message.workspacePath.trim());
      if (issueId === "" || workspacePath === null) {
        if (workspacePath === null) {
          vscode.window.showWarningMessage(
            "Refusing to update a bead outside an initialized workspace folder."
          );
        }
        return;
      }

      const actionKey = `start-bead:${workspacePath}:${issueId}`;
      if (!this.beginAction(actionKey, `Starting bead ${issueId}`)) {
        return;
      }
      try {
        await this.autoAssignAndStartBead(
          workspacePath,
          issueId,
          message.title,
          message.provider,
          message.model?.trim() || message.agent,
          message.ssot,
          message.worktree
        );
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : "Unable to assign and start bead.";
        vscode.window.showErrorMessage(messageText);
      } finally {
        this.finishAction(actionKey);
      }
      return;
    }

    if (
      message.command === "startParallelBeads" &&
      typeof message.workspacePath === "string" &&
      Array.isArray(message.items)
    ) {
      const workspacePath = await this.resolveAuthorizedWorkspacePath(message.workspacePath.trim());
      if (workspacePath === null) {
        vscode.window.showWarningMessage(
          "Refusing to start parallel beads outside an initialized workspace folder."
        );
        return;
      }

      const actionKey = `start-parallel:${workspacePath}`;
      if (!this.beginAction(actionKey, "Parallel AI start")) {
        return;
      }
      try {
        const outcomes = await this.startParallelBeads(
          workspacePath,
          message.items,
          message.skipped ?? []
        );
        if (outcomes !== null) {
          this.postHostMessage(
            {
              command: "parallelExecutionResult",
              requestId: message.requestId,
              workspacePath,
              completedAt: new Date().toISOString(),
              outcomes
            },
            sourceWebview
          );
        }
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : "Unable to start parallel beads.";
        vscode.window.showErrorMessage(messageText);
        this.postHostMessage(
          {
            command: "parallelExecutionResult",
            requestId: message.requestId,
            workspacePath,
            completedAt: new Date().toISOString(),
            outcomes: message.items.map((item) => ({
              ...item,
              status: "failed",
              message: this.formatParallelExecutionError(error)
            }))
          },
          sourceWebview
        );
      } finally {
        this.finishAction(actionKey);
      }
      return;
    }

    if (
      message.command === "mergeParallelPrs" &&
      typeof message.issueId === "string" &&
      typeof message.workspacePath === "string"
    ) {
      const issueId = message.issueId.trim();
      const workspacePath = await this.resolveAuthorizedWorkspacePath(message.workspacePath.trim());
      if (issueId === "" || workspacePath === null) {
        if (workspacePath === null) {
          vscode.window.showWarningMessage(
            "Refusing to merge PRs outside an initialized workspace folder."
          );
        }
        return;
      }

      const actionKey = `merge-parallel:${workspacePath}:${issueId}`;
      if (!this.beginAction(actionKey, `Merging work for ${issueId}`)) {
        return;
      }
      try {
        await this.mergeParallelPullRequests(
          workspacePath,
          issueId,
          message.title,
          message.dependencies
        );
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : "Unable to merge parallel PRs.";
        vscode.window.showErrorMessage(messageText);
      } finally {
        this.finishAction(actionKey);
      }
    }
  }

  private postHostMessage(message: BeadsHostMessage, sourceWebview?: vscode.Webview) {
    if (sourceWebview !== undefined) {
      void sourceWebview.postMessage(message);
      return;
    }
    if (this.webviewView !== null) {
      void this.webviewView.webview.postMessage(message);
    }
    if (this.panel !== null) {
      void this.panel.webview.postMessage(message);
    }
  }

  private async generatePlanDraft(
    message: {
      requestId: string;
      workspacePath: string;
      goal: string;
    },
    sourceWebview?: vscode.Webview
  ) {
    const reply = (result: PlanDraftGenerationReply) => {
      this.postHostMessage({ ...result, requestId: message.requestId }, sourceWebview);
    };

    let artifactUri: string | undefined;
    try {
      const workspacePath = await this.resolveAuthorizedWorkspacePath(message.workspacePath.trim());
      if (workspacePath === null) {
        reply({
          command: "planDraftGenerationResult",
          status: "error",
          message: "Choose an initialized Beads workspace before generating a plan."
        });
        return;
      }
      this.assertTrustedWorkspaceForAgentAction();
      const goal = normalizePlanDraftGenerationGoal(message.goal);
      const provider = await this.pickTextAgentProviderPreference();
      if (provider === null) {
        reply({
          command: "planDraftGenerationResult",
          status: "cancelled",
          message: "Plan generation was cancelled before any provider request was sent."
        });
        return;
      }
      const model = await this.pickAgentModelPreference(provider, undefined);
      if (model === null) {
        reply({
          command: "planDraftGenerationResult",
          status: "cancelled",
          message: "Plan generation was cancelled before any provider request was sent."
        });
        return;
      }
      await this.preflightAgentProvider(provider);

      const providerCatalog = AGENT_PROVIDERS.map((definition) => {
        const configured = getConfig().agentProviderModelOptions(definition.id);
        const models =
          definition.id === provider && !configured.includes(model)
            ? [model, ...configured]
            : configured;
        return { provider: definition.id, models };
      }).filter((entry) => entry.models.length > 0);
      const prompt = buildPlanDraftGenerationPrompt({
        goal,
        workspaceName: path.basename(workspacePath),
        ssotCandidates: ASSIGN_CONTEXT_CANDIDATES.filter((candidate) =>
          fs.existsSync(path.join(workspacePath, candidate))
        ),
        providerCatalog
      });
      if (!(await this.confirmPlanDraftProviderRequest(provider, model))) {
        reply({
          command: "planDraftGenerationResult",
          status: "cancelled",
          message: "Plan generation was cancelled before any provider request was sent."
        });
        return;
      }

      const controller = new AbortController();
      const response = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Generating an editable task plan with ${getAgentProviderDefinition(provider).label}`,
          cancellable: true
        },
        async (_progress, token) => {
          const cancellation = token.onCancellationRequested(() => {
            controller.abort("Plan generation cancelled by user.");
          });
          try {
            const credential = await this.credentialStore.get(provider);
            return await requestAgentProviderResponse({
              provider,
              model,
              prompt,
              apiKey: credential?.value,
              ollamaBaseUrl: provider === "ollama" ? getConfig().agentOllamaBaseUrl() : undefined,
              maxOutputTokens: getConfig().agentProviderMaxOutputTokens(),
              timeoutMs: getConfig().agentProviderTimeoutMs(),
              signal: controller.signal
            });
          } finally {
            cancellation.dispose();
          }
        }
      );

      const capture = await this.artifactStore.writeOrOpenFallback({
        issueId: "plan-draft",
        title: goal.slice(0, 160),
        response
      });
      if (capture.status === "opened-unsaved") {
        reply({
          command: "planDraftGenerationResult",
          status: "error",
          message:
            "The provider response was opened as an unsaved document because local artifact storage failed. Save it manually; the current draft was left unchanged."
        });
        return;
      }
      artifactUri = capture.artifact.reference;

      const parsed = parsePlanDraftGenerationResponse(goal, response.text);
      if (parsed.json.length > 256 * 1024) {
        reply({
          command: "planDraftGenerationResult",
          status: "error",
          message:
            "The generated draft is too large to preview. The raw provider response was preserved locally.",
          artifactUri
        });
        return;
      }
      reply({
        command: "planDraftGenerationResult",
        status: "generated",
        draftText: parsed.json,
        provider,
        requestedModel: response.requestedModel,
        confirmedModel: normalizeAgentModelName(response.confirmedModel) ?? model,
        artifactUri,
        validationErrorCount: Math.min(100, parsed.errors.length)
      });
    } catch (error) {
      const cancelled = error instanceof AgentProviderError && error.code === "cancelled";
      reply({
        command: "planDraftGenerationResult",
        status: cancelled ? "cancelled" : "error",
        message: cancelled
          ? "Plan generation was cancelled. The current draft was left unchanged."
          : error instanceof AgentProviderError
            ? error.message
            : "Plan generation failed. The current draft was left unchanged.",
        ...(artifactUri === undefined ? {} : { artifactUri })
      });
    }
  }

  private async pickTextAgentProviderPreference(): Promise<TextResponseProviderId | null> {
    const selected = await vscode.window.showQuickPick(
      AGENT_PROVIDERS.filter(
        (
          provider
        ): provider is (typeof AGENT_PROVIDERS)[number] & {
          id: TextResponseProviderId;
        } => provider.mode === "text-response"
      ).map((provider) => ({
        label: provider.label,
        description: provider.description,
        provider: provider.id
      })),
      {
        title: "AI provider for task decomposition",
        placeHolder: "Choose a provider that returns a reviewable Plan Draft."
      }
    );
    return selected?.provider ?? null;
  }

  private async confirmPlanDraftProviderRequest(provider: TextResponseProviderId, model: string) {
    const providerLabel = getAgentProviderDefinition(provider).label;
    const selected = await vscode.window.showWarningMessage(
      `Generate a task plan with ${providerLabel}?`,
      {
        modal: true,
        detail: `1 × ${providerLabel} / ${model}\n\nThe provider receives your goal, a fixed Plan Draft JSON schema, the workspace display name, relative SSOT candidate names, and configured provider/model choices. File contents, absolute local paths, and API credentials are not included in the prompt. Cloud providers may charge for this request. The response is preserved locally as untrusted text and remains an editable draft; it is never imported into Beads automatically.`
      },
      "Generate Draft"
    );
    return selected === "Generate Draft";
  }

  private async autoAssignAndStartBead(
    workspacePath: string,
    issueId: string,
    title: string | undefined,
    currentProvider: string | undefined,
    currentModel: string | undefined,
    currentSsot: string | undefined,
    currentWorktree: string | undefined
  ) {
    this.assertTrustedWorkspaceForAgentAction();
    const provider = await this.pickAgentProviderPreference(currentProvider);
    if (provider === null) {
      return;
    }
    const model = await this.pickAgentModelPreference(
      provider,
      provider === resolveAgentProviderId(currentProvider) ? currentModel : undefined
    );
    if (model === null) {
      return;
    }
    await this.assertAgentWriteCapability(workspacePath);
    await this.preflightAgentProvider(provider);
    if (
      provider !== "copilot" &&
      !(await this.confirmTextProviderRequests([{ provider, model }]))
    ) {
      return;
    }
    const ssot = this.resolveAssignSsot(workspacePath, issueId, currentSsot);
    const worktree =
      provider === "copilot"
        ? this.resolveAssignWorktree(workspacePath, issueId, currentWorktree)
        : "";

    const startResult = await this.assignAndStartBead({
      workspacePath,
      issueId,
      title,
      provider,
      model,
      ssot,
      worktree
    });
    if (startResult.status === "not-ready") {
      vscode.window.showWarningMessage(
        startResult.phase === "before-preparation"
          ? `Refusing to start ${issueId}: bd ready no longer reports this task as ready. Refresh the Beads view and review its dependencies.`
          : startResult.phase === "dependencies-changed"
            ? `Stopped ${issueId} because its dependency handoffs changed while generating the response. The response artifact was preserved locally and opened when possible; no Beads mutation was made.`
            : provider === "copilot"
              ? `Stopped ${issueId} before updating Beads because readiness changed while preparing its worktree. No agent session was started.`
              : `Stopped ${issueId} before updating Beads because readiness changed while generating the response. The response artifact was preserved locally and opened when possible; no Beads mutation was made.`
      );
      return;
    }
    const openResult = startResult.result;
    await this.refresh();

    if (openResult === "session-opened") {
      vscode.window.showInformationMessage(
        `Started ${issueId} with requested model ${model}. Opened Copilot agent session for ${path.basename(worktree)}.`
      );
      return;
    }

    if (openResult === "prompt-prepared") {
      vscode.window.showInformationMessage(
        `Started ${issueId} with requested model ${model}. Copilot agent prompt copied to clipboard; paste it into Copilot chat.`
      );
      return;
    }

    if (openResult === "response-opened" || openResult === "response-stored") {
      const providerLabel = getAgentProviderDefinition(provider).label;
      const detail =
        openResult === "response-opened"
          ? "Opened the local response artifact for review."
          : "Stored the local response artifact, but could not open it.";
      vscode.window.showInformationMessage(
        `${providerLabel} generated a response for ${issueId} with requested model ${model}. ${detail} No code was applied automatically.`
      );
      return;
    }

    vscode.window.showWarningMessage(
      provider === "copilot"
        ? `Updated ${issueId} with requested model ${model}, but could not open Copilot chat or copy the agent prompt.`
        : `Generated a response for ${issueId}, but could not store its local artifact.`
    );
  }

  private async assignAndStartBead(values: {
    workspacePath: string;
    issueId: string;
    title: string | undefined;
    provider: AgentProviderId;
    model: string;
    ssot: string;
    worktree: string;
    signal?: AbortSignal;
    writeCapabilityAlreadyChecked?: boolean;
  }) {
    let preparedForFinalization: PreparedAgentExecution | undefined;
    return runReadinessGuardedStart<PreparedAgentExecution, AssignAgentOpenResult>({
      issueId: values.issueId,
      queryReadyItemIds: () => this.queryReadyItemIds(values.workspacePath),
      queryDependencyIds: async () => {
        const dependencies = await this.queryDependencyIdsForStart(
          [values.issueId],
          values.workspacePath
        );
        return dependencies.get(values.issueId) ?? [];
      },
      preflight: values.writeCapabilityAlreadyChecked
        ? undefined
        : () => this.assertAgentWriteCapability(values.workspacePath),
      prepare: async (dependencyIds) => {
        if (values.signal?.aborted) {
          throw new AgentProviderError("cancelled", "The AI task was cancelled.");
        }
        if (values.provider === "copilot") {
          const prepared: PreparedAgentExecution = {
            kind: "copilot-worktree",
            worktree: await this.agentExecutionQueue.enqueue(values.workspacePath, () =>
              this.ensureAgentWorktree(values.workspacePath, values.issueId, values.worktree)
            )
          };
          preparedForFinalization = prepared;
          return prepared;
        }
        const response = await this.requestTextProviderResponse(
          {
            workspacePath: values.workspacePath,
            issueId: values.issueId,
            title: values.title,
            provider: values.provider,
            model: values.model,
            ssot: values.ssot
          },
          dependencyIds,
          values.signal
        );
        const capture = await this.artifactStore.writeOrOpenFallback({
          issueId: values.issueId,
          title: values.title,
          response
        });
        if (capture.status === "opened-unsaved") {
          throw new Error(
            `Generated the ${values.provider} response, but extension storage failed: ${capture.storageError}. The response was opened as an unsaved document; save it before closing. No Beads mutation was made.`
          );
        }
        const prepared: PreparedAgentExecution = {
          kind: "text-response",
          artifact: capture.artifact,
          dependencyIds: [...dependencyIds]
        };
        preparedForFinalization = prepared;
        return prepared;
      },
      preservePreparedOnAbort: async (prepared) => {
        if (prepared.kind === "text-response") {
          await this.openAgentResponseArtifact(prepared.artifact);
        }
      },
      isPreparedStillValid: (prepared, dependencyIds) =>
        prepared.kind !== "text-response" ||
        this.haveSameDependencyIds(prepared.dependencyIds, dependencyIds),
      runFinalization: (operation) =>
        this.agentExecutionQueue.enqueue(values.workspacePath, async () => {
          if (values.signal?.aborted) {
            if (preparedForFinalization?.kind === "text-response") {
              await this.openAgentResponseArtifact(preparedForFinalization.artifact);
            }
            throw new AgentProviderError(
              "cancelled",
              "The AI task was cancelled before Beads was updated."
            );
          }
          return operation();
        }),
      mutateAndLaunch: async (prepared, dependencyIds) => {
        if (prepared.kind === "text-response") {
          const agent = `${values.provider}:${values.model}`;
          return persistGeneratedAgentResponse({
            createArtifact: async () => prepared.artifact,
            updateBead: async (artifact) => {
              const metadata = [
                `agent=${agent}`,
                `provider=${values.provider}`,
                `model=${values.model}`,
                `ssot=${values.ssot}`,
                "provider_status=response_completed",
                `artifact_run=${artifact.runId}`,
                `artifact=${artifact.reference}`
              ];
              const notes = [
                `provider=${values.provider}`,
                `model=${values.model}`,
                "provider_status=response_completed",
                `artifact_run=${artifact.runId}`,
                `artifact=${artifact.reference}`
              ];
              await this.runBdCommand(
                buildAgentBeadUpdateArgs({
                  issueId: values.issueId,
                  assignee: agent,
                  notes,
                  metadata
                }),
                values.workspacePath
              );
            },
            flushBeads: async () => {
              await flushBeadsWorkspace(
                (args, cwd) => this.runBdCommand(args, cwd),
                values.workspacePath
              );
            },
            openArtifact: (artifact) => this.openAgentResponseArtifact(artifact)
          });
        }

        const worktree = prepared.worktree.path;
        const metadata = [
          `agent=${values.model}`,
          `provider=${values.provider}`,
          `model=${values.model}`,
          `ssot=${values.ssot}`,
          `worktree=${worktree}`,
          prepared.worktree.branch.trim() === "" ? "" : `branch=${prepared.worktree.branch.trim()}`
        ].filter((entry) => entry !== "");

        const notes = [
          `provider=${values.provider}`,
          `model=${values.model}`,
          `ssot=${values.ssot}`,
          `worktree=${worktree}`,
          prepared.worktree.branch.trim() === "" ? "" : `branch=${prepared.worktree.branch.trim()}`
        ].filter((entry) => entry !== "");

        await this.runBdCommand(
          buildAgentBeadUpdateArgs({
            issueId: values.issueId,
            assignee: values.model,
            notes,
            metadata
          }),
          values.workspacePath
        );
        await flushBeadsWorkspace(
          (args, cwd) => this.runBdCommand(args, cwd),
          values.workspacePath
        );

        return this.openAssignAgentSession({
          ...values,
          provider: "copilot",
          worktree,
          dependencyIds
        });
      }
    });
  }

  private async startParallelBeads(
    workspacePath: string,
    items: BeadsExecutionTarget[],
    skipped: BeadsExecutionSkip[] = []
  ): Promise<ParallelExecutionOutcome[] | null> {
    this.assertTrustedWorkspaceForAgentAction();
    const selection = await this.pickParallelAgentProviderModelPreference(items);
    if (selection.cancelled) {
      return null;
    }
    await this.assertAgentWriteCapability(workspacePath);
    const readyItemIds = await this.queryReadyItemIds(workspacePath);
    const revalidated = revalidateExecutionTargets(items, readyItemIds);
    const revalidatedSkipped = [...skipped, ...revalidated.noLongerReady];
    const outcomes: ParallelExecutionOutcome[] = [
      ...new Map(
        revalidatedSkipped.map((item) => [
          item.issueId.trim(),
          {
            issueId: item.issueId.trim(),
            title: item.title,
            status: "skipped" as const,
            message: item.reason.trim()
          }
        ])
      ).values()
    ];
    if (revalidated.ready.length === 0) {
      const skippedSummary = this.formatSkippedParallelTargets(revalidatedSkipped);
      vscode.window.showWarningMessage(
        skippedSummary === ""
          ? "No parallel beads were available to start."
          : `No parallel beads were available to start. Skipped ${skippedSummary}.`
      );
      return outcomes;
    }
    const selectedItems = revalidated.ready.map((item) => ({
      ...item,
      ...(selection.overrideProvider === null ? {} : { provider: selection.overrideProvider }),
      ...(selection.overrideModel === null ? {} : { model: selection.overrideModel })
    }));
    const missingModelItems: string[] = [];
    const candidates = selectedItems.flatMap((item) => {
      const provider = resolveAgentProviderId(item.provider);
      const model = this.resolveAssignModel(provider, item.model);
      if (model === null) {
        missingModelItems.push(item.issueId.trim());
        outcomes.push({
          ...item,
          issueId: item.issueId.trim(),
          provider,
          status: "failed",
          message:
            "No model is configured. Set a provider-specific model option or override the provider and model for this run."
        });
        return [];
      }
      return [
        {
          issueId: item.issueId.trim(),
          title: item.title,
          provider,
          model,
          ssot: "",
          worktree: ""
        }
      ];
    });
    if (missingModelItems.length > 0) {
      vscode.window.showWarningMessage(
        `No model is configured for ${missingModelItems.join(", ")}. Set a provider-specific model option or override the provider and model for this run.`
      );
    }

    let uniqueCandidates = [...new Map(candidates.map((item) => [item.issueId, item])).values()];
    const unavailableProviders = new Map<AgentProviderId, string>();
    for (const provider of new Set(uniqueCandidates.map((candidate) => candidate.provider))) {
      try {
        await this.preflightAgentProvider(provider);
      } catch (error) {
        unavailableProviders.set(provider, this.formatParallelExecutionError(error));
      }
    }
    if (unavailableProviders.size > 0) {
      for (const candidate of uniqueCandidates) {
        const reason = unavailableProviders.get(candidate.provider);
        if (reason !== undefined) {
          outcomes.push({ ...candidate, status: "failed", message: reason });
        }
      }
      uniqueCandidates = uniqueCandidates.filter(
        (candidate) => !unavailableProviders.has(candidate.provider)
      );
    }
    if (uniqueCandidates.length === 0) {
      await this.refresh();
      return outcomes;
    }

    const textRequests = uniqueCandidates
      .filter(
        (candidate): candidate is typeof candidate & { provider: TextResponseProviderId } =>
          candidate.provider !== "copilot"
      )
      .map(({ provider, model }) => ({ provider, model }));
    const directConcurrency = getConfig().agentParallelConcurrency();
    if (!(await this.confirmTextProviderRequests(textRequests, directConcurrency))) {
      outcomes.push(
        ...uniqueCandidates.map((candidate) => ({
          ...candidate,
          status: "cancelled" as const,
          message: "The batch was cancelled before any task was started."
        }))
      );
      return outcomes;
    }

    for (const candidate of uniqueCandidates) {
      const source = selectedItems.find((item) => item.issueId.trim() === candidate.issueId);
      candidate.ssot = this.resolveAssignSsot(workspacePath, candidate.issueId, source?.ssot);
      candidate.worktree =
        candidate.provider === "copilot"
          ? this.resolveAssignWorktree(workspacePath, candidate.issueId, source?.worktree)
          : "";
    }

    const directCandidates = uniqueCandidates.filter(
      (candidate): candidate is typeof candidate & { provider: TextResponseProviderId } =>
        candidate.provider !== "copilot"
    );
    const copilotCandidates = uniqueCandidates.filter(
      (candidate): candidate is typeof candidate & { provider: "copilot" } =>
        candidate.provider === "copilot"
    );
    const controller = new AbortController();
    let completed = 0;
    const total = uniqueCandidates.length;
    const completedOutcomes = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Running ${total} ready AI task${total === 1 ? "" : "s"}`,
        cancellable: true
      },
      async (progress, token) => {
        const cancellation = token.onCancellationRequested(() => {
          controller.abort("Parallel AI work cancelled by user.");
        });
        const reportCompletion = (issueId: string) => {
          completed += 1;
          progress.report({ message: `${completed}/${total}: ${issueId}` });
        };
        try {
          const directPromise = runBoundedAllSettled(
            directCandidates,
            async (candidate, _index, signal) =>
              this.runParallelExecutionCandidate(workspacePath, candidate, signal),
            {
              limit: directConcurrency,
              signal: controller.signal,
              onProgress: ({ item }) => {
                reportCompletion(item.issueId);
              }
            }
          ).then((results) =>
            results.map((result, index): ParallelExecutionOutcome => {
              const candidate = directCandidates[index];
              if (result.status === "fulfilled") {
                return result.value;
              }
              if (result.status === "cancelled") {
                return {
                  ...candidate,
                  status: "cancelled",
                  message: "Cancelled before the provider request started."
                };
              }
              return {
                ...candidate,
                status:
                  result.reason instanceof AgentProviderError && result.reason.code === "cancelled"
                    ? "cancelled"
                    : "failed",
                message: this.formatParallelExecutionError(result.reason)
              };
            })
          );

          const copilotPromise = (async () => {
            const results: ParallelExecutionOutcome[] = [];
            for (const candidate of copilotCandidates) {
              if (controller.signal.aborted) {
                results.push({
                  ...candidate,
                  status: "cancelled",
                  message: "Cancelled before the Copilot session was prepared."
                });
                reportCompletion(candidate.issueId);
                continue;
              }
              try {
                results.push(
                  await this.runParallelExecutionCandidate(
                    workspacePath,
                    candidate,
                    controller.signal
                  )
                );
              } catch (error) {
                results.push({
                  ...candidate,
                  status:
                    error instanceof AgentProviderError && error.code === "cancelled"
                      ? "cancelled"
                      : "failed",
                  message: this.formatParallelExecutionError(error)
                });
              }
              reportCompletion(candidate.issueId);
            }
            return results;
          })();

          const [directOutcomes, copilotOutcomes] = await Promise.all([
            directPromise,
            copilotPromise
          ]);
          return [...directOutcomes, ...copilotOutcomes];
        } finally {
          cancellation.dispose();
        }
      }
    );

    outcomes.push(...completedOutcomes);
    await this.refresh();
    const succeeded = outcomes.filter((outcome) =>
      ["response-ready", "session-started", "prompt-prepared"].includes(outcome.status)
    ).length;
    const failed = outcomes.filter((outcome) => outcome.status === "failed").length;
    const cancelled = outcomes.filter((outcome) => outcome.status === "cancelled").length;
    const skippedCount = outcomes.filter((outcome) => outcome.status === "skipped").length;
    vscode.window.showInformationMessage(
      `AI task batch completed: ${succeeded} ready result(s), ${failed} failed, ${cancelled} cancelled, ${skippedCount} skipped.`
    );
    return outcomes;
  }

  private async runParallelExecutionCandidate(
    workspacePath: string,
    candidate: {
      issueId: string;
      title: string | undefined;
      provider: AgentProviderId;
      model: string;
      ssot: string;
      worktree: string;
    },
    signal: AbortSignal | undefined
  ): Promise<ParallelExecutionOutcome> {
    if (signal?.aborted) {
      throw new AgentProviderError("cancelled", "The AI task was cancelled.");
    }
    const startResult = await this.assignAndStartBead({
      workspacePath,
      ...candidate,
      signal,
      writeCapabilityAlreadyChecked: true
    });
    if (startResult.status === "not-ready") {
      const message =
        startResult.phase === "before-preparation"
          ? "No longer reported ready by bd."
          : startResult.phase === "dependencies-changed"
            ? "Dependency handoffs changed after generation; the response artifact was preserved locally."
            : candidate.provider === "copilot"
              ? "Readiness changed while preparing the worktree."
              : "Readiness changed after generation; the response artifact was preserved locally.";
      return { ...candidate, status: "skipped", message };
    }
    switch (startResult.result) {
      case "session-opened":
        return { ...candidate, status: "session-started", message: "Copilot session opened." };
      case "prompt-prepared":
        return {
          ...candidate,
          status: "prompt-prepared",
          message: "Copilot prompt copied for manual paste."
        };
      case "response-opened":
        return {
          ...candidate,
          status: "response-ready",
          message: "Local provider response artifact generated and opened."
        };
      case "response-stored":
        return {
          ...candidate,
          status: "response-ready",
          message: "Local provider response artifact generated and stored."
        };
      default:
        return {
          ...candidate,
          status: "failed",
          message: "The provider completed, but no usable session, prompt, or artifact was opened."
        };
    }
  }

  private formatParallelExecutionError(error: unknown) {
    const message =
      error instanceof AgentProviderError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Provider execution failed.";
    const normalized = message.trim() || "Provider execution failed.";
    return normalized.length <= 1_500 ? normalized : `${normalized.slice(0, 1_497)}...`;
  }

  private formatSkippedParallelTargets(skipped: BeadsExecutionSkip[]) {
    const uniqueSkipped = [
      ...new Map(
        skipped
          .filter((item) => item.issueId.trim() !== "" && item.reason.trim() !== "")
          .map((item) => [item.issueId.trim(), item])
      ).values()
    ];
    if (uniqueSkipped.length === 0) {
      return "";
    }

    const preview = uniqueSkipped
      .slice(0, 4)
      .map((item) => `${item.issueId.trim()} (${item.reason.trim()})`)
      .join(", ");
    const remaining = uniqueSkipped.length - 4;
    return remaining > 0 ? `${preview}, +${remaining} more` : preview;
  }

  private async mergeParallelPullRequests(
    workspacePath: string,
    issueId: string,
    title: string | undefined,
    dependencies: BeadsExecutionTarget[]
  ) {
    this.assertTrustedWorkspaceForAgentAction();
    await this.assertAgentWriteCapability(workspacePath);
    const worktrees = await this.resolveDependencyWorktrees(workspacePath, dependencies);
    if (worktrees.length === 0) {
      throw new Error("No dependency worktrees were found for this parallel merge task.");
    }

    await this.runGitCommand(["fetch", "origin"], workspacePath);
    const preflightChecks = await this.assertWorktreesReadyForMerge(worktrees);
    const pullRequestChecks = await this.assertPullRequestsReadyForMerge(worktrees, workspacePath);

    const confirmation = await vscode.window.showWarningMessage(
      `Auto-merge PRs for ${issueId}${title ? `: ${title}` : ""}?`,
      {
        modal: true,
        detail: `Preflight passed for ${preflightChecks.length} agent worktree(s) and ${pullRequestChecks.length} PR(s):\n${this.formatWorktreeMergeChecks(preflightChecks)}\n${this.formatPullRequestMergeChecks(pullRequestChecks)}`
      },
      "Merge PRs"
    );
    if (confirmation !== "Merge PRs") {
      return;
    }

    const mergedPrs: string[] = [];
    for (const pullRequest of pullRequestChecks) {
      await this.runExternalCommand(
        "gh",
        ["pr", "merge", String(pullRequest.number), "--auto", "--squash", "--delete-branch"],
        workspacePath
      );
      await this.waitForPullRequestMerged(pullRequest.number, workspacePath);
      mergedPrs.push(`#${pullRequest.number}`);
    }

    await this.runGitCommand(["pull", "--rebase"], workspacePath);
    const syncResult = await syncBeadsWorkspace(
      (args, cwd) => this.runBdCommand(args, cwd),
      workspacePath
    );
    await this.refresh();
    if (syncResult.status === "synced") {
      vscode.window.showInformationMessage(`Merged ${mergedPrs.join(", ")} and synced Beads.`);
    } else {
      vscode.window.showWarningMessage(
        `Merged ${mergedPrs.join(", ")}. The Beads CLI does not support sync; data was not synced.`
      );
    }
  }

  private async openAssignAgentSession(values: {
    workspacePath: string;
    issueId: string;
    title: string | undefined;
    provider: "copilot";
    model: string;
    ssot: string;
    worktree: string | undefined;
    dependencyIds: readonly string[];
  }): Promise<AssignAgentOpenResult> {
    const commands = new Set(await vscode.commands.getCommands(true));
    const prompt = buildAgentWorkPrompt(values);
    const resource = vscode.Uri.file(values.worktree?.trim() || values.workspacePath);

    for (const command of COPILOT_ASSIGN_COMMAND_CANDIDATES) {
      if (!commands.has(command)) {
        continue;
      }

      try {
        await vscode.commands.executeCommand(command, {
          prompt,
          resource
        });
        return "session-opened";
      } catch {
        continue;
      }
    }

    try {
      await vscode.env.clipboard.writeText(prompt);
      for (const command of CHAT_FALLBACK_COMMAND_CANDIDATES) {
        if (!commands.has(command)) {
          continue;
        }
        try {
          await vscode.commands.executeCommand(command);
          break;
        } catch {
          continue;
        }
      }
      return "prompt-prepared";
    } catch {
      return "failed";
    }
  }

  private async pickAgentProviderPreference(currentProvider: string | undefined) {
    const taskProvider = resolveAgentProviderId(currentProvider);
    const selected = await vscode.window.showQuickPick(
      AGENT_PROVIDERS.map((provider) => ({
        label: provider.label,
        description:
          provider.id === taskProvider
            ? currentProvider === undefined || currentProvider.trim() === ""
              ? "Current/default provider"
              : "Task provider preference"
            : provider.description,
        provider: provider.id
      })),
      {
        title: "AI provider",
        placeHolder:
          "Copilot opens a coding session. Other providers generate a reviewable text artifact."
      }
    );
    return selected?.provider ?? null;
  }

  private async pickAgentModelPreference(
    provider: AgentProviderId,
    currentModel: string | undefined
  ) {
    const taskModel = normalizeAgentModelName(currentModel);
    const configuredModels = getConfig().agentProviderModelOptions(provider);
    const modelOptions =
      provider === "copilot"
        ? buildAgentModelOptions(currentModel, configuredModels)
        : [
            ...new Set(
              [currentModel, ...configuredModels]
                .map(normalizeAgentModelName)
                .filter((model): model is string => model !== null)
            )
          ];
    const providerLabel = getAgentProviderDefinition(provider).label;
    const selected = await vscode.window.showQuickPick(
      [
        ...modelOptions.map((model) => ({
          label: model,
          description: model === taskModel ? "Task model preference" : "Configured preference",
          choice: "model" as const,
          model
        })),
        {
          label: "Enter another model...",
          description: "Record a different model preference",
          choice: "custom" as const,
          model: ""
        }
      ],
      {
        title: `Model for ${providerLabel}`,
        placeHolder: "Choose the exact requested model. Availability is checked by the provider."
      }
    );
    if (selected === undefined) {
      return null;
    }
    if (selected.choice === "model") {
      return selected.model;
    }
    return this.inputCustomAgentModel(provider);
  }

  private async pickParallelAgentProviderModelPreference(
    items: readonly BeadsExecutionTarget[]
  ): Promise<{
    cancelled: boolean;
    overrideProvider: AgentProviderId | null;
    overrideModel: string | null;
  }> {
    const selected = await vscode.window.showQuickPick(
      [
        {
          label: "Use each task's provider and model",
          description: "Preserve every task-specific provider/model handoff",
          choice: "per-task" as const,
          provider: "copilot" as AgentProviderId
        },
        ...AGENT_PROVIDERS.map((provider) => ({
          label: `Use ${provider.label} for every task`,
          description: provider.description,
          choice: "provider" as const,
          provider: provider.id
        }))
      ],
      {
        title: "Provider for parallel work",
        placeHolder: "Keep task-specific handoffs or override every selected task."
      }
    );
    if (selected === undefined) {
      return { cancelled: true, overrideProvider: null, overrideModel: null };
    }
    if (selected.choice === "per-task") {
      return { cancelled: false, overrideProvider: null, overrideModel: null };
    }
    const existingModel = items.find(
      (item) => resolveAgentProviderId(item.provider) === selected.provider
    )?.model;
    const model = await this.pickAgentModelPreference(selected.provider, existingModel);
    return model === null
      ? { cancelled: true, overrideProvider: null, overrideModel: null }
      : {
          cancelled: false,
          overrideProvider: selected.provider,
          overrideModel: model
        };
  }

  private async inputCustomAgentModel(provider: AgentProviderId) {
    const providerLabel = getAgentProviderDefinition(provider).label;
    const value = await vscode.window.showInputBox({
      title: `Model for ${providerLabel}`,
      prompt: "Enter the exact provider model ID to request and record with the task.",
      validateInput: (input) =>
        normalizeAgentModelName(input) === null
          ? "Enter a one-line model name between 1 and 100 characters."
          : null
    });
    return value === undefined ? null : normalizeAgentModelName(value);
  }

  private resolveAssignModel(provider: AgentProviderId, currentModel: string | undefined) {
    const normalized = normalizeAgentModelName(currentModel);
    if (normalized !== null) {
      return normalized;
    }
    return provider === "copilot"
      ? DEFAULT_AGENT_MODEL
      : (getConfig().agentProviderModelOptions(provider)[0] ?? null);
  }

  private assertTrustedWorkspaceForAgentAction() {
    assertBeadsProcessTrusted(vscode.workspace.isTrusted);
  }

  private async assertWorkspaceWriteCapability(workspacePath: string) {
    const executableStatus = await this.getBdExecutableStatus();
    const capability = await probeBeadsWriteCapability(
      executableStatus.available,
      executableStatus.message,
      (args) => this.runBdCapabilityProbe(args, workspacePath)
    );
    if (!capability.supported) {
      throw new Error(`Beads cannot be updated safely: ${capability.reason}`);
    }
  }

  private async assertAgentWriteCapability(workspacePath: string) {
    const executableStatus = await this.getBdExecutableStatus();
    const capability = await probeBeadsAgentWriteCapability(
      executableStatus.available,
      executableStatus.message,
      (args) => this.runBdCapabilityProbe(args, workspacePath)
    );
    if (!capability.supported) {
      throw new Error(
        `AI work is disabled because Beads cannot be updated safely: ${capability.reason}`
      );
    }
  }

  private async preflightAgentProvider(provider: AgentProviderId) {
    this.assertTrustedWorkspaceForAgentAction();
    if (provider === "copilot") {
      return;
    }
    if (provider === "ollama") {
      normalizeOllamaBaseUrl(getConfig().agentOllamaBaseUrl());
      return;
    }
    const credential = await this.credentialStore.get(provider);
    if (credential === null) {
      const definition = getAgentProviderDefinition(provider);
      throw new Error(
        `${definition.label} has no credential. Run “Beads Git Graph: Manage AI Provider Credentials” or set ${definition.credentialEnvironmentVariable}.`
      );
    }
  }

  private async confirmTextProviderRequests(
    requests: ReadonlyArray<{ provider: TextResponseProviderId; model: string }>,
    concurrency = 1
  ) {
    if (requests.length === 0) {
      return true;
    }
    if (requests.length > MAX_PARALLEL_TEXT_PROVIDER_REQUESTS) {
      vscode.window.showWarningMessage(
        `Refusing to send ${requests.length} text-response requests at once. Select ${MAX_PARALLEL_TEXT_PROVIDER_REQUESTS} or fewer tasks and retry.`
      );
      return false;
    }
    const groups = new Map<string, number>();
    for (const request of requests) {
      const key = `${getAgentProviderDefinition(request.provider).label} / ${request.model}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    const summary = [...groups.entries()].map(([label, count]) => `${count} × ${label}`).join("\n");
    const action = requests.length === 1 ? "Generate Response" : "Generate Responses";
    const selected = await vscode.window.showWarningMessage(
      `Generate ${requests.length} text response${requests.length === 1 ? "" : "s"}?`,
      {
        modal: true,
        detail: `${summary}\n\nUp to ${Math.min(requests.length, concurrency)} direct provider request${Math.min(requests.length, concurrency) === 1 ? "" : "s"} run concurrently. Beads and Git mutations remain serialized per workspace.\n\nThe provider receives the task ID/title, workspace name, SSOT references, and dependency IDs. File contents and API credentials are not included in the prompt. Cloud providers may charge for each request. Output is stored locally as untrusted text and is never applied automatically.`
      },
      action
    );
    return selected === action;
  }

  private async requestTextProviderResponse(
    values: {
      workspacePath: string;
      issueId: string;
      title: string | undefined;
      provider: TextResponseProviderId;
      model: string;
      ssot: string;
    },
    dependencyIds: readonly string[],
    signal?: AbortSignal
  ) {
    const credential = await this.credentialStore.get(values.provider);
    const prompt = buildAgentWorkPrompt({
      ...values,
      worktree: undefined,
      dependencyIds,
      includeLocalPaths: false,
      executionMode: "text-response"
    });
    return requestAgentProviderResponse({
      provider: values.provider,
      model: values.model,
      prompt,
      apiKey: credential?.value,
      ollamaBaseUrl: values.provider === "ollama" ? getConfig().agentOllamaBaseUrl() : undefined,
      maxOutputTokens: getConfig().agentProviderMaxOutputTokens(),
      timeoutMs: getConfig().agentProviderTimeoutMs(),
      signal
    });
  }

  private async openAgentResponseArtifact(artifact: AgentResponseArtifact) {
    try {
      await this.artifactStore.open(artifact);
      return "response-opened" as const;
    } catch {
      return "response-stored" as const;
    }
  }

  private haveSameDependencyIds(left: readonly string[], right: readonly string[]) {
    const normalize = (values: readonly string[]) =>
      [...new Set(values.map((value) => value.trim()).filter((value) => value !== ""))].sort();
    const normalizedLeft = normalize(left);
    const normalizedRight = normalize(right);
    return (
      normalizedLeft.length === normalizedRight.length &&
      normalizedLeft.every((value, index) => value === normalizedRight[index])
    );
  }

  private resolveAssignSsot(
    workspacePath: string,
    issueId: string,
    currentSsot: string | undefined
  ) {
    return currentSsot?.trim() || this.inferAssignSsot(workspacePath, issueId);
  }

  private inferAssignSsot(workspacePath: string, issueId: string) {
    const manifestEntries = this.loadAssignSsotManifestEntries(workspacePath, issueId);
    if (manifestEntries.length > 0) {
      return manifestEntries.join(", ");
    }

    const references = ASSIGN_CONTEXT_CANDIDATES.filter((candidate) =>
      fs.existsSync(path.join(workspacePath, candidate))
    );

    return [`bd:${issueId}`, ...references].join(", ");
  }

  private loadAssignSsotManifestEntries(workspacePath: string, issueId: string) {
    for (const candidate of SSOT_USAGE_MANIFEST_CANDIDATES) {
      const manifestPath = path.join(workspacePath, candidate);
      if (!fs.existsSync(manifestPath)) {
        continue;
      }

      try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
        const entries = this.normalizeSsotManifestEntries(workspacePath, issueId, parsed);
        if (entries.length > 0) {
          return entries;
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "unknown manifest parse error";
        throw new Error(`Unable to read SSOT usage manifest at ${manifestPath}: ${messageText}`);
      }
    }

    return [];
  }

  private normalizeSsotManifestEntries(
    workspacePath: string,
    issueId: string,
    manifest: Record<string, unknown>
  ) {
    const values: string[] = [];
    const pushValue = (value: unknown) => {
      if (typeof value === "string") {
        values.push(value);
        return;
      }
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return;
      }

      const record = value as Record<string, unknown>;
      const candidate = record.ref ?? record.path ?? record.url ?? record.id;
      if (typeof candidate === "string") {
        values.push(candidate);
      }
    };

    if (Array.isArray(manifest.default)) {
      manifest.default.forEach(pushValue);
    }
    if (Array.isArray(manifest.contexts)) {
      manifest.contexts.forEach(pushValue);
    }

    const normalized = values
      .map((value) => value.replace(/\$\{issueId\}/g, issueId).trim())
      .filter((value) => value !== "")
      .filter((value) => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
          return true;
        }
        return fs.existsSync(path.join(workspacePath, value));
      });

    return [...new Set(normalized)];
  }

  private async waitForPullRequestMerged(pullRequestNumber: number, cwd: string) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const stdout = await this.runExternalCommand(
        "gh",
        ["pr", "view", String(pullRequestNumber), "--json", "state"],
        cwd
      );
      const parsed = JSON.parse(stdout) as { state?: unknown };
      if (parsed.state === "MERGED") {
        return;
      }
      if (parsed.state === "CLOSED") {
        throw new Error(`Pull request #${pullRequestNumber} closed without merging.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    throw new Error(
      `Pull request #${pullRequestNumber} was queued but did not merge within 5 minutes; Beads sync was skipped.`
    );
  }

  private resolveAssignWorktree(
    workspacePath: string,
    issueId: string,
    currentWorktree: string | undefined
  ) {
    const trimmed = currentWorktree?.trim();
    if (trimmed) {
      return trimmed;
    }

    const safeIssueId = issueId.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
    return path.join(path.dirname(workspacePath), `${path.basename(workspacePath)}-${safeIssueId}`);
  }

  private async resolveDependencyWorktrees(
    workspacePath: string,
    dependencies: BeadsExecutionTarget[]
  ) {
    const knownWorktrees = await this.listGitWorktrees(workspacePath);
    const knownByPath = new Map(
      knownWorktrees.map((worktree) => [path.resolve(worktree.path), worktree])
    );
    const resolved: GitWorktreeInfo[] = [];

    for (const dependency of dependencies) {
      const worktreeHint = dependency.worktree?.trim();
      if (!worktreeHint) {
        throw new Error(`Bead ${dependency.issueId} has no worktree metadata.`);
      }

      const requestedPath = path.resolve(workspacePath, worktreeHint);
      const worktree = knownByPath.get(requestedPath);
      if (!worktree) {
        throw new Error(
          `Worktree for bead ${dependency.issueId} is not registered with git worktree list: ${worktreeHint}`
        );
      }
      resolved.push(worktree);
    }

    return [...new Map(resolved.map((worktree) => [worktree.path, worktree])).values()];
  }

  private async ensureAgentWorktree(workspacePath: string, issueId: string, worktreeHint: string) {
    const worktreePath = path.resolve(workspacePath, worktreeHint);
    const knownWorktrees = await this.listGitWorktrees(workspacePath);
    const knownWorktree = knownWorktrees.find(
      (worktree) => path.resolve(worktree.path) === worktreePath
    );
    if (knownWorktree) {
      return knownWorktree;
    }

    if (fs.existsSync(worktreePath)) {
      throw new Error(
        `Worktree path already exists but is not registered with git worktree list: ${worktreePath}`
      );
    }

    const branchName = `agent/${issueId.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80)}`;
    const branchExists = await this.gitRefExists(workspacePath, `refs/heads/${branchName}`);
    await this.runGitCommand(
      branchExists
        ? ["worktree", "add", worktreePath, branchName]
        : ["worktree", "add", "-b", branchName, worktreePath, "HEAD"],
      workspacePath
    );

    const head = await this.resolveGitHead(worktreePath);
    return { path: worktreePath, branch: branchName, head };
  }

  private async resolveGitHead(cwd: string) {
    try {
      return (await this.runGitCommand(["rev-parse", "HEAD"], cwd)).trim();
    } catch {
      return "";
    }
  }

  private async gitRefExists(cwd: string, refName: string) {
    try {
      await this.runGitCommand(["show-ref", "--verify", "--quiet", refName], cwd);
      return true;
    } catch {
      return false;
    }
  }

  private async listGitWorktrees(cwd: string) {
    const stdout = await this.runGitCommand(["worktree", "list", "--porcelain"], cwd);
    const worktrees: GitWorktreeInfo[] = [];
    let current: GitWorktreeInfo | null = null;

    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line === "") {
        if (current !== null) {
          worktrees.push(current);
          current = null;
        }
        continue;
      }

      const [key, ...valueParts] = line.split(" ");
      const value = valueParts.join(" ");
      if (key === "worktree") {
        if (current !== null) {
          worktrees.push(current);
        }
        current = { path: value, branch: "", head: "" };
      } else if (current !== null && key === "branch") {
        current.branch = value.replace(/^refs\/heads\//, "");
      } else if (current !== null && key === "HEAD") {
        current.head = value;
      }
    }

    if (current !== null) {
      worktrees.push(current);
    }

    return worktrees;
  }

  private async assertWorktreesReadyForMerge(worktrees: GitWorktreeInfo[]) {
    const checks = await this.checkWorktreesReadyForMerge(worktrees);
    const blockedChecks = checks.filter((check) => !check.ok);
    if (blockedChecks.length > 0) {
      throw new Error(
        `Cannot merge parallel PRs until agent worktrees are synced:\n${this.formatWorktreeMergeChecks(blockedChecks)}`
      );
    }

    return checks;
  }

  private async checkWorktreesReadyForMerge(worktrees: GitWorktreeInfo[]) {
    const checks: WorktreeMergeCheck[] = [];
    for (const worktree of worktrees) {
      const reasons: string[] = [];
      if (worktree.branch.trim() === "") {
        reasons.push("detached HEAD; no branch PR can be resolved");
      }
      try {
        await this.runGitCommand(
          ["merge-base", "--is-ancestor", "origin/main", "HEAD"],
          worktree.path
        );
      } catch {
        reasons.push("does not contain origin/main; rebase or merge the latest base");
      }

      const status = await this.runGitCommand(["status", "--porcelain"], worktree.path);
      if (status.trim() !== "") {
        reasons.push("has uncommitted changes; commit or clean it before PR merge");
      }

      checks.push({ worktree, ok: reasons.length === 0, reasons });
    }

    return checks;
  }

  private async assertPullRequestsReadyForMerge(worktrees: GitWorktreeInfo[], cwd: string) {
    const checks = await this.checkPullRequestsReadyForMerge(worktrees, cwd);
    const blockedChecks = checks.filter((check) => !check.ok);
    if (blockedChecks.length > 0) {
      throw new Error(
        `Cannot merge parallel PRs until PR checks are ready:\n${this.formatPullRequestMergeChecks(blockedChecks)}`
      );
    }

    return checks;
  }

  private async checkPullRequestsReadyForMerge(worktrees: GitWorktreeInfo[], cwd: string) {
    const checks: PullRequestMergeCheck[] = [];
    for (const worktree of worktrees) {
      const branch = worktree.branch.trim();
      if (branch === "") {
        checks.push({
          worktree,
          number: 0,
          url: "",
          ok: false,
          reasons: ["detached HEAD; no branch PR can be resolved"]
        });
        continue;
      }

      const pullRequest = await this.findOpenPullRequestForBranch(branch, cwd);
      if (pullRequest === null) {
        checks.push({
          worktree,
          number: 0,
          url: "",
          ok: false,
          reasons: [`no open pull request was found for branch ${branch}`]
        });
        continue;
      }

      const reasons = this.findBlockingPullRequestCheckReasons(pullRequest.statusCheckRollup);
      checks.push({
        worktree,
        number: pullRequest.number,
        url: pullRequest.url,
        ok: reasons.length === 0,
        reasons
      });
    }

    return checks;
  }

  private findBlockingPullRequestCheckReasons(statusCheckRollup: unknown[]) {
    if (statusCheckRollup.length === 0) {
      return ["no status checks were reported by GitHub"];
    }

    const reasons: string[] = [];
    for (const rawCheck of statusCheckRollup) {
      if (typeof rawCheck !== "object" || rawCheck === null) {
        continue;
      }
      const check = rawCheck as Record<string, unknown>;
      const name = this.pickPullRequestCheckName(check);
      const status = typeof check.status === "string" ? check.status.toUpperCase() : "";
      const conclusion = typeof check.conclusion === "string" ? check.conclusion.toUpperCase() : "";
      if (conclusion === "SUCCESS" || conclusion === "SKIPPED" || conclusion === "NEUTRAL") {
        continue;
      }
      if (status !== "" && status !== "COMPLETED") {
        reasons.push(`${name} is ${status.toLowerCase()}`);
        continue;
      }
      reasons.push(
        `${name} concluded ${conclusion === "" ? "without success" : conclusion.toLowerCase()}`
      );
    }

    return reasons;
  }

  private pickPullRequestCheckName(check: Record<string, unknown>) {
    for (const key of ["name", "workflowName", "context"]) {
      const value = check[key];
      if (typeof value === "string" && value.trim() !== "") {
        return value.trim();
      }
    }
    return "check";
  }

  private formatWorktreeMergeChecks(checks: WorktreeMergeCheck[]) {
    return checks
      .map((check) => {
        const branch = check.worktree.branch.trim() || "detached";
        const label = `${branch} (${check.worktree.path})`;
        return check.ok
          ? `- ${label}: clean and contains origin/main`
          : `- ${label}: ${check.reasons.join("; ")}`;
      })
      .join("\n");
  }

  private formatPullRequestMergeChecks(checks: PullRequestMergeCheck[]) {
    return checks
      .map((check) => {
        const branch = check.worktree.branch.trim() || "detached";
        const label = check.number > 0 ? `#${check.number} ${branch}` : branch;
        return check.ok ? `- ${label}: checks passed` : `- ${label}: ${check.reasons.join("; ")}`;
      })
      .join("\n");
  }

  private async findOpenPullRequestForBranch(branch: string, cwd: string) {
    let stdout = "";
    try {
      stdout = await this.runExternalCommand(
        "gh",
        ["pr", "view", branch, "--json", "number,state,isDraft,url,statusCheckRollup"],
        cwd
      );
    } catch {
      return null;
    }

    const parsed = JSON.parse(stdout) as {
      number?: unknown;
      state?: unknown;
      isDraft?: unknown;
      url?: unknown;
      statusCheckRollup?: unknown;
    };
    if (typeof parsed.number !== "number") {
      return null;
    }
    if (parsed.state !== "OPEN") {
      return null;
    }
    if (parsed.isDraft === true) {
      throw new Error(`Pull request #${parsed.number} for ${branch} is still draft.`);
    }
    return {
      number: parsed.number,
      url: typeof parsed.url === "string" ? parsed.url : "",
      statusCheckRollup: Array.isArray(parsed.statusCheckRollup) ? parsed.statusCheckRollup : []
    };
  }

  private async promptAndCreateBead(workspacePath: string) {
    const type = await this.pickCreateBeadType();
    if (!type) {
      return;
    }

    const title = await vscode.window.showInputBox({
      title: "Create Bead",
      prompt: "Title",
      placeHolder: "Implement create action",
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() === "" ? "Title is required." : undefined)
    });
    if (title === undefined) {
      return;
    }

    const status = await this.pickCreateBeadStatus();
    if (!status) {
      return;
    }

    const priority = await this.pickCreateBeadPriority();
    if (!priority) {
      return;
    }

    const bead = await this.createBead(workspacePath, {
      type,
      title: title.trim(),
      status,
      priority
    });
    await this.refresh();
    vscode.window.showInformationMessage(`Created bead ${bead.id}.`);
  }

  private async pickCreateBeadType(): Promise<CreateBeadType | undefined> {
    const selection = await vscode.window.showQuickPick(
      [
        { label: "Task", value: "task" as const },
        { label: "Feature", value: "feature" as const },
        { label: "Bug", value: "bug" as const },
        { label: "Epic", value: "epic" as const },
        { label: "Chore", value: "chore" as const }
      ],
      {
        title: "Create Bead",
        placeHolder: "Type",
        ignoreFocusOut: true
      }
    );

    return selection?.value;
  }

  private async pickCreateBeadStatus(): Promise<CreateBeadStatus | undefined> {
    const selection = await vscode.window.showQuickPick(
      [
        { label: "Open", value: "open" as const },
        { label: "In Progress", value: "in_progress" as const },
        { label: "Blocked", value: "blocked" as const },
        { label: "Closed", value: "closed" as const }
      ],
      {
        title: "Create Bead",
        placeHolder: "Status",
        ignoreFocusOut: true
      }
    );

    return selection?.value;
  }

  private async pickCreateBeadPriority(): Promise<CreateBeadPriority | undefined> {
    const selection = await vscode.window.showQuickPick(
      [
        { label: "P0", value: "P0" as const },
        { label: "P1", value: "P1" as const },
        { label: "P2", value: "P2" as const },
        { label: "P3", value: "P3" as const },
        { label: "P4", value: "P4" as const }
      ],
      {
        title: "Create Bead",
        placeHolder: "Priority",
        ignoreFocusOut: true
      }
    );

    return selection?.value;
  }

  private async createBead(
    workspacePath: string,
    values: {
      type: CreateBeadType;
      title: string;
      status: CreateBeadStatus;
      priority: CreateBeadPriority;
    }
  ) {
    const stdout = await this.runBdCommand(
      [
        "create",
        "--json",
        "--type",
        values.type,
        "--priority",
        values.priority,
        "--title",
        values.title
      ],
      workspacePath
    );
    const bead = this.parseCreatedBead(stdout);

    if (values.status === "closed") {
      await this.runBdCommand(["close", bead.id], workspacePath);
    } else if (values.status !== "open") {
      await this.runBdCommand(["update", bead.id, "--status", values.status], workspacePath);
    }

    await flushBeadsWorkspace((args, cwd) => this.runBdCommand(args, cwd), workspacePath);
    return bead;
  }

  private parseCreatedBead(stdout: string): { id: string } {
    const trimmed = stdout.trim();
    const jsonText = trimmed.startsWith("{")
      ? trimmed
      : (trimmed.match(/\{[\s\S]*\}\s*$/)?.[0] ?? "");

    if (jsonText === "") {
      throw new Error("Unable to read the created bead id from bd create.");
    }

    const parsed = JSON.parse(jsonText) as { id?: unknown };
    if (typeof parsed.id !== "string" || parsed.id.trim() === "") {
      throw new Error("bd create did not return a valid bead id.");
    }

    return { id: parsed.id.trim() };
  }

  private async pathExists(uri: vscode.Uri) {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private async resolveAuthorizedWorkspacePath(workspacePath: string) {
    const normalizedPath = workspacePath.trim();
    if (normalizedPath === "") {
      return null;
    }

    const resolvedPath = path.resolve(normalizedPath);
    const workspaceFolder = (vscode.workspace.workspaceFolders ?? []).find(
      (folder) => path.resolve(folder.uri.fsPath) === resolvedPath
    );
    if (!workspaceFolder) {
      return null;
    }

    const beadsDirUri = vscode.Uri.joinPath(workspaceFolder.uri, ".beads");
    return (await this.pathExists(beadsDirUri)) ? workspaceFolder.uri.fsPath : null;
  }

  private async syncBranchWatchers() {
    const trackedWorkspaces = new Set<string>();

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const workspacePath = folder.uri.fsPath;
      const beadsDirUri = vscode.Uri.joinPath(folder.uri, ".beads");
      if (!(await this.pathExists(beadsDirUri))) {
        this.stopWatchingBranch(workspacePath);
        this.branchSyncCoordinator.forgetWorkspace(workspacePath);
        continue;
      }

      trackedWorkspaces.add(workspacePath);
      await this.ensureBranchWatcher(workspacePath);
    }

    for (const workspacePath of Array.from(this.branchWatchers.keys())) {
      if (!trackedWorkspaces.has(workspacePath)) {
        this.stopWatchingBranch(workspacePath);
        this.branchSyncCoordinator.forgetWorkspace(workspacePath);
      }
    }
  }

  private async ensureBranchWatcher(workspacePath: string) {
    if (this.branchWatchers.has(workspacePath)) {
      return;
    }

    await this.branchSyncCoordinator.primeWorkspace(workspacePath);

    const gitDir = await this.resolveGitDirectory(workspacePath);
    if (gitDir === null) {
      return;
    }

    const pattern = new vscode.RelativePattern(vscode.Uri.file(gitDir), "HEAD");
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const scheduleCheck = () => {
      void this.branchSyncCoordinator.scheduleWorkspaceCheck(workspacePath);
    };
    const disposables: vscode.Disposable[] = [
      watcher,
      watcher.onDidCreate(scheduleCheck),
      watcher.onDidChange(scheduleCheck),
      watcher.onDidDelete(scheduleCheck)
    ];

    this.branchWatchers.set(workspacePath, disposables);
  }

  private stopWatchingBranch(workspacePath: string) {
    const disposables = this.branchWatchers.get(workspacePath);
    if (!disposables) {
      return;
    }

    for (const disposable of disposables) {
      disposable.dispose();
    }
    this.branchWatchers.delete(workspacePath);
  }

  private async findLegacyBeadFiles(folder: vscode.WorkspaceFolder) {
    const jsonPattern = new vscode.RelativePattern(folder, ".beads/*.json");
    const jsonlPattern = new vscode.RelativePattern(folder, ".beads/*.jsonl");
    const files = [
      ...(await vscode.workspace.findFiles(jsonPattern, "**/node_modules/**")),
      ...(await vscode.workspace.findFiles(jsonlPattern, "**/node_modules/**"))
    ];

    return [...new Map(files.map((file) => [file.toString(), file])).values()].filter((fileUri) => {
      const basename = fileUri.path.split("/").pop() ?? "";
      return !basename.startsWith("sync_base") && !basename.startsWith(".");
    });
  }

  private async loadLegacyWorkspaceItems(files: vscode.Uri[]) {
    const items: BeadItem[] = [];
    const errors: { source: string; message: string }[] = [];

    for (const fileUri of files) {
      try {
        const raw = await vscode.workspace.fs.readFile(fileUri);
        const text = Buffer.from(raw).toString("utf8");
        const parsed = fileUri.path.endsWith(".jsonl")
          ? text
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((line) => line !== "")
              .map((line) => JSON.parse(line))
          : JSON.parse(text);
        items.push(...extractBeadItems(parsed));
      } catch (error) {
        errors.push({
          source: vscode.workspace.asRelativePath(fileUri, false),
          message: error instanceof Error ? error.message : "Unable to parse JSON"
        });
      }
    }

    const uniqueItems = [...new Map(items.map((item) => [item.id, item])).values()];

    return {
      hasFiles: files.length > 0,
      items: uniqueItems,
      errors
    };
  }

  private async loadBdItemsFromCli(cwd: string): Promise<CliLoadResult> {
    const stdout = await this.runBdCommand(["list", "--json", "--limit", "0", "--all"], cwd);
    const parsed = stdout.trim() === "" ? [] : JSON.parse(stdout);
    const cliItems = extractBeadItems(parsed);
    const warnings: BeadWarning[] = [];
    const readyItemIds = await this.loadReadyItemIds(cwd, warnings);
    const itemsNeedingParentLookup = new Set<string>(
      beadsAsArray(parsed)
        .map((item) => {
          if (typeof item !== "object" || item === null) {
            return null;
          }

          const record = item as Record<string, unknown>;
          const normalizedItem = toBeadItem(record);
          if (normalizedItem === null) {
            return null;
          }

          const dependencyCount = record.dependency_count;
          return typeof dependencyCount === "number" && dependencyCount > 0
            ? normalizedItem.id
            : null;
        })
        .filter((id): id is string => id !== null)
    );

    try {
      const issueFileUri = vscode.Uri.file(path.join(cwd, ".beads", "issues.jsonl"));
      const raw = await vscode.workspace.fs.readFile(issueFileUri);
      const text = Buffer.from(raw).toString("utf8");
      const legacyItems = extractBeadItems(
        text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line !== "")
          .map((line) => JSON.parse(line))
      );
      let mergedItems = mergeBeadItems(cliItems, legacyItems);
      const missingParentIds = mergedItems
        .filter((item) => item.parentId.trim() === "" && itemsNeedingParentLookup.has(item.id))
        .map((item) => item.id);
      if (missingParentIds.length > 0) {
        const parentLookupItems = await this.loadBdShowItems(missingParentIds, cwd);
        mergedItems = mergeBeadItems(mergedItems, parentLookupItems);
      }

      const diff = diffBeadItems(mergedItems, legacyItems);

      if (
        diff.missingFromPrimary.length > 0 ||
        diff.missingFromSecondary.length > 0 ||
        diff.changed.length > 0
      ) {
        const details: string[] = [];
        if (diff.missingFromPrimary.length > 0) {
          details.push(
            `missing from local bd view: ${diff.missingFromPrimary.slice(0, 5).join(", ")}${diff.missingFromPrimary.length > 5 ? ", ..." : ""}`
          );
        }
        if (diff.missingFromSecondary.length > 0) {
          details.push(
            `missing from issues.jsonl: ${diff.missingFromSecondary.slice(0, 5).join(", ")}${diff.missingFromSecondary.length > 5 ? ", ..." : ""}`
          );
        }
        if (diff.changed.length > 0) {
          details.push(
            `field differences: ${diff.changed
              .slice(0, 3)
              .map((entry) => `${entry.id} (${entry.fields.join(", ")})`)
              .join("; ")}${diff.changed.length > 3 ? "; ..." : ""}`
          );
        }

        warnings.push({
          source: path.join(cwd, ".beads"),
          workspacePath: cwd,
          message: `Local bd state and issues.jsonl differ; run bd sync to reconcile. ${details.join(". ")}`
        });
      }

      return { items: inferReadyParallelizableItems(mergedItems, readyItemIds), warnings };
    } catch {
      const missingParentIds = cliItems
        .filter((item) => item.parentId.trim() === "" && itemsNeedingParentLookup.has(item.id))
        .map((item) => item.id);
      if (missingParentIds.length === 0) {
        return { items: inferReadyParallelizableItems(cliItems, readyItemIds), warnings };
      }

      const parentLookupItems = await this.loadBdShowItems(missingParentIds, cwd);
      return {
        items: inferReadyParallelizableItems(
          mergeBeadItems(cliItems, parentLookupItems),
          readyItemIds
        ),
        warnings
      };
    }
  }

  private async loadReadyItemIds(cwd: string, warnings: BeadWarning[]) {
    try {
      return await this.queryReadyItemIds(cwd);
    } catch (error) {
      warnings.push({
        source: path.join(cwd, ".beads"),
        workspacePath: cwd,
        message:
          error instanceof Error
            ? `Unable to infer parallel-ready tasks from bd ready: ${error.message}`
            : "Unable to infer parallel-ready tasks from bd ready."
      });
      return new Set<string>();
    }
  }

  private async queryReadyItemIds(cwd: string) {
    const stdout = await this.runBdCommand(["ready", "--json", "--limit", "0"], cwd);
    const parsed = stdout.trim() === "" ? [] : JSON.parse(stdout);
    return new Set(extractBeadItems(parsed).map((item) => item.id));
  }

  private async queryDependencyIdsForStart(issueIds: readonly string[], cwd: string) {
    const uniqueIssueIds = [
      ...new Set(issueIds.map((issueId) => issueId.trim()).filter((issueId) => issueId !== ""))
    ];
    const items = await this.loadBdShowItems(uniqueIssueIds, cwd);
    const itemById = new Map(items.map((item) => [item.id, item]));
    const missingIssueIds = uniqueIssueIds.filter((issueId) => !itemById.has(issueId));
    if (missingIssueIds.length > 0) {
      throw new Error(
        `Unable to verify current Beads dependencies for: ${missingIssueIds.join(", ")}. No work was started.`
      );
    }

    return new Map(
      uniqueIssueIds.map((issueId) => [issueId, [...(itemById.get(issueId)?.dependencyIds ?? [])]])
    );
  }

  private async loadBdShowItems(issueIds: string[], cwd: string) {
    const items = await Promise.all(
      issueIds.map(async (issueId) => {
        const stdout = await this.runBdCommand(["show", issueId, "--json"], cwd);
        const parsed = stdout.trim() === "" ? [] : JSON.parse(stdout);
        return extractBeadItems(parsed);
      })
    );

    return items.flat();
  }

  private async resolveGitDirectory(cwd: string) {
    try {
      const stdout = await this.runGitCommand(["rev-parse", "--git-dir"], cwd);
      const gitDir = stdout.trim();
      return gitDir === "" ? null : path.resolve(cwd, gitDir);
    } catch {
      return null;
    }
  }

  private async loadCurrentBranchKey(cwd: string) {
    try {
      const stdout = await this.runGitCommand(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);
      const branch = stdout.trim();
      if (branch !== "") {
        return `branch:${branch}`;
      }
    } catch {}

    try {
      const stdout = await this.runGitCommand(["rev-parse", "--verify", "HEAD"], cwd);
      const commitHash = stdout.trim();
      return commitHash === "" ? null : `detached:${commitHash}`;
    } catch {
      return null;
    }
  }

  private async runBdCommand(args: string[], cwd: string) {
    assertBeadsProcessTrusted(vscode.workspace.isTrusted);
    const workspacePath = await this.resolveAuthorizedWorkspacePath(cwd);
    if (workspacePath === null) {
      throw new Error("Refusing to run bd outside an initialized workspace folder.");
    }

    return new Promise<string>((resolve, reject) => {
      const bdPath = getConfig().bdPath();
      const child = cp.spawn(bdPath, args, createBdSpawnOptions(workspacePath));
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        reject(error);
      });
      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        reject(
          new Error(
            stderr.trim() || `${bdPath} ${args.join(" ")} failed with exit code ${code ?? -1}.`
          )
        );
      });
    });
  }

  private async runBdCapabilityProbe(
    args: readonly string[],
    cwd: string
  ): Promise<BeadsCapabilityCommandResult> {
    assertBeadsProcessTrusted(vscode.workspace.isTrusted);
    const workspacePath = await this.resolveAuthorizedWorkspacePath(cwd);
    if (workspacePath === null) {
      throw new Error("Refusing to probe bd outside an initialized workspace folder.");
    }

    return new Promise((resolve, reject) => {
      const child = cp.spawn(getConfig().bdPath(), [...args], createBdSpawnOptions(workspacePath));
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({ exitCode: code ?? -1, stdout, stderr });
      });
    });
  }

  private getBdExecutableStatus() {
    return resolveBdExecutableStatus(
      getConfig().bdPath(),
      vscode.workspace.isTrusted,
      checkExecutable
    );
  }

  private async runGitCommand(args: string[], cwd: string) {
    return new Promise<string>((resolve, reject) => {
      const gitPath = getConfig().gitPath();
      const child = cp.spawn(gitPath, args, { cwd });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        reject(error);
      });
      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        reject(
          new Error(
            stderr.trim() || `${gitPath} ${args.join(" ")} failed with exit code ${code ?? -1}.`
          )
        );
      });
    });
  }

  private async runExternalCommand(command: string, args: string[], cwd: string) {
    return new Promise<string>((resolve, reject) => {
      const child = cp.spawn(command, args, { cwd });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        reject(error);
      });
      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        reject(
          new Error(
            stderr.trim() || `${command} ${args.join(" ")} failed with exit code ${code ?? -1}.`
          )
        );
      });
    });
  }
}
