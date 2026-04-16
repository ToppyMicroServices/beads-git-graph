import * as vscode from "vscode";

import { getConfig } from "./config";
import { DataSource } from "./dataSource";
import { encodeDiffDocUri } from "./diffDocProvider";
import { ExtensionState } from "./extensionState";
import { RepoFileWatcher } from "./repoFileWatcher";
import { RepoManager } from "./repoManager";
import {
  GitFileChangeType,
  GitGraphViewState,
  GitRepoSet,
  RequestMessage,
  ResponseMessage
} from "./types";
import {
  abbrevCommit,
  copyToClipboard,
  escapeHtml,
  getNonce,
  resolvePathWithinRoot
} from "./utils";

export class GitGraphView {
  public static currentPanel: GitGraphView | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly dataSource: DataSource;
  private readonly extensionState: ExtensionState;
  private readonly repoFileWatcher: RepoFileWatcher;
  private readonly repoManager: RepoManager;
  private disposables: vscode.Disposable[] = [];
  private isGraphViewLoaded: boolean = false;
  private isPanelVisible: boolean = true;
  private currentRepo: string | null = null;

  public static createOrShow(
    extensionUri: vscode.Uri,
    dataSource: DataSource,
    extensionState: ExtensionState,
    repoManager: RepoManager,
    column?: vscode.ViewColumn
  ) {
    const targetColumn =
      column ??
      (vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined);

    if (GitGraphView.currentPanel) {
      GitGraphView.currentPanel.panel.reveal(targetColumn);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "beads-git-graph",
      "Beads Git Graph",
      targetColumn || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "media"),
          vscode.Uri.joinPath(extensionUri, "out")
        ]
      }
    );

    GitGraphView.currentPanel = new GitGraphView(
      panel,
      extensionUri,
      dataSource,
      extensionState,
      repoManager
    );
  }

  public static closeCurrentPanel() {
    if (!GitGraphView.currentPanel) {
      return undefined;
    }

    const { viewColumn } = GitGraphView.currentPanel.panel;
    GitGraphView.currentPanel.dispose();
    return viewColumn;
  }

  public static refreshCurrentPanel() {
    if (GitGraphView.currentPanel) {
      void GitGraphView.currentPanel.update();
    }
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    dataSource: DataSource,
    extensionState: ExtensionState,
    repoManager: RepoManager
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.dataSource = dataSource;
    this.extensionState = extensionState;
    this.repoManager = repoManager;

    panel.iconPath =
      getConfig().tabIconColourTheme() === "colour"
        ? this.getUri("resources", "webview-icon.svg")
        : {
            light: this.getUri("resources", "webview-icon-light.svg"),
            dark: this.getUri("resources", "webview-icon-dark.svg")
          };

    this.update();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.onDidChangeViewState(
      () => {
        if (this.panel.visible !== this.isPanelVisible) {
          if (this.panel.visible) {
            this.update();
          } else {
            this.currentRepo = null;
            this.repoFileWatcher.stop();
          }
          this.isPanelVisible = this.panel.visible;
        }
      },
      null,
      this.disposables
    );

    this.repoFileWatcher = new RepoFileWatcher(() => {
      if (this.panel.visible) {
        this.sendMessage({ command: "refresh" });
      }
    });
    this.repoManager.registerViewCallback((repos: GitRepoSet, numRepos: number) => {
      if (!this.panel.visible) return;
      if ((numRepos === 0 && this.isGraphViewLoaded) || (numRepos > 0 && !this.isGraphViewLoaded)) {
        this.update();
      } else {
        this.respondLoadRepos(repos);
      }
    });

    this.panel.webview.onDidReceiveMessage(
      async (msg: RequestMessage) => {
        this.repoFileWatcher.mute();
        const repo = "repo" in msg && typeof msg.repo === "string" ? msg.repo : null;
        if (repo !== null && !this.isKnownRepo(repo)) {
          vscode.window.showWarningMessage("Refusing to run an action for an unknown repository.");
          this.repoFileWatcher.unmute();
          return;
        }

        switch (msg.command) {
          case "addTag":
            this.sendMessage({
              command: "addTag",
              status: await this.dataSource.addTag(
                msg.repo,
                msg.tagName,
                msg.commitHash,
                msg.lightweight,
                msg.message
              )
            });
            break;
          case "checkoutBranch":
            this.sendMessage({
              command: "checkoutBranch",
              status: await this.dataSource.checkoutBranch(
                msg.repo,
                msg.branchName,
                msg.remoteBranch
              )
            });
            break;
          case "checkoutCommit":
            this.sendMessage({
              command: "checkoutCommit",
              status: await this.dataSource.checkoutCommit(msg.repo, msg.commitHash)
            });
            break;
          case "cherrypickCommit":
            this.sendMessage({
              command: "cherrypickCommit",
              status: await this.dataSource.cherrypickCommit(
                msg.repo,
                msg.commitHash,
                msg.parentIndex
              )
            });
            break;
          case "commitDetails":
            this.sendMessage({
              command: "commitDetails",
              commitDetails: await this.dataSource.commitDetails(msg.repo, msg.commitHash)
            });
            break;
          case "copyToClipboard":
            this.sendMessage({
              command: "copyToClipboard",
              type: msg.type,
              success: await copyToClipboard(msg.data)
            });
            break;
          case "createBranch":
            this.sendMessage({
              command: "createBranch",
              status: await this.dataSource.createBranch(msg.repo, msg.branchName, msg.commitHash)
            });
            break;
          case "deleteBranch":
            this.sendMessage({
              command: "deleteBranch",
              status: await this.dataSource.deleteBranch(msg.repo, msg.branchName, msg.forceDelete)
            });
            break;
          case "deleteTag":
            this.sendMessage({
              command: "deleteTag",
              status: await this.dataSource.deleteTag(msg.repo, msg.tagName)
            });
            break;
          case "loadBranches":
            let branchData = await this.dataSource.getBranches(msg.repo, msg.showRemoteBranches),
              isRepo = true;
            if (branchData.error) {
              // If an error occurred, check to make sure the repo still exists
              isRepo = await this.dataSource.isGitRepository(msg.repo);
            }
            this.sendMessage({
              command: "loadBranches",
              branches: branchData.branches,
              head: branchData.head,
              remotes: branchData.remotes,
              defaultRemote: branchData.defaultRemote,
              hard: msg.hard,
              isRepo: isRepo
            });
            if (msg.repo !== this.currentRepo) {
              this.currentRepo = msg.repo;
              this.extensionState.setLastActiveRepo(msg.repo);
              this.repoFileWatcher.start(msg.repo);
            }
            break;
          case "loadCommits":
            this.sendMessage({
              command: "loadCommits",
              ...(await this.dataSource.getCommits(
                msg.repo,
                msg.branchName,
                msg.maxCommits,
                msg.showRemoteBranches,
                msg.selectedRemote,
                msg.commitTypeFilter
              )),
              hard: msg.hard
            });
            break;
          case "loadRepos":
            if (!msg.check || !(await this.repoManager.checkReposExist())) {
              // If not required to check repos, or no changes were found when checking, respond with repos
              this.respondLoadRepos(this.repoManager.getRepos());
            }
            break;
          case "mergeBranch":
            this.sendMessage({
              command: "mergeBranch",
              status: await this.dataSource.mergeBranch(
                msg.repo,
                msg.branchName,
                msg.createNewCommit
              )
            });
            break;
          case "mergeCommit":
            this.sendMessage({
              command: "mergeCommit",
              status: await this.dataSource.mergeCommit(
                msg.repo,
                msg.commitHash,
                msg.createNewCommit
              )
            });
            break;
          case "pushTag":
            this.sendMessage({
              command: "pushTag",
              status: await this.dataSource.pushTag(msg.repo, msg.tagName, msg.remoteName)
            });
            break;
          case "renameBranch":
            this.sendMessage({
              command: "renameBranch",
              status: await this.dataSource.renameBranch(msg.repo, msg.oldName, msg.newName)
            });
            break;
          case "resetToCommit":
            this.sendMessage({
              command: "resetToCommit",
              status: await this.dataSource.resetToCommit(msg.repo, msg.commitHash, msg.resetMode)
            });
            break;
          case "resetFileToRevision":
            this.sendMessage({
              command: "resetFileToRevision",
              status: await this.dataSource.resetFileToRevision(
                msg.repo,
                msg.commitHash,
                msg.filePath
              )
            });
            break;
          case "revertCommit":
            this.sendMessage({
              command: "revertCommit",
              status: await this.dataSource.revertCommit(msg.repo, msg.commitHash, msg.parentIndex)
            });
            break;
          case "saveRepoState":
            this.repoManager.setRepoState(msg.repo, msg.state);
            break;
          case "viewDiff":
            this.sendMessage({
              command: "viewDiff",
              success: await this.viewDiff(
                msg.repo,
                msg.commitHash,
                msg.oldFilePath,
                msg.newFilePath,
                msg.type
              )
            });
            break;
          case "viewFileAtRevision":
            await this.viewFileAtRevision(msg.repo, msg.commitHash, msg.filePath);
            break;
          case "viewDiffWithWorkingFile":
            await this.viewDiffWithWorkingFile(msg.repo, msg.commitHash, msg.filePath);
            break;
          case "openFile":
            await this.openFile(msg.repo, msg.filePath, msg.commitHash ?? null);
            break;
          case "focusBeadsView":
            await vscode.commands.executeCommand("beads-git-graph.focusBeadsView");
            break;
        }
        this.repoFileWatcher.unmute();
      },
      null,
      this.disposables
    );
  }

  public sendMessage(msg: ResponseMessage) {
    this.panel.webview.postMessage(msg);
  }

  public dispose() {
    GitGraphView.currentPanel = undefined;
    this.panel.dispose();
    this.repoFileWatcher.stop();
    this.repoManager.deregisterViewCallback();
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) x.dispose();
    }
  }

  private async update() {
    this.panel.webview.html = await this.getHtmlForWebview();
  }

  private async getHtmlForWebview() {
    const config = getConfig(),
      nonce = getNonce();
    const viewState: GitGraphViewState = {
      autoCenterCommitDetailsView: config.autoCenterCommitDetailsView(),
      commitDetailsFileActionVisibility: config.commitDetailsFileActionVisibility(),
      enhancedAccessibility: config.enhancedAccessibility(),
      dateFormat: config.dateFormat(),
      graphColours: config.graphColours(),
      graphStyle: config.graphStyle(),
      initialLoadCommits: config.initialLoadCommits(),
      lastActiveRepo: this.extensionState.getLastActiveRepo(),
      loadMoreCommits: config.loadMoreCommits(),
      mutedGraphOpacity: config.mutedGraphOpacity(),
      mutedGraphLineWidth: config.mutedGraphLineWidth(),
      mutedGraphNodeRadius: config.mutedGraphNodeRadius(),
      referenceInputSpaceSubstitution: config.referenceInputSpaceSubstitution(),
      repoDropdownOrder: config.repoDropdownOrder(),
      repos: this.repoManager.getRepos(),
      preferMainBranchByDefault: config.preferMainBranchByDefault(),
      showCurrentBranchByDefault: config.showCurrentBranchByDefault()
    };
    const gitStatus = await this.dataSource.getGitExecutableStatus();

    let body,
      numRepos = Object.keys(viewState.repos).length,
      colorVars = "",
      colorParams = "";
    for (let i = 0; i < viewState.graphColours.length; i++) {
      colorVars += "--git-graph-color" + i + ":" + viewState.graphColours[i] + "; ";
      colorParams +=
        '[data-color="' + i + '"]{--git-graph-color:var(--git-graph-color' + i + ");} ";
    }
    if (!gitStatus.available) {
      body = `<body class="unableToLoad" style="${colorVars}">
			<h2>Git executable not found</h2>
			<p>Beads Git Graph could not start because the configured Git executable is unavailable.</p>
			<p><strong>Configured path:</strong> <code>${escapeHtml(this.dataSource.getGitPath())}</code></p>
			<p>Set the Visual Studio Code setting "git.path" to a valid Git executable, or install Git so the configured command is available on PATH.</p>
			${gitStatus.message ? `<p>${escapeHtml(gitStatus.message)}</p>` : ""}
			</body>`;
    } else if (numRepos > 0) {
      body = `<body style="${colorVars}">
			<div id="controls">
				<span id="repoControl"><span class="unselectable">Repo: </span><div id="repoSelect" class="dropdown"></div></span>
        <span id="remoteControl"><span class="unselectable">Remote: </span><div id="remoteSelect" class="dropdown"></div></span>
        <span id="branchControl"><span class="unselectable">Branch: </span><div id="branchSelect" class="dropdown"></div></span>
				<label id="showRemoteBranchesControl"><input type="checkbox" id="showRemoteBranchesCheckbox" value="1" checked>Show Remote</label>
        <span id="typeFilterControl"><span class="unselectable">Type: </span><select id="typeFilterSelect"><option value="all">All</option><option value="feat">feat</option><option value="fix">fix</option><option value="docs">docs</option><option value="chore">chore</option><option value="refactor">refactor</option><option value="perf">perf</option><option value="test">test</option><option value="build">build</option><option value="ci">ci</option><option value="style">style</option><option value="revert">revert</option><option value="other">other</option></select></span>
        <div id="beadsBtn" class="roundedBtn iconBtn" title="Beads" aria-label="Beads">
          <svg class="toolbarActionIcon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M7 5.5v13M7 6h4M7 12h6M7 18h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M11 6h6M13 12h4M19 18h0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          <span class="toolbarActionLabel">Beads</span>
        </div>
				<div id="refreshBtn" class="roundedBtn iconBtn" title="Refresh" aria-label="Refresh">
					<svg class="toolbarActionIcon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
						<path fill="currentColor" d="M12 5a7 7 0 1 0 6.65 9.5a1 1 0 1 0-1.9-.63A5 5 0 1 1 12 7h1.59l-1.3 1.29a1 1 0 1 0 1.42 1.42l3-3a1 1 0 0 0 0-1.42l-3-3a1 1 0 1 0-1.42 1.42L13.59 5H12Z"/>
					</svg>
				</div>
			</div>
			<div id="content">
				<div id="commitGraph"></div>
				<div id="commitTable"></div>
			</div>
			<div id="footer"></div>
			<ul id="contextMenu"></ul>
			<div id="dialogBacking"></div>
			<div id="dialog"></div>
			<div id="scrollShadow"></div>
			<script nonce="${nonce}">var viewState = ${JSON.stringify(viewState)};</script>
			<script src="${this.getCompiledOutputUri("web.min.js")}"></script>
			</body>`;
    } else {
      body = `<body class="unableToLoad" style="${colorVars}">
      <h2>No Git repositories found</h2>
      <p>The configured Git executable is available, but the current workspace does not contain any Git repositories.</p>
      <p>Open a folder with a Git repository, or initialize one with <code>git init</code>.</p>
			</body>`;
    }
    this.isGraphViewLoaded = gitStatus.available && numRepos > 0;

    return `<!DOCTYPE html>
		<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; script-src ${this.panel.webview.cspSource} 'nonce-${nonce}'; img-src data:;">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link rel="stylesheet" type="text/css" href="${this.getMediaUri("main.css")}">
				<link rel="stylesheet" type="text/css" href="${this.getMediaUri("dropdown.css")}">
				<title>Beads Git Graph</title>
				<style>${colorParams}"</style>
			</head>
			${body}
		</html>`;
  }

  private getMediaUri(file: string) {
    return this.panel.webview.asWebviewUri(this.getUri("media", file));
  }

  private getCompiledOutputUri(file: string) {
    return this.panel.webview.asWebviewUri(this.getUri("out", file));
  }

  private getUri(...pathComps: string[]) {
    return vscode.Uri.joinPath(this.extensionUri, ...pathComps);
  }

  private respondLoadRepos(repos: GitRepoSet) {
    this.sendMessage({
      command: "loadRepos",
      repos: repos,
      lastActiveRepo: this.extensionState.getLastActiveRepo()
    });
  }

  private isKnownRepo(repo: string) {
    return Object.prototype.hasOwnProperty.call(this.repoManager.getRepos(), repo);
  }

  private getWorkingTreeFileUri(repo: string, filePath: string) {
    const resolvedTarget = resolvePathWithinRoot(repo, filePath);
    return resolvedTarget === null ? null : vscode.Uri.file(resolvedTarget);
  }

  private viewDiff(
    repo: string,
    commitHash: string,
    oldFilePath: string,
    newFilePath: string,
    type: GitFileChangeType
  ) {
    let abbrevHash = abbrevCommit(commitHash);
    let pathComponents = newFilePath.split("/");
    let title =
      pathComponents[pathComponents.length - 1] +
      " (" +
      (type === "A"
        ? "Added in " + abbrevHash
        : type === "D"
          ? "Deleted in " + abbrevHash
          : abbrevCommit(commitHash) + "^ ↔ " + abbrevCommit(commitHash)) +
      ")";
    return new Promise<boolean>((resolve) => {
      vscode.commands
        .executeCommand(
          "vscode.diff",
          encodeDiffDocUri(repo, oldFilePath, commitHash + "^"),
          encodeDiffDocUri(repo, newFilePath, commitHash),
          title,
          { preview: true }
        )
        .then(
          () => resolve(true),
          () => resolve(false)
        );
    });
  }

  private async viewFileAtRevision(repo: string, commitHash: string, filePath: string) {
    const docUri = encodeDiffDocUri(repo, filePath, commitHash);
    try {
      await vscode.commands.executeCommand("vscode.open", docUri, { preview: true });
    } catch {
      vscode.window.showWarningMessage("Unable to open file at this revision.");
    }
  }

  private async viewDiffWithWorkingFile(repo: string, commitHash: string, filePath: string) {
    const resolvedPath = await this.dataSource.resolveFilePathInWorkingTree(
      repo,
      commitHash,
      filePath
    );
    const workingFileUri = this.getWorkingTreeFileUri(repo, resolvedPath);
    if (workingFileUri === null) {
      vscode.window.showWarningMessage("Refusing to open a file outside the repository root.");
      return;
    }
    try {
      await vscode.commands.executeCommand(
        "vscode.diff",
        encodeDiffDocUri(repo, filePath, commitHash),
        workingFileUri,
        `${resolvedPath.split("/").pop()} (${abbrevCommit(commitHash)} ↔ Working Tree)`,
        { preview: true }
      );
    } catch {
      vscode.window.showWarningMessage("Unable to compare with working file.");
    }
  }

  private async openFile(repo: string, filePath: string, commitHash: string | null) {
    const resolvedPath =
      commitHash !== null
        ? await this.dataSource.resolveFilePathInWorkingTree(repo, commitHash, filePath)
        : filePath;
    const fileUri = this.getWorkingTreeFileUri(repo, resolvedPath);
    if (fileUri === null) {
      vscode.window.showWarningMessage("Refusing to open a file outside the repository root.");
      return;
    }
    try {
      const document = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(document, { preview: true });
    } catch {
      vscode.window.showWarningMessage("Unable to open file.");
    }
  }
}
