import * as vscode from "vscode";

import { AgentArtifactStore } from "./agentArtifactStore";
import { manageAgentProviderCredentials } from "./agentCredentialManager";
import { AgentCredentialStore } from "./agentCredentialStore";
import { BeadsViewProvider } from "./beadsView";
import { getConfig } from "./config";
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
  const agentCredentialStore = new AgentCredentialStore(context.secrets);
  const agentArtifactStore = new AgentArtifactStore(
    context.storageUri ?? context.globalStorageUri,
    () => getConfig().agentArtifactRetentionCount()
  );
  const beadsViewProvider = new BeadsViewProvider(
    context.extensionUri,
    agentCredentialStore,
    agentArtifactStore
  );
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
    vscode.commands.registerCommand("beads-git-graph.manageAgentProviderCredentials", async () =>
      manageAgentProviderCredentials(agentCredentialStore)
    ),
    vscode.commands.registerCommand("beads-git-graph.clearAgentResponseArtifacts", async () => {
      if (!vscode.workspace.isTrusted) {
        vscode.window.showWarningMessage(
          "Trust this workspace before deleting stored AI response artifacts."
        );
        return;
      }
      const confirmation = await vscode.window.showWarningMessage(
        "Delete all locally stored AI response artifacts for this workspace?",
        {
          modal: true,
          detail:
            "These plain-text responses are stored in VS Code extension storage. This cannot be undone."
        },
        "Delete Artifacts"
      );
      if (confirmation !== "Delete Artifacts") {
        return;
      }
      try {
        const deleted = await agentArtifactStore.clearAll();
        vscode.window.showInformationMessage(
          `Deleted ${deleted} stored AI response artifact${deleted === 1 ? "" : "s"}.`
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          error instanceof Error
            ? `Unable to delete stored AI response artifacts: ${error.message}`
            : "Unable to delete stored AI response artifacts."
        );
      }
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
      } else if (e.affectsConfiguration("beads-git-graph.fetchOnGraphRefresh")) {
        GitGraphView.refreshCurrentPanel();
      }
    }),
    repoManager
  );

  outputChannel.appendLine("Extension activated successfully");
}

export function deactivate() {}
