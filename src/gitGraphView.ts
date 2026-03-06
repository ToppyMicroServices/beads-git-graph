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
import { abbrevCommit, copyToClipboard, getNonce } from "./utils";

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
    repoManager: RepoManager
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (GitGraphView.currentPanel) {
      GitGraphView.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "beads-git-graph",
      "Beads Git Graph",
      column || vscode.ViewColumn.One,
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
              status: await this.dataSource.pushTag(msg.repo, msg.tagName)
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
            await vscode.commands.executeCommand("beads-git-graph.beadsView.focus");
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

  private getHtmlForWebview() {
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

    let body,
      numRepos = Object.keys(viewState.repos).length,
      colorVars = "",
      colorParams = "";
    for (let i = 0; i < viewState.graphColours.length; i++) {
      colorVars += "--git-graph-color" + i + ":" + viewState.graphColours[i] + "; ";
      colorParams +=
        '[data-color="' + i + '"]{--git-graph-color:var(--git-graph-color' + i + ");} ";
    }
    if (numRepos > 0) {
      body = `<body style="${colorVars}">
			<div id="controls">
				<span id="repoControl"><span class="unselectable">Repo: </span><div id="repoSelect" class="dropdown"></div></span>
				<span id="branchControl"><span class="unselectable">Branch: </span><div id="branchSelect" class="dropdown"></div></span>
				<label id="showRemoteBranchesControl"><input type="checkbox" id="showRemoteBranchesCheckbox" value="1" checked>Show Remote</label>
        <span id="typeFilterControl"><span class="unselectable">Type: </span><select id="typeFilterSelect"><option value="all">All</option><option value="feat">feat</option><option value="fix">fix</option><option value="docs">docs</option><option value="chore">chore</option><option value="refactor">refactor</option><option value="perf">perf</option><option value="test">test</option><option value="build">build</option><option value="ci">ci</option><option value="style">style</option><option value="revert">revert</option><option value="other">other</option></select></span>
        <div id="beadsBtn" class="roundedBtn iconBtn" title="Beads" aria-label="Beads">
          <svg class="beadsBtnIcon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path style="fill:#757575" d="m 2.75,15.808 c 0,0 0.5,0.2 1.25,0.2 0.75,0 1.25,-0.2 1.25,-0.2 l 0,8.192 -2.5,0 z"/>
            <path style="fill:#656565" d="m 10.75,6.7964375 c 0,0 0.5,0.2 1.25,0.203125 0.750257,-8.355e-4 1.25,-0.203125 1.25,-0.203125 L 13.25,14.47 10.75,14 z"/>
            <path style="fill:#656565" d="m 10.75,18.52 2.5,0.46 0,5.02 -2.5,0 z"/>
            <path style="fill:#a5a5a5" d="m 2.75,0 2.5,0 0,8.2 C 5.25,8.2 4.75,8 3.9779029,8 3.25,8.015175 2.75,8.203 2.75,8.2 z"/>
            <path style="fill:#858585" d="M 5.140625,15.835938 C 5.23502,15.905738 5.143195,15.875148 6,16.25 c 1.7136032,0.749701 3.78125,1.09375 5.78125,1.46875 2,0.375 3.545654,0.571029 4.832051,1.133828 0.560272,-0.839749 1.263386,-1.390304 2.244583,-1.678078 C 18.667708,17.046412 18.856802,17.124851 18,16.75 c -1.713603,-0.749701 -3.78125,-1.09375 -5.78125,-1.46875 -2,-0.375 -3.5228672,-0.621464 -4.809264,-1.184263 -0.406834,0.63185 -1.0739799,1.382044 -2.268861,1.738951 z"/>
            <circle style="fill:#757575" cx="4" cy="12" r="3"/>
            <circle style="fill:#656565" cx="12" cy="3" r="3"/>
            <circle style="fill:#858585" cx="20" cy="21" r="3"/>
          </svg>
        </div>
				<div id="refreshBtn" class="roundedBtn iconBtn" title="Refresh">&#x21bb;</div>
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
			<h2>Unable to load Git Graph</h2>
			<p>Either the current workspace does not contain a Git repository, or the Git executable could not be found.</p>
			<p>If you are using a portable Git installation, make sure you have set the Visual Studio Code Setting "git.path" to the path of your portable installation (e.g. "C:\\Program Files\\Git\\bin\\git.exe" on Windows).</p>
			</body>`;
    }
    this.isGraphViewLoaded = numRepos > 0;

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
    const relativePath = resolvedPath.replace(/^\/+/, "");
    const workingFileUri = vscode.Uri.joinPath(vscode.Uri.file(repo), relativePath);
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
    const relativePath = resolvedPath.replace(/^\/+/, "");
    const fileUri = vscode.Uri.joinPath(vscode.Uri.file(repo), relativePath);
    try {
      const document = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(document, { preview: true });
    } catch {
      vscode.window.showWarningMessage("Unable to open file.");
    }
  }
}
