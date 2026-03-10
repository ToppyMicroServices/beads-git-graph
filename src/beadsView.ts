import * as cp from "node:child_process";
import * as path from "node:path";

import * as vscode from "vscode";

import {
  type BeadItem,
  beadShortDate,
  beadStatusLabel,
  buildBeadHierarchy,
  diffBeadItems,
  extractBeadItems,
  mergeBeadItems,
  normalizeBeadPriority,
  normalizeBeadStatus,
  normalizeBeadType
} from "./beadsData";
import { checkExecutable,type CommandAvailability } from "./commandAvailability";
import { getConfig } from "./config";
import { GitGraphView } from "./gitGraphView";
import { escapeHtml, getNonce } from "./utils";

type CreateBeadType = "task" | "feature" | "bug" | "epic" | "chore";
type CreateBeadStatus = "open" | "in_progress" | "blocked" | "closed";
type CreateBeadPriority = "P0" | "P1" | "P2" | "P3" | "P4";

interface BeadGroup {
  workspace: string;
  workspacePath: string;
  items: BeadItem[];
}

interface EmptyBeadWorkspace {
  workspace: string;
  workspacePath: string;
}

interface BeadWarning {
  source: string;
  message: string;
  workspacePath?: string;
}

interface BeadLoadResult {
  groups: BeadGroup[];
  emptyWorkspaces: EmptyBeadWorkspace[];
  unavailableWorkspaces: EmptyBeadWorkspace[];
  bdExecutableStatus: CommandAvailability;
  errors: { source: string; message: string }[];
  warnings: BeadWarning[];
}

interface CliLoadResult {
  items: BeadItem[];
  warnings: BeadWarning[];
}

interface BeadRenderItem {
  item: BeadItem;
  parentId: string | null;
  epicId: string | null;
  depth: number;
  orderIndex: number;
  guideColumns: boolean[];
  isLastSibling: boolean;
}

interface BeadHierarchyOrderItem {
  item: BeadItem;
  parentId: string | null;
  epicId: string | null;
  depth: number;
  orderIndex: number;
}

function beadUpdatedTimestamp(updatedAt: string) {
  const updatedTs = Date.parse(updatedAt);
  return Number.isNaN(updatedTs) ? 0 : updatedTs;
}

