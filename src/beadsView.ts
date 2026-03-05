import * as vscode from "vscode";

interface BeadItem {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  updatedAt: string;
  commitHash: string;
  description: string;
  assignee: string;
  labels: string;
  createdAt: string;
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
      description: this.pickString(record, ["description", "body", "details", "summary"], "-"),
      assignee: this.pickString(record, ["assignee", "owner", "assigned_to"], "-"),
      labels: this.pickStringArray(record, ["labels", "tags"], "-"),
      createdAt: this.pickString(record, ["created_at", "createdAt", "created"], "-"),
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

  private pickStringArray(record: Record<string, unknown>, keys: string[], fallback: string = "") {
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) {
        const labels = value
          .filter((v): v is string => typeof v === "string" && v.trim() !== "")
          .map((v) => v.trim());
        if (labels.length > 0) return labels.join(", ");
      }
    }
    return fallback;
  }

  private normalizeStatus(status: string) {
    const value = status.toLowerCase().replace(/\s+/g, "_");
    if (value === "open") return "open";
    if (value === "in_progress" || value === "in-progress" || value === "progress") {
      return "in_progress";
    }
    if (value === "blocked") return "blocked";
    if (value === "closed" || value === "done" || value === "resolved") return "closed";
    return "other";
  }

  private statusLabel(status: string) {
    if (status === "open") return "Open";
    if (status === "in_progress") return "In Progress";
    if (status === "blocked") return "Blocked";
    if (status === "closed") return "Closed";
    return "Other";
  }

  private normalizePriority(priority: string) {
    const value = priority.trim().toUpperCase();
    const match = value.match(/P\s*([0-4])/i) ?? value.match(/([0-4])/);
    return match ? `P${match[1]}` : "P3";
  }

  private normalizeType(type: string) {
    const value = type.trim().toLowerCase();
    if (value === "feature" || value === "feat") return "feature";
    if (value === "bug" || value === "fix") return "bug";
    if (value === "task" || value === "chore") return "task";
    if (value === "epic") return "epic";
    return "other";
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
            .map((item) => {
              const normalizedStatus = this.normalizeStatus(item.status);
              const statusLabel = this.statusLabel(normalizedStatus);
              const normalizedPriority = this.normalizePriority(item.priority);
              const normalizedType = this.normalizeType(item.type);
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
              return `<tr class="beadRow" data-status="${escapeHtml(normalizedStatus)}" data-text="${escapeHtml((item.id + " " + item.title + " " + item.type + " " + item.status + " " + item.priority).toLowerCase())}" data-item="${escapeHtml(encodeURIComponent(JSON.stringify(item)))}" data-updated-ts="${Number.isNaN(updatedTs) ? 0 : updatedTs}" data-type-sort="${typeSortOrder}" data-priority-sort="${Number.isNaN(prioritySortOrder) ? 9 : prioritySortOrder}"><td><span class="typeBadge type-${escapeHtml(normalizedType)}">${escapeHtml(item.type)}</span></td><td><div class="beadId">${escapeHtml(item.id)}</div><div class="beadTitle">${escapeHtml(item.title)}</div></td><td><span class="statusBadge status-${escapeHtml(normalizedStatus.replace(/_/g, "-"))}">${escapeHtml(statusLabel)}</span></td><td><span class="priorityBadge priority-${escapeHtml(normalizedPriority.toLowerCase())}">${escapeHtml(normalizedPriority)}</span></td><td>${escapeHtml(item.updatedAt)}</td></tr>`;
            })
            .join("");

          return `<section><div class="meta"><strong>${escapeHtml(group.workspace)}</strong><span>${escapeHtml(group.source)}</span><button class="openSource" data-uri="${encodeURIComponent(group.sourceUri.toString())}">Open JSON</button></div><table><thead><tr><th><button class="sortToggle" data-sort-key="type" type="button" title="Sort by type">Type <span class="sortIcon" data-sort-key="type"> </span></button></th><th>Title</th><th>Status</th><th><button class="sortToggle" data-sort-key="priority" type="button" title="Sort by priority">Priority <span class="sortIcon" data-sort-key="priority"> </span></button></th><th><button class="sortToggle" data-sort-key="updated" type="button" title="Sort by updated">Updated <span class="sortIcon" data-sort-key="updated">▼</span></button></th></tr></thead><tbody>${itemRows}</tbody></table></section>`;
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
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:8px;background:var(--vscode-editor-background);}
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
.toolbarLeft,.toolbarRight{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.preset{height:26px;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));border-radius:6px;padding:0 8px;font-size:12px;}
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
.search{min-width:180px;max-width:280px;width:100%;padding:5px 8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);border-radius:6px;}
button{border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:4px 10px;cursor:pointer;border-radius:6px;font-size:12px;}
button:hover{background:var(--vscode-button-hoverBackground);}
.meta{display:grid;grid-template-columns:1fr auto auto;font-size:12px;opacity:.9;margin:10px 0 6px;gap:8px;align-items:center;}
table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed;}
th,td{text-align:left;border-bottom:1px solid var(--vscode-panel-border);padding:8px 6px;vertical-align:middle;}
th{font-size:12px;font-weight:600;opacity:.9;}
th:nth-child(1){width:90px;}th:nth-child(3){width:110px;}th:nth-child(4){width:80px;}th:nth-child(5){width:100px;}
.sortToggle{display:inline-flex;align-items:center;gap:4px;background:transparent;border:none;color:inherit;padding:0;cursor:pointer;font:inherit;}
.sortToggle:hover{text-decoration:underline;}
.beadRow{cursor:pointer;}
.beadRow:hover{background:rgba(128,128,128,.08);}
.beadRow.selected{background:rgba(128,128,128,.18);}
.beadId{font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:2px;}
.beadTitle{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.typeBadge,.statusBadge,.priorityBadge{display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap;}
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
  <div class="toolbarLeft">
    <select id="preset" class="preset">
      <option value="not_closed" selected>Not Closed</option>
      <option value="all">All</option>
    </select>
    <div id="chips" class="chips"></div>
    <div class="menu">
      <button id="addFilter" type="button">+ Filter</button>
      <div id="filterMenu" class="menuPopup"></div>
    </div>
    <button id="clearFilters" type="button">Clear</button>
  </div>
  <div class="toolbarRight">
    <input id="search" class="search" type="text" placeholder="Search beads..."/>
    <button id="refresh">Refresh</button>
  </div>
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
const search = document.getElementById('search');
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
  const text = search.value.trim().toLowerCase();
  let visibleCount = 0;
  for (const row of rows) {
    const status = row.dataset.status || '';
    const rowText = row.dataset.text || '';
    const statusMatch = activeFilters.has(status);
    const textMatch = text === '' || rowText.includes(text);
    const visible = statusMatch && textMatch;
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

search.addEventListener('input', applyFilters);
document.getElementById('addFilter').addEventListener('click', () => {
  filterMenu.classList.toggle('open');
});
document.getElementById('clearFilters').addEventListener('click', () => {
  preset.value = 'not_closed';
  applyPreset('not_closed');
});
preset.addEventListener('change', () => {
  applyPreset(preset.value || 'not_closed');
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.menu')) {
    filterMenu.classList.remove('open');
  }
});
document.getElementById('refresh').addEventListener('click', () => {
  vscode.postMessage({ command: 'refresh' });
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
for (const row of Array.from(document.querySelectorAll('tbody tr'))) {
  row.addEventListener('click', (event) => {
    const target = event.target;
    if (target && target.closest && target.closest('button')) return;
    if (selectedRow) {
      selectedRow.classList.remove('selected');
    }
    selectedRow = row;
    row.classList.add('selected');
    try {
      const encoded = row.dataset.item;
      renderDetails(encoded ? JSON.parse(decodeURIComponent(encoded)) : null);
    } catch {
      renderDetails(null);
    }
  });
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
