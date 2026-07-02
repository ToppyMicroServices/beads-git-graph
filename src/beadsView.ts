import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

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
  type BeadsExecutionSkip,
  type BeadsExecutionTarget,
  isBeadsRequestMessage
} from "./beadsProtocol";
import { flushBeadsWorkspace, syncBeadsWorkspace } from "./beadsSync";
import {
  type BeadGroup,
  type BeadLoadResult,
  type BeadWarning,
  type CliLoadResult,
  type EmptyBeadWorkspace
} from "./beadsViewTypes";
import { renderBeadsWebviewHtml } from "./beadsWebview";
import { BranchSwitchSyncCoordinator } from "./branchSwitchSync";
import { checkExecutable } from "./commandAvailability";
import { getConfig } from "./config";
import { GitGraphView } from "./gitGraphView";

type CreateBeadType = "task" | "feature" | "bug" | "epic" | "chore";
type CreateBeadStatus = "open" | "in_progress" | "blocked" | "closed";
type CreateBeadPriority = "P0" | "P1" | "P2" | "P3" | "P4";
const DEFAULT_ASSIGN_MODEL = "gpt-5-codex";
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

type AssignAgentOpenResult = "opened" | "copied-prompt" | "failed";

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
  private refreshTimer: NodeJS.Timeout | null = null;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly panelDisposables: vscode.Disposable[] = [];
  private readonly viewDisposables: vscode.Disposable[] = [];
  private readonly watchers: vscode.FileSystemWatcher[];
  private readonly branchWatchers = new Map<string, vscode.Disposable[]>();
  private readonly branchSyncCoordinator: BranchSwitchSyncCoordinator;
  private readonly extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
    this.branchSyncCoordinator = new BranchSwitchSyncCoordinator(
      (workspacePath) => this.loadCurrentBranchKey(workspacePath),
      (workspacePath) =>
        syncBeadsWorkspace((args, cwd) => this.runBdCommand(args, cwd), workspacePath),
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
      vscode.workspace.createFileSystemWatcher("**/.beads/beads.db*"),
      vscode.workspace.createFileSystemWatcher("**/.beads/config.yaml"),
      vscode.workspace.createFileSystemWatcher("**/.beads/metadata.json"),
      vscode.workspace.createFileSystemWatcher("**/.beads/*.json"),
      vscode.workspace.createFileSystemWatcher("**/.beads/*.jsonl")
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
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this.disposeScoped(this.viewDisposables);
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    this.viewDisposables.push(
      webviewView.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message);
      }),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          void this.refresh();
        }
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
      void this.refresh();
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
        void this.handleMessage(message);
      }),
      this.panel.onDidDispose(() => {
        this.panel = null;
        this.disposeScoped(this.panelDisposables);
      }),
      this.panel.onDidChangeViewState(() => {
        if (this.panel?.visible) {
          void this.refresh();
        }
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

    const results = await this.loadBeads();
    if (this.webviewView !== null) {
      this.webviewView.webview.html = this.getHtml(this.webviewView.webview, results);
    }
    if (this.panel !== null) {
      this.panel.webview.html = this.getHtml(this.panel.webview, results);
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
    const bdExecutableStatus = await checkExecutable(getConfig().bdPath());

    for (const folder of workspaceFolders) {
      const workspaceInfo = {
        workspace: folder.name,
        workspacePath: folder.uri.fsPath
      };
      const legacyFiles = await this.findLegacyBeadFiles(folder);
      const beadsDirUri = vscode.Uri.joinPath(folder.uri, ".beads");
      const hasBeadsDirectory = await this.pathExists(beadsDirUri);

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
      warnings
    };
  }

  private getHtml(webview: vscode.Webview, result: BeadLoadResult) {
    return renderBeadsWebviewHtml(webview, this.extensionUri, result);
  }

  public async handleMessage(message: unknown) {
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

    if (message.command === "syncAllBeads") {
      const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
      const syncedWorkspaces: string[] = [];

      for (const folder of workspaceFolders) {
        const beadsDirUri = vscode.Uri.joinPath(folder.uri, ".beads");
        if (!(await this.pathExists(beadsDirUri))) {
          continue;
        }

        await syncBeadsWorkspace((args, cwd) => this.runBdCommand(args, cwd), folder.uri.fsPath);
        syncedWorkspaces.push(folder.name);
      }

      await this.refresh();

      if (syncedWorkspaces.length === 0) {
        vscode.window.showWarningMessage("No Beads workspace was found to sync.");
      } else {
        vscode.window.showInformationMessage(
          `Synced Beads data for ${syncedWorkspaces.join(", ")}.`
        );
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

      try {
        await syncBeadsWorkspace((args, cwd) => this.runBdCommand(args, cwd), workspacePath);
        await this.refresh();
        vscode.window.showInformationMessage(
          `Synced Beads data for ${path.basename(workspacePath)}.`
        );
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Unable to sync Beads data.";
        vscode.window.showErrorMessage(messageText);
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

      try {
        await this.promptAndCreateBead(workspacePath);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Unable to create bead.";
        vscode.window.showErrorMessage(messageText);
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

      const confirmation = await vscode.window.showWarningMessage(
        `Close bead ${issueId}${message.title ? `: ${message.title}` : ""}?`,
        { modal: true },
        "Close"
      );
      if (confirmation !== "Close") {
        return;
      }

      try {
        await this.runBdCommand(["close", issueId], workspacePath);
        await flushBeadsWorkspace((args, cwd) => this.runBdCommand(args, cwd), workspacePath);
        await this.refresh();
        vscode.window.showInformationMessage(`Closed bead ${issueId}.`);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Unable to close bead.";
        vscode.window.showErrorMessage(messageText);
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

      try {
        await this.autoAssignAndStartBead(
          workspacePath,
          issueId,
          message.title,
          message.model?.trim() || message.agent,
          message.ssot,
          message.worktree
        );
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : "Unable to assign and start bead.";
        vscode.window.showErrorMessage(messageText);
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

      try {
        await this.startParallelBeads(workspacePath, message.items, message.skipped ?? []);
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : "Unable to start parallel beads.";
        vscode.window.showErrorMessage(messageText);
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
      }
    }
  }

  private async autoAssignAndStartBead(
    workspacePath: string,
    issueId: string,
    title: string | undefined,
    currentModel: string | undefined,
    currentSsot: string | undefined,
    currentWorktree: string | undefined
  ) {
    const model = this.resolveAssignModel(currentModel);
    const ssot = this.resolveAssignSsot(workspacePath, issueId, currentSsot);
    const worktree = this.resolveAssignWorktree(workspacePath, issueId, currentWorktree);

    const openResult = await this.assignAndStartBead({
      workspacePath,
      issueId,
      title,
      model,
      ssot,
      worktree
    });
    await this.refresh();

    if (openResult === "opened") {
      vscode.window.showInformationMessage(
        `Started ${issueId} with ${model}. Opened Copilot agent session for ${path.basename(worktree)}.`
      );
      return;
    }

    if (openResult === "copied-prompt") {
      vscode.window.showInformationMessage(
        `Started ${issueId} with ${model}. Copilot agent prompt copied to clipboard; paste it into Copilot chat.`
      );
      return;
    }

    vscode.window.showWarningMessage(
      `Started ${issueId} with ${model}, but could not open Copilot chat or copy the agent prompt.`
    );
  }

  private async assignAndStartBead(values: {
    workspacePath: string;
    issueId: string;
    title: string | undefined;
    model: string;
    ssot: string;
    worktree: string;
  }) {
    const agentWorktree = await this.ensureAgentWorktree(
      values.workspacePath,
      values.issueId,
      values.worktree
    );
    const worktree = agentWorktree.path;
    const metadata = [
      `agent=${values.model}`,
      `model=${values.model}`,
      `ssot=${values.ssot}`,
      `worktree=${worktree}`,
      agentWorktree.branch.trim() === "" ? "" : `branch=${agentWorktree.branch.trim()}`
    ].filter((entry) => entry !== "");

    const notes = [
      `model=${values.model}`,
      `ssot=${values.ssot}`,
      `worktree=${worktree}`,
      agentWorktree.branch.trim() === "" ? "" : `branch=${agentWorktree.branch.trim()}`
    ].filter((entry) => entry !== "");

    await this.runBdCommand(["assign", values.issueId, values.model], values.workspacePath);
    await this.runBdCommand(
      [
        "update",
        values.issueId,
        "--status",
        "in_progress",
        "--append-notes",
        notes.join("\n"),
        ...metadata.flatMap((entry) => ["--set-metadata", entry])
      ],
      values.workspacePath
    );
    await flushBeadsWorkspace((args, cwd) => this.runBdCommand(args, cwd), values.workspacePath);

    return this.openAssignAgentSession({ ...values, worktree });
  }

  private async startParallelBeads(
    workspacePath: string,
    items: BeadsExecutionTarget[],
    skipped: BeadsExecutionSkip[] = []
  ) {
    const candidates = items
      .map((item) => ({
        issueId: item.issueId.trim(),
        title: item.title,
        model: this.resolveAssignModel(item.model),
        ssot: "",
        worktree: ""
      }))
      .filter((item) => item.issueId !== "");

    if (candidates.length === 0) {
      const skippedSummary = this.formatSkippedParallelTargets(skipped);
      vscode.window.showWarningMessage(
        skippedSummary === ""
          ? "No parallel beads were available to start."
          : `No parallel beads were available to start. Skipped ${skippedSummary}.`
      );
      return;
    }

    const uniqueCandidates = [...new Map(candidates.map((item) => [item.issueId, item])).values()];
    let openedCount = 0;
    let copiedPromptCount = 0;
    for (const candidate of uniqueCandidates) {
      const source = items.find((item) => item.issueId.trim() === candidate.issueId);
      candidate.ssot = this.resolveAssignSsot(workspacePath, candidate.issueId, source?.ssot);
      candidate.worktree = this.resolveAssignWorktree(
        workspacePath,
        candidate.issueId,
        source?.worktree
      );
      const openResult = await this.assignAndStartBead({
        workspacePath,
        issueId: candidate.issueId,
        title: candidate.title,
        model: candidate.model,
        ssot: candidate.ssot,
        worktree: candidate.worktree
      });
      if (openResult === "opened") {
        openedCount += 1;
      } else if (openResult === "copied-prompt") {
        copiedPromptCount += 1;
      }
    }

    await this.refresh();
    const skippedSummary = this.formatSkippedParallelTargets(skipped);
    vscode.window.showInformationMessage(
      `Started ${uniqueCandidates.length} parallel bead(s). Opened ${openedCount} Copilot session(s). Copied ${copiedPromptCount} prompt(s).${skippedSummary === "" ? "" : ` Skipped ${skippedSummary}.`}`
    );
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
    await syncBeadsWorkspace((args, cwd) => this.runBdCommand(args, cwd), workspacePath);
    await this.refresh();
    vscode.window.showInformationMessage(`Merged ${mergedPrs.join(", ")} and synced Beads.`);
  }

  private buildAssignAgentPrompt(values: {
    issueId: string;
    title: string | undefined;
    model: string;
    ssot: string;
    workspacePath: string;
    worktree: string | undefined;
  }) {
    const lines = [
      `Start work on bead ${values.issueId}${values.title ? `: ${values.title}` : ""}.`,
      `Use model ${values.model}.`,
      `Workspace: ${values.workspacePath}`,
      `SSOT/context: ${values.ssot}`
    ];

    if ((values.worktree ?? "").trim() !== "") {
      lines.push(`Preferred worktree: ${values.worktree?.trim()}`);
    }

    lines.push(
      `Read AGENTS.md and the listed SSOT/context before changing code.`,
      `Inspect the bead details with bd show ${values.issueId}.`,
      `Keep the work scoped to this bead and proceed autonomously.`
    );

    return lines.join("\n");
  }

  private async openAssignAgentSession(values: {
    workspacePath: string;
    issueId: string;
    title: string | undefined;
    model: string;
    ssot: string;
    worktree: string | undefined;
  }): Promise<AssignAgentOpenResult> {
    const commands = new Set(await vscode.commands.getCommands(true));
    const prompt = this.buildAssignAgentPrompt(values);
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
        return "opened";
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
      return "copied-prompt";
    } catch {
      return "failed";
    }
  }

  private resolveAssignModel(currentModel: string | undefined) {
    return currentModel?.trim() || DEFAULT_ASSIGN_MODEL;
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
      const stdout = await this.runBdCommand(["ready", "--json"], cwd);
      const parsed = stdout.trim() === "" ? [] : JSON.parse(stdout);
      return new Set(extractBeadItems(parsed).map((item) => item.id));
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
    const workspacePath = await this.resolveAuthorizedWorkspacePath(cwd);
    if (workspacePath === null) {
      throw new Error("Refusing to run bd outside an initialized workspace folder.");
    }

    return new Promise<string>((resolve, reject) => {
      const bdPath = getConfig().bdPath();
      const child = cp.spawn(bdPath, args, { cwd: workspacePath });
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
