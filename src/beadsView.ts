import * as vscode from "vscode";

interface BeadItem {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  updatedAt: string;
}

export class BeadsViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = "neo-git-graph.beadsView";

  private webviewView: vscode.WebviewView | null = null;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly watcher: vscode.FileSystemWatcher;

  constructor() {
    this.watcher = vscode.workspace.createFileSystemWatcher("**/.beads/*.json");

    this.disposables.push(
      this.watcher,
      this.watcher.onDidCreate(() => this.refresh()),
      this.watcher.onDidChange(() => this.refresh()),
      this.watcher.onDidDelete(() => this.refresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh())
    );
  }

  public dispose() {
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage((message: { command?: string }) => {
      if (message.command === "refresh") {
        this.refresh();
      }
    });
    this.refresh();
  }

  public async refresh() {
    if (this.webviewView === null) {
      return;
    }

    const results = await this.loadBeads();
    this.webviewView.webview.html = this.getHtml(this.webviewView.webview, results);
  }

  private async loadBeads() {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const records: { workspace: string; source: string; items: BeadItem[] }[] = [];

    for (const folder of workspaceFolders) {
      const workspaceName = folder.name;
      const candidateFiles = [
        vscode.Uri.joinPath(folder.uri, ".beads", "beads.json"),
        vscode.Uri.joinPath(folder.uri, ".beads", "issues.json"),
        vscode.Uri.joinPath(folder.uri, ".beads", "tasks.json")
      ];

      for (const fileUri of candidateFiles) {
        try {
          const raw = await vscode.workspace.fs.readFile(fileUri);
          const text = Buffer.from(raw).toString("utf8");
          const parsed = JSON.parse(text);
          const items = this.extractItems(parsed);
          if (items.length > 0) {
            records.push({
              workspace: workspaceName,
              source: vscode.workspace.asRelativePath(fileUri, false),
              items: items
            });
          }
        } catch {
          // Continue trying other candidate files.
        }
      }
    }

    return records;
  }

  private extractItems(parsed: unknown): BeadItem[] {
    const items = this.asArray(parsed);
    const mapped = items
      .map((item) => this.toBeadItem(item))
      .filter((item): item is BeadItem => item !== null);

    return mapped.sort((a, b) => {
      const aTime = Date.parse(a.updatedAt);
      const bTime = Date.parse(b.updatedAt);
      if (!Number.isNaN(aTime) && !Number.isNaN(bTime)) {
        return bTime - aTime;
      }
      return a.id.localeCompare(b.id);
    });
  }

  private asArray(parsed: unknown): unknown[] {
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (typeof parsed !== "object" || parsed === null) {
      return [];
    }

    const root = parsed as Record<string, unknown>;
    const candidateKeys = ["beads", "issues", "items", "tasks", "data"];
    for (const key of candidateKeys) {
      if (Array.isArray(root[key])) {
        return root[key] as unknown[];
      }
    }

    return [];
  }

  private toBeadItem(item: unknown): BeadItem | null {
    if (typeof item !== "object" || item === null) {
      return null;
    }

    const record = item as Record<string, unknown>;
    const id = this.pickString(record, ["id", "key", "slug", "issue", "name"]);
    const title = this.pickString(record, ["title", "summary", "name", "description"]);

    if (id === "" || title === "") {
      return null;
    }

    return {
      id,
      title,
      type: this.pickString(record, ["type", "kind", "category"], "task"),
      status: this.pickString(record, ["status", "state"], "open"),
      priority: this.pickString(record, ["priority", "p"], "P3"),
      updatedAt: this.pickString(record, ["updated_at", "updatedAt", "updated", "modified_at"], "-")
    };
  }

  private pickString(record: Record<string, unknown>, keys: string[], fallback: string = "") {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") {
        return value.trim();
      }
      if (typeof value === "number") {
        return String(value);
      }
    }
    return fallback;
  }

  private getHtml(
    webview: vscode.Webview,
    rows: { workspace: string; source: string; items: BeadItem[] }[]
  ) {
    const nonce = getNonce();

    let bodyHtml = "";
    if (rows.length === 0) {
      bodyHtml =
        '<div class="empty">.beads data was not found. Add <code>.beads/beads.json</code> (or issues/tasks json) to show a bd list style table.</div>';
    } else {
      bodyHtml = rows
        .map((group) => {
          const itemRows = group.items
            .map(
              (item) =>
                `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.priority)}</td><td>${escapeHtml(item.updatedAt)}</td></tr>`
            )
            .join("");

          return `<section><div class="meta"><strong>${escapeHtml(group.workspace)}</strong><span>${escapeHtml(group.source)}</span></div><table><thead><tr><th>ID</th><th>Title</th><th>Type</th><th>Status</th><th>Priority</th><th>Updated</th></tr></thead><tbody>${itemRows}</tbody></table></section>`;
        })
        .join("");
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:8px;}
.toolbar{display:flex;justify-content:flex-end;margin-bottom:8px;}
button{border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:4px 10px;cursor:pointer;}
button:hover{background:var(--vscode-button-hoverBackground);}
.meta{display:flex;justify-content:space-between;font-size:12px;opacity:.8;margin:10px 0 6px;gap:8px;}
table{width:100%;border-collapse:collapse;font-size:12px;}
th,td{text-align:left;border-bottom:1px solid var(--vscode-panel-border);padding:4px 6px;vertical-align:top;}
.empty{font-size:12px;line-height:1.5;opacity:.9;}
code{font-family:var(--vscode-editor-font-family);}
</style>
</head>
<body>
<div class="toolbar"><button id="refresh">Refresh</button></div>
${bodyHtml}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.getElementById('refresh').addEventListener('click', () => {
  vscode.postMessage({ command: 'refresh' });
});
</script>
</body>
</html>`;
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getNonce() {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
