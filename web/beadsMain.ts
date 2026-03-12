import type { BeadsRequestMessage } from "../src/beadsProtocol";

declare function acquireVsCodeApi(): {
  postMessage(message: BeadsRequestMessage): void;
};

type SortKey = "updated" | "type" | "priority";
type StatusFilter = "open" | "in_progress" | "blocked" | "closed" | "other";
type BeadRow = HTMLTableRowElement & { dataset: DOMStringMap };
type BeadSection = HTMLElement & { dataset: DOMStringMap };

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
}

const vscode = acquireVsCodeApi()
const STATUS_LABELS: Record<StatusFilter, string> = {
  open: "Open",
  in_progress: "In Progress",
  blocked: "Blocked",
  closed: "Closed",
  other: "Other"
}
const ALL_FILTERS: StatusFilter[] = ["open", "in_progress", "blocked", "closed", "other"]
const PRESET_FILTERS: Record<string, StatusFilter[]> = {
  default: ["open", "in_progress", "blocked"],
  open: ["open"],
  wip: ["in_progress"],
  blocked: ["blocked"],
  closed: ["closed"],
  all: ALL_FILTERS
}

let activeFilters = new Set<StatusFilter>(PRESET_FILTERS.default)
let selectedRow: BeadRow | null = null
let expandedDetailsRow: HTMLTableRowElement | null = null
let contextMenuRow: BeadRow | null = null
let contextMenuWorkspacePath = ""
let sortState: { key: SortKey; desc: boolean } = { key: "updated", desc: true }

const chips = queryElement<HTMLDivElement>("#chips")
const preset = queryElement<HTMLSelectElement>("#preset")
const filterMenu = queryElement<HTMLDivElement>("#filterMenu")
const clearFilters = queryElement<HTMLButtonElement>("#clearFilters")
const rowContextMenu = queryElement<HTMLDivElement>("#rowContextMenu")
const createBeadAction = queryElement<HTMLButtonElement>("#createBeadAction")
const closeBeadAction = queryElement<HTMLButtonElement>("#closeBeadAction")
const stats = queryElement<HTMLDivElement>("#stats")
const syncBeadsButton = queryElement<HTMLButtonElement>("#syncBeads")
const bdAvailable = document.body.dataset.bdAvailable === "1"
const hasSyncWarnings = document.body.dataset.hasSyncWarnings === "1"

if (hasSyncWarnings) {
  syncBeadsButton.title = "Sync Beads (differences detected)"
  syncBeadsButton.setAttribute("aria-label", "Sync Beads, differences detected")
}

function queryElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector)
  if (element === null) {
    throw new Error(`Missing required element: ${selector}`)
  }
  return element
}

function decodeRowItem(row: BeadRow): BeadRowItem | null {
  const encoded = row.dataset.item
  if (!encoded) {
    return null
  }

  try {
    return JSON.parse(decodeURIComponent(encoded)) as BeadRowItem
  } catch {
    try {
      return JSON.parse(encoded) as BeadRowItem
    } catch {
      return null
    }
  }
}

function closeContextMenu() {
  rowContextMenu.classList.remove("open")
  contextMenuRow = null
  contextMenuWorkspacePath = ""
}

function openContextMenu(row: BeadRow | null, workspacePath: string, event: MouseEvent) {
  contextMenuRow = row
  contextMenuWorkspacePath = workspacePath
  const item = row ? decodeRowItem(row) : null
  createBeadAction.disabled = !bdAvailable || contextMenuWorkspacePath === ""
  closeBeadAction.disabled = item === null || (row?.dataset.status ?? "") === "closed"
  rowContextMenu.style.left = `${event.clientX}px`
  rowContextMenu.style.top = `${event.clientY}px`
  rowContextMenu.classList.add("open")
}

function setsEqual(values: Set<StatusFilter>, expected: StatusFilter[]) {
  return values.size === expected.length && expected.every((value) => values.has(value))
}

