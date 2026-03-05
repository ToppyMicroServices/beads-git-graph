import * as vscode from "vscode";

interface BeadItem {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  updatedAt: string;
  commitHash: string;
}

interface BeadGroup {
  workspace: string;
  source: string;
  sourceUri: vscode.Uri;
  items: BeadItem[];
}

interface BeadLoadResult {
  groups: BeadGroup[];
  errors: { source: string; message: string }[];
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
    webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    this.refresh();
  }

  public async refresh() {
    if (this.webviewView === null) {
      return;
    }

    const results = await this.loadBeads();
    this.webviewView.webview.html = this.getHtml(this.webviewView.webview, results);
  }

  private async loadBeads(): Promise<BeadLoadResult> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const groups: BeadGroup[] = [];
    const errors: { source: string; message: string }[] = [];

    for (const folder of workspaceFolders) {
      const pattern = new vscode.RelativePattern(folder, ".beads/*.json");
      const files = await vscode.workspace.findFiles(pattern, "**/node_modules/**");

      for (const fileUri of files) {
        try {
          const raw = await vscode.workspace.fs.readFile(fileUri);
          const text = Buffer.from(raw).toString("utf8");
          const parsed = JSON.parse(text);
          const items = this.extractItems(parsed);

          if (items.length > 0) {
            groups.push({
              workspace: folder.name,
              source: vscode.workspace.asRelativePath(fileUri, false),
              sourceUri: fileUri,
              items
            });
          }
        } catch (error) {
          errors.push({
            source: vscode.workspace.asRelativePath(fileUri, false),
            message: error instanceof Error ? error.message : "Unable to parse JSON"
          });
        }
      }
    }

    return {
      groups: groups.sort((a, b) => a.source.localeCompare(b.source)),
      errors
    };
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
      updatedAt: this.pickString(
        record,
        ["updated_at", "updatedAt", "updated", "modified_at"],
        "-"
      ),
      commitHash: this.pickString(record, ["commitHash", "commit_hash", "commit"], "")
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

  private getHtml(webview: vscode.Webview, result: BeadLoadResult) {
    const nonce = getNonce();
    const rows = result.groups;

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
                `<tr data-status="${escapeHtml(item.status.toLowerCase())}" data-text="${escapeHtml((item.id + " " + item.title + " " + item.type + " " + item.status + " " + item.priority).toLowerCase())}"><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.priority)}</td><td>${escapeHtml(item.updatedAt)}</td><td>${item.commitHash !== "" ? `<button class="commitLink" data-commit="${escapeHtml(item.commitHash)}">${escapeHtml(item.commitHash.substring(0, 8))}</button>` : "-"}</td></tr>`
            )
            .join("");

          return `<section><div class="meta"><strong>${escapeHtml(group.workspace)}</strong><span>${escapeHtml(group.source)}</span><button class="openSource" data-uri="${encodeURIComponent(group.sourceUri.toString())}">Open JSON</button></div><table><thead><tr><th>ID</th><th>Title</th><th>Type</th><th>Status</th><th>Priority</th><th>Updated</th><th>Commit</th></tr></thead><tbody>${itemRows}</tbody></table></section>`;
        })
        .join("");
    }

    const errorHtml =
      result.errors.length > 0
        ? `<div class="errors"><strong>Parse errors</strong><ul>${result.errors.map((error) => `<li>${escapeHtml(error.source)}: ${escapeHtml(error.message)}</li>`).join("")}</ul></div>`
        : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:8px;}
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
.filters{display:flex;gap:6px;align-items:center;flex-wrap:wrap;}
.filters button{padding:2px 8px;font-size:11px;opacity:.95;}
.filters button.active{outline:1px solid var(--vscode-focusBorder);}
.search{min-width:160px;max-width:260px;width:100%;padding:4px 8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);}
button{border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:4px 10px;cursor:pointer;}
button:hover{background:var(--vscode-button-hoverBackground);}
.meta{display:grid;grid-template-columns:1fr auto auto;font-size:12px;opacity:.9;margin:10px 0 6px;gap:8px;align-items:center;}
table{width:100%;border-collapse:collapse;font-size:12px;}
th,td{text-align:left;border-bottom:1px solid var(--vscode-panel-border);padding:4px 6px;vertical-align:top;}
.empty{font-size:12px;line-height:1.5;opacity:.9;}
.errors{margin-top:10px;padding-top:8px;border-top:1px solid var(--vscode-panel-border);font-size:12px;}
.errors ul{margin:6px 0 0;padding-left:18px;}
.commitLink{font-size:11px;padding:2px 6px;}
.stats{font-size:11px;opacity:.85;}
code{font-family:var(--vscode-editor-font-family);}
</style>
</head>
<body>
<div class="toolbar">
  <div class="filters">
    <button data-filter="open" class="active">Open</button>
    <button data-filter="in progress" class="active">In Progress</button>
    <button data-filter="blocked" class="active">Blocked</button>
    <button data-filter="all" class="active">All Others</button>
  </div>
  <input id="search" class="search" type="text" placeholder="Search beads..."/>
  <button id="refresh">Refresh</button>
