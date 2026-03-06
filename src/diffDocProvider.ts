import * as vscode from "vscode";

import { DataSource } from "./dataSource";
import { getPathFromStr } from "./utils";

export class DiffDocProvider implements vscode.TextDocumentContentProvider {
  public static scheme = "beads-git-graph";
  private readonly dataSource: DataSource;
  private readonly onDidChangeEventEmitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly docs = new Map<string, string>();
  private readonly subscriptions: vscode.Disposable;

  constructor(dataSource: DataSource) {
    this.dataSource = dataSource;
    this.subscriptions = vscode.workspace.onDidCloseTextDocument((doc) =>
      this.docs.delete(doc.uri.toString())
    );
  }

  public dispose() {
    this.subscriptions.dispose();
    this.docs.clear();
    this.onDidChangeEventEmitter.dispose();
  }

  get onDidChange() {
    return this.onDidChangeEventEmitter.event;
  }

  public provideTextDocumentContent(uri: vscode.Uri): string | Thenable<string> {
    const cached = this.docs.get(uri.toString());
    if (cached !== undefined) return cached;

    const request = decodeDiffDocUri(uri);
    return this.dataSource
      .getCommitFile(request.repo, request.commit, request.filePath)
      .then((data) => {
        this.docs.set(uri.toString(), data);
        return data;
      });
  }
}

export function encodeDiffDocUri(repo: string, path: string, commit: string): vscode.Uri {
  return vscode.Uri.parse(
    DiffDocProvider.scheme +
      ":" +
      getPathFromStr(path) +
      "?commit=" +
      encodeURIComponent(commit) +
      "&repo=" +
      encodeURIComponent(repo)
  );
}

export function decodeDiffDocUri(uri: vscode.Uri) {
  const params = new URLSearchParams(uri.query);
  return {
    filePath: uri.path,
    commit: params.get("commit") ?? "",
    repo: params.get("repo") ?? ""
  };
}