function getPresetValue() {
  for (const [presetKey, presetFilters] of Object.entries(PRESET_FILTERS)) {
    if (setsEqual(activeFilters, presetFilters)) {
      return presetKey
    }
  }
  return ""
}

function statusChipClass(status: StatusFilter) {
  return `chip status-${status}`
}

function renderFilterMenu() {
  const candidates = ALL_FILTERS.filter((status) => !activeFilters.has(status))
  filterMenu.innerHTML =
    candidates.length === 0
      ? '<div style="font-size:11px;opacity:.8;padding:4px 6px;">No more filters</div>'
      : candidates
          .map(
            (status) => `<button data-add-filter="${status}">${STATUS_LABELS[status]}</button>`
          )
          .join("")

  for (const button of Array.from(filterMenu.querySelectorAll<HTMLButtonElement>("button[data-add-filter]"))) {
    button.addEventListener("click", () => {
      const status = button.dataset.addFilter as StatusFilter | undefined
      if (!status) {
        return
      }
      activeFilters.add(status)
      preset.value = ""
      filterMenu.classList.remove("open")
      renderFilterChips()
      applyFilters()
    })
  }
}

function renderFilterChips() {
  const presetValue = getPresetValue()
  preset.value = presetValue
  clearFilters.style.display = presetValue === "" ? "" : "none"
  if (presetValue !== "") {
    chips.innerHTML = ""
    renderFilterMenu()
    return
  }

  chips.innerHTML = Array.from(activeFilters)
    .map(
      (status) =>
        `<span class="${statusChipClass(status)}">${STATUS_LABELS[status]}<button class="remove" data-remove-filter="${status}" title="Remove">×</button></span>`
    )
    .join("")

  for (const button of Array.from(chips.querySelectorAll<HTMLButtonElement>("button[data-remove-filter]"))) {
    button.addEventListener("click", () => {
      const status = button.dataset.removeFilter as StatusFilter | undefined
      if (!status) {
        return
      }
      activeFilters.delete(status)
      preset.value = ""
      renderFilterChips()
      applyFilters()
    })
  }

  renderFilterMenu()
}