</div>
<div class="stats" id="stats"></div>
${bodyHtml}
${errorHtml}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const activeFilters = new Set(['open', 'in progress', 'blocked', 'all']);
const search = document.getElementById('search');

function isDefaultStatus(status) {
  return status === 'open' || status === 'in progress' || status === 'blocked';
}

function applyFilters() {
  const rows = Array.from(document.querySelectorAll('tbody tr'));
  const text = search.value.trim().toLowerCase();
  let visibleCount = 0;
  for (const row of rows) {
    const status = row.dataset.status || '';
    const rowText = row.dataset.text || '';
    const statusMatch = isDefaultStatus(status)
      ? activeFilters.has(status)
      : activeFilters.has('all');
    const textMatch = text === '' || rowText.includes(text);
    const visible = statusMatch && textMatch;
    row.style.display = visible ? '' : 'none';
    if (visible) visibleCount++;
  }
  document.getElementById('stats').textContent = visibleCount + ' / ' + rows.length + ' beads shown';
}

for (const button of Array.from(document.querySelectorAll('.filters button'))) {
  button.addEventListener('click', () => {
    const key = button.dataset.filter;
    if (activeFilters.has(key)) {
      activeFilters.delete(key);
      button.classList.remove('active');
    } else {
      activeFilters.add(key);
      button.classList.add('active');
    }
    applyFilters();
  });
}

search.addEventListener('input', applyFilters);
document.getElementById('refresh').addEventListener('click', () => {
  vscode.postMessage({ command: 'refresh' });
});
for (const button of Array.from(document.getElementsByClassName('openSource'))) {
  button.addEventListener('click', () => {
    vscode.postMessage({ command: 'openSource', uri: decodeURIComponent(button.dataset.uri) });
  });
}
for (const button of Array.from(document.getElementsByClassName('commitLink'))) {
  button.addEventListener('click', () => {
    vscode.postMessage({ command: 'openGitGraphForCommit', commitHash: button.dataset.commit });
  });
}
applyFilters();
</script>
</body>
</html>`;
  }

  public async handleMessage(message: { command?: string; uri?: string; commitHash?: string }) {
    if (message.command === "refresh") {
      await this.refresh();
      return;
    }

    if (message.command === "openSource" && typeof message.uri === "string") {
      try {
        const uri = vscode.Uri.parse(message.uri);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch {
        vscode.window.showWarningMessage("Unable to open Beads JSON source file.");
      }
      return;
    }

    if (message.command === "openGitGraphForCommit" && typeof message.commitHash === "string") {
      const commitHash = message.commitHash.trim();
      if (!/^[0-9a-f]{7,40}$/i.test(commitHash)) {
        vscode.window.showWarningMessage("Invalid commit hash in Beads item.");
        return;
      }
      await vscode.commands.executeCommand("neo-git-graph.view");
      await vscode.env.clipboard.writeText(commitHash);
      vscode.window.showInformationMessage(
        `Opened Git Graph. Commit hash copied to clipboard: ${commitHash.substring(0, 8)}`
      );
    }
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
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
