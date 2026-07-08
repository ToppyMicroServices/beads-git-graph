import type { BeadsRequestMessage } from "../src/beadsProtocol";
import { isCollapsedByEpic, shouldShowBeadRow } from "./beadsRowVisibility";

declare function acquireVsCodeApi(): {
  postMessage(message: BeadsRequestMessage): void;
  getState(): BeadsWebviewState | undefined;
  setState(state: BeadsWebviewState): void;
};

type SortKey = "order" | "updated" | "type" | "priority";
type StatusFilter = "open" | "in_progress" | "blocked" | "closed" | "other";
type ViewMode = "table" | "graph";
type BeadRow = HTMLTableRowElement & { dataset: DOMStringMap };
type BeadSection = HTMLElement & { dataset: DOMStringMap };
type GraphScrollState = { left: number; top: number };
type BeadsWebviewState = {
  viewMode?: ViewMode;
  graphZoom?: number;
  graphScroll?: Record<string, GraphScrollState>;
  [key: string]: unknown;
};

interface BeadRowItem {
  id: string;
  title: string;
  type: string;
  status: string;
  progress: number | null;
  priority: string;
  updatedAt: string;
  commitHash: string;
  description: string;
  notes: string;
  assignee: string;
  labels: string;
  createdAt: string;
  parentId: string;
  epicId: string;
  dependencyIds: string[];
  parallelizable: boolean;
  parallelizableSource: "explicit" | "ready" | "";
  agent: string;
  model: string;
  ssot: string;
  worktree: string;
  branch: string;
  pullRequest: string;
  checkStatus: string;
  syncRisk: string;
  synthetic: boolean;
  syntheticKind: "" | "parallel-pr-merge";
  displayAgent?: string;
  displayAssignee?: string;
  displayModel?: string;
}

const vscode = acquireVsCodeApi();
const STATUS_LABELS: Record<StatusFilter, string> = {
  open: "Open",
  in_progress: "In Progress",
  blocked: "Blocked",
  closed: "Closed",
  other: "Other"
};
const ALL_FILTERS: StatusFilter[] = ["open", "in_progress", "blocked", "closed", "other"];
const GRAPH_ZOOM_MIN = 0.05;
const GRAPH_ZOOM_MAX = 1.8;
const GRAPH_ZOOM_STEP = 0.1;
const GRAPH_FIT_PADDING = 16;
const PRESET_FILTERS: Record<string, StatusFilter[]> = {
  default: ["open", "in_progress", "blocked"],
  open: ["open"],
  wip: ["in_progress"],
  blocked: ["blocked"],
  closed: ["closed"],
  all: ALL_FILTERS
};

let activeFilters = new Set<StatusFilter>(PRESET_FILTERS.default);
let selectedRow: BeadRow | null = null;
let expandedDetailsRow: HTMLTableRowElement | null = null;
let contextMenuRow: BeadRow | null = null;
let contextMenuWorkspacePath = "";
let sortState: { key: SortKey; desc: boolean } = { key: "order", desc: false };
let activeViewMode: ViewMode = normalizeViewMode(vscode.getState()?.viewMode);
let graphZoom = normalizeGraphZoom(vscode.getState()?.graphZoom);
let rowClickTimer: number | null = null;
const collapsedIds = new Set<string>();
const collapsedEpicIds = new Set<string>();

const chips = queryElement<HTMLDivElement>("#chips");
const preset = queryElement<HTMLSelectElement>("#preset");
const filterMenu = queryElement<HTMLDivElement>("#filterMenu");
const clearFilters = queryElement<HTMLButtonElement>("#clearFilters");
const rowContextMenu = queryElement<HTMLDivElement>("#rowContextMenu");
const createBeadAction = queryElement<HTMLButtonElement>("#createBeadAction");
const closeBeadAction = queryElement<HTMLButtonElement>("#closeBeadAction");
const stats = queryElement<HTMLDivElement>("#stats");
const syncBeadsButton = queryElement<HTMLButtonElement>("#syncBeads");
const tableViewButton = queryElement<HTMLButtonElement>("#tableView");
const graphViewButton = queryElement<HTMLButtonElement>("#graphView");
const bdAvailable = document.body.dataset.bdAvailable === "1";
const hasSyncWarnings = document.body.dataset.hasSyncWarnings === "1";

if (hasSyncWarnings) {
  syncBeadsButton.title = "Sync Beads (differences detected)";
  syncBeadsButton.setAttribute("aria-label", "Sync Beads, differences detected");
}

function queryElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

function normalizeViewMode(value: unknown): ViewMode {
  return value === "graph" ? "graph" : "table";
}

function normalizeGraphZoom(value: unknown) {
  const numericValue = typeof value === "number" && Number.isFinite(value) ? value : 1;
  return Math.min(GRAPH_ZOOM_MAX, Math.max(GRAPH_ZOOM_MIN, numericValue));
}

function saveWebviewState(patch: Partial<BeadsWebviewState>) {
  vscode.setState({
    ...vscode.getState(),
    ...patch
  });
}

function saveViewMode(mode: ViewMode) {
  saveWebviewState({ viewMode: mode });
}