function flattenBeadHierarchy(items: BeadItem[]): BeadRenderItem[] {
  const hierarchy: BeadHierarchyOrderItem[] = buildBeadHierarchy(items).map(
    (entry, orderIndex) => ({
      ...entry,
      orderIndex
    })
  );
  const rowsById = new Map(hierarchy.map((entry) => [entry.item.id, entry]));
  const childrenByParent = new Map<string, BeadHierarchyOrderItem[]>();
  const subtreeUpdatedCache = new Map<string, number>();

  for (const entry of hierarchy) {
    if (entry.parentId !== null && rowsById.has(entry.parentId)) {
      const children = childrenByParent.get(entry.parentId) ?? [];
      children.push(entry);
      childrenByParent.set(entry.parentId, children);
    }
  }

  const getSubtreeUpdatedTimestamp = (
    entry: BeadHierarchyOrderItem,
    visiting: Set<string>
  ): number => {
    const cached = subtreeUpdatedCache.get(entry.item.id);
    if (cached !== undefined) {
      return cached;
    }

    if (visiting.has(entry.item.id)) {
      return beadUpdatedTimestamp(entry.item.updatedAt);
    }

    visiting.add(entry.item.id);

    let latest = beadUpdatedTimestamp(entry.item.updatedAt);
    for (const child of childrenByParent.get(entry.item.id) ?? []) {
      latest = Math.max(latest, getSubtreeUpdatedTimestamp(child, visiting));
    }

    visiting.delete(entry.item.id);
    subtreeUpdatedCache.set(entry.item.id, latest);
    return latest;
  };

  const compareEntries = (a: BeadHierarchyOrderItem, b: BeadHierarchyOrderItem) => {
    const updatedDelta =
      getSubtreeUpdatedTimestamp(b, new Set<string>()) -
      getSubtreeUpdatedTimestamp(a, new Set<string>());
    if (updatedDelta !== 0) {
      return updatedDelta;
    }

    return a.orderIndex - b.orderIndex;
  };

  const roots = hierarchy
    .filter((entry) => entry.parentId === null || !rowsById.has(entry.parentId))
    .sort(compareEntries);
  const ordered: BeadRenderItem[] = [];
  const visited = new Set<string>();

  const appendSubtree = (
    entry: BeadHierarchyOrderItem,
    guideColumns: boolean[],
    isLastSibling: boolean
  ) => {
    if (visited.has(entry.item.id)) {
      return;
    }

    visited.add(entry.item.id);
    ordered.push({
      ...entry,
      guideColumns,
      isLastSibling
    });

    const children = [...(childrenByParent.get(entry.item.id) ?? [])].sort(compareEntries);
    const childGuideColumns = entry.depth > 0 ? [...guideColumns, !isLastSibling] : [];
    for (let i = 0; i < children.length; i++) {
      appendSubtree(children[i], childGuideColumns, i === children.length - 1);
    }
  };

  for (let i = 0; i < roots.length; i++) {
    appendSubtree(roots[i], [], i === roots.length - 1);
  }

  for (const entry of hierarchy) {
    appendSubtree(entry, [], true);
  }

  return ordered;
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
      vscode.workspace.createFileSystemWatcher("**/.beads/beads.db*"),
      vscode.workspace.createFileSystemWatcher("**/.beads/config.yaml"),
      vscode.workspace.createFileSystemWatcher("**/.beads/metadata.json"),
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
    const emptyWorkspaces: EmptyBeadWorkspace[] = [];
    const unavailableWorkspaces: EmptyBeadWorkspace[] = [];
    const errors: { source: string; message: string }[] = [];
    const warnings: BeadWarning[] = [];
    const bdExecutableStatus = await checkExecutable(getConfig().bdPath());

    for (const folder of workspaceFolders) {
      const workspaceInfo = {
        workspace: folder.name,
        workspacePath: folder.uri.fsPath
      };
      const legacyFiles = await this.findLegacyBeadFiles(folder);
      const beadsDirUri = vscode.Uri.joinPath(folder.uri, ".beads");
      const hasBeadsDirectory = await this.pathExists(beadsDirUri);

      if (hasBeadsDirectory && bdExecutableStatus.available) {
        try {
          const cliResult = await this.loadBdItemsFromCli(folder.uri.fsPath);
          warnings.push(...cliResult.warnings);
          const cliItems = cliResult.items;
          if (cliItems.length > 0) {
            groups.push({
              ...workspaceInfo,
              items: cliItems
            });
          } else {
            emptyWorkspaces.push(workspaceInfo);
          }
          continue;
        } catch (error) {
          if (legacyFiles.length === 0) {
            errors.push({
              source: vscode.workspace.asRelativePath(beadsDirUri, false),
              message:
                error instanceof Error ? error.message : "Unable to read Beads data via bd list"
            });
          }
        }
      }

      const legacyResult = await this.loadLegacyWorkspaceItems(legacyFiles);
      errors.push(...legacyResult.errors);

      if (legacyResult.items.length > 0) {
        groups.push({
          ...workspaceInfo,
          items: legacyResult.items
        });
      } else if (legacyResult.hasFiles) {
        emptyWorkspaces.push(workspaceInfo);
      } else if (hasBeadsDirectory && !bdExecutableStatus.available) {
        unavailableWorkspaces.push(workspaceInfo);
      }
    }

    return {
      groups: groups.sort((a, b) => a.workspace.localeCompare(b.workspace)),
      emptyWorkspaces: emptyWorkspaces.sort((a, b) => a.workspace.localeCompare(b.workspace)),
      unavailableWorkspaces: unavailableWorkspaces.sort((a, b) =>
        a.workspace.localeCompare(b.workspace)
      ),
      bdExecutableStatus,
      errors,
      warnings
    };
  }

  private getHtml(webview: vscode.Webview, result: BeadLoadResult) {
    const nonce = getNonce();
    const rows = result.groups;
    const showWorkspaceLabel =
      rows.length + result.emptyWorkspaces.length + result.unavailableWorkspaces.length > 1;

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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
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
th:nth-child(1){width:52px;}th:nth-child(3){width:72px;}th:nth-child(4){width:38px;}th:nth-child(5){width:72px;}
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
.updatedCell{font-size:10px;white-space:nowrap;}
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
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const STATUS_LABELS = { open: 'Open', in_progress: 'In Progress', blocked: 'Blocked', closed: 'Closed', other: 'Other' };
const ALL_FILTERS = ['open', 'in_progress', 'blocked', 'closed', 'other'];
const PRESET_FILTERS = {
  default: ['open', 'in_progress', 'blocked'],
  open: ['open'],
  wip: ['in_progress'],
  blocked: ['blocked'],
  closed: ['closed'],
  all: ALL_FILTERS
};
let activeFilters = new Set(PRESET_FILTERS.default);
let selectedRow = null;
let expandedDetailsRow = null;
let contextMenuRow = null;
let contextMenuWorkspacePath = '';
let sortState = { key: 'updated', desc: true };
const chips = document.getElementById('chips');
const preset = document.getElementById('preset');
const filterMenu = document.getElementById('filterMenu');
const clearFilters = document.getElementById('clearFilters');
const rowContextMenu = document.getElementById('rowContextMenu');
const createBeadAction = document.getElementById('createBeadAction');
const closeBeadAction = document.getElementById('closeBeadAction');
const bdAvailable = document.body.dataset.bdAvailable === '1';
const hasSyncWarnings = document.body.dataset.hasSyncWarnings === '1';
const syncBeadsButton = document.getElementById('syncBeads');

if (hasSyncWarnings) {
  syncBeadsButton.title = 'Sync Beads (differences detected)';
  syncBeadsButton.setAttribute('aria-label', 'Sync Beads, differences detected');
}

function decodeRowItem(row) {
  const encoded = row.dataset.item;
  if (!encoded) {
    return null;
  }
  try {
    return JSON.parse(decodeURIComponent(encoded));
  } catch {
    try {
      return JSON.parse(encoded);
    } catch {
      return null;
    }
  }
}

function closeContextMenu() {
  rowContextMenu.classList.remove('open');
  contextMenuRow = null;
  contextMenuWorkspacePath = '';
}

function openContextMenu(row, workspacePath, event) {
  contextMenuRow = row;
  contextMenuWorkspacePath = workspacePath || '';
  const item = row ? decodeRowItem(row) : null;
  createBeadAction.disabled = !bdAvailable || contextMenuWorkspacePath === '';
  closeBeadAction.disabled = !item || (row.dataset.status || '') === 'closed';
  rowContextMenu.style.left = event.clientX + 'px';
  rowContextMenu.style.top = event.clientY + 'px';
  rowContextMenu.classList.add('open');
}

function setsEqual(values, expected) {
  if (values.size !== expected.length) return false;
  return expected.every((value) => values.has(value));
}

function getPresetValue() {
  for (const [presetKey, presetFilters] of Object.entries(PRESET_FILTERS)) {
    if (setsEqual(activeFilters, presetFilters)) return presetKey;
  }
  return '';
}

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
  const presetValue = getPresetValue();
  preset.value = presetValue;
  clearFilters.style.display = presetValue === '' ? '' : 'none';
  if (presetValue !== '') {
    chips.innerHTML = '';
    renderFilterMenu();
    return;
  }

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
  activeFilters = new Set(PRESET_FILTERS[value] || PRESET_FILTERS.default);
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

function renderDetailsMarkup(item) {
  const commit = item.commitHash && item.commitHash !== ''
    ? '<button class="commitLink" data-commit="' + esc(item.commitHash) + '">' + esc(item.commitHash.substring(0, 8)) + '</button>'
    : '-';
  const progress = item.status === 'in_progress' && item.progress !== null
    ? String(item.progress) + '%'
    : '-';
  const parent = item.parentId && item.parentId !== '' ? item.parentId : '-';
  const epic = item.epicId && item.epicId !== '' && item.epicId !== item.id ? item.epicId : '-';
  return '' +
    '<div class="details">' +
    '<h3>' + esc(item.id) + ' — ' + esc(item.title) + '</h3>' +
    '<div class="detailsGrid">' +
      '<div class="key">Type</div><div>' + esc(item.type || '-') + '</div>' +
      '<div class="key">Parent</div><div>' + esc(parent) + '</div>' +
      '<div class="key">Epic</div><div>' + esc(epic) + '</div>' +
      '<div class="key">Status</div><div>' + esc(item.status || '-') + '</div>' +
      '<div class="key">Progress</div><div>' + esc(progress) + '</div>' +
      '<div class="key">Priority</div><div>' + esc(item.priority || '-') + '</div>' +
      '<div class="key">Assignee</div><div>' + esc(item.assignee || '-') + '</div>' +
      '<div class="key">Labels</div><div>' + esc(item.labels || '-') + '</div>' +
      '<div class="key">Created</div><div>' + esc(item.createdAt || '-') + '</div>' +
      '<div class="key">Updated</div><div>' + esc(item.updatedAt || '-') + '</div>' +
      '<div class="key">Commit</div><div>' + commit + '</div>' +
    '</div>' +
    '<div class="detailsDescription"><strong>Notes</strong><br>' + esc(item.notes || '-') + '</div>' +

    '<div class="detailsDescription"><strong>Description</strong><br>' + esc(item.description || '-') + '</div>' +
    '</div>';
}

function bindCommitLinks(scope) {
  for (const button of Array.from(scope.getElementsByClassName('commitLink'))) {
    button.addEventListener('click', () => {
      vscode.postMessage({ command: 'openGitGraphForCommit', commitHash: button.dataset.commit });
    });
  }
}

function removeExpandedDetails() {
  if (!expandedDetailsRow) {
    return;
  }
  expandedDetailsRow.remove();
  expandedDetailsRow = null;
}

function expandDetailsRow(row, item) {
  removeExpandedDetails();
  const detailsRow = document.createElement('tr');
  detailsRow.className = 'inlineDetailsRow';
  const detailsCell = document.createElement('td');
  detailsCell.colSpan = 5;
  detailsCell.innerHTML = renderDetailsMarkup(item);
  detailsRow.appendChild(detailsCell);
  row.insertAdjacentElement('afterend', detailsRow);
  bindCommitLinks(detailsRow);
  expandedDetailsRow = detailsRow;
}

function applyFilters() {
  const rows = Array.from(document.querySelectorAll('tbody .beadRow'));
  let visibleCount = 0;
  for (const row of rows) {
    const status = row.dataset.status || '';
    const visible = activeFilters.has(status);
    row.style.display = visible ? '' : 'none';
    if (visible) visibleCount++;
  }
  if (selectedRow && selectedRow.style.display === 'none') {
    selectedRow.classList.remove('selected');
    selectedRow = null;
    removeExpandedDetails();
  }
  if (contextMenuRow && contextMenuRow.style.display === 'none') {
    closeContextMenu();
  }
  document.getElementById('stats').textContent = visibleCount + ' / ' + rows.length + ' beads shown';
  renderHierarchyOverlays();
}

function getSortValue(row, key) {
  if (key === 'type') return parseInt(row.dataset.typeSort || '9', 10);
  if (key === 'priority') return parseInt(row.dataset.prioritySort || '9', 10);
  return parseInt(row.dataset.updatedTs || '0', 10);
}

function compareRows(a, b) {
  const aValue = getSortValue(a, sortState.key);
  const bValue = getSortValue(b, sortState.key);
  if (aValue !== bValue) {
    return sortState.desc ? bValue - aValue : aValue - bValue;
  }

  const aOrder = parseInt(a.dataset.orderIndex || '0', 10);
  const bOrder = parseInt(b.dataset.orderIndex || '0', 10);
  return aOrder - bOrder;
}

function applySort() {
  for (const tbody of Array.from(document.querySelectorAll('tbody'))) {
    const rows = Array.from(tbody.querySelectorAll('.beadRow'));
    const rowById = new Map();
    const childrenByParent = new Map();
    for (const row of rows) {
      rowById.set(row.dataset.id || '', row);
    }
    for (const row of rows) {
      const parentId = row.dataset.parentId || '';
      if (parentId !== '' && rowById.has(parentId)) {
        const siblings = childrenByParent.get(parentId) || [];
        siblings.push(row);
        childrenByParent.set(parentId, siblings);
      }
    }

    const visited = new Set();
    const appendRow = (row) => {
      const id = row.dataset.id || '';
      if (visited.has(id)) {
        return;
      }
      visited.add(id);
      tbody.appendChild(row);
      if (selectedRow === row && expandedDetailsRow) {
        tbody.appendChild(expandedDetailsRow);
      }
      const children = (childrenByParent.get(id) || []).sort(compareRows);
      for (const child of children) {
        appendRow(child);
      }
    };

    const roots = rows
      .filter((row) => {
        const parentId = row.dataset.parentId || '';
        return parentId === '' || !rowById.has(parentId);
      })
      .sort(compareRows);

    for (const root of roots) {
      appendRow(root);
    }
    for (const row of rows) {
      appendRow(row);
    }
  }
  for (const icon of Array.from(document.querySelectorAll('.sortIcon'))) {
    const key = icon.dataset.sortKey;
    icon.textContent = key === sortState.key ? (sortState.desc ? '▼' : '▲') : ' ';
  }
  renderHierarchyOverlays();
}

function renderHierarchyOverlays() {
  const step = 18;
  const paddingBase = 4;
  for (const wrap of Array.from(document.querySelectorAll('.tableWrap'))) {
    const overlay = wrap.querySelector('.hierarchyOverlay');
    const tbody = wrap.querySelector('tbody');
    if (!overlay || !tbody) {
      continue;
    }

    const visibleRows = Array.from(tbody.querySelectorAll('.beadRow')).filter((row) => row.style.display !== 'none');
    if (visibleRows.length === 0) {
      overlay.innerHTML = '';
      continue;
    }

    const wrapRect = wrap.getBoundingClientRect();
    const width = Math.max(1, Math.round(wrapRect.width));
    const height = Math.max(1, Math.round(wrapRect.height));
    overlay.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

    let shadowPaths = '';
    let linePaths = '';
    let nodes = '';

    for (const row of visibleRows) {
      const depth = parseInt(row.dataset.depth || '0', 10);
      if (!Number.isFinite(depth) || depth < 1) {
        continue;
      }

      const titleCell = row.querySelector('.titleCell');
      if (!titleCell) {
        continue;
      }

      const titleRect = titleCell.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const cellLeft = titleRect.left - wrapRect.left;
      const xBase = cellLeft + paddingBase;
      const topY = rowRect.top - wrapRect.top + 2;
      const bottomY = rowRect.bottom - wrapRect.top - 2;
      const midY = (topY + bottomY) / 2;
      const currentX = xBase + (depth - 0.5) * step;
      const endX = xBase + depth * step + 1;
      const guideColumns = (row.dataset.guideColumns || '').split('').map((value) => value === '1');
      const isLastSibling = row.dataset.lastSibling === '1';
      const curveStartY = midY - Math.min(15, (bottomY - topY) * 0.34);
      const controlY = midY - Math.min(8, (bottomY - topY) * 0.16);
      const elbowX = Math.min(endX, currentX + 11);

      for (let i = 0; i < guideColumns.length; i++) {
        if (!guideColumns[i]) {
          continue;
        }
        const x = xBase + (i + 0.5) * step;
        const segment = 'M' + x.toFixed(1) + ' ' + topY.toFixed(1) + ' V ' + bottomY.toFixed(1);
        shadowPaths += '<path class="hierarchyGuideShadow" d="' + segment + '" />';
        linePaths += '<path class="hierarchyGuideLine" d="' + segment + '" />';
      }

      const branchSegment = isLastSibling
        ? 'M' + currentX.toFixed(1) + ' ' + topY.toFixed(1) + ' V ' + curveStartY.toFixed(1) +
          ' C ' + currentX.toFixed(1) + ' ' + controlY.toFixed(1) + ' ' + (currentX + 2).toFixed(1) + ' ' + midY.toFixed(1) + ' ' + elbowX.toFixed(1) + ' ' + midY.toFixed(1) + ' H ' + endX.toFixed(1)
        : 'M' + currentX.toFixed(1) + ' ' + topY.toFixed(1) + ' V ' + curveStartY.toFixed(1) +
          ' C ' + currentX.toFixed(1) + ' ' + controlY.toFixed(1) + ' ' + (currentX + 2).toFixed(1) + ' ' + midY.toFixed(1) + ' ' + elbowX.toFixed(1) + ' ' + midY.toFixed(1) + ' H ' + endX.toFixed(1) +
          ' M' + currentX.toFixed(1) + ' ' + midY.toFixed(1) + ' V ' + bottomY.toFixed(1);

      shadowPaths += '<path class="hierarchyGuideShadow" d="' + branchSegment + '" />';
      linePaths += '<path class="hierarchyGuideLine" d="' + branchSegment + '" />';
      nodes += '<circle class="hierarchyGuideNodeShadow" cx="' + currentX.toFixed(1) + '" cy="' + midY.toFixed(1) + '" r="3.7" />' +
        '<circle class="hierarchyGuideNode" cx="' + currentX.toFixed(1) + '" cy="' + midY.toFixed(1) + '" r="2.15" />';
    }

    overlay.innerHTML = shadowPaths + linePaths + nodes;
  }
}

document.getElementById('addFilter').addEventListener('click', () => {
  filterMenu.classList.toggle('open');
});
document.getElementById('clearFilters').addEventListener('click', () => {
  applyPreset('default');
});
preset.addEventListener('change', () => {
  applyPreset(preset.value || 'default');
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.menu')) {
    filterMenu.classList.remove('open');
  }
  if (!event.target.closest('.contextMenu')) {
    closeContextMenu();
  }
});
document.addEventListener('contextmenu', (event) => {
  const row = event.target.closest ? event.target.closest('.beadRow') : null;
  const section = event.target.closest ? event.target.closest('section[data-workspace-path]') : null;
  if (!row && !section) {
    closeContextMenu();
    return;
  }
  event.preventDefault();
  const workspacePath = row
    ? (row.dataset.workspacePath || '')
    : (section ? (section.dataset.workspacePath || '') : '');
  openContextMenu(row, workspacePath, event);
});
createBeadAction.addEventListener('click', () => {
  const workspacePath = contextMenuWorkspacePath;
  closeContextMenu();
  if (!bdAvailable || workspacePath === '') {
    return;
  }
  vscode.postMessage({ command: 'createBead', workspacePath });
});
closeBeadAction.addEventListener('click', () => {
  if (!contextMenuRow) {
    return;
  }
  const item = decodeRowItem(contextMenuRow);
  const issueId = contextMenuRow.dataset.id || '';
  const workspacePath = contextMenuRow.dataset.workspacePath || '';
  closeContextMenu();
  if (!item || issueId === '' || workspacePath === '') {
    return;
  }
  vscode.postMessage({ command: 'closeBead', issueId, workspacePath, title: item.title || '' });
});
window.addEventListener('resize', renderHierarchyOverlays);
document.getElementById('refresh').addEventListener('click', () => {
  vscode.postMessage({ command: 'refresh' });
});
document.getElementById('syncBeads').addEventListener('click', () => {
  vscode.postMessage({ command: 'syncAllBeads' });
});
document.getElementById('openGitGraph').addEventListener('click', () => {
  vscode.postMessage({ command: 'openGitGraph' });
});
for (const button of Array.from(document.querySelectorAll('button[data-sync-workspace]'))) {
  button.addEventListener('click', () => {
    const workspacePath = button.dataset.syncWorkspace || '';
    if (workspacePath === '') {
      return;
    }
    vscode.postMessage({ command: 'syncBeads', workspacePath });
  });
}
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
for (const row of Array.from(document.querySelectorAll('tbody tr'))) {
  const selectRow = (event) => {
    const target = event.target;
    if (target && target.closest && target.closest('button')) return;
    if (selectedRow === row) {
      row.classList.remove('selected');
      selectedRow = null;
      removeExpandedDetails();
      return;
    }
    if (selectedRow) {
      selectedRow.classList.remove('selected');
    }
    removeExpandedDetails();
    selectedRow = row;
    row.classList.add('selected');

    const item = decodeRowItem(row);
    if (!item) {
      removeExpandedDetails();
      return;
    }
    expandDetailsRow(row, item);
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

  public async handleMessage(message: {
    command?: string;
    uri?: string;
    commitHash?: string;
    issueId?: string;
    workspacePath?: string;
    title?: string;
  }) {
    if (message.command === "refresh") {
      await this.refresh();
      return;
    }

    if (message.command === "openGitGraph") {
      await vscode.commands.executeCommand("beads-git-graph.view");
      return;
    }

    if (message.command === "syncAllBeads") {
      const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
      const syncedWorkspaces: string[] = [];

      for (const folder of workspaceFolders) {
        const beadsDirUri = vscode.Uri.joinPath(folder.uri, ".beads");
        if (!(await this.pathExists(beadsDirUri))) {
          continue;
        }

        await this.runBdCommand(["sync"], folder.uri.fsPath);
        syncedWorkspaces.push(folder.name);
      }

      await this.refresh();

      if (syncedWorkspaces.length === 0) {
        vscode.window.showWarningMessage("No Beads workspace was found to sync.");
      } else {
        vscode.window.showInformationMessage(
          `Synced Beads data for ${syncedWorkspaces.join(", ")}.`
        );
      }
      return;
    }

    if (message.command === "syncBeads" && typeof message.workspacePath === "string") {
      const workspacePath = await this.resolveAuthorizedWorkspacePath(message.workspacePath.trim());
      if (workspacePath === null) {
        vscode.window.showWarningMessage(
          "Refusing to sync Beads data outside an initialized workspace folder."
        );
        return;
      }

      try {
        await this.runBdCommand(["sync"], workspacePath);
        await this.refresh();
        vscode.window.showInformationMessage(`Synced Beads data for ${path.basename(workspacePath)}.`);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Unable to sync Beads data.";
        vscode.window.showErrorMessage(messageText);
      }
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
      return;
    }

    if (
      message.command === "createBead" &&
      typeof message.workspacePath === "string" &&
      message.workspacePath.trim() !== ""
    ) {
      const workspacePath = await this.resolveAuthorizedWorkspacePath(message.workspacePath.trim());
      if (workspacePath === null) {
        vscode.window.showWarningMessage(
          "Refusing to create a bead outside an initialized workspace folder."
        );
        return;
      }

      try {
        await this.promptAndCreateBead(workspacePath);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Unable to create bead.";
        vscode.window.showErrorMessage(messageText);
      }
      return;
    }

    if (
      message.command === "closeBead" &&
      typeof message.issueId === "string" &&
      typeof message.workspacePath === "string"
    ) {
      const issueId = message.issueId.trim();
      const workspacePath = await this.resolveAuthorizedWorkspacePath(message.workspacePath.trim());
      if (issueId === "" || workspacePath === null) {
        if (workspacePath === null) {
          vscode.window.showWarningMessage(
            "Refusing to close a bead outside an initialized workspace folder."
          );
        }
        return;
      }

      const confirmation = await vscode.window.showWarningMessage(
        `Close bead ${issueId}${message.title ? `: ${message.title}` : ""}?`,
        { modal: true },
        "Close"
      );
      if (confirmation !== "Close") {
        return;
      }

      try {
        await this.runBdCommand(["close", issueId], workspacePath);
        await this.runBdCommand(["sync", "--flush-only"], workspacePath);
        await this.refresh();
        vscode.window.showInformationMessage(`Closed bead ${issueId}.`);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Unable to close bead.";
        vscode.window.showErrorMessage(messageText);
      }
    }
  }

  private async promptAndCreateBead(workspacePath: string) {
    const type = await this.pickCreateBeadType();
    if (!type) {
      return;
    }

    const title = await vscode.window.showInputBox({
      title: "Create Bead",
      prompt: "Title",
      placeHolder: "Implement create action",
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() === "" ? "Title is required." : undefined)
    });
    if (title === undefined) {
      return;
    }

    const status = await this.pickCreateBeadStatus();
    if (!status) {
      return;
    }

    const priority = await this.pickCreateBeadPriority();
    if (!priority) {
      return;
    }

    const bead = await this.createBead(workspacePath, {
      type,
      title: title.trim(),
      status,
      priority
    });
    await this.refresh();
    vscode.window.showInformationMessage(`Created bead ${bead.id}.`);
  }

  private async pickCreateBeadType(): Promise<CreateBeadType | undefined> {
    const selection = await vscode.window.showQuickPick(
      [
        { label: "Task", value: "task" as const },
        { label: "Feature", value: "feature" as const },
        { label: "Bug", value: "bug" as const },
        { label: "Epic", value: "epic" as const },
        { label: "Chore", value: "chore" as const }
      ],
      {
        title: "Create Bead",
        placeHolder: "Type",
        ignoreFocusOut: true
      }
    );

    return selection?.value;
  }

  private async pickCreateBeadStatus(): Promise<CreateBeadStatus | undefined> {
    const selection = await vscode.window.showQuickPick(
      [
        { label: "Open", value: "open" as const },
        { label: "In Progress", value: "in_progress" as const },
        { label: "Blocked", value: "blocked" as const },
        { label: "Closed", value: "closed" as const }
      ],
      {
        title: "Create Bead",
        placeHolder: "Status",
        ignoreFocusOut: true
      }
    );

    return selection?.value;
  }

  private async pickCreateBeadPriority(): Promise<CreateBeadPriority | undefined> {
    const selection = await vscode.window.showQuickPick(
      [
        { label: "P0", value: "P0" as const },
        { label: "P1", value: "P1" as const },
        { label: "P2", value: "P2" as const },
        { label: "P3", value: "P3" as const },
        { label: "P4", value: "P4" as const }
      ],
      {
        title: "Create Bead",
        placeHolder: "Priority",
        ignoreFocusOut: true
      }
    );

    return selection?.value;
  }

  private async createBead(
    workspacePath: string,
    values: {
      type: CreateBeadType;
      title: string;
      status: CreateBeadStatus;
      priority: CreateBeadPriority;
    }
  ) {
    const stdout = await this.runBdCommand(
      [
        "create",
        "--json",
        "--type",
        values.type,
        "--priority",
        values.priority,
        "--title",
        values.title
      ],
      workspacePath
    );
    const bead = this.parseCreatedBead(stdout);

    if (values.status === "closed") {
      await this.runBdCommand(["close", bead.id], workspacePath);
    } else if (values.status !== "open") {
      await this.runBdCommand(["update", bead.id, "--status", values.status], workspacePath);
    }

    await this.runBdCommand(["sync", "--flush-only"], workspacePath);
    return bead;
  }

  private parseCreatedBead(stdout: string): { id: string } {
    const trimmed = stdout.trim();
    const jsonText = trimmed.startsWith("{")
      ? trimmed
      : (trimmed.match(/\{[\s\S]*\}\s*$/)?.[0] ?? "");

    if (jsonText === "") {
      throw new Error("Unable to read the created bead id from bd create.");
    }

    const parsed = JSON.parse(jsonText) as { id?: unknown };
    if (typeof parsed.id !== "string" || parsed.id.trim() === "") {
      throw new Error("bd create did not return a valid bead id.");
    }

    return { id: parsed.id.trim() };
  }

  private async pathExists(uri: vscode.Uri) {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private async resolveAuthorizedWorkspacePath(workspacePath: string) {
    const normalizedPath = workspacePath.trim();
    if (normalizedPath === "") {
      return null;
    }

    const resolvedPath = path.resolve(normalizedPath);
    const workspaceFolder = (vscode.workspace.workspaceFolders ?? []).find(
      (folder) => path.resolve(folder.uri.fsPath) === resolvedPath
    );
    if (!workspaceFolder) {
      return null;
    }

    const beadsDirUri = vscode.Uri.joinPath(workspaceFolder.uri, ".beads");
    return (await this.pathExists(beadsDirUri)) ? workspaceFolder.uri.fsPath : null;
  }

  private async findLegacyBeadFiles(folder: vscode.WorkspaceFolder) {
    const jsonPattern = new vscode.RelativePattern(folder, ".beads/*.json");
    const jsonlPattern = new vscode.RelativePattern(folder, ".beads/*.jsonl");
    const files = [
      ...(await vscode.workspace.findFiles(jsonPattern, "**/node_modules/**")),
      ...(await vscode.workspace.findFiles(jsonlPattern, "**/node_modules/**"))
    ];

    return [...new Map(files.map((file) => [file.toString(), file])).values()].filter((fileUri) => {
      const basename = fileUri.path.split("/").pop() ?? "";
      return !basename.startsWith("sync_base") && !basename.startsWith(".");
    });
  }

  private async loadLegacyWorkspaceItems(files: vscode.Uri[]) {
    const items: BeadItem[] = [];
    const errors: { source: string; message: string }[] = [];

    for (const fileUri of files) {
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
        items.push(...extractBeadItems(parsed));
      } catch (error) {
        errors.push({
          source: vscode.workspace.asRelativePath(fileUri, false),
          message: error instanceof Error ? error.message : "Unable to parse JSON"
        });
      }
    }

    const uniqueItems = [...new Map(items.map((item) => [item.id, item])).values()];

    return {
      hasFiles: files.length > 0,
      items: uniqueItems,
      errors
    };
  }

  private async loadBdItemsFromCli(cwd: string): Promise<CliLoadResult> {
    const stdout = await this.runBdCommand(["list", "--json", "--limit", "0", "--all"], cwd);
    const parsed = stdout.trim() === "" ? [] : JSON.parse(stdout);
    const cliItems = extractBeadItems(parsed);
    const warnings: BeadWarning[] = [];

    try {
      const issueFileUri = vscode.Uri.file(path.join(cwd, ".beads", "issues.jsonl"));
      const raw = await vscode.workspace.fs.readFile(issueFileUri);
      const text = Buffer.from(raw).toString("utf8");
      const legacyItems = extractBeadItems(
        text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line !== "")
          .map((line) => JSON.parse(line))
      );
      const mergedItems = mergeBeadItems(cliItems, legacyItems);
      const diff = diffBeadItems(mergedItems, legacyItems);

      if (
        diff.missingFromPrimary.length > 0 ||
        diff.missingFromSecondary.length > 0 ||
        diff.changed.length > 0
      ) {
        const details: string[] = [];
        if (diff.missingFromPrimary.length > 0) {
          details.push(`missing from local bd view: ${diff.missingFromPrimary.slice(0, 5).join(", ")}${diff.missingFromPrimary.length > 5 ? ", ..." : ""}`);
        }
        if (diff.missingFromSecondary.length > 0) {
          details.push(`missing from issues.jsonl: ${diff.missingFromSecondary.slice(0, 5).join(", ")}${diff.missingFromSecondary.length > 5 ? ", ..." : ""}`);
        }
        if (diff.changed.length > 0) {
          details.push(
            `field differences: ${diff.changed
              .slice(0, 3)
              .map((entry) => `${entry.id} (${entry.fields.join(", ")})`)
              .join("; ")}${diff.changed.length > 3 ? "; ..." : ""}`
          );
        }

        warnings.push({
          source: path.join(cwd, ".beads"),
          workspacePath: cwd,
          message: `Local bd state and issues.jsonl differ; run bd sync to reconcile. ${details.join(". ")}`
        });
      }

      return { items: mergedItems, warnings };
    } catch {
      return { items: cliItems, warnings };
    }
  }

  private async runBdCommand(args: string[], cwd: string) {
    const workspacePath = await this.resolveAuthorizedWorkspacePath(cwd);
    if (workspacePath === null) {
      throw new Error("Refusing to run bd outside an initialized workspace folder.");
    }

    return new Promise<string>((resolve, reject) => {
      const bdPath = getConfig().bdPath();
      const child = cp.spawn(bdPath, args, { cwd: workspacePath });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        reject(error);
      });
      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        reject(
          new Error(
            stderr.trim() || `${bdPath} ${args.join(" ")} failed with exit code ${code ?? -1}.`
          )
        );
      });
    });
  }
}
