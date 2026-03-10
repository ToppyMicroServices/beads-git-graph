import * as vscode from "vscode";

import { BeadsViewProvider } from "./beadsView";
import { DataSource } from "./dataSource";
import { decodeDiffDocUri, DiffDocProvider } from "./diffDocProvider";
import { ExtensionState } from "./extensionState";
import { GitGraphView } from "./gitGraphView";
import { RepoManager } from "./repoManager";
import { StatusBarItem } from "./statusBarItem";
import { isPathWithinRoot } from "./utils";

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("Beads Git Graph");
  const extensionState = new ExtensionState(context);
  const dataSource = new DataSource();
  const beadsViewProvider = new BeadsViewProvider(context.extensionUri);
  const statusBarItem = new StatusBarItem(context);
  const repoManager = new RepoManager(dataSource, extensionState, statusBarItem);

  context.subscriptions.push(
    outputChannel,
    beadsViewProvider,
    vscode.commands.registerCommand("beads-git-graph.view", () => {
      const column = beadsViewProvider.closePanel();
      GitGraphView.createOrShow(
        context.extensionUri,
        dataSource,
        extensionState,
        repoManager,
        column
      );
    }),
    vscode.commands.registerCommand("beads-git-graph.refreshBeads", () => {
      beadsViewProvider.refresh();
    }),
    vscode.commands.registerCommand("beads-git-graph.focusBeadsView", async () => {
      const column = GitGraphView.closeCurrentPanel();
      beadsViewProvider.showPanel(column);
    }),
    vscode.commands.registerCommand("beads-git-graph.openDiffFile", async (uri?: vscode.Uri) => {
      const sourceUri =
        uri ??
        vscode.window.activeTextEditor?.document.uri ??
        vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      if (!(sourceUri instanceof vscode.Uri) || sourceUri.scheme !== DiffDocProvider.scheme) {
        return;
      }

      const request = decodeDiffDocUri(sourceUri);
      const relativePath = request.filePath.replace(/^\/+/, "");
      const fileUri = vscode.Uri.joinPath(vscode.Uri.file(request.repo), relativePath);
      if (!isPathWithinRoot(request.repo, fileUri.fsPath)) {
        vscode.window.showWarningMessage("Refusing to open a file outside the repository root.");
        return;
      }

      try {
        const document = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(document, { preview: true });
      } catch {
        vscode.window.showWarningMessage("Unable to open file in working tree.");
      }
    }),
    vscode.workspace.registerTextDocumentContentProvider(
      DiffDocProvider.scheme,
      new DiffDocProvider(dataSource)
    ),
    vscode.window.registerWebviewViewProvider(BeadsViewProvider.viewType, beadsViewProvider),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("beads-git-graph.showStatusBarItem")) {
        statusBarItem.refresh();
      } else if (e.affectsConfiguration("beads-git-graph.dateType")) {
        dataSource.generateGitCommandFormats();
      } else if (e.affectsConfiguration("beads-git-graph.maxDepthOfRepoSearch")) {
        repoManager.maxDepthOfRepoSearchChanged();
      } else if (e.affectsConfiguration("git.path")) {
        dataSource.registerGitPath();
        GitGraphView.refreshCurrentPanel();
      } else if (e.affectsConfiguration("beads-git-graph.bdPath")) {
        beadsViewProvider.refresh();
      }
    }),
    repoManager
  );

  outputChannel.appendLine("Extension activated successfully");
}

export function deactivate() {}
