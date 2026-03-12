import * as vscode from "vscode";

import {
  beadShortDate,
  beadStatusLabel,
  normalizeBeadPriority,
  normalizeBeadStatus,
  normalizeBeadType
} from "./beadsData";
import { beadUpdatedTimestamp, flattenBeadHierarchy } from "./beadsHierarchy";
import { type BeadLoadResult } from "./beadsViewTypes";
import { escapeHtml, getNonce } from "./utils";

const BEADS_WEBVIEW_SCRIPT = "beadsWebview.min.js";

export function renderBeadsWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  result: BeadLoadResult
) {
  const nonce = getNonce();
  const rows = result.groups;
  const showWorkspaceLabel =
    rows.length + result.emptyWorkspaces.length + result.unavailableWorkspaces.length > 1;
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "out", BEADS_WEBVIEW_SCRIPT)
  );

  let bodyHtml = "";
  if (
    rows.length === 0 &&
    result.emptyWorkspaces.length === 0 &&
    result.unavailableWorkspaces.length === 0
  ) {
    if (!result.bdExecutableStatus.available) {
      bodyHtml = `<div class="empty">The Beads CLI could not be found. Set <code>beads-git-graph.bdPath</code> to a valid executable or install <code>bd</code> so it is available on PATH.${result.bdExecutableStatus.message ? `<br><br>${escapeHtml(result.bdExecutableStatus.message)}` : ""}</div>`;
    } else {
      bodyHtml =
        '<div class="empty">Beads is not initialized in this workspace. Run <code>bd init</code> to create <code>.beads</code>, or add legacy <code>.beads/beads.json</code> or <code>.beads/issues.jsonl</code> data.</div>';
    }
  } else {
    const populatedHtml = rows
      .map((group) => {
        const itemRows = flattenBeadHierarchy(group.items)
          .map(({ item, parentId, epicId, depth, orderIndex, guideColumns, isLastSibling }) => {
            const normalizedStatus = normalizeBeadStatus(item.status);
            const statusLabel = beadStatusLabel(normalizedStatus);
            const progressLabel =
              normalizedStatus === "in_progress" && item.progress !== null
                ? `${item.progress}%`
                : "";
            const normalizedPriority = normalizeBeadPriority(item.priority);
            const normalizedType = normalizeBeadType(item.type);
            const updatedTs = beadUpdatedTimestamp(item.updatedAt);
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
            const serializedItem = {
              ...item,
              parentId: parentId ?? "",
              epicId: epicId ?? ""
            };
            const treeWidth = depth > 0 ? depth * 18 : 0;
            return `<tr class="beadRow" data-id="${escapeHtml(item.id)}" data-workspace-path="${escapeHtml(group.workspacePath)}" data-parent-id="${escapeHtml(parentId ?? "")}" data-epic-id="${escapeHtml(epicId ?? "")}" data-depth="${depth}" data-order-index="${orderIndex}" data-guide-columns="${guideColumns.map((value) => (value ? "1" : "0")).join("")}" data-last-sibling="${isLastSibling ? "1" : "0"}" data-status="${escapeHtml(normalizedStatus)}" data-item="${escapeHtml(encodeURIComponent(JSON.stringify(serializedItem)))}" data-updated-ts="${updatedTs}" data-type-sort="${typeSortOrder}" data-priority-sort="${Number.isNaN(prioritySortOrder) ? 9 : prioritySortOrder}"><td><span class="typeBadge type-${escapeHtml(normalizedType)}">${escapeHtml(item.type)}</span></td><td><div class="titleCell" style="--tree-width:${treeWidth}px"><div class="titleContent"><div class="beadId">${escapeHtml(item.id)}</div><div class="beadTitle">${escapeHtml(item.title)}</div></div></div></td><td><div class="statusCell"><span class="statusBadge status-${escapeHtml(normalizedStatus.replace(/_/g, "-"))}">${escapeHtml(statusLabel)}</span>${progressLabel === "" ? "" : `<span class="progressText">${escapeHtml(progressLabel)}</span>`}</div></td><td><span class="priorityBadge priority-${escapeHtml(normalizedPriority.toLowerCase())}">${escapeHtml(normalizedPriority)}</span></td><td class="updatedCell" title="${escapeHtml(item.updatedAt)}">${escapeHtml(shortUpdated)}</td></tr>`;
          })
          .join("");

        return `<section data-workspace-path="${escapeHtml(group.workspacePath)}">${showWorkspaceLabel ? `<div class="meta"><strong>${escapeHtml(group.workspace)}</strong></div>` : ""}<div class="tableWrap"><svg class="hierarchyOverlay" aria-hidden="true"></svg><table><thead><tr><th><button class="sortToggle" data-sort-key="type" type="button" title="Sort by type">Type <span class="sortIcon" data-sort-key="type"> </span></button></th><th>Title</th><th>Status</th><th><button class="sortToggle" data-sort-key="priority" type="button" title="Sort by priority">Priority <span class="sortIcon" data-sort-key="priority"> </span></button></th><th><button class="sortToggle" data-sort-key="updated" type="button" title="Sort by updated">Updated <span class="sortIcon" data-sort-key="updated">▼</span></button></th></tr></thead><tbody>${itemRows}</tbody></table></div></section>`;
      })
      .join("");
    const emptyHtml = result.emptyWorkspaces
      .map(
        (workspace) =>
          `<section data-workspace-path="${escapeHtml(workspace.workspacePath)}">${showWorkspaceLabel ? `<div class="meta"><strong>${escapeHtml(workspace.workspace)}</strong></div>` : ""}<div class="empty">Beads is initialized, but no issues exist yet. Run <code>bd create &quot;Title&quot;</code> to add one.</div></section>`
      )
      .join("");
    const unavailableHtml = result.unavailableWorkspaces
      .map(
        (workspace) =>
          `<section data-workspace-path="${escapeHtml(workspace.workspacePath)}">${showWorkspaceLabel ? `<div class="meta"><strong>${escapeHtml(workspace.workspace)}</strong></div>` : ""}<div class="empty">Beads is initialized, but the configured <code>bd</code> executable is unavailable, so current <code>.beads</code> data cannot be loaded. Set <code>beads-git-graph.bdPath</code> to a valid executable or install <code>bd</code> on PATH.</div></section>`
      )
      .join("");

    bodyHtml = populatedHtml + emptyHtml + unavailableHtml;
  }

  const warningHtml =
    result.warnings.length > 0
      ? `<div class="warnings"><strong>Sync warnings</strong><ul>${result.warnings.map((warning) => `<li>${escapeHtml(warning.source)}: ${escapeHtml(warning.message)}${warning.workspacePath ? ` <button class="warningAction" type="button" data-sync-workspace="${escapeHtml(warning.workspacePath)}">Sync Now</button>` : ""}</li>`).join("")}</ul></div>`
      : "";
  const errorHtml =
    result.errors.length > 0
      ? `<div class="errors"><strong>Parse errors</strong><ul>${result.errors.map((error) => `<li>${escapeHtml(error.source)}: ${escapeHtml(error.message)}</li>`).join("")}</ul></div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:4px;background:var(--vscode-editor-background);}
.toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:8px;margin-bottom:2px;}
.toolbarMain{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;}
.toolbarActions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex:0 0 auto;}
.toolbarStatsRow{display:flex;justify-content:flex-end;margin:0 0 6px;}
.preset{height:24px;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));border-radius:6px;padding:0 6px;font-size:11px;}
.chips{display:flex;gap:6px;flex-wrap:wrap;}
.chips:empty{display:none;}
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
.contextMenu{display:none;position:fixed;z-index:40;min-width:140px;background:var(--vscode-menu-background);border:1px solid var(--vscode-menu-border, var(--vscode-panel-border));box-shadow:0 6px 18px var(--vscode-widget-shadow);padding:4px;border-radius:6px;}
.contextMenu.open{display:block;}
.contextMenu button{display:block;width:100%;margin:0;text-align:left;background:transparent;color:var(--vscode-menu-foreground);border:1px solid transparent;padding:6px 8px;border-radius:4px;}
.contextMenu button:hover:not(:disabled){background:var(--vscode-menu-selectionBackground);color:var(--vscode-menu-selectionForeground);}
.contextMenu button:disabled{opacity:.45;cursor:default;}
button{border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:4px 8px;cursor:pointer;border-radius:6px;font-size:11px;}
button:hover{background:var(--vscode-button-hoverBackground);}
.actionBtn{display:inline-flex;align-items:center;justify-content:center;height:24px;padding:0 10px;border-radius:11px;background:rgba(128,128,128,.1);border:1px solid rgba(128,128,128,.5);gap:6px;transition:border-color .18s ease, background-color .18s ease, box-shadow .18s ease;}
.actionBtn:hover{background:rgba(128,128,128,.2);}
#syncBeads{min-width:68px;}
body[data-has-sync-warnings="1"] #syncBeads{border-color:var(--vscode-editorWarning-foreground, #f59e0b);background:rgba(245,158,11,.18);box-shadow:0 0 0 0 rgba(245,158,11,.32);animation:syncPulse 1.4s ease-in-out infinite;}
body[data-has-sync-warnings="1"] #syncBeads .toolbarActionLabel{font-weight:700;}
@keyframes syncPulse{0%{box-shadow:0 0 0 0 rgba(245,158,11,.34);}70%{box-shadow:0 0 0 8px rgba(245,158,11,0);}100%{box-shadow:0 0 0 0 rgba(245,158,11,0);}}
#openGitGraph{min-width:74px;}
#refresh{width:80px;font-size:14px;line-height:1;}
.toolbarIcon{display:block;color:var(--vscode-button-foreground);}
.toolbarIcon.switchIcon{width:18px;height:18px;}
.toolbarIcon.refreshIcon{width:18px;height:18px;}
.toolbarActionLabel{color:var(--vscode-button-foreground);font-size:11px;line-height:1;}
.meta{display:grid;grid-template-columns:1fr;font-size:11px;opacity:.9;margin:6px 0 4px;gap:6px;align-items:center;}
section{margin-bottom:10px;}
.tableWrap{position:relative;}
.hierarchyOverlay{position:absolute;inset:0;z-index:0;width:100%;height:100%;pointer-events:none;overflow:visible;}
table{position:relative;z-index:1;width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed;}
th,td{text-align:left;border-bottom:1px solid var(--vscode-panel-border);padding:4px 4px;vertical-align:middle;font-size:13px;}
th{position:sticky;top:0;z-index:2;font-weight:700;line-height:18px;padding:6px 4px;opacity:.95;background:var(--vscode-editor-background);box-shadow:0 1px 0 var(--vscode-panel-border);}
th:nth-child(1){width:52px;}th:nth-child(3){width:78px;}th:nth-child(4){width:56px;}th:nth-child(5){width:84px;}
.sortToggle{display:inline-flex;align-items:center;justify-content:flex-start;width:100%;gap:4px;background:transparent;border:none;color:inherit;padding:0;cursor:pointer;font:inherit;}
.sortToggle:hover{text-decoration:underline;}
.beadRow{cursor:pointer;}
.beadRow:hover{background:rgba(128,128,128,.08);}
.beadRow.selected{background:rgba(128,128,128,.18);}
.beadId{font-size:10px;color:var(--vscode-descriptionForeground);margin-bottom:1px;}
.titleCell{position:relative;min-width:0;padding-left:calc(var(--tree-width, 0px) + 4px);}
.titleContent{min-width:0;}
.hierarchyGuideShadow{fill:none;stroke:rgba(0,0,0,.18);stroke-width:3.8;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;opacity:.45;}
.hierarchyGuideLine{fill:none;stroke:var(--vscode-textLink-foreground, #4da3ff);stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;opacity:1;}
.hierarchyGuideNodeShadow{fill:rgba(0,0,0,.22);vector-effect:non-scaling-stroke;opacity:.4;}
.hierarchyGuideNode{fill:var(--vscode-textLink-foreground, #4da3ff);vector-effect:non-scaling-stroke;opacity:1;}
.beadTitle{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.statusCell{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.typeBadge,.statusBadge,.priorityBadge{display:inline-flex;align-items:center;justify-content:center;padding:1px 5px;border-radius:999px;font-size:10px;font-weight:600;white-space:nowrap;}
.priorityBadge{min-width:34px;}
.progressText{font-size:10px;font-weight:700;color:var(--vscode-textLink-foreground);white-space:nowrap;}
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
.updatedCell{font-size:10px;white-space:nowrap;text-align:right;}
.warnings,.errors{margin-top:10px;padding-top:8px;border-top:1px solid var(--vscode-panel-border);font-size:12px;}
.warnings ul,.errors ul{margin:6px 0 0;padding-left:18px;}
.warnings strong{color:var(--vscode-editorWarning-foreground, var(--vscode-textLink-foreground));}
.warningAction{margin-left:8px;padding:1px 8px;font-size:11px;line-height:1.6;vertical-align:middle;}
.commitLink{font-size:11px;padding:2px 6px;}
.stats{font-size:11px;opacity:.85;margin:0;white-space:nowrap;}
.inlineDetailsRow td{padding:0 4px 8px;border-bottom:none;}
.details{margin:0;padding:8px;border:1px solid var(--vscode-panel-border);font-size:12px;background:var(--vscode-editor-background);border-radius:6px;}
.details h3{margin:0 0 6px;font-size:13px;}
.detailsGrid{display:grid;grid-template-columns:100px 1fr;gap:4px 8px;}
.detailsGrid .key{opacity:.75;}
.detailsDescription{margin-top:8px;white-space:pre-wrap;line-height:1.4;}
code{font-family:var(--vscode-editor-font-family);}
</style>
</head>
<body data-bd-available="${result.bdExecutableStatus.available ? "1" : "0"}" data-has-sync-warnings="${result.warnings.length > 0 ? "1" : "0"}">
<div class="toolbar">
  <div class="toolbarMain">
    <select id="preset" class="preset">
      <option value="default" selected>Default (Active)</option>
      <option value="open">Open</option>
      <option value="wip">WIP</option>
      <option value="blocked">Blocked</option>
      <option value="closed">Closed</option>
      <option value="all">All</option>
    </select>
    <div id="chips" class="chips"></div>
    <div class="menu">
      <button id="addFilter" type="button">+ Filter</button>
      <div id="filterMenu" class="menuPopup"></div>
    </div>
    <button id="clearFilters" type="button">Clear</button>
  </div>
  <div class="toolbarActions">
    <button id="syncBeads" class="actionBtn" type="button" title="Sync Beads" aria-label="Sync Beads">
      <span class="toolbarActionLabel">Sync</span>
    </button>
    <button id="openGitGraph" class="actionBtn" type="button" title="Git Graph" aria-label="Git Graph">
      <svg class="toolbarIcon switchIcon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7 7.5v9M8 8h3.5l3.2 3.2M8 16h3.5l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="7" cy="7.5" r="2.1" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <circle cx="7" cy="16.5" r="2.1" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <circle cx="18" cy="12" r="2.1" fill="none" stroke="currentColor" stroke-width="1.8"/>
      </svg>
      <span class="toolbarActionLabel">Git</span>
    </button>
    <button id="refresh" class="actionBtn" type="button" title="Refresh" aria-label="Refresh">
      <svg class="toolbarIcon refreshIcon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M12 5a7 7 0 1 0 6.65 9.5a1 1 0 1 0-1.9-.63A5 5 0 1 1 12 7h1.59l-1.3 1.29a1 1 0 1 0 1.42 1.42l3-3a1 1 0 0 0 0-1.42l-3-3a1 1 0 1 0-1.42 1.42L13.59 5H12Z"/>
      </svg>
    </button>
  </div>
</div>
<div class="toolbarStatsRow"><div class="stats" id="stats"></div></div>
<div id="rowContextMenu" class="contextMenu"><button id="createBeadAction" type="button">Create</button><button id="closeBeadAction" type="button">Close</button></div>
${bodyHtml}
${warningHtml}
${errorHtml}
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
