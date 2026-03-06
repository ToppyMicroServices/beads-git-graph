import * as vscode from "vscode";

import {
  type BeadItem,
  beadShortDate,
  beadStatusLabel,
  extractBeadItems,
  normalizeBeadPriority,
  normalizeBeadStatus,
  normalizeBeadType
} from "./beadsData";
import { GitGraphView } from "./gitGraphView";
import { escapeHtml, getNonce } from "./utils";

interface BeadGroup {
  workspace: string;
  items: BeadItem[];
}

interface BeadLoadResult {
  groups: BeadGroup[];
  errors: { source: string; message: string }[];
}

export class BeadsViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = "beads-git-graph.beadsView";

  private webviewView: vscode.WebviewView | null = null;
  private panel: vscode.WebviewPanel | null = null;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly watchers: vscode.FileSystemWatcher[];
  private readonly extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
    this.watchers = [
      vscode.workspace.createFileSystemWatcher("**/.beads/*.json"),
      vscode.workspace.createFileSystemWatcher("**/.beads/*.jsonl")
    ];

    this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()));

    for (const watcher of this.watchers) {
      this.disposables.push(
        watcher,
        watcher.onDidCreate(() => this.refresh()),
        watcher.onDidChange(() => this.refresh()),
        watcher.onDidDelete(() => this.refresh())
      );
    }
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

    this.disposables.push(
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          this.showPanel();
        }
      })
    );

    this.showPanel();

    this.refresh();
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
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables
    );
    this.disposables.push(
      this.panel.onDidDispose(() => {
        this.panel = null;
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

  private async loadBeads(): Promise<BeadLoadResult> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const groups: BeadGroup[] = [];
    const errors: { source: string; message: string }[] = [];

    for (const folder of workspaceFolders) {
      const jsonPattern = new vscode.RelativePattern(folder, ".beads/*.json");
      const jsonlPattern = new vscode.RelativePattern(folder, ".beads/*.jsonl");
      const files = [
        ...(await vscode.workspace.findFiles(jsonPattern, "**/node_modules/**")),
        ...(await vscode.workspace.findFiles(jsonlPattern, "**/node_modules/**"))
      ];
      const uniqueFiles = new Map(files.map((file) => [file.toString(), file]));

      for (const fileUri of uniqueFiles.values()) {
        const basename = fileUri.path.split("/").pop() ?? "";
        if (basename.startsWith("sync_base") || basename.startsWith(".")) {
          continue;
        }
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
          const items = extractBeadItems(parsed);

          if (items.length > 0) {
            groups.push({
              workspace: folder.name,
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
      groups: groups.sort((a, b) => a.workspace.localeCompare(b.workspace)),
      errors
    };
  }

  private getHtml(webview: vscode.Webview, result: BeadLoadResult) {
    const nonce = getNonce();
    const rows = result.groups;

    let bodyHtml = "";
    if (rows.length === 0) {
      bodyHtml =
        '<div class="empty">.beads data was not found. Add <code>.beads/beads.json</code> or <code>.beads/issues.jsonl</code> to show a bd list style table.</div>';
    } else {
      bodyHtml = rows
        .map((group) => {
          const itemRows = group.items
            .map((item) => {
              const normalizedStatus = normalizeBeadStatus(item.status);
              const statusLabel = beadStatusLabel(normalizedStatus);
              const normalizedPriority = normalizeBeadPriority(item.priority);
              const normalizedType = normalizeBeadType(item.type);
              const updatedTs = Date.parse(item.updatedAt);
              const typeSortOrder =
                normalizedType === "epic"
                  ? 0
                  : normalizedType === "feature"
                    ? 1
                    : normalizedType === "bug"
                      ? 2
                      : normalizedType === "task"
                        ? 3
                        : 9;
              const prioritySortOrder = parseInt(normalizedPriority.substring(1), 10);
              const shortUpdated = beadShortDate(item.updatedAt);
              return `<tr class="beadRow" data-status="${escapeHtml(normalizedStatus)}" data-item="${escapeHtml(encodeURIComponent(JSON.stringify(item)))}" data-updated-ts="${Number.isNaN(updatedTs) ? 0 : updatedTs}" data-type-sort="${typeSortOrder}" data-priority-sort="${Number.isNaN(prioritySortOrder) ? 9 : prioritySortOrder}"><td><span class="typeBadge type-${escapeHtml(normalizedType)}">${escapeHtml(item.type)}</span></td><td><div class="beadId">${escapeHtml(item.id)}</div><div class="beadTitle">${escapeHtml(item.title)}</div></td><td><span class="statusBadge status-${escapeHtml(normalizedStatus.replace(/_/g, "-"))}">${escapeHtml(statusLabel)}</span></td><td><span class="priorityBadge priority-${escapeHtml(normalizedPriority.toLowerCase())}">${escapeHtml(normalizedPriority)}</span></td><td class="updatedCell" title="${escapeHtml(item.updatedAt)}">${escapeHtml(shortUpdated)}</td></tr>`;
            })
            .join("");

          return `<section><div class="meta"><strong>${escapeHtml(group.workspace)}</strong></div><table><thead><tr><th><button class="sortToggle" data-sort-key="type" type="button" title="Sort by type">Type <span class="sortIcon" data-sort-key="type"> </span></button></th><th>Title</th><th>Status</th><th><button class="sortToggle" data-sort-key="priority" type="button" title="Sort by priority">Priority <span class="sortIcon" data-sort-key="priority"> </span></button></th><th><button class="sortToggle" data-sort-key="updated" type="button" title="Sort by updated">Updated <span class="sortIcon" data-sort-key="updated">▼</span></button></th></tr></thead><tbody>${itemRows}</tbody></table></section>`;
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
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:4px;background:var(--vscode-editor-background);}
.toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px;}
.preset{height:24px;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));border-radius:6px;padding:0 6px;font-size:11px;}
.chips{display:flex;gap:6px;flex-wrap:wrap;}
.chip{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:999px;font-size:11px;border:1px solid var(--vscode-panel-border);background:rgba(128,128,128,.12);}
.chip .remove{background:transparent;border:none;color:inherit;cursor:pointer;line-height:1;padding:0;font-size:12px;opacity:.8;}
.chip.status-open{border-left:3px solid #10b981;}
.chip.status-in_progress{border-left:3px solid #3b82f6;}
.chip.status-blocked{border-left:3px solid #ef4444;}
.chip.status-closed{border-left:3px solid #6b7280;}
.menu{position:relative;}
.menuPopup{display:none;position:absolute;top:30px;left:0;z-index:20;min-width:140px;background:var(--vscode-menu-background);border:1px solid var(--vscode-menu-border, var(--vscode-panel-border));box-shadow:0 2px 8px var(--vscode-widget-shadow);padding:6px;}
.menuPopup.open{display:block;}
.menuPopup button{display:block;width:100%;margin:2px 0;text-align:left;background:transparent;color:var(--vscode-menu-foreground);border:1px solid transparent;padding:4px 6px;border-radius:4px;}
.menuPopup button:hover{background:var(--vscode-menu-selectionBackground);color:var(--vscode-menu-selectionForeground);}
button{border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:4px 8px;cursor:pointer;border-radius:6px;font-size:11px;}
button:hover{background:var(--vscode-button-hoverBackground);}
#refresh{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;font-size:14px;line-height:1;}
.meta{display:grid;grid-template-columns:1fr;font-size:11px;opacity:.9;margin:6px 0 4px;gap:6px;align-items:center;}
table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed;}
th,td{text-align:left;border-bottom:1px solid var(--vscode-panel-border);padding:4px 4px;vertical-align:middle;}
th{font-size:11px;font-weight:600;opacity:.9;}
th:nth-child(1){width:56px;}th:nth-child(3){width:72px;}th:nth-child(4){width:38px;}th:nth-child(5){width:72px;}
.sortToggle{display:inline-flex;align-items:center;gap:4px;background:transparent;border:none;color:inherit;padding:0;cursor:pointer;font:inherit;}
.sortToggle:hover{text-decoration:underline;}
.beadRow{cursor:pointer;}
.beadRow:hover{background:rgba(128,128,128,.08);}
.beadRow.selected{background:rgba(128,128,128,.18);}
.beadId{font-size:10px;color:var(--vscode-descriptionForeground);margin-bottom:1px;}
.beadTitle{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.typeBadge,.statusBadge,.priorityBadge{display:inline-flex;align-items:center;justify-content:center;padding:1px 5px;border-radius:999px;font-size:10px;font-weight:600;white-space:nowrap;}
.type-feature{background:#16a34a;color:#fff;}
.type-bug{background:#dc2626;color:#fff;}
.type-task{background:#eab308;color:#1f2937;}
.type-epic{background:#9333ea;color:#fff;}
.type-other{background:#64748b;color:#fff;}
.status-open{background:#10b981;color:#fff;}
.status-in-progress{background:#3b82f6;color:#fff;}
.status-blocked{background:#ef4444;color:#fff;}
.status-closed{background:#6b7280;color:#fff;}
.status-other{background:#64748b;color:#fff;}
.priority-p0{background:#ef4444;color:#fff;}
.priority-p1{background:#f97316;color:#fff;}
.priority-p2{background:#facc15;color:#1f2937;}
.priority-p3{background:#22c55e;color:#fff;}
.priority-p4{background:#6b7280;color:#fff;}
.empty{font-size:12px;line-height:1.5;opacity:.9;}
.updatedCell{font-size:10px;white-space:nowrap;}
.errors{margin-top:10px;padding-top:8px;border-top:1px solid var(--vscode-panel-border);font-size:12px;}
.errors ul{margin:6px 0 0;padding-left:18px;}
.commitLink{font-size:11px;padding:2px 6px;}
.stats{font-size:11px;opacity:.85;margin-bottom:8px;}
.details{margin:8px 0 12px;padding:8px;border:1px solid var(--vscode-panel-border);font-size:12px;background:var(--vscode-editor-background);border-radius:6px;}
.details.empty{opacity:.75;}
.details h3{margin:0 0 6px;font-size:13px;}
.detailsGrid{display:grid;grid-template-columns:100px 1fr;gap:4px 8px;}
.detailsGrid .key{opacity:.75;}
.detailsDescription{margin-top:8px;white-space:pre-wrap;line-height:1.4;}
code{font-family:var(--vscode-editor-font-family);}
</style>
</head>
<body>
<div class="toolbar">
  <button id="openGitGraph" type="button">Git Graph</button>
  <select id="preset" class="preset">
    <option value="default" selected>Default</option>
    <option value="all">All</option>
  </select>
  <div id="chips" class="chips"></div>
  <div class="menu">
    <button id="addFilter" type="button">+ Filter</button>
    <div id="filterMenu" class="menuPopup"></div>
  </div>
  <button id="clearFilters" type="button">Clear</button>
  <button id="refresh">↻</button>
</div>
<div class="stats" id="stats"></div>
<div id="details" class="details empty">Click a bead row to view details (show-like info).</div>
${bodyHtml}
${errorHtml}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const STATUS_LABELS = { open: 'Open', in_progress: 'In Progress', blocked: 'Blocked', closed: 'Closed', other: 'Other' };
let activeFilters = new Set(['open', 'in_progress', 'blocked']);
let selectedRow = null;
let sortState = { key: 'updated', desc: true };
const details = document.getElementById('details');
const chips = document.getElementById('chips');
const preset = document.getElementById('preset');
const filterMenu = document.getElementById('filterMenu');

function statusChipClass(status) {
  return 'chip status-' + status;
}

function renderFilterMenu() {
  const statuses = ['open', 'in_progress', 'blocked', 'closed', 'other'];
  const candidates = statuses.filter((status) => !activeFilters.has(status));
  filterMenu.innerHTML = candidates.length === 0
    ? '<div style="font-size:11px;opacity:.8;padding:4px 6px;">No more filters</div>'
    : candidates
        .map((status) => '<button data-add-filter="' + status + '">' + STATUS_LABELS[status] + '</button>')
        .join('');
  for (const button of Array.from(filterMenu.querySelectorAll('button[data-add-filter]'))) {
    button.addEventListener('click', () => {
      activeFilters.add(button.dataset.addFilter);
      preset.value = '';
      filterMenu.classList.remove('open');
      renderFilterChips();
      applyFilters();
    });
  }
}

function renderFilterChips() {
  chips.innerHTML = Array.from(activeFilters)
    .map((status) =>
      '<span class="' + statusChipClass(status) + '">' +
      STATUS_LABELS[status] +
      '<button class="remove" data-remove-filter="' + status + '" title="Remove">×</button>' +
      '</span>'
    )
    .join('');
  for (const button of Array.from(chips.querySelectorAll('button[data-remove-filter]'))) {
    button.addEventListener('click', () => {
      activeFilters.delete(button.dataset.removeFilter);
      preset.value = '';
      renderFilterChips();
      applyFilters();
    });
  }
  renderFilterMenu();
}

function applyPreset(value) {
  if (value === 'all') {
    activeFilters = new Set(['open', 'in_progress', 'blocked', 'closed', 'other']);
  } else {
    activeFilters = new Set(['open', 'in_progress', 'blocked']);
  }
  renderFilterChips();
  applyFilters();
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderDetails(item) {
  if (!item) {
    details.classList.add('empty');
    details.textContent = 'Click a bead row to view details (show-like info).';
    return;
  }
  details.classList.remove('empty');
  const commit = item.commitHash && item.commitHash !== ''
    ? '<button class="commitLink" data-commit="' + esc(item.commitHash) + '">' + esc(item.commitHash.substring(0, 8)) + '</button>'
    : '-';
  details.innerHTML =
    '<h3>' + esc(item.id) + ' — ' + esc(item.title) + '</h3>' +
    '<div class="detailsGrid">' +
      '<div class="key">Type</div><div>' + esc(item.type || '-') + '</div>' +
      '<div class="key">Status</div><div>' + esc(item.status || '-') + '</div>' +
      '<div class="key">Priority</div><div>' + esc(item.priority || '-') + '</div>' +
      '<div class="key">Assignee</div><div>' + esc(item.assignee || '-') + '</div>' +
      '<div class="key">Labels</div><div>' + esc(item.labels || '-') + '</div>' +
      '<div class="key">Created</div><div>' + esc(item.createdAt || '-') + '</div>' +
      '<div class="key">Updated</div><div>' + esc(item.updatedAt || '-') + '</div>' +
      '<div class="key">Commit</div><div>' + commit + '</div>' +
    '</div>' +
    '<div class="detailsDescription"><strong>Description</strong><br>' + esc(item.description || '-') + '</div>';

  for (const button of Array.from(details.getElementsByClassName('commitLink'))) {
    button.addEventListener('click', () => {
      vscode.postMessage({ command: 'openGitGraphForCommit', commitHash: button.dataset.commit });
    });
  }
}

function applyFilters() {
  const rows = Array.from(document.querySelectorAll('tbody tr'));
  let visibleCount = 0;
  for (const row of rows) {
    const status = row.dataset.status || '';
    const visible = activeFilters.has(status);
    row.style.display = visible ? '' : 'none';
    if (visible) visibleCount++;
  }
  document.getElementById('stats').textContent = visibleCount + ' / ' + rows.length + ' beads shown';
}

function getSortValue(row, key) {
  if (key === 'type') return parseInt(row.dataset.typeSort || '9', 10);
  if (key === 'priority') return parseInt(row.dataset.prioritySort || '9', 10);
  return parseInt(row.dataset.updatedTs || '0', 10);
}

function applySort() {
  for (const tbody of Array.from(document.querySelectorAll('tbody'))) {
    const rows = Array.from(tbody.querySelectorAll('tr'));
    rows.sort((a, b) => {
      const aValue = getSortValue(a, sortState.key);
      const bValue = getSortValue(b, sortState.key);
      return sortState.desc ? bValue - aValue : aValue - bValue;
    });
    for (const row of rows) {
      tbody.appendChild(row);
    }
  }
  for (const icon of Array.from(document.querySelectorAll('.sortIcon'))) {
    const key = icon.dataset.sortKey;
    icon.textContent = key === sortState.key ? (sortState.desc ? '▼' : '▲') : ' ';
  }
}

document.getElementById('addFilter').addEventListener('click', () => {
  filterMenu.classList.toggle('open');
});
document.getElementById('clearFilters').addEventListener('click', () => {
  preset.value = 'default';
  applyPreset('default');
});
preset.addEventListener('change', () => {
  applyPreset(preset.value || 'default');
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.menu')) {
    filterMenu.classList.remove('open');
  }
});
document.getElementById('refresh').addEventListener('click', () => {
  vscode.postMessage({ command: 'refresh' });
});
document.getElementById('openGitGraph').addEventListener('click', () => {
  vscode.postMessage({ command: 'openGitGraph' });
});
for (const button of Array.from(document.querySelectorAll('.sortToggle'))) {
  button.addEventListener('click', () => {
    const key = button.dataset.sortKey || 'updated';
    if (sortState.key === key) {
      sortState.desc = !sortState.desc;
    } else {
      sortState = { key: key, desc: true };
    }
    applySort();
  });
}
for (const button of Array.from(document.getElementsByClassName('commitLink'))) {
  button.addEventListener('click', () => {
    vscode.postMessage({ command: 'openGitGraphForCommit', commitHash: button.dataset.commit });
  });
}
for (const row of Array.from(document.querySelectorAll('tbody tr'))) {
  const selectRow = (event) => {
    const target = event.target;
    if (target && target.closest && target.closest('button')) return;
    if (selectedRow) {
      selectedRow.classList.remove('selected');
    }
    selectedRow = row;
    row.classList.add('selected');

    const encoded = row.dataset.item;
    if (!encoded) {
      renderDetails(null);
      return;
    }
    try {
      renderDetails(JSON.parse(decodeURIComponent(encoded)));
    } catch {
      try {
        renderDetails(JSON.parse(encoded));
      } catch {
        renderDetails(null);
      }
    }
  };

  row.addEventListener('click', selectRow);
  row.addEventListener('dblclick', selectRow);
}
renderFilterChips();
applySort();
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

    if (message.command === "openGitGraph") {
      await vscode.commands.executeCommand("beads-git-graph.view");
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
    }
  }
}