function applyPreset(value: string) {
  activeFilters = new Set(PRESET_FILTERS[value] ?? PRESET_FILTERS.default)
  renderFilterChips()
  applyFilters()
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function renderDetailsMarkup(item: BeadRowItem) {
  const commit =
    item.commitHash !== ""
      ? `<button class="commitLink" data-commit="${escapeHtml(item.commitHash)}">${escapeHtml(item.commitHash.substring(0, 8))}</button>`
      : "-"
  const progress =
    item.status === "in_progress" && item.progress !== null ? `${String(item.progress)}%` : "-"
  const parent = item.parentId !== "" ? item.parentId : "-"
  const epic = item.epicId !== "" && item.epicId !== item.id ? item.epicId : "-"

  return (
    `<div class="details"><h3>${escapeHtml(item.id)} - ${escapeHtml(item.title)}</h3><div class="detailsGrid">` +
    `<div class="key">Type</div><div>${escapeHtml(item.type || "-")}</div>` +
    `<div class="key">Parent</div><div>${escapeHtml(parent)}</div>` +
    `<div class="key">Epic</div><div>${escapeHtml(epic)}</div>` +
    `<div class="key">Status</div><div>${escapeHtml(item.status || "-")}</div>` +
    `<div class="key">Progress</div><div>${escapeHtml(progress)}</div>` +
    `<div class="key">Priority</div><div>${escapeHtml(item.priority || "-")}</div>` +
    `<div class="key">Assignee</div><div>${escapeHtml(item.assignee || "-")}</div>` +
    `<div class="key">Labels</div><div>${escapeHtml(item.labels || "-")}</div>` +
    `<div class="key">Created</div><div>${escapeHtml(item.createdAt || "-")}</div>` +
    `<div class="key">Updated</div><div>${escapeHtml(item.updatedAt || "-")}</div>` +
    `<div class="key">Commit</div><div>${commit}</div>` +
    `</div><div class="detailsDescription"><strong>Notes</strong><br>${escapeHtml(item.notes || "-")}</div>` +
    `<div class="detailsDescription"><strong>Description</strong><br>${escapeHtml(item.description || "-")}</div></div>`
  )
}

function bindCommitLinks(scope: ParentNode) {
  for (const button of Array.from(scope.querySelectorAll<HTMLButtonElement>(".commitLink"))) {
    button.addEventListener("click", () => {
      const commitHash = button.dataset.commit
      if (!commitHash) {
        return
      }
      vscode.postMessage({ command: "openGitGraphForCommit", commitHash })
    })
  }
}

function removeExpandedDetails() {
  expandedDetailsRow?.remove()
  expandedDetailsRow = null
}

function expandDetailsRow(row: BeadRow, item: BeadRowItem) {
  removeExpandedDetails()
  const detailsRow = document.createElement("tr")
  detailsRow.className = "inlineDetailsRow"
  const detailsCell = document.createElement("td")
  detailsCell.colSpan = 5
  detailsCell.innerHTML = renderDetailsMarkup(item)
  detailsRow.appendChild(detailsCell)
  row.insertAdjacentElement("afterend", detailsRow)
  bindCommitLinks(detailsRow)
  expandedDetailsRow = detailsRow
}

function getVisibleBeadRows(scope: ParentNode = document) {
  return Array.from(scope.querySelectorAll<BeadRow>("tbody .beadRow"))
}

function applyFilters() {
  const rows = getVisibleBeadRows()
  let visibleCount = 0
  for (const row of rows) {
    const status = (row.dataset.status || "") as StatusFilter
    const visible = activeFilters.has(status)
    row.style.display = visible ? "" : "none"
    if (visible) {
      visibleCount += 1
    }
  }
  if (selectedRow !== null && selectedRow.style.display === "none") {
    selectedRow.classList.remove("selected")
    selectedRow = null
    removeExpandedDetails()
  }
  if (contextMenuRow !== null && contextMenuRow.style.display === "none") {
    closeContextMenu()
  }
  stats.textContent = `${visibleCount} / ${rows.length} beads shown`
  renderHierarchyOverlays()
}

function getSortValue(row: BeadRow, key: SortKey) {
  if (key === "type") {
    return parseInt(row.dataset.typeSort || "9", 10)
  }
  if (key === "priority") {
    return parseInt(row.dataset.prioritySort || "9", 10)
  }
  return parseInt(row.dataset.updatedTs || "0", 10)
}

function compareRows(a: BeadRow, b: BeadRow) {
  const aValue = getSortValue(a, sortState.key)
  const bValue = getSortValue(b, sortState.key)
  if (aValue !== bValue) {
    return sortState.desc ? bValue - aValue : aValue - bValue
  }

  const aOrder = parseInt(a.dataset.orderIndex || "0", 10)
  const bOrder = parseInt(b.dataset.orderIndex || "0", 10)
  return aOrder - bOrder
}

function applySort() {
  for (const tbody of Array.from(document.querySelectorAll<HTMLTableSectionElement>("tbody"))) {
    const rows = Array.from(tbody.querySelectorAll<BeadRow>(".beadRow"))
    const rowById = new Map(rows.map((row) => [row.dataset.id || "", row]))
    const childrenByParent = new Map<string, BeadRow[]>()

    for (const row of rows) {
      const parentId = row.dataset.parentId || ""
      if (parentId !== "" && rowById.has(parentId)) {
        const siblings = childrenByParent.get(parentId) ?? []
        siblings.push(row)
        childrenByParent.set(parentId, siblings)
      }
    }

    const visited = new Set<string>()
    const appendRow = (row: BeadRow) => {
      const id = row.dataset.id || ""
      if (visited.has(id)) {
        return
      }
      visited.add(id)
      tbody.appendChild(row)
      if (selectedRow === row && expandedDetailsRow !== null) {
        tbody.appendChild(expandedDetailsRow)
      }

      const children = [...(childrenByParent.get(id) ?? [])].sort(compareRows)
      for (const child of children) {
        appendRow(child)
      }
    }

    const roots = rows
      .filter((row) => {
        const parentId = row.dataset.parentId || ""
        return parentId === "" || !rowById.has(parentId)
      })
      .sort(compareRows)

    for (const root of roots) {
      appendRow(root)
    }
    for (const row of rows) {
      appendRow(row)
    }
  }

  for (const icon of Array.from(document.querySelectorAll<HTMLElement>(".sortIcon"))) {
    const key = icon.dataset.sortKey as SortKey | undefined
    icon.textContent = key === sortState.key ? (sortState.desc ? "▼" : "▲") : " "
  }

  renderHierarchyOverlays()
}

function renderHierarchyOverlays() {
  const step = 18
  const paddingBase = 4
  for (const wrap of Array.from(document.querySelectorAll<HTMLElement>(".tableWrap"))) {
    const overlay = wrap.querySelector<SVGElement>(".hierarchyOverlay")
    const tbody = wrap.querySelector<HTMLTableSectionElement>("tbody")
    if (overlay === null || tbody === null) {
      continue
    }

    const visibleRows = Array.from(tbody.querySelectorAll<BeadRow>(".beadRow")).filter(
      (row) => row.style.display !== "none"
    )
    if (visibleRows.length === 0) {
      overlay.innerHTML = ""
      continue
    }

    const wrapRect = wrap.getBoundingClientRect()
    const width = Math.max(1, Math.round(wrapRect.width))
    const height = Math.max(1, Math.round(wrapRect.height))
    overlay.setAttribute("viewBox", `0 0 ${width} ${height}`)

    let shadowPaths = ""
    let linePaths = ""
    for (const row of visibleRows) {
      const depth = parseInt(row.dataset.depth || "0", 10)
      if (!Number.isFinite(depth) || depth < 1) {
        continue
      }

      const titleCell = row.querySelector<HTMLElement>(".titleCell")
      if (titleCell === null) {
        continue
      }

      const titleRect = titleCell.getBoundingClientRect()
      const rowRect = row.getBoundingClientRect()
      const cellLeft = titleRect.left - wrapRect.left
      const xBase = cellLeft + paddingBase
      const topY = rowRect.top - wrapRect.top + 2
      const bottomY = rowRect.bottom - wrapRect.top - 2
      const midY = (topY + bottomY) / 2
      const currentX = xBase + (depth - 0.5) * step
      const endX = xBase + depth * step + 1
      const guideColumns = (row.dataset.guideColumns || "").split("").map((value) => value === "1")
      const isLastSibling = row.dataset.lastSibling === "1"
      const curveStartY = midY - Math.min(15, (bottomY - topY) * 0.34)
      const controlY = midY - Math.min(8, (bottomY - topY) * 0.16)
      const elbowX = Math.min(endX, currentX + 11)

      for (let i = 0; i < guideColumns.length; i += 1) {
        if (!guideColumns[i]) {
          continue
        }
        const x = xBase + (i + 0.5) * step
        const segment = `M${x.toFixed(1)} ${topY.toFixed(1)} V ${bottomY.toFixed(1)}`
        shadowPaths += `<path class="hierarchyGuideShadow" d="${segment}" />`
        linePaths += `<path class="hierarchyGuideLine" d="${segment}" />`
      }

      const branchSegment = isLastSibling
        ? `M${currentX.toFixed(1)} ${topY.toFixed(1)} V ${curveStartY.toFixed(1)} C ${currentX.toFixed(1)} ${controlY.toFixed(1)} ${(currentX + 2).toFixed(1)} ${midY.toFixed(1)} ${elbowX.toFixed(1)} ${midY.toFixed(1)} H ${endX.toFixed(1)}`
        : `M${currentX.toFixed(1)} ${topY.toFixed(1)} V ${curveStartY.toFixed(1)} C ${currentX.toFixed(1)} ${controlY.toFixed(1)} ${(currentX + 2).toFixed(1)} ${midY.toFixed(1)} ${elbowX.toFixed(1)} ${midY.toFixed(1)} H ${endX.toFixed(1)} M${currentX.toFixed(1)} ${midY.toFixed(1)} V ${bottomY.toFixed(1)}`

      shadowPaths += `<path class="hierarchyGuideShadow" d="${branchSegment}" />`
      linePaths += `<path class="hierarchyGuideLine" d="${branchSegment}" />`
    }

    overlay.innerHTML = shadowPaths + linePaths
  }
}

queryElement<HTMLButtonElement>("#addFilter").addEventListener("click", () => {
  filterMenu.classList.toggle("open")
})
clearFilters.addEventListener("click", () => {
  applyPreset("default")
})
preset.addEventListener("change", () => {
  applyPreset(preset.value || "default")
})
document.addEventListener("click", (event) => {
  const target = event.target
  if (!(target instanceof Element)) {
    return
  }
  if (!target.closest(".menu")) {
    filterMenu.classList.remove("open")
  }
  if (!target.closest(".contextMenu")) {
    closeContextMenu()
  }
})
document.addEventListener("contextmenu", (event) => {
  const target = event.target
  if (!(target instanceof Element)) {
    closeContextMenu()
    return
  }

  const row = target.closest(".beadRow") as BeadRow | null
  const section = target.closest("section[data-workspace-path]") as BeadSection | null
  if (row === null && section === null) {
    closeContextMenu()
    return
  }

  event.preventDefault()
  openContextMenu(row, row?.dataset.workspacePath || section?.dataset.workspacePath || "", event)
})
createBeadAction.addEventListener("click", () => {
  const workspacePath = contextMenuWorkspacePath
  closeContextMenu()
  if (!bdAvailable || workspacePath === "") {
    return
  }
  vscode.postMessage({ command: "createBead", workspacePath })
})
closeBeadAction.addEventListener("click", () => {
  if (contextMenuRow === null) {
    return
  }

  const item = decodeRowItem(contextMenuRow)
  const issueId = contextMenuRow.dataset.id || ""
  const workspacePath = contextMenuRow.dataset.workspacePath || ""
  closeContextMenu()
  if (item === null || issueId === "" || workspacePath === "") {
    return
  }

  vscode.postMessage({ command: "closeBead", issueId, workspacePath, title: item.title || "" })
})
window.addEventListener("resize", renderHierarchyOverlays)
queryElement<HTMLButtonElement>("#refresh").addEventListener("click", () => {
  vscode.postMessage({ command: "refresh" })
})
syncBeadsButton.addEventListener("click", () => {
  vscode.postMessage({ command: "syncAllBeads" })
})
queryElement<HTMLButtonElement>("#openGitGraph").addEventListener("click", () => {
  vscode.postMessage({ command: "openGitGraph" })
})
for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-sync-workspace]"))) {
  button.addEventListener("click", () => {
    const workspacePath = button.dataset.syncWorkspace || ""
    if (workspacePath === "") {
      return
    }
    vscode.postMessage({ command: "syncBeads", workspacePath })
  })
}
for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>(".sortToggle"))) {
  button.addEventListener("click", () => {
    const key = (button.dataset.sortKey as SortKey | undefined) || "updated"
    sortState = sortState.key === key ? { key, desc: !sortState.desc } : { key, desc: true }
    applySort()
  })
}
for (const row of Array.from(document.querySelectorAll<BeadRow>("tbody tr.beadRow"))) {
  const selectRow = (event: MouseEvent) => {
    const target = event.target
    if (target instanceof Element && target.closest("button")) {
      return
    }

    if (selectedRow === row) {
      row.classList.remove("selected")
      selectedRow = null
      removeExpandedDetails()
      return
    }

    selectedRow?.classList.remove("selected")
    removeExpandedDetails()
    selectedRow = row
    row.classList.add("selected")

    const item = decodeRowItem(row)
    if (item !== null) {
      expandDetailsRow(row, item)
    }
  }

  row.addEventListener("click", selectRow)
  row.addEventListener("dblclick", selectRow)
}

renderFilterChips()
applySort()
applyFilters()
