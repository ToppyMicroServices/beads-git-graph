import * as cp from "node:child_process";
import * as path from "node:path";

import * as vscode from "vscode";

import {
  type BeadItem,
  beadsAsArray,
  diffBeadItems,
  extractBeadItems,
  mergeBeadItems,
  toBeadItem
} from "./beadsData";
import { isBeadsRequestMessage } from "./beadsProtocol";
import { syncBeadsWorkspace } from "./beadsSync";
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

export class BeadsViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = "beads-git-graph.beadsView";

  private webviewView: vscode.WebviewView | null = null;
  private panel: vscode.WebviewPanel | null = null;
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
          this.showPanel();
        }
      })
    );

    void this.showPanel();

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
    void this.refresh();
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
              items: cliItems
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
          items: legacyResult.items
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
        await this.runBdCommand(["sync", "--flush-only"], workspacePath);
        await this.refresh();
        vscode.window.showInformationMessage(`Closed bead ${issueId}.`);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Unable to close bead.";
        vscode.window.showErrorMessage(messageText);
      }
    }
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

    await this.runBdCommand(["sync", "--flush-only"], workspacePath);
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
    const warnings: BeadWarning[] = [];

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

      return { items: mergedItems, warnings };
    } catch {
      const missingParentIds = cliItems
        .filter((item) => item.parentId.trim() === "" && itemsNeedingParentLookup.has(item.id))
        .map((item) => item.id);
      if (missingParentIds.length === 0) {
        return { items: cliItems, warnings };
      }

      const parentLookupItems = await this.loadBdShowItems(missingParentIds, cwd);
      return { items: mergeBeadItems(cliItems, parentLookupItems), warnings };
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
}