function normalizeOptionalDatasetValue(value: string | undefined) {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function decodeRowItem(row: BeadRow): BeadRowItem | null {
  const encoded = row.dataset.item;
  if (!encoded) {
    return null;
  }

  try {
    return JSON.parse(decodeURIComponent(encoded)) as BeadRowItem;
  } catch {
    try {
      return JSON.parse(encoded) as BeadRowItem;
    } catch {
      return null;
    }
  }
}

function decodeEncodedJson<T>(encoded: string | undefined): T | null {
  if (!encoded) {
    return null;
  }

  try {
    return JSON.parse(decodeURIComponent(encoded)) as T;
  } catch {
    return null;
  }
}

function toExecutionTarget(item: BeadRowItem) {
  return {
    issueId: item.id,
    title: item.title || "",
    model: item.model || undefined,
    ssot: item.ssot || undefined,
    worktree: item.worktree || undefined
  };
}

function findSectionRows(button: HTMLElement) {
  const section = button.closest("section[data-workspace-path]");
  return section === null ? [] : getVisibleBeadRows(section);
}

function closeContextMenu() {
  rowContextMenu.classList.remove("open");
  contextMenuRow = null;
  contextMenuWorkspacePath = "";
}

function postAssignStartBead(button: HTMLButtonElement) {
  const issueId = button.dataset.assignStartId || "";
  const workspacePath = button.dataset.assignStartWorkspace || "";
  if (!bdAvailable || issueId === "" || workspacePath === "") {
    return;
  }
  vscode.postMessage({
    command: "assignStartBead",
    issueId,
    workspacePath,
    title: button.dataset.assignStartTitle || "",
    agent: normalizeOptionalDatasetValue(button.dataset.assignStartAgent),
    model: normalizeOptionalDatasetValue(button.dataset.assignStartModel),
    ssot: normalizeOptionalDatasetValue(button.dataset.assignStartSsot),
    worktree: normalizeOptionalDatasetValue(button.dataset.assignStartWorktree)
  });
}

function openContextMenu(row: BeadRow | null, workspacePath: string, event: MouseEvent) {
  contextMenuRow = row;
  contextMenuWorkspacePath = workspacePath;
  const item = row ? decodeRowItem(row) : null;
  createBeadAction.disabled = !bdAvailable || contextMenuWorkspacePath === "";
  closeBeadAction.disabled = item === null || (row?.dataset.status ?? "") === "closed";
  rowContextMenu.style.left = `${event.clientX}px`;
  rowContextMenu.style.top = `${event.clientY}px`;
  rowContextMenu.classList.add("open");
}

function setsEqual(values: Set<StatusFilter>, expected: StatusFilter[]) {
  return values.size === expected.length && expected.every((value) => values.has(value));
}

function getPresetValue() {
  for (const [presetKey, presetFilters] of Object.entries(PRESET_FILTERS)) {
    if (setsEqual(activeFilters, presetFilters)) {
      return presetKey;
    }
  }
  return "";
}

function statusChipClass(status: StatusFilter) {
  return `chip status-${status}`;
}

function renderFilterMenu() {
  const candidates = ALL_FILTERS.filter((status) => !activeFilters.has(status));
  filterMenu.innerHTML =
    candidates.length === 0
      ? '<div style="font-size:11px;opacity:.8;padding:4px 6px;">No more filters</div>'
      : candidates
          .map((status) => `<button data-add-filter="${status}">${STATUS_LABELS[status]}</button>`)
          .join("");

  for (const button of Array.from(
    filterMenu.querySelectorAll<HTMLButtonElement>("button[data-add-filter]")
  )) {
    button.addEventListener("click", () => {
      const status = button.dataset.addFilter as StatusFilter | undefined;
      if (!status) {
        return;
      }
      activeFilters.add(status);
      preset.value = "";
      filterMenu.classList.remove("open");
      renderFilterChips();
      applyFilters();
    });
  }
}

function renderFilterChips() {
  const presetValue = getPresetValue();
  preset.value = presetValue;
  clearFilters.style.display = presetValue === "" ? "" : "none";
  if (presetValue !== "") {
    chips.innerHTML = "";
    renderFilterMenu();
    return;
  }

  chips.innerHTML = Array.from(activeFilters)
    .map(
      (status) =>
        `<span class="${statusChipClass(status)}">${STATUS_LABELS[status]}<button class="remove" data-remove-filter="${status}" title="Remove">×</button></span>`
    )
    .join("");

  for (const button of Array.from(
    chips.querySelectorAll<HTMLButtonElement>("button[data-remove-filter]")
  )) {
    button.addEventListener("click", () => {
      const status = button.dataset.removeFilter as StatusFilter | undefined;
      if (!status) {
        return;
      }
      activeFilters.delete(status);
      preset.value = "";
      renderFilterChips();
      applyFilters();
    });
  }

  renderFilterMenu();
}

function applyPreset(value: string) {
  activeFilters = new Set(PRESET_FILTERS[value] ?? PRESET_FILTERS.default);
  renderFilterChips();
  applyFilters();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderDetailsMarkup(item: BeadRowItem) {
  const commit =
    item.commitHash !== ""
      ? `<button class="commitLink" data-commit="${escapeHtml(item.commitHash)}">${escapeHtml(item.commitHash.substring(0, 8))}</button>`
      : "-";
  const progress =
    item.status === "in_progress" && item.progress !== null ? `${String(item.progress)}%` : "-";
  const parent = item.parentId !== "" ? item.parentId : "-";
  const epic = item.epicId !== "" && item.epicId !== item.id ? item.epicId : "-";
  const dependencyIds = item.dependencyIds ?? [];
  const dependencies = dependencyIds.length > 0 ? dependencyIds.join(", ") : "-";
  const parallel =
    item.parallelizableSource === "ready"
      ? "Yes (ready)"
      : item.parallelizable
        ? "Yes (explicit)"
        : "-";
  const agent = item.displayAgent?.trim() || "-";
  const assignee = item.displayAssignee?.trim() || item.assignee || "-";
  const model = item.displayModel?.trim() || (item.model !== "" ? item.model : agent);
  const ssot = item.ssot !== "" ? item.ssot : "-";
  const worktree = item.worktree !== "" ? item.worktree : "-";
  const branch = item.branch !== "" ? item.branch : "-";
  const pullRequest =
    item.pullRequest !== ""
      ? item.pullRequest.startsWith("#")
        ? item.pullRequest
        : `#${item.pullRequest}`
      : "-";
  const checkStatus = item.checkStatus !== "" ? item.checkStatus : "-";
  const syncRisk = item.syncRisk !== "" ? item.syncRisk : "-";
  const executionPills = [
    item.syntheticKind === "parallel-pr-merge"
      ? `<span class="detailPill">Derived merge task</span>`
      : "",
    item.status !== "" ? `<span class="detailPill">Status ${escapeHtml(item.status)}</span>` : "",
    item.priority !== ""
      ? `<span class="detailPill">Priority ${escapeHtml(item.priority)}</span>`
      : "",
    item.parallelizable
      ? `<span class="detailPill">${escapeHtml(item.parallelizableSource === "ready" ? "Parallel ready" : "Parallel OK")}</span>`
      : "",
    model !== "-" ? `<span class="detailPill">Model ${escapeHtml(model)}</span>` : "",
    ssot !== "-" ? `<span class="detailPill">SSOT ${escapeHtml(ssot)}</span>` : "",
    item.worktree !== "" ? `<span class="detailPill">WT ${escapeHtml(item.worktree)}</span>` : "",
    branch !== "-" ? `<span class="detailPill">Branch ${escapeHtml(branch)}</span>` : "",
    pullRequest !== "-" ? `<span class="detailPill">PR ${escapeHtml(pullRequest)}</span>` : "",
    checkStatus !== "-" ? `<span class="detailPill">Checks ${escapeHtml(checkStatus)}</span>` : "",
    syncRisk !== "-" ? `<span class="detailPill">Sync ${escapeHtml(syncRisk)}</span>` : ""
  ]
    .filter((pill) => pill !== "")
    .join("");

  return (
    `<div class="details"><div class="detailsHeader"><div class="detailsId">${escapeHtml(item.id)}</div><div class="detailsTitle">${escapeHtml(item.title)}</div>${executionPills === "" ? "" : `<div class="detailsPills">${executionPills}</div>`}</div><div class="detailsGrid">` +
    `<div class="key">Type</div><div>${escapeHtml(item.type || "-")}</div>` +
    `<div class="key">Parent</div><div>${escapeHtml(parent)}</div>` +
    `<div class="key">Epic</div><div>${escapeHtml(epic)}</div>` +
    `<div class="key">Depends</div><div>${escapeHtml(dependencies)}</div>` +
    `<div class="key">Status</div><div>${escapeHtml(item.status || "-")}</div>` +
    `<div class="key">Progress</div><div>${escapeHtml(progress)}</div>` +
    `<div class="key">Priority</div><div>${escapeHtml(item.priority || "-")}</div>` +
    `<div class="key">Assignee</div><div>${escapeHtml(assignee)}</div>` +
    `<div class="key">Parallel</div><div>${escapeHtml(parallel)}</div>` +
    `<div class="key">Agent</div><div>${escapeHtml(agent)}</div>` +
    `<div class="key">AI Model</div><div>${escapeHtml(model)}</div>` +
    `<div class="key">SSOT / Context</div><div>${escapeHtml(ssot)}</div>` +
    `<div class="key">Worktree</div><div>${escapeHtml(worktree)}</div>` +
    `<div class="key">Branch</div><div>${escapeHtml(branch)}</div>` +
    `<div class="key">PR</div><div>${escapeHtml(pullRequest)}</div>` +
    `<div class="key">Checks</div><div>${escapeHtml(checkStatus)}</div>` +
    `<div class="key">Sync Risk</div><div>${escapeHtml(syncRisk)}</div>` +
    `<div class="key">Labels</div><div>${escapeHtml(item.labels || "-")}</div>` +
    `<div class="key">Created</div><div>${escapeHtml(item.createdAt || "-")}</div>` +
    `<div class="key">Updated</div><div>${escapeHtml(item.updatedAt || "-")}</div>` +
    `<div class="key">Commit</div><div>${commit}</div>` +
    `</div><div class="detailsDescription"><strong>Notes</strong><br>${escapeHtml(item.notes || "-")}</div>` +
    `<div class="detailsDescription"><strong>Description</strong><br>${escapeHtml(item.description || "-")}</div></div>`
  );
}

function bindCommitLinks(scope: ParentNode) {
  for (const button of Array.from(scope.querySelectorAll<HTMLButtonElement>(".commitLink"))) {
    button.addEventListener("click", () => {
      const commitHash = button.dataset.commit;
      if (!commitHash) {
        return;
      }
      vscode.postMessage({ command: "openGitGraphForCommit", commitHash });
    });
  }
}

function removeExpandedDetails() {
  expandedDetailsRow?.remove();
  expandedDetailsRow = null;
}

function clearSelectedRow() {
  selectedRow?.classList.remove("selected");
  selectedRow = null;
  removeExpandedDetails();
}

function expandDetailsRow(row: BeadRow, item: BeadRowItem) {
  removeExpandedDetails();
  const detailsRow = document.createElement("tr");
  detailsRow.className = "inlineDetailsRow";
  const detailsCell = document.createElement("td");
  detailsCell.colSpan = 6;
  detailsCell.innerHTML = renderDetailsMarkup(item);
  detailsRow.appendChild(detailsCell);
  row.insertAdjacentElement("afterend", detailsRow);
  bindCommitLinks(detailsRow);
  expandedDetailsRow = detailsRow;
}

function getVisibleBeadRows(scope: ParentNode = document) {
  return Array.from(scope.querySelectorAll<BeadRow>("tbody .beadRow"));
}

function getRowVisibilityState(row: BeadRow) {
  return {
    id: row.dataset.id || "",
    epicId: row.dataset.epicId || "",
    status: (row.dataset.status || "") as StatusFilter
  };
}

function getRowsById(rows: BeadRow[]) {
  const rowsById = new Map<string, BeadRow>();
  for (const row of rows) {
    const id = row.dataset.id || "";
    if (id !== "") {
      rowsById.set(id, row);
    }
  }
  return rowsById;
}

function rowHasCollapsedAncestor(row: BeadRow, rowsById: Map<string, BeadRow>) {
  const visited = new Set<string>();
  let parentId = row.dataset.parentId || "";

  while (parentId !== "") {
    if (visited.has(parentId)) {
      return false;
    }
    visited.add(parentId);
    if (collapsedIds.has(parentId)) {
      return true;
    }

    const parentRow = rowsById.get(parentId);
    if (parentRow === undefined) {
      return false;
    }
    parentId = parentRow.dataset.parentId || "";
  }

  return false;
}

function refreshRowVisibility() {
  const rows = getVisibleBeadRows();
  const rowsById = getRowsById(rows);
  let visibleCount = 0;
  let matchingCount = 0;
  for (const row of rows) {
    const status = (row.dataset.status || "") as StatusFilter;
    const filterVisible = activeFilters.has(status);
    if (filterVisible) {
      matchingCount += 1;
    }
    const visible =
      shouldShowBeadRow(getRowVisibilityState(row), activeFilters, collapsedEpicIds) &&
      !rowHasCollapsedAncestor(row, rowsById);
    row.style.display = visible ? "" : "none";
    if (visible) {
      visibleCount += 1;
    }
  }
  if (selectedRow !== null && selectedRow.style.display === "none") {
    clearSelectedRow();
  }
  if (contextMenuRow !== null && contextMenuRow.style.display === "none") {
    closeContextMenu();
  }
  stats.textContent =
    matchingCount === rows.length
      ? `${visibleCount} / ${rows.length} beads shown`
      : `${visibleCount} / ${matchingCount} matching beads shown`;
  stats.title = `${rows.length} total beads`;
  refreshGraphNodeVisibility();
  renderHierarchyOverlays();
  if (activeViewMode === "graph") {
    fitGraphToViewport();
  } else {
    renderDependencyGraphOverlays();
  }
}

function applyFilters() {
  refreshRowVisibility();
}

function applyViewMode(mode: ViewMode) {
  activeViewMode = mode;
  saveViewMode(mode);
  document.body.dataset.viewMode = mode;
  tableViewButton.classList.toggle("active", mode === "table");
  graphViewButton.classList.toggle("active", mode === "graph");
  tableViewButton.setAttribute("aria-pressed", mode === "table" ? "true" : "false");
  graphViewButton.setAttribute("aria-pressed", mode === "graph" ? "true" : "false");
  if (mode === "graph") {
    fitGraphToViewport();
  }
  renderHierarchyOverlays();
  renderDependencyGraphOverlays();
}

function isCollapsibleRow(row: BeadRow) {
  return parseInt(row.dataset.childCount || "0", 10) > 0;
}

function updateCollapseButton(row: BeadRow) {
  const id = row.dataset.id || "";
  const button = row.querySelector<HTMLButtonElement>(".collapseToggle");
  const collapsed = id !== "" && collapsedIds.has(id);
  row.classList.toggle("collapsedParent", collapsed);
  if (button !== null) {
    button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }
}

function toggleRowCollapse(row: BeadRow) {
  const id = row.dataset.id || "";
  if (id === "" || !isCollapsibleRow(row)) {
    return false;
  }

  if (collapsedIds.has(id)) {
    collapsedIds.delete(id);
  } else {
    collapsedIds.add(id);
  }
  updateCollapseButton(row);
  refreshRowVisibility();
  return true;
}

function clearRowClickTimer() {
  if (rowClickTimer !== null) {
    window.clearTimeout(rowClickTimer);
    rowClickTimer = null;
  }
}

function isEpicRow(row: BeadRow) {
  return row.dataset.beadType === "epic";
}

function toggleEpicSubprojects(row: BeadRow) {
  if (!isEpicRow(row)) {
    return false;
  }

  const epicId = row.dataset.id || "";
  if (epicId === "") {
    return false;
  }

  if (collapsedEpicIds.has(epicId)) {
    collapsedEpicIds.delete(epicId);
  } else {
    collapsedEpicIds.add(epicId);
  }

  if (
    selectedRow !== null &&
    (selectedRow === row || isCollapsedByEpic(getRowVisibilityState(selectedRow), collapsedEpicIds))
  ) {
    clearSelectedRow();
  }

  applyFilters();
  return true;
}

function getSortValue(row: BeadRow, key: SortKey) {
  if (key === "order") {
    return parseInt(row.dataset.orderIndex || "0", 10);
  }
  if (key === "type") {
    return parseInt(row.dataset.typeSort || "9", 10);
  }
  if (key === "priority") {
    return parseInt(row.dataset.prioritySort || "9", 10);
  }
  return parseInt(row.dataset.updatedTs || "0", 10);
}

function compareRows(a: BeadRow, b: BeadRow) {
  const aValue = getSortValue(a, sortState.key);
  const bValue = getSortValue(b, sortState.key);
  if (aValue !== bValue) {
    return sortState.desc ? bValue - aValue : aValue - bValue;
  }

  const aOrder = parseInt(a.dataset.orderIndex || "0", 10);
  const bOrder = parseInt(b.dataset.orderIndex || "0", 10);
  return aOrder - bOrder;
}

function applySort() {
  for (const tbody of Array.from(document.querySelectorAll<HTMLTableSectionElement>("tbody"))) {
    const rows = Array.from(tbody.querySelectorAll<BeadRow>(".beadRow"));
    const rowById = new Map(rows.map((row) => [row.dataset.id || "", row]));
    const childrenByParent = new Map<string, BeadRow[]>();

    for (const row of rows) {
      const parentId = row.dataset.parentId || "";
      if (parentId !== "" && rowById.has(parentId)) {
        const siblings = childrenByParent.get(parentId) ?? [];
        siblings.push(row);
        childrenByParent.set(parentId, siblings);
      }
    }

    const visited = new Set<string>();
    const appendRow = (row: BeadRow) => {
      const id = row.dataset.id || "";
      if (visited.has(id)) {
        return;
      }
      visited.add(id);
      tbody.appendChild(row);
      if (selectedRow === row && expandedDetailsRow !== null) {
        tbody.appendChild(expandedDetailsRow);
      }

      const children = [...(childrenByParent.get(id) ?? [])].sort(compareRows);
      for (const child of children) {
        appendRow(child);
      }
    };

    const roots = rows
      .filter((row) => {
        const parentId = row.dataset.parentId || "";
        return parentId === "" || !rowById.has(parentId);
      })
      .sort(compareRows);

    for (const root of roots) {
      appendRow(root);
    }
    for (const row of rows) {
      appendRow(row);
    }
  }

  for (const icon of Array.from(document.querySelectorAll<HTMLElement>(".sortIcon"))) {
    const key = icon.dataset.sortKey as SortKey | undefined;
    icon.textContent = key === sortState.key ? (sortState.desc ? "▼" : "▲") : " ";
  }

  refreshRowVisibility();
}

function renderHierarchyOverlays() {
  const step = 18;
  const paddingBase = 4;
  for (const wrap of Array.from(document.querySelectorAll<HTMLElement>(".tableWrap"))) {
    const overlay = wrap.querySelector<SVGElement>(".hierarchyOverlay");
    const tbody = wrap.querySelector<HTMLTableSectionElement>("tbody");
    if (overlay === null || tbody === null) {
      continue;
    }

    const visibleRows = Array.from(tbody.querySelectorAll<BeadRow>(".beadRow")).filter(
      (row) => row.style.display !== "none"
    );
    if (visibleRows.length === 0) {
      overlay.innerHTML = "";
      continue;
    }

    const wrapRect = wrap.getBoundingClientRect();
    const width = Math.max(1, Math.round(wrapRect.width));
    const height = Math.max(1, Math.round(wrapRect.height));
    overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);

    let shadowPaths = "";
    let linePaths = "";
    for (const row of visibleRows) {
      const depth = parseInt(row.dataset.depth || "0", 10);
      if (!Number.isFinite(depth) || depth < 1) {
        continue;
      }

      const titleCell = row.querySelector<HTMLElement>(".titleCell");
      if (titleCell === null) {
        continue;
      }

      const titleRect = titleCell.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const cellLeft = titleRect.left - wrapRect.left;
      const xBase = cellLeft + paddingBase;
      const topY = rowRect.top - wrapRect.top;
      const bottomY = rowRect.bottom - wrapRect.top;
      const midY = (topY + bottomY) / 2;
      const currentX = xBase + (depth - 0.5) * step;
      const endX = xBase + depth * step + 1;
      const guideColumns = (row.dataset.guideColumns || "").split("").map((value) => value === "1");
      const isLastSibling = row.dataset.lastSibling === "1";
      const curveStartY = midY - Math.min(15, (bottomY - topY) * 0.34);
      const controlY = midY - Math.min(8, (bottomY - topY) * 0.16);
      const elbowX = Math.min(endX, currentX + 11);

      for (let i = 0; i < guideColumns.length; i += 1) {
        if (!guideColumns[i]) {
          continue;
        }
        const x = xBase + (i + 0.5) * step;
        const segment = `M${x.toFixed(1)} ${topY.toFixed(1)} V ${bottomY.toFixed(1)}`;
        shadowPaths += `<path class="hierarchyGuideShadow hierarchyGuideVertical" d="${segment}" />`;
        linePaths += `<path class="hierarchyGuideLine hierarchyGuideVertical" d="${segment}" />`;
      }

      const branchSegment = isLastSibling
        ? `M${currentX.toFixed(1)} ${topY.toFixed(1)} V ${curveStartY.toFixed(1)} C ${currentX.toFixed(1)} ${controlY.toFixed(1)} ${(currentX + 2).toFixed(1)} ${midY.toFixed(1)} ${elbowX.toFixed(1)} ${midY.toFixed(1)} H ${endX.toFixed(1)}`
        : `M${currentX.toFixed(1)} ${topY.toFixed(1)} V ${curveStartY.toFixed(1)} C ${currentX.toFixed(1)} ${controlY.toFixed(1)} ${(currentX + 2).toFixed(1)} ${midY.toFixed(1)} ${elbowX.toFixed(1)} ${midY.toFixed(1)} H ${endX.toFixed(1)} M${currentX.toFixed(1)} ${midY.toFixed(1)} V ${bottomY.toFixed(1)}`;

      shadowPaths += `<path class="hierarchyGuideShadow" d="${branchSegment}" />`;
      linePaths += `<path class="hierarchyGuideLine" d="${branchSegment}" />`;
    }

    overlay.innerHTML = shadowPaths + linePaths;
  }
}

function refreshGraphNodeVisibility() {
  for (const section of Array.from(document.querySelectorAll<BeadSection>("section"))) {
    const visibleRowIds = new Set(
      Array.from(section.querySelectorAll<BeadRow>("tbody .beadRow"))
        .filter((row) => row.style.display !== "none")
        .map((row) => row.dataset.id || "")
        .filter((id) => id !== "")
    );

    for (const node of Array.from(section.querySelectorAll<HTMLElement>(".graphNode"))) {
      node.style.display = visibleRowIds.has(node.dataset.graphId || "") ? "" : "none";
    }
  }
}

function getGraphScroller(pane: HTMLElement) {
  return pane.querySelector<HTMLElement>(".graphScroller");
}

function getGraphCanvas(pane: HTMLElement) {
  return pane.querySelector<HTMLElement>(".graphCanvas");
}

function getGraphContent(pane: HTMLElement) {
  return pane.querySelector<HTMLElement>(".graphContent");
}

function getGraphWorkspaceKey(pane: HTMLElement) {
  return pane.dataset.workspacePath || "default";
}

function getGraphBaseSize(canvas: HTMLElement) {
  return {
    width: Math.max(1, parseFloat(canvas.dataset.graphWidth || "960")),
    height: Math.max(1, parseFloat(canvas.dataset.graphHeight || "620"))
  };
}

function getGraphRequiredSize(pane: HTMLElement, base: { width: number; height: number }) {
  let width = base.width;
  let height = base.height;
  for (const node of Array.from(pane.querySelectorAll<HTMLElement>(".graphNode"))) {
    if (node.style.display === "none") {
      continue;
    }
    width = Math.max(width, node.offsetLeft + node.offsetWidth + 40);
    height = Math.max(height, node.offsetTop + node.offsetHeight + 40);
  }
  return { width, height };
}

function saveGraphZoom() {
  saveWebviewState({ graphZoom });
}

function saveGraphScroll(pane: HTMLElement) {
  const scroller = getGraphScroller(pane);
  if (scroller === null) {
    return;
  }
  const state = vscode.getState() ?? {};
  const graphScroll = { ...state.graphScroll };
  graphScroll[getGraphWorkspaceKey(pane)] = {
    left: scroller.scrollLeft,
    top: scroller.scrollTop
  };
  saveWebviewState({ graphScroll });
}

function updateGraphZoomLabels() {
  const label = `${Math.round(graphZoom * 100)}%`;
  for (const element of Array.from(
    document.querySelectorAll<HTMLElement>("[data-graph-zoom-value]")
  )) {
    element.textContent = label;
  }
}

function applyGraphZoomToPane(pane: HTMLElement) {
  const scroller = getGraphScroller(pane);
  const canvas = getGraphCanvas(pane);
  const content = getGraphContent(pane);
  if (scroller === null || canvas === null || content === null) {
    return;
  }

  const base = getGraphRequiredSize(pane, getGraphBaseSize(canvas));
  content.style.width = `${base.width}px`;
  content.style.height = `${base.height}px`;
  canvas.style.width = `${Math.max(scroller.clientWidth, base.width * graphZoom)}px`;
  canvas.style.height = `${Math.max(scroller.clientHeight, base.height * graphZoom)}px`;
  content.style.setProperty("--graph-zoom", graphZoom.toFixed(2));
}

function applyGraphZoomToAll() {
  for (const pane of Array.from(document.querySelectorAll<HTMLElement>(".graphPane"))) {
    applyGraphZoomToPane(pane);
  }
  updateGraphZoomLabels();
}

function getGraphFitZoomForPane(pane: HTMLElement) {
  const scroller = getGraphScroller(pane);
  const canvas = getGraphCanvas(pane);
  if (
    scroller === null ||
    canvas === null ||
    scroller.clientWidth <= 0 ||
    scroller.clientHeight <= 0
  ) {
    return 1;
  }

  const requiredSize = getGraphRequiredSize(pane, { width: 1, height: 1 });
  const availableWidth = Math.max(1, scroller.clientWidth - GRAPH_FIT_PADDING * 2);
  const availableHeight = Math.max(1, scroller.clientHeight - GRAPH_FIT_PADDING * 2);
  const fitZoom = Math.min(
    1,
    availableWidth / requiredSize.width,
    availableHeight / requiredSize.height
  );
  return normalizeGraphZoom(fitZoom);
}

function fitGraphToViewport() {
  let nextZoom = 1;
  for (const pane of Array.from(document.querySelectorAll<HTMLElement>(".graphPane"))) {
    if (pane.offsetParent === null) {
      continue;
    }
    nextZoom = Math.min(nextZoom, getGraphFitZoomForPane(pane));
  }

  graphZoom = nextZoom;
  applyGraphZoomToAll();
  for (const pane of Array.from(document.querySelectorAll<HTMLElement>(".graphPane"))) {
    const scroller = getGraphScroller(pane);
    if (scroller === null) {
      continue;
    }
    scroller.scrollLeft = 0;
    scroller.scrollTop = 0;
    saveGraphScroll(pane);
  }
  saveGraphZoom();
}

function setGraphZoom(nextZoom: number) {
  const previousZoom = graphZoom;
  const nextNormalizedZoom = normalizeGraphZoom(nextZoom);
  if (Math.abs(previousZoom - nextNormalizedZoom) < 0.001) {
    return;
  }

  const centers = new Map<HTMLElement, { x: number; y: number }>();
  for (const pane of Array.from(document.querySelectorAll<HTMLElement>(".graphPane"))) {
    const scroller = getGraphScroller(pane);
    if (scroller === null) {
      continue;
    }
    centers.set(pane, {
      x: (scroller.scrollLeft + scroller.clientWidth / 2) / previousZoom,
      y: (scroller.scrollTop + scroller.clientHeight / 2) / previousZoom
    });
  }

  graphZoom = nextNormalizedZoom;
  applyGraphZoomToAll();
  for (const [pane, center] of centers.entries()) {
    const scroller = getGraphScroller(pane);
    if (scroller === null) {
      continue;
    }
    scroller.scrollLeft = Math.max(0, center.x * graphZoom - scroller.clientWidth / 2);
    scroller.scrollTop = Math.max(0, center.y * graphZoom - scroller.clientHeight / 2);
    saveGraphScroll(pane);
  }
  saveGraphZoom();
  renderDependencyGraphOverlays();
}

function renderDependencyGraphOverlays() {
  for (const [paneIndex, pane] of Array.from(
    document.querySelectorAll<HTMLElement>(".graphPane")
  ).entries()) {
    const overlay = pane.querySelector<SVGElement>(".dependencyOverlay");
    const canvas = pane.querySelector<HTMLElement>(".graphCanvas");
    const content = getGraphContent(pane);
    if (overlay === null || canvas === null || content === null) {
      continue;
    }
    if (activeViewMode !== "graph" || pane.offsetParent === null) {
      overlay.innerHTML = "";
      continue;
    }

    applyGraphZoomToPane(pane);

    const contentRect = content.getBoundingClientRect();
    const width = Math.max(1, Math.round(content.offsetWidth));
    const height = Math.max(1, Math.round(content.offsetHeight));
    overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;

    const nodesById = new Map(
      Array.from(pane.querySelectorAll<HTMLElement>(".graphNode[data-graph-id]"))
        .filter((node) => node.style.display !== "none")
        .map((node) => [node.dataset.graphId || "", node])
    );
    const markerId = `dependencyArrow-${paneIndex}`;
    const criticalMarkerId = `criticalDependencyArrow-${paneIndex}`;
    const markerDefs = `<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path class="dependencyArrowHead" d="M0 0 L10 5 L0 10 Z" /></marker><marker id="${criticalMarkerId}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto"><path class="criticalDependencyArrowHead" d="M0 0 L10 5 L0 10 Z" /></marker></defs>`;
    let paths = "";
    for (const edge of Array.from(pane.querySelectorAll<HTMLElement>(".graphEdge"))) {
      const fromNode = nodesById.get(edge.dataset.fromId || "");
      const toNode = nodesById.get(edge.dataset.toId || "");
      if (fromNode === undefined || toNode === undefined) {
        continue;
      }

      const fromRect = fromNode.getBoundingClientRect();
      const toRect = toNode.getBoundingClientRect();
      const x1 = (fromRect.right - contentRect.left) / graphZoom;
      const y1 = (fromRect.top - contentRect.top + fromRect.height / 2) / graphZoom;
      const x2 = (toRect.left - contentRect.left) / graphZoom;
      const y2 = (toRect.top - contentRect.top + toRect.height / 2) / graphZoom;
      const gap = Math.max(18, Math.abs(x2 - x1) * 0.34);
      const d =
        x2 >= x1
          ? `M${x1.toFixed(1)} ${y1.toFixed(1)} C${(x1 + gap).toFixed(1)} ${y1.toFixed(1)} ${(x2 - gap).toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
          : `M${x1.toFixed(1)} ${y1.toFixed(1)} C${(x1 + gap).toFixed(1)} ${y1.toFixed(1)} ${(x1 + gap).toFixed(1)} ${(y1 + y2) / 2} ${(x1 + 12).toFixed(1)} ${(y1 + y2) / 2} S${(x2 - gap).toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
      const criticalClass = edge.dataset.critical === "1" ? " criticalDependencyPath" : "";
      const arrowId = edge.dataset.critical === "1" ? criticalMarkerId : markerId;
      paths += `<path class="dependencyPath${criticalClass}" marker-end="url(#${arrowId})" d="${d}" />`;
    }
    overlay.innerHTML = markerDefs + paths;
  }
}

queryElement<HTMLButtonElement>("#addFilter").addEventListener("click", () => {
  filterMenu.classList.toggle("open");
});
tableViewButton.addEventListener("click", () => {
  applyViewMode("table");
});
graphViewButton.addEventListener("click", () => {
  applyViewMode("graph");
});
clearFilters.addEventListener("click", () => {
  applyPreset("default");
});
preset.addEventListener("change", () => {
  applyPreset(preset.value || "default");
});
document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const assignStartButton = target.closest(".assignStartBead") as HTMLButtonElement | null;
  if (assignStartButton !== null) {
    event.preventDefault();
    postAssignStartBead(assignStartButton);
    return;
  }
  if (!target.closest(".menu")) {
    filterMenu.classList.remove("open");
  }
  if (!target.closest(".contextMenu")) {
    closeContextMenu();
  }
});
document.addEventListener("contextmenu", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    closeContextMenu();
    return;
  }

  const row = target.closest(".beadRow") as BeadRow | null;
  const section = target.closest("section[data-workspace-path]") as BeadSection | null;
  if (row === null && section === null) {
    closeContextMenu();
    return;
  }

  event.preventDefault();
  openContextMenu(row, row?.dataset.workspacePath || section?.dataset.workspacePath || "", event);
});
createBeadAction.addEventListener("click", () => {
  const workspacePath = contextMenuWorkspacePath;
  closeContextMenu();
  if (!bdAvailable || workspacePath === "") {
    return;
  }
  vscode.postMessage({ command: "createBead", workspacePath });
});
closeBeadAction.addEventListener("click", () => {
  if (contextMenuRow === null) {
    return;
  }

  const item = decodeRowItem(contextMenuRow);
  const issueId = contextMenuRow.dataset.id || "";
  const workspacePath = contextMenuRow.dataset.workspacePath || "";
  closeContextMenu();
  if (item === null || issueId === "" || workspacePath === "") {
    return;
  }

  vscode.postMessage({ command: "closeBead", issueId, workspacePath, title: item.title || "" });
});
window.addEventListener("resize", () => {
  if (activeViewMode === "graph") {
    fitGraphToViewport();
  } else {
    applyGraphZoomToAll();
  }
  renderHierarchyOverlays();
  renderDependencyGraphOverlays();
});
for (const pane of Array.from(document.querySelectorAll<HTMLElement>(".graphPane"))) {
  getGraphScroller(pane)?.addEventListener("scroll", () => {
    saveGraphScroll(pane);
    renderDependencyGraphOverlays();
  });
}
for (const button of Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-graph-zoom-action]")
)) {
  button.addEventListener("click", () => {
    const action = button.dataset.graphZoomAction || "";
    if (action === "in") {
      setGraphZoom(graphZoom + GRAPH_ZOOM_STEP);
    } else if (action === "out") {
      setGraphZoom(graphZoom - GRAPH_ZOOM_STEP);
    } else if (action === "reset") {
      setGraphZoom(1);
    }
  });
}
queryElement<HTMLButtonElement>("#refresh").addEventListener("click", () => {
  vscode.postMessage({ command: "refresh" });
});
syncBeadsButton.addEventListener("click", () => {
  vscode.postMessage({ command: "syncAllBeads" });
});
queryElement<HTMLButtonElement>("#openGitGraph").addEventListener("click", () => {
  vscode.postMessage({ command: "openGitGraph" });
});
for (const button of Array.from(
  document.querySelectorAll<HTMLButtonElement>("button[data-sync-workspace]")
)) {
  button.addEventListener("click", () => {
    const workspacePath = button.dataset.syncWorkspace || "";
    if (workspacePath === "") {
      return;
    }
    vscode.postMessage({ command: "syncBeads", workspacePath });
  });
}
for (const button of Array.from(
  document.querySelectorAll<HTMLButtonElement>(".startParallelBeads")
)) {
  button.addEventListener("click", () => {
    const workspacePath = button.dataset.startParallelWorkspace || "";
    const items = decodeEncodedJson<
      Array<{
        issueId: string;
        title?: string;
        model?: string;
        ssot?: string;
        worktree?: string;
      }>
    >(button.dataset.startParallelItems);
    const skipped = decodeEncodedJson<
      Array<{
        issueId: string;
        title?: string;
        reason: string;
      }>
    >(button.dataset.startParallelSkipped);
    if (!bdAvailable || workspacePath === "" || items === null || items.length === 0) {
      return;
    }
    vscode.postMessage({
      command: "startParallelBeads",
      workspacePath,
      items,
      skipped: skipped ?? []
    });
  });
}
for (const button of Array.from(
  document.querySelectorAll<HTMLButtonElement>(".mergeParallelPrs")
)) {
  button.addEventListener("click", () => {
    const issueId = button.dataset.mergeId || "";
    const workspacePath = button.dataset.mergeWorkspace || "";
    const dependencyIds = (button.dataset.mergeDependencies || "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== "");
    if (!bdAvailable || issueId === "" || workspacePath === "" || dependencyIds.length === 0) {
      return;
    }

    const dependencySet = new Set(dependencyIds);
    const dependencies = findSectionRows(button)
      .map((row) => decodeRowItem(row))
      .filter((item): item is BeadRowItem => item !== null && dependencySet.has(item.id))
      .map(toExecutionTarget);
    vscode.postMessage({
      command: "mergeParallelPrs",
      issueId,
      workspacePath,
      title: button.dataset.mergeTitle || "",
      dependencies
    });
  });
}
for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>(".sortToggle"))) {
  button.addEventListener("click", () => {
    const key = (button.dataset.sortKey as SortKey | undefined) || "updated";
    sortState = sortState.key === key ? { key, desc: !sortState.desc } : { key, desc: true };
    applySort();
  });
}
for (const row of Array.from(document.querySelectorAll<BeadRow>("tbody tr.beadRow"))) {
  const toggleButton = row.querySelector<HTMLButtonElement>(".collapseToggle");
  const selectRow = (event: MouseEvent) => {
    const target = event.target;
    if (target instanceof Element && target.closest("button")) {
      return;
    }

    if (selectedRow === row) {
      clearSelectedRow();
      return;
    }

    selectedRow?.classList.remove("selected");
    removeExpandedDetails();
    selectedRow = row;
    row.classList.add("selected");

    const item = decodeRowItem(row);
    if (item !== null) {
      expandDetailsRow(row, item);
    }
    renderHierarchyOverlays();
  };

  toggleButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleRowCollapse(row);
  });
  row.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("button")) {
      return;
    }
    clearRowClickTimer();
    const clickDelayMs = isCollapsibleRow(row) ? 260 : 160;
    rowClickTimer = window.setTimeout(() => {
      rowClickTimer = null;
      selectRow(event);
    }, clickDelayMs);
  });
  row.addEventListener("dblclick", (event) => {
    if (event.target instanceof Element && event.target.closest("button")) {
      return;
    }
    clearRowClickTimer();
    event.preventDefault();
    if (toggleEpicSubprojects(row)) {
      if (selectedRow === row) {
        clearSelectedRow();
      }
      return;
    }
    if (toggleRowCollapse(row)) {
      if (selectedRow === row) {
        clearSelectedRow();
      }
      return;
    }
    selectRow(event);
  });
}

renderFilterChips();
applySort();
applyFilters();
applyViewMode(activeViewMode);
