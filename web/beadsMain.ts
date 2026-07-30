import createDOMPurify from "dompurify";

import { normalizeAgentArtifactReference } from "../src/agentArtifactReference";
import {
  type AgentProviderId,
  getAgentProviderDefinition,
  resolveAgentProviderId
} from "../src/agentProvider";
import {
  type BeadsHostMessage,
  type BeadsRequestMessage,
  isBeadsHostMessage,
  type ParallelExecutionOutcome
} from "../src/beadsProtocol";
import type { BeadsWriteCapability } from "../src/beadsWriteCapability";
import { renderPlanDraftPreview } from "../src/planPreview";
import {
  computePackedGraphLayout,
  computeVisibleGraphState,
  graphEdgeKey
} from "./beadsGraphModel";
import {
  DEFAULT_ACTIVE_STATUSES,
  getDetailsReadinessLabel,
  isCollapsedByEpic,
  shouldShowBeadRow
} from "./beadsRowVisibility";
import {
  clampGraphPanForVisibility,
  computeAnchoredGraphPan,
  computeCenteredGraphPan,
  getGraphPointerGesture
} from "./graphViewportTransform";
import { createPlanDraftController, type PlanDraftPreviewState } from "./planDraftController";

declare function acquireVsCodeApi(): {
  postMessage(message: BeadsRequestMessage): void;
  getState(): BeadsWebviewState | undefined;
  setState(state: BeadsWebviewState): void;
};

type SortKey = "order" | "updated" | "type" | "priority";
type StatusFilter = "open" | "in_progress" | "blocked" | "closed" | "other";
type ViewMode = "table" | "graph" | "control" | "plan";
type BeadRow = HTMLTableRowElement & { dataset: DOMStringMap };
type BeadSection = HTMLElement & { dataset: DOMStringMap };
type GraphScrollState = { left: number; top: number };
type GraphPanState = { x: number; y: number };
type GraphTransformState = { zoom: number; pan: GraphPanState };
type GraphZoomAnchor = { x: number; y: number };
type GraphSelectionState = {
  pane: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};
type GraphPanGestureState = {
  pane: HTMLElement;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPan: GraphPanState;
};
type SelectedIssueState = { workspacePath: string; issueId: string };
type RenderViewportAnchor = {
  element: HTMLElement | null;
  elementTop: number;
  fallbackScrollX: number;
  fallbackScrollY: number;
  graphDetailsScrollTop: number | null;
};
type BeadsWebviewState = {
  viewMode?: ViewMode;
  activeFilters?: StatusFilter[];
  sortState?: { key: SortKey; desc: boolean };
  selectedIssue?: SelectedIssueState | null;
  collapsedIds?: string[];
  collapsedEpicIds?: string[];
  windowScrollY?: number;
  graphZoom?: number;
  graphPan?: GraphPanState;
  graphTransforms?: Record<string, GraphTransformState>;
  graphScroll?: Record<string, GraphScrollState>;
  planDraftText?: string;
  planGoalText?: string;
  planWorkspacePath?: string;
  parallelExecutionResult?: Extract<BeadsHostMessage, { command: "parallelExecutionResult" }>;
  [key: string]: unknown;
};

interface BeadRowItem {
  id: string;
  title: string;
  type: string;
  status: string;
  normalizedStatus: StatusFilter;
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
  readyByBd: boolean;
  parallelizable: boolean;
  parallelizableSource: "explicit" | "ready" | "";
  agent: string;
  provider: AgentProviderId;
  model: string;
  ssot: string;
  artifact: string;
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
const DOMPurify = createDOMPurify(window);
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
const GRAPH_FIT_PADDING = 16;
const GRAPH_SELECTION_MIN_SIZE = 12;
const GRAPH_NODE_WIDTH = 252;
const GRAPH_LEVEL_GAP = 56;
const GRAPH_LEVEL_COLUMN_GAP = 24;
const GRAPH_LANE_GAP = 30;
const GRAPH_PADDING_X = 28;
const GRAPH_PADDING_Y = 44;
const GRAPH_KEYBOARD_PAN_STEP = 40;
const GRAPH_MINIMUM_VISIBLE_SIZE = 48;
const PLAN_DRAFT_EXAMPLE = JSON.stringify(
  {
    version: 1,
    goal: "Coordinate a linked workflow across AI providers and requested models",
    tasks: [
      {
        id: "research",
        title: "Research the decision",
        priority: "P1",
        acceptanceCriteria: ["Record the recommendation and evidence in docs/decision.md"],
        dependencyIds: [],
        ssot: ["AGENTS.md", "docs/decision.md"],
        provider: "huggingface",
        model: "reasoning-model"
      },
      {
        id: "implement",
        title: "Implement the approved decision",
        priority: "P1",
        acceptanceCriteria: ["Implementation follows the recorded decision and passes tests"],
        dependencyIds: ["research"],
        ssot: ["AGENTS.md", "docs/decision.md"],
        provider: "ollama",
        model: "coding-model"
      },
      {
        id: "review",
        title: "Review the integrated result",
        priority: "P2",
        acceptanceCriteria: ["Review records pass/fail evidence against the acceptance criteria"],
        dependencyIds: ["implement"],
        ssot: ["docs/decision.md", "README.md"],
        provider: "anthropic",
        model: "review-model"
      }
    ]
  },
  null,
  2
);
const PRESET_FILTERS: Record<string, StatusFilter[]> = {
  default: [...DEFAULT_ACTIVE_STATUSES],
  open: ["open"],
  wip: ["in_progress"],
  blocked: ["blocked"],
  closed: ["closed"],
  all: ALL_FILTERS
};

const initialWebviewState = vscode.getState();
let activeFilters = new Set<StatusFilter>(
  normalizeStatusFilters(initialWebviewState?.activeFilters)
);
let selectedRow: BeadRow | null = null;
let expandedDetailsRow: HTMLTableRowElement | null = null;
let contextMenuRow: BeadRow | null = null;
let contextMenuWorkspacePath = "";
let sortState = normalizeSortState(initialWebviewState?.sortState);
let activeViewMode: ViewMode = normalizeViewMode(initialWebviewState?.viewMode);
let graphTransforms = normalizeGraphTransforms(initialWebviewState);
let graphSelection: GraphSelectionState | null = null;
let graphPanGesture: GraphPanGestureState | null = null;
let graphTransformSaveTimer: number | null = null;
let scrollStateSaveTimer: number | null = null;
const graphZoomAnchors = new WeakMap<HTMLElement, GraphZoomAnchor>();
const initializedGraphPanes = new WeakSet<HTMLElement>();
const dynamicallyBoundElements = new WeakSet<EventTarget>();
const pendingActionKeys = new Set<string>();
let rowClickTimer: number | null = null;
const collapsedIds = new Set(normalizeStringList(initialWebviewState?.collapsedIds));
const collapsedEpicIds = new Set(normalizeStringList(initialWebviewState?.collapsedEpicIds));
let lastRenderGeneration = 0;

const chips = queryElement<HTMLDivElement>("#chips");
const preset = queryElement<HTMLSelectElement>("#preset");
const addFilter = queryElement<HTMLButtonElement>("#addFilter");
const filterMenu = queryElement<HTMLDivElement>("#filterMenu");
const clearFilters = queryElement<HTMLButtonElement>("#clearFilters");
const rowContextMenu = queryElement<HTMLDivElement>("#rowContextMenu");
const createBeadAction = queryElement<HTMLButtonElement>("#createBeadAction");
const closeBeadAction = queryElement<HTMLButtonElement>("#closeBeadAction");
const stats = queryElement<HTMLDivElement>("#stats");
const syncBeadsButton = queryElement<HTMLButtonElement>("#syncBeads");
const tableViewButton = queryElement<HTMLButtonElement>("#tableView");
const graphViewButton = queryElement<HTMLButtonElement>("#graphView");
const controlViewButton = queryElement<HTMLButtonElement>("#controlView");
const planViewButton = queryElement<HTMLButtonElement>("#planView");
const planDraftWorkspace = queryElement<HTMLSelectElement>("#planDraftWorkspace");
const planGoalText = queryElement<HTMLTextAreaElement>("#planGoalText");
const generatePlanDraftWithAi = queryElement<HTMLButtonElement>("#generatePlanDraftWithAi");
const planGenerationStatus = queryElement<HTMLSpanElement>("#planGenerationStatus");
const planDraftText = queryElement<HTMLTextAreaElement>("#planDraftText");
const loadPlanDraftExample = queryElement<HTMLButtonElement>("#loadPlanDraftExample");
const previewPlanDraft = queryElement<HTMLButtonElement>("#previewPlanDraft");
const planDraftPreview = queryElement<HTMLDivElement>("#planDraftPreview");
const parallelBatchResult = queryElement<HTMLElement>("#parallelBatchResult");
const beadsWorkspaceViews = queryElement<HTMLDivElement>("#beadsWorkspaceViews");
const beadsWarnings = queryElement<HTMLDivElement>("#beadsWarnings");
const beadsErrors = queryElement<HTMLDivElement>("#beadsErrors");
let lastWorkspaceRenderHtml = beadsWorkspaceViews.innerHTML;
let bdAvailable = document.body.dataset.bdAvailable === "1";
let syncAvailable = document.body.dataset.syncAvailable === "1";
let syncUnavailableReason =
  document.body.dataset.syncUnavailableReason || "The active Beads CLI does not provide bd sync.";
let hasSyncWarnings = document.body.dataset.hasSyncWarnings === "1";
const planDraftController = createPlanDraftController((message) => vscode.postMessage(message));
let currentPlanPreview: PlanDraftPreviewState | null = null;
let activePlanGenerationRequestId: string | null = null;

updateSyncButtonState();

function queryElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

function normalizeViewMode(value: unknown): ViewMode {
  return value === "graph" || value === "control" || value === "plan" ? value : "table";
}

function normalizeStatusFilters(value: unknown): StatusFilter[] {
  if (!Array.isArray(value)) {
    return [...PRESET_FILTERS.default];
  }
  const filters = value.filter(
    (candidate): candidate is StatusFilter =>
      typeof candidate === "string" && ALL_FILTERS.includes(candidate as StatusFilter)
  );
  return Array.from(new Set(filters));
}

function normalizeSortState(value: unknown): { key: SortKey; desc: boolean } {
  if (typeof value !== "object" || value === null) {
    return { key: "order", desc: false };
  }
  const candidate = value as { key?: unknown; desc?: unknown };
  const key =
    candidate.key === "updated" ||
    candidate.key === "type" ||
    candidate.key === "priority" ||
    candidate.key === "order"
      ? candidate.key
      : "order";
  return { key, desc: typeof candidate.desc === "boolean" ? candidate.desc : false };
}

function normalizeStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== ""
      )
    : [];
}

function normalizeSelectedIssue(value: unknown): SelectedIssueState | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as { workspacePath?: unknown; issueId?: unknown };
  return typeof candidate.workspacePath === "string" &&
    candidate.workspacePath !== "" &&
    typeof candidate.issueId === "string" &&
    candidate.issueId !== ""
    ? { workspacePath: candidate.workspacePath, issueId: candidate.issueId }
    : null;
}

function normalizeGraphZoom(value: unknown) {
  const numericValue = typeof value === "number" && Number.isFinite(value) ? value : 1;
  return Math.min(GRAPH_ZOOM_MAX, Math.max(GRAPH_ZOOM_MIN, numericValue));
}

function normalizeGraphPan(value: unknown): GraphPanState {
  if (typeof value !== "object" || value === null) {
    return { x: 0, y: 0 };
  }

  const candidate = value as { x?: unknown; y?: unknown };
  return {
    x: typeof candidate.x === "number" && Number.isFinite(candidate.x) ? candidate.x : 0,
    y: typeof candidate.y === "number" && Number.isFinite(candidate.y) ? candidate.y : 0
  };
}

function normalizeGraphTransforms(state: BeadsWebviewState | undefined) {
  const normalized: Record<string, GraphTransformState> = {};
  const candidates = state?.graphTransforms;
  if (typeof candidates === "object" && candidates !== null) {
    for (const [workspacePath, value] of Object.entries(candidates)) {
      if (typeof value !== "object" || value === null) {
        continue;
      }
      normalized[workspacePath] = {
        zoom: normalizeGraphZoom((value as { zoom?: unknown }).zoom),
        pan: normalizeGraphPan((value as { pan?: unknown }).pan)
      };
    }
  }
  const hasLegacyTransform = state?.graphZoom !== undefined || state?.graphPan !== undefined;
  if (Object.keys(normalized).length === 0 && hasLegacyTransform) {
    normalized.__legacy__ = {
      zoom: normalizeGraphZoom(state?.graphZoom),
      pan: normalizeGraphPan(state?.graphPan)
    };
  }
  return normalized;
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

function getSelectedIssue(): SelectedIssueState | null {
  if (selectedRow === null) {
    return null;
  }
  const workspacePath = selectedRow.dataset.workspacePath || "";
  const issueId = selectedRow.dataset.id || "";
  return workspacePath !== "" && issueId !== "" ? { workspacePath, issueId } : null;
}

function saveInteractionState() {
  saveWebviewState({
    activeFilters: Array.from(activeFilters),
    sortState,
    selectedIssue: getSelectedIssue(),
    collapsedIds: Array.from(collapsedIds),
    collapsedEpicIds: Array.from(collapsedEpicIds),
    windowScrollY: window.scrollY
  });
}

function updateSyncButtonState() {
  syncBeadsButton.disabled = !syncAvailable;
  syncBeadsButton.title = !syncAvailable
    ? syncUnavailableReason
    : hasSyncWarnings
      ? "Sync Beads (differences detected)"
      : "Sync Beads";
  syncBeadsButton.setAttribute(
    "aria-label",
    !syncAvailable
      ? `Sync unavailable: ${syncUnavailableReason}`
      : hasSyncWarnings
        ? "Sync Beads, differences detected"
        : "Sync Beads"
  );
}

function markActionButtonsPending(
  buttons: Iterable<HTMLButtonElement>,
  pendingLabel: string,
  timeoutMs: number = 1500
) {
  for (const button of buttons) {
    if (button.disabled || button.dataset.pendingAction === "1") {
      continue;
    }
    button.dataset.pendingOriginalLabel = button.textContent || "";
    button.dataset.pendingAction = "1";
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = pendingLabel;
    window.setTimeout(() => {
      if (!button.isConnected || button.dataset.pendingAction !== "1") {
        return;
      }
      delete button.dataset.pendingAction;
      button.removeAttribute("aria-busy");
      button.disabled = false;
      button.textContent = button.dataset.pendingOriginalLabel || "";
      delete button.dataset.pendingOriginalLabel;
    }, timeoutMs);
  }
}

function restoreActionButtons(buttons: Iterable<HTMLButtonElement>) {
  for (const button of buttons) {
    if (button.dataset.pendingAction !== "1") {
      continue;
    }
    delete button.dataset.pendingAction;
    button.removeAttribute("aria-busy");
    button.disabled = false;
    button.textContent = button.dataset.pendingOriginalLabel || "";
    delete button.dataset.pendingOriginalLabel;
  }
}

function beginClientAction(
  actionKey: string,
  buttons: Iterable<HTMLButtonElement>,
  pendingLabel: string,
  timeoutMs: number = 1500
) {
  if (pendingActionKeys.has(actionKey)) {
    return false;
  }
  pendingActionKeys.add(actionKey);
  markActionButtonsPending(buttons, pendingLabel, timeoutMs);
  window.setTimeout(() => pendingActionKeys.delete(actionKey), timeoutMs);
  return true;
}

function cancelClientAction(actionKey: string, buttons: Iterable<HTMLButtonElement>) {
  pendingActionKeys.delete(actionKey);
  restoreActionButtons(buttons);
}

function createRequestId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setPlanGenerationStatus(
  status: "idle" | "pending" | "success" | "error",
  message: string,
  artifactUri?: string
) {
  planGenerationStatus.dataset.status = status;
  planGenerationStatus.replaceChildren(document.createTextNode(message));
  if (artifactUri !== undefined) {
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "openAgentArtifact";
    openButton.dataset.artifactUri = artifactUri;
    openButton.textContent = "Open raw response";
    planGenerationStatus.append(document.createTextNode(" "), openButton);
  }
}

function finishPlanGenerationRequest() {
  activePlanGenerationRequestId = null;
  generatePlanDraftWithAi.disabled = planDraftWorkspace.value === "";
  generatePlanDraftWithAi.removeAttribute("aria-busy");
  planDraftWorkspace.disabled = planDraftWorkspace.value === "";
}

const PARALLEL_STATUS_LABELS: Record<ParallelExecutionOutcome["status"], string> = {
  "response-ready": "Response ready",
  "session-started": "Session started",
  "prompt-prepared": "Prompt prepared",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Cancelled"
};

function renderParallelExecutionResult(
  result: Extract<BeadsHostMessage, { command: "parallelExecutionResult" }> | undefined
) {
  parallelBatchResult.replaceChildren();
  if (result === undefined) {
    parallelBatchResult.hidden = true;
    return;
  }

  parallelBatchResult.hidden = false;
  const header = document.createElement("div");
  header.className = "parallelBatchHeader";
  const headingGroup = document.createElement("div");
  const heading = document.createElement("h2");
  heading.textContent = "Latest AI task batch";
  const description = document.createElement("p");
  const completedAt = new Date(result.completedAt);
  description.textContent = Number.isNaN(completedAt.getTime())
    ? "Recorded outcomes; this is not live-agent monitoring."
    : `${completedAt.toLocaleString()} · Recorded outcomes; this is not live-agent monitoring.`;
  headingGroup.append(heading, description);

  const summary = document.createElement("div");
  summary.className = "parallelBatchSummary";
  for (const status of [
    "response-ready",
    "session-started",
    "prompt-prepared",
    "failed",
    "cancelled",
    "skipped"
  ] as const) {
    const count = result.outcomes.filter((outcome) => outcome.status === status).length;
    if (count === 0) {
      continue;
    }
    const badge = document.createElement("span");
    badge.className = "summaryPill";
    badge.textContent = `${count} ${PARALLEL_STATUS_LABELS[status]}`;
    summary.append(badge);
  }
  header.append(headingGroup, summary);

  const list = document.createElement("ul");
  list.className = "parallelBatchList";
  for (const outcome of result.outcomes) {
    const item = document.createElement("li");
    item.className = "parallelBatchItem";
    const task = document.createElement("span");
    task.className = "parallelBatchTask";
    task.textContent = outcome.title?.trim()
      ? `${outcome.issueId} · ${outcome.title.trim()}`
      : outcome.issueId;
    const status = document.createElement("span");
    status.className = "parallelBatchStatus";
    status.dataset.status = outcome.status;
    status.textContent = PARALLEL_STATUS_LABELS[outcome.status];
    const message = document.createElement("span");
    message.className = "parallelBatchMessage";
    message.textContent = outcome.message;
    item.append(task, status, message);

    if (outcome.status === "failed" || outcome.status === "cancelled") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "parallelBatchRetry";
      retry.textContent = "Retry task";
      retry.addEventListener("click", () => {
        retry.disabled = true;
        retry.textContent = "Retrying…";
        vscode.postMessage({
          command: "startParallelBeads",
          requestId: createRequestId(),
          workspacePath: result.workspacePath,
          items: [
            {
              issueId: outcome.issueId,
              title: outcome.title,
              provider: outcome.provider,
              model: outcome.model,
              ssot: outcome.ssot,
              worktree: outcome.worktree
            }
          ],
          skipped: []
        });
      });
      item.append(retry);
    }
    list.append(item);
  }
  parallelBatchResult.append(header, list);
}

function normalizeOptionalDatasetValue(value: string | undefined) {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function getSelectedPlanCapability(): BeadsWriteCapability | null {
  const option = planDraftWorkspace.selectedOptions[0];
  const encoded = option?.dataset.planCapability;
  if (!encoded) {
    return null;
  }
  try {
    const capability = JSON.parse(decodeURIComponent(encoded)) as Partial<BeadsWriteCapability>;
    if (
      typeof capability.supported !== "boolean" ||
      typeof capability.state !== "string" ||
      typeof capability.reason !== "string"
    ) {
      return null;
    }
    return capability as BeadsWriteCapability;
  } catch {
    return null;
  }
}

function renderCurrentPlanPreview() {
  if (currentPlanPreview === null) {
    planDraftPreview.innerHTML =
      '<div class="empty">Preview the current draft before importing it.</div>';
    return;
  }
  planDraftPreview.innerHTML = renderPlanDraftPreview({
    ...currentPlanPreview,
    capability: getSelectedPlanCapability()
  });
  planDraftPreview
    .querySelector<HTMLButtonElement>("#cancelPlanDraft")
    ?.addEventListener("click", () => {
      planDraftController.cancel();
      currentPlanPreview = null;
      planDraftText.value = "";
      saveWebviewState({ planDraftText: "" });
      renderCurrentPlanPreview();
      planDraftText.focus();
    });
  planDraftPreview
    .querySelector<HTMLButtonElement>("#importPlanDraft")
    ?.addEventListener("click", () => {
      const capability = getSelectedPlanCapability();
      const importButton = planDraftPreview.querySelector<HTMLButtonElement>("#importPlanDraft");
      const actionKey = `import-plan:${planDraftWorkspace.value}`;
      if (
        importButton === null ||
        !beginClientAction(actionKey, [importButton], "Importing…", 3000)
      ) {
        return;
      }
      if (
        !planDraftController.importPlan(planDraftWorkspace.value, capability?.supported === true)
      ) {
        cancelClientAction(actionKey, [importButton]);
      }
    });
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
    provider: resolveAgentProviderId(item.provider),
    model: item.model || undefined,
    ssot: item.ssot || undefined,
    worktree: item.worktree || undefined
  };
}

function findSectionRows(button: HTMLElement) {
  const section = button.closest("section[data-workspace-path]");
  return section === null ? [] : getVisibleBeadRows(section);
}

function openGraphBeadDetails(
  button: HTMLButtonElement,
  options: { saveState?: boolean; scrollIntoView?: boolean } = {}
) {
  const issueId = button.dataset.graphDetailsId || "";
  const workspacePath = button.dataset.graphDetailsWorkspace || "";
  const section = Array.from(document.querySelectorAll<BeadSection>("section")).find(
    (candidate) => candidate.dataset.workspacePath === workspacePath
  );
  const row = Array.from(section?.querySelectorAll<BeadRow>("tbody .beadRow") ?? []).find(
    (candidate) => candidate.dataset.id === issueId
  );
  if (row === undefined) {
    return;
  }
  const item = decodeRowItem(row);
  const detailsHost =
    button.closest<HTMLElement>(".graphPane")?.querySelector<HTMLElement>(".graphIssueStack") ??
    button
      .closest<HTMLElement>(".agentWorkQueue")
      ?.querySelector<HTMLElement>(".agentWorkDetailsHost");
  if (item === null || detailsHost === null || detailsHost === undefined) {
    return;
  }

  removeExpandedDetails();
  removeGraphSelectedDetails();
  selectedRow?.classList.remove("selected");
  if (selectedRow !== null) {
    setRowDetailsExpanded(selectedRow, false);
  }
  selectedRow = row;
  row.classList.add("selected");
  setRowDetailsExpanded(row, true);
  expandDetailsRow(row, item);

  const details = document.createElement("article");
  details.className = "graphSelectedDetails";
  details.dataset.issueId = issueId;
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "graphSelectedDetailsClose";
  closeButton.title = "Close details";
  closeButton.setAttribute("aria-label", "Close details");
  closeButton.textContent = "×";
  closeButton.addEventListener("click", () => {
    clearSelectedRow();
    button.focus();
  });
  details.append(closeButton);
  details.insertAdjacentHTML("beforeend", renderDetailsMarkup(item));
  bindCommitLinks(details);
  detailsHost.prepend(details);
  detailsHost.hidden = false;
  if (options.saveState !== false) {
    saveInteractionState();
  }
  if (options.scrollIntoView !== false) {
    details.scrollIntoView({ block: "nearest" });
  }
}

function findIssueRow(issue: SelectedIssueState) {
  return Array.from(document.querySelectorAll<BeadRow>("tbody .beadRow")).find(
    (row) => row.dataset.workspacePath === issue.workspacePath && row.dataset.id === issue.issueId
  );
}

function restoreSelectedIssue(
  issue: SelectedIssueState | null,
  options: { saveState?: boolean; scrollIntoView?: boolean } = {}
) {
  if (issue === null) {
    return;
  }
  const row = findIssueRow(issue);
  const item = row === undefined ? null : decodeRowItem(row);
  if (row === undefined || item === null || row.style.display === "none") {
    saveWebviewState({ selectedIssue: null });
    return;
  }

  selectedRow = row;
  row.classList.add("selected");
  setRowDetailsExpanded(row, true);
  expandDetailsRow(row, item);

  if (activeViewMode === "graph" || activeViewMode === "control") {
    const modeRootSelector = activeViewMode === "graph" ? ".graphPane" : ".agentWorkQueue";
    const detailsButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>(`${modeRootSelector} .graphDetailsBead`)
    ).find(
      (button) =>
        button.dataset.graphDetailsWorkspace === issue.workspacePath &&
        button.dataset.graphDetailsId === issue.issueId
    );
    if (detailsButton !== undefined) {
      openGraphBeadDetails(detailsButton, options);
    }
  }
  if (options.saveState !== false) {
    saveInteractionState();
  }
}

function updatePlanWorkspaceOptions(nextSelect: HTMLSelectElement) {
  const preferredWorkspace = planDraftWorkspace.value || vscode.getState()?.planWorkspacePath || "";
  const currentOptions = Array.from(planDraftWorkspace.options)
    .map((option) => option.outerHTML)
    .join("");
  const nextOptions = Array.from(nextSelect.options)
    .map((option) => option.outerHTML)
    .join("");
  const optionsChanged = currentOptions !== nextOptions;
  if (optionsChanged) {
    planDraftWorkspace.replaceChildren(
      ...Array.from(nextSelect.options).map((option) => option.cloneNode(true))
    );
  }
  if (
    typeof preferredWorkspace === "string" &&
    Array.from(planDraftWorkspace.options).some((option) => option.value === preferredWorkspace)
  ) {
    planDraftWorkspace.value = preferredWorkspace;
  }
  planDraftWorkspace.disabled =
    activePlanGenerationRequestId !== null || planDraftWorkspace.value === "";
  generatePlanDraftWithAi.disabled =
    activePlanGenerationRequestId !== null || planDraftWorkspace.value === "";
  return optionsChanged;
}

const STABLE_RENDER_CLASSES = new Set([
  "workspaceHeader",
  "tableWrap",
  "graphPane",
  "graphHeader",
  "graphIssueStack",
  "agentWorkDetailsHost",
  "graphMapFrame",
  "graphMapHeader",
  "graphScroller",
  "graphCanvas",
  "graphContent",
  "dependencyOverlay",
  "graphNodes",
  "agentWorkQueue"
]);

const CLIENT_OWNED_STYLE_CLASSES = [
  "beadRow",
  "graphCanvas",
  "graphContent",
  "graphNode",
  "graphLevelGuide"
];

function hasClientOwnedStyle(element: Element) {
  return CLIENT_OWNED_STYLE_CLASSES.some((className) => element.classList.contains(className));
}

function getStableRenderKey(node: Node) {
  if (!(node instanceof Element)) {
    return null;
  }
  if (node.id !== "") {
    return `${node.tagName}#${node.id}`;
  }
  const workspacePath = node.getAttribute("data-workspace-path");
  if (
    workspacePath !== null &&
    (node.tagName === "SECTION" || node.classList.contains("graphPane"))
  ) {
    return `${node.tagName}:workspace:${workspacePath}:${node.className}`;
  }
  const issueId = node.getAttribute("data-id");
  if (node.classList.contains("beadRow") && issueId !== null) {
    return `row:${workspacePath ?? ""}:${issueId}`;
  }
  const graphId = node.getAttribute("data-graph-id");
  if (graphId !== null) {
    return `graph-node:${graphId}`;
  }
  if (node.classList.contains("graphEdge")) {
    return `graph-edge:${node.getAttribute("data-from-id") ?? ""}:${node.getAttribute("data-to-id") ?? ""}`;
  }
  for (const className of STABLE_RENDER_CLASSES) {
    if (node.classList.contains(className)) {
      return `${node.tagName}.${className}`;
    }
  }
  return null;
}

function canReconcileRenderNode(currentNode: Node, nextNode: Node) {
  if (currentNode.nodeType !== nextNode.nodeType) {
    return false;
  }
  if (!(currentNode instanceof Element) || !(nextNode instanceof Element)) {
    return true;
  }
  if (currentNode.tagName !== nextNode.tagName) {
    return false;
  }
  const currentKey = getStableRenderKey(currentNode);
  const nextKey = getStableRenderKey(nextNode);
  return currentKey === null && nextKey === null ? true : currentKey === nextKey;
}

function reconcileRenderAttributes(currentElement: Element, nextElement: Element) {
  for (const attribute of Array.from(currentElement.attributes)) {
    if (attribute.name === "style" && hasClientOwnedStyle(currentElement)) {
      continue;
    }
    if (!nextElement.hasAttribute(attribute.name)) {
      currentElement.removeAttribute(attribute.name);
    }
  }
  for (const attribute of Array.from(nextElement.attributes)) {
    if (attribute.name === "style" && hasClientOwnedStyle(currentElement)) {
      continue;
    }
    if (currentElement.getAttribute(attribute.name) !== attribute.value) {
      currentElement.setAttribute(attribute.name, attribute.value);
    }
  }
}

function reconcileRenderNode(currentNode: Node, nextNode: Node) {
  if (currentNode.nodeType === Node.TEXT_NODE || currentNode.nodeType === Node.COMMENT_NODE) {
    if (currentNode.nodeValue !== nextNode.nodeValue) {
      currentNode.nodeValue = nextNode.nodeValue;
    }
    return;
  }
  if (!(currentNode instanceof Element) || !(nextNode instanceof Element)) {
    return;
  }
  reconcileRenderAttributes(currentNode, nextNode);
  if (
    currentNode.classList.contains("dependencyOverlay") ||
    currentNode.classList.contains("hierarchyOverlay") ||
    currentNode.classList.contains("graphZoomValue")
  ) {
    return;
  }
  reconcileRenderChildren(currentNode, nextNode);
}

function reconcileRenderChildren(currentParent: Element, nextParent: Element) {
  const keyedCurrentNodes = new Map<string, Node>();
  for (const child of Array.from(currentParent.childNodes)) {
    const key = getStableRenderKey(child);
    if (key !== null) {
      keyedCurrentNodes.set(key, child);
    }
  }

  const retainedNodes = new Set<Node>();
  let insertionPoint = currentParent.firstChild;
  for (const nextChild of Array.from(nextParent.childNodes)) {
    const key = getStableRenderKey(nextChild);
    let currentChild = key === null ? null : (keyedCurrentNodes.get(key) ?? null);
    if (
      currentChild === null &&
      insertionPoint !== null &&
      !retainedNodes.has(insertionPoint) &&
      getStableRenderKey(insertionPoint) === null &&
      canReconcileRenderNode(insertionPoint, nextChild)
    ) {
      currentChild = insertionPoint;
    }

    if (currentChild === null || !canReconcileRenderNode(currentChild, nextChild)) {
      currentChild = nextChild.cloneNode(true);
      currentParent.insertBefore(currentChild, insertionPoint);
    } else {
      if (currentChild !== insertionPoint) {
        currentParent.insertBefore(currentChild, insertionPoint);
      }
      reconcileRenderNode(currentChild, nextChild);
    }
    retainedNodes.add(currentChild);
    insertionPoint = currentChild.nextSibling;
  }

  for (const child of Array.from(currentParent.childNodes)) {
    if (!retainedNodes.has(child)) {
      child.remove();
    }
  }
}

function reconcileRenderRegion(currentRegion: Element, nextRegion: Element) {
  if (currentRegion.innerHTML === nextRegion.innerHTML) {
    return false;
  }
  reconcileRenderChildren(currentRegion, nextRegion);
  return true;
}

function getNearestViewportElement(candidates: HTMLElement[]) {
  const connected = candidates.filter(
    (element) => element.isConnected && element.offsetParent !== null
  );
  const visible = connected.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  });
  const pool = visible.length > 0 ? visible : connected;
  return (
    pool.sort(
      (left, right) =>
        Math.abs(left.getBoundingClientRect().top) - Math.abs(right.getBoundingClientRect().top)
    )[0] ?? null
  );
}

function getRenderViewportElement() {
  if (activeViewMode === "graph") {
    return getNearestViewportElement(
      Array.from(document.querySelectorAll<HTMLElement>(".graphScroller"))
    );
  }
  if (activeViewMode === "table") {
    return getNearestViewportElement([
      ...(selectedRow?.isConnected ? [selectedRow] : []),
      ...Array.from(document.querySelectorAll<HTMLElement>(".tableWrap"))
    ]);
  }
  if (activeViewMode === "control") {
    return getNearestViewportElement(
      Array.from(document.querySelectorAll<HTMLElement>(".agentWorkQueue"))
    );
  }
  return document.querySelector<HTMLElement>("#planDraftView");
}

function captureRenderViewportAnchor(): RenderViewportAnchor {
  const element = getRenderViewportElement();
  return {
    element,
    elementTop: element?.getBoundingClientRect().top ?? 0,
    fallbackScrollX: window.scrollX,
    fallbackScrollY: window.scrollY,
    graphDetailsScrollTop:
      document.querySelector<HTMLElement>(".graphSelectedDetails")?.scrollTop ?? null
  };
}

function restoreRenderViewportAnchor(anchor: RenderViewportAnchor) {
  const details = document.querySelector<HTMLElement>(".graphSelectedDetails");
  if (details !== null && anchor.graphDetailsScrollTop !== null) {
    details.scrollTop = anchor.graphDetailsScrollTop;
  }

  if (anchor.element !== null && anchor.element.isConnected) {
    const topDelta = anchor.element.getBoundingClientRect().top - anchor.elementTop;
    const targetScrollY = window.scrollY + topDelta;
    if (
      Math.abs(window.scrollX - anchor.fallbackScrollX) > 0.5 ||
      Math.abs(window.scrollY - targetScrollY) > 0.5
    ) {
      window.scrollTo({
        left: anchor.fallbackScrollX,
        top: targetScrollY,
        behavior: "auto"
      });
    }
    return;
  }
  if (
    Math.abs(window.scrollX - anchor.fallbackScrollX) > 0.5 ||
    Math.abs(window.scrollY - anchor.fallbackScrollY) > 0.5
  ) {
    window.scrollTo({
      left: anchor.fallbackScrollX,
      top: anchor.fallbackScrollY,
      behavior: "auto"
    });
  }
}

function applyBeadsRenderUpdate(
  message: Extract<BeadsHostMessage, { command: "beadsRenderUpdate" }>
) {
  if (message.generation <= lastRenderGeneration) {
    return;
  }

  const sanitizedHtml = DOMPurify.sanitize(message.html);
  const parsed = new DOMParser().parseFromString(sanitizedHtml, "text/html");
  const nextWorkspaceViews = parsed.querySelector<HTMLDivElement>("#beadsWorkspaceViews");
  const nextWarnings = parsed.querySelector<HTMLDivElement>("#beadsWarnings");
  const nextErrors = parsed.querySelector<HTMLDivElement>("#beadsErrors");
  const nextPlanWorkspace = parsed.querySelector<HTMLSelectElement>("#planDraftWorkspace");
  if (
    nextWorkspaceViews === null ||
    nextWarnings === null ||
    nextErrors === null ||
    nextPlanWorkspace === null
  ) {
    return;
  }

  lastRenderGeneration = message.generation;
  const viewportAnchor = captureRenderViewportAnchor();
  const selectedIssue = getSelectedIssue();
  const nextWorkspaceRenderHtml = nextWorkspaceViews.innerHTML;
  const workspaceChanged = nextWorkspaceRenderHtml !== lastWorkspaceRenderHtml;
  lastWorkspaceRenderHtml = nextWorkspaceRenderHtml;

  if (workspaceChanged) {
    clearRowClickTimer();
    closeContextMenu();
    removeExpandedDetails();
    removeGraphSelectedDetails();
    selectedRow = null;
    expandedDetailsRow = null;
    graphSelection = null;
    graphPanGesture = null;
    reconcileRenderRegion(beadsWorkspaceViews, nextWorkspaceViews);
  }
  reconcileRenderRegion(beadsWarnings, nextWarnings);
  reconcileRenderRegion(beadsErrors, nextErrors);
  bdAvailable = parsed.body.dataset.bdAvailable === "1";
  syncAvailable = parsed.body.dataset.syncAvailable === "1";
  syncUnavailableReason =
    parsed.body.dataset.syncUnavailableReason || "The active Beads CLI does not provide bd sync.";
  hasSyncWarnings = parsed.body.dataset.hasSyncWarnings === "1";
  document.body.dataset.bdAvailable = bdAvailable ? "1" : "0";
  document.body.dataset.syncAvailable = syncAvailable ? "1" : "0";
  document.body.dataset.syncUnavailableReason = syncUnavailableReason;
  document.body.dataset.hasSyncWarnings = hasSyncWarnings ? "1" : "0";
  updateSyncButtonState();
  const planWorkspaceOptionsChanged = updatePlanWorkspaceOptions(nextPlanWorkspace);

  bindDynamicContent();
  if (workspaceChanged) {
    sortRowsAndUpdateIcons();
    for (const row of getVisibleBeadRows()) {
      updateCollapseButton(row);
    }
    refreshRowVisibility({ refreshGraph: false, renderHierarchy: false });
    restoreSelectedIssue(selectedIssue, { saveState: false, scrollIntoView: false });
    updateViewModeControls(activeViewMode, false);

    if (activeViewMode === "graph") {
      refreshGraphPresentation();
      updateGraphViewportPreservingTransform(false);
    }
    renderHierarchyOverlays();
    renderDependencyGraphOverlays();
  }
  if (planWorkspaceOptionsChanged) {
    renderCurrentPlanPreview();
  }
  restoreRenderViewportAnchor(viewportAnchor);
  saveInteractionState();
}

function closeContextMenu() {
  rowContextMenu.classList.remove("open");
  rowContextMenu.style.removeProperty("left");
  rowContextMenu.style.removeProperty("top");
  contextMenuRow = null;
  contextMenuWorkspacePath = "";
}

function postAssignStartBead(button: HTMLButtonElement) {
  const issueId = button.dataset.assignStartId || "";
  const workspacePath = button.dataset.assignStartWorkspace || "";
  if (button.disabled || issueId === "" || workspacePath === "") {
    return;
  }
  const matchingButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".assignStartBead")
  ).filter(
    (candidate) =>
      candidate.dataset.assignStartId === issueId &&
      candidate.dataset.assignStartWorkspace === workspacePath
  );
  if (
    !beginClientAction(`start-bead:${workspacePath}:${issueId}`, matchingButtons, "Starting…", 3000)
  ) {
    return;
  }
  vscode.postMessage({
    command: "assignStartBead",
    issueId,
    workspacePath,
    title: button.dataset.assignStartTitle || "",
    agent: normalizeOptionalDatasetValue(button.dataset.assignStartAgent),
    provider: resolveAgentProviderId(button.dataset.assignStartProvider),
    model: normalizeOptionalDatasetValue(button.dataset.assignStartModel),
    ssot: normalizeOptionalDatasetValue(button.dataset.assignStartSsot),
    worktree: normalizeOptionalDatasetValue(button.dataset.assignStartWorktree)
  });
}

function postOpenAgentArtifact(button: HTMLButtonElement) {
  const artifactUri = button.dataset.artifactUri || "";
  if (artifactUri.trim() === "" || artifactUri.length > 2048) {
    return;
  }
  vscode.postMessage({ command: "openAgentArtifact", artifactUri });
}

function openContextMenu(
  row: BeadRow | null,
  workspacePath: string,
  clientX: number,
  clientY: number,
  focusMenu: boolean = false
) {
  contextMenuRow = row;
  contextMenuWorkspacePath = workspacePath;
  const item = row ? decodeRowItem(row) : null;
  const section =
    row?.closest<BeadSection>("section[data-workspace-path]") ??
    Array.from(document.querySelectorAll<BeadSection>("section[data-workspace-path]")).find(
      (candidate) => candidate.dataset.workspacePath === workspacePath
    ) ??
    null;
  const writeAvailable = section?.dataset.writeAvailable === "1";
  const unavailableReason =
    section?.dataset.writeUnavailableReason ||
    "Beads write capability has not been confirmed for this workspace.";
  createBeadAction.disabled = !writeAvailable || contextMenuWorkspacePath === "";
  closeBeadAction.disabled =
    !writeAvailable || item === null || (row?.dataset.status ?? "") === "closed";
  createBeadAction.title = createBeadAction.disabled ? unavailableReason : "Create a bead";
  closeBeadAction.title = !writeAvailable
    ? unavailableReason
    : item === null
      ? "Select a bead to close."
      : (row?.dataset.status ?? "") === "closed"
        ? "This bead is already closed."
        : "Close this bead";
  rowContextMenu.classList.add("open");
  const menuRect = rowContextMenu.getBoundingClientRect();
  const viewportMargin = 4;
  const left = Math.max(
    viewportMargin,
    Math.min(clientX, window.innerWidth - menuRect.width - viewportMargin)
  );
  const top = Math.max(
    viewportMargin,
    Math.min(clientY, window.innerHeight - menuRect.height - viewportMargin)
  );
  rowContextMenu.style.left = `${left}px`;
  rowContextMenu.style.top = `${top}px`;
  if (focusMenu) {
    const firstEnabledAction =
      rowContextMenu.querySelector<HTMLButtonElement>("button:not(:disabled)");
    firstEnabledAction?.focus();
  }
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
          .map(
            (status) =>
              `<button type="button" role="menuitemcheckbox" aria-checked="false" data-add-filter="${status}">${STATUS_LABELS[status]}</button>`
          )
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
      setFilterMenuOpen(false);
      renderFilterChips();
      applyFilters();
      saveInteractionState();
    });
  }
}

function setFilterMenuOpen(open: boolean, focusFirst: boolean = false) {
  filterMenu.classList.toggle("open", open);
  addFilter.setAttribute("aria-expanded", open ? "true" : "false");
  if (open && focusFirst) {
    filterMenu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
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
      saveInteractionState();
    });
  }

  renderFilterMenu();
}

function applyPreset(value: string) {
  activeFilters = new Set(PRESET_FILTERS[value] ?? PRESET_FILTERS.default);
  renderFilterChips();
  applyFilters();
  saveInteractionState();
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
    item.normalizedStatus === "in_progress" && item.progress !== null
      ? `${String(item.progress)}%`
      : "-";
  const parent = item.parentId !== "" ? item.parentId : "-";
  const epic = item.epicId !== "" && item.epicId !== item.id ? item.epicId : "-";
  const dependencyIds = item.dependencyIds ?? [];
  const dependencies = dependencyIds.length > 0 ? dependencyIds.join(", ") : "-";
  const readiness = getDetailsReadinessLabel(item);
  const parallel =
    item.parallelizableSource === "ready"
      ? "Yes (ready)"
      : item.parallelizable
        ? "Yes (explicit)"
        : "-";
  const agent = item.displayAgent?.trim() || "-";
  const assignee = item.displayAssignee?.trim() || item.assignee || "-";
  const providerId = resolveAgentProviderId(item.provider);
  const provider =
    item.syntheticKind === "parallel-pr-merge" ? "-" : getAgentProviderDefinition(providerId).label;
  const model = item.displayModel?.trim() || (item.model !== "" ? item.model : agent);
  const ssot = item.ssot !== "" ? item.ssot : "-";
  const artifact = item.artifact !== "" ? item.artifact : "-";
  const openableArtifact = normalizeAgentArtifactReference(item.artifact);
  const worktree =
    item.worktree === ""
      ? "-"
      : providerId === "copilot"
        ? item.worktree
        : `${item.worktree} (recorded separately; not provider output)`;
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
    item.readyByBd ? '<span class="detailPill">Ready confirmed</span>' : "",
    provider !== "-" ? `<span class="detailPill">Provider ${escapeHtml(provider)}</span>` : "",
    model !== "-" ? `<span class="detailPill">Model ${escapeHtml(model)}</span>` : "",
    openableArtifact !== null
      ? `<button class="openAgentArtifact detailPill artifactBadge" type="button" data-artifact-uri="${escapeHtml(openableArtifact)}" title="Open the stored response artifact">Open response</button>`
      : artifact !== "-"
        ? `<span class="detailPill artifactBadge">Artifact recorded</span>`
        : "",
    ssot !== "-" ? `<span class="detailPill">SSOT ${escapeHtml(ssot)}</span>` : "",
    providerId === "copilot" && item.worktree !== ""
      ? `<span class="detailPill">WT ${escapeHtml(item.worktree)}</span>`
      : "",
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
    `<div class="key">Readiness</div><div>${escapeHtml(readiness)}</div>` +
    `<div class="key">Parallel</div><div>${escapeHtml(parallel)}</div>` +
    `<div class="key">Agent</div><div>${escapeHtml(agent)}</div>` +
    `<div class="key">AI Provider</div><div>${escapeHtml(provider)}</div>` +
    `<div class="key">AI Model</div><div>${escapeHtml(model)}</div>` +
    `<div class="key">Response Artifact</div><div>${escapeHtml(artifact)}</div>` +
    `<div class="key">SSOT / Context</div><div>${escapeHtml(ssot)}</div>` +
    `<div class="key">Coding Worktree</div><div>${escapeHtml(worktree)}</div>` +
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

function removeGraphSelectedDetails() {
  for (const details of Array.from(
    document.querySelectorAll<HTMLElement>(".graphSelectedDetails")
  )) {
    details.remove();
  }
}

function setRowDetailsExpanded(row: BeadRow, expanded: boolean) {
  row
    .querySelector<HTMLButtonElement>(".beadDetailsButton")
    ?.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function clearSelectedRow() {
  if (selectedRow !== null) {
    setRowDetailsExpanded(selectedRow, false);
  }
  selectedRow?.classList.remove("selected");
  selectedRow = null;
  removeExpandedDetails();
  removeGraphSelectedDetails();
  saveInteractionState();
}

function expandDetailsRow(row: BeadRow, item: BeadRowItem) {
  removeExpandedDetails();
  const detailsRow = document.createElement("tr");
  detailsRow.className = "inlineDetailsRow";
  detailsRow.id = row.dataset.detailsId || "";
  const detailsCell = document.createElement("td");
  detailsCell.colSpan = 6;
  detailsCell.innerHTML = renderDetailsMarkup(item);
  detailsRow.appendChild(detailsCell);
  row.insertAdjacentElement("afterend", detailsRow);
  bindCommitLinks(detailsRow);
  expandedDetailsRow = detailsRow;
}

function toggleRowDetails(row: BeadRow) {
  if (selectedRow === row) {
    clearSelectedRow();
    return;
  }

  if (selectedRow !== null) {
    selectedRow.classList.remove("selected");
    setRowDetailsExpanded(selectedRow, false);
  }
  removeExpandedDetails();
  removeGraphSelectedDetails();
  selectedRow = row;
  row.classList.add("selected");
  setRowDetailsExpanded(row, true);

  const item = decodeRowItem(row);
  if (item !== null) {
    expandDetailsRow(row, item);
  }
  saveInteractionState();
  renderHierarchyOverlays();
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

function refreshRowVisibility(options: { refreshGraph?: boolean; renderHierarchy?: boolean } = {}) {
  const shouldRefreshGraph = options.refreshGraph !== false;
  const shouldRenderHierarchy = options.renderHierarchy !== false;
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
  refreshAgentWorkQueueVisibility();
  refreshParallelStartActions();
  if (shouldRenderHierarchy) {
    renderHierarchyOverlays();
  }
  if (activeViewMode === "graph" && shouldRefreshGraph) {
    refreshGraphPresentation();
    updateGraphViewportPreservingTransform();
  }
  if (shouldRefreshGraph) {
    renderDependencyGraphOverlays();
  }
}

function applyFilters() {
  refreshRowVisibility();
}

function updateViewModeControls(mode: ViewMode, persist: boolean = true) {
  activeViewMode = mode;
  if (persist) {
    saveViewMode(mode);
  }
  document.body.dataset.viewMode = mode;
  tableViewButton.classList.toggle("active", mode === "table");
  graphViewButton.classList.toggle("active", mode === "graph");
  controlViewButton.classList.toggle("active", mode === "control");
  planViewButton.classList.toggle("active", mode === "plan");
  tableViewButton.setAttribute("aria-pressed", mode === "table" ? "true" : "false");
  graphViewButton.setAttribute("aria-pressed", mode === "graph" ? "true" : "false");
  controlViewButton.setAttribute("aria-pressed", mode === "control" ? "true" : "false");
  planViewButton.setAttribute("aria-pressed", mode === "plan" ? "true" : "false");
}

function applyViewMode(mode: ViewMode) {
  const selectedIssue =
    selectedRow === null
      ? null
      : {
          workspacePath: selectedRow.dataset.workspacePath || "",
          issueId: selectedRow.dataset.id || ""
        };
  updateViewModeControls(mode);
  if ((mode === "graph" || mode === "control") && selectedIssue !== null) {
    const modeRootSelector = mode === "graph" ? ".graphPane" : ".agentWorkQueue";
    const activeDetails = document.querySelector(`${modeRootSelector} .graphSelectedDetails`);
    if (activeDetails === null) {
      const detailsButton = Array.from(
        document.querySelectorAll<HTMLButtonElement>(`${modeRootSelector} .graphDetailsBead`)
      ).find(
        (button) =>
          button.dataset.graphDetailsWorkspace === selectedIssue.workspacePath &&
          button.dataset.graphDetailsId === selectedIssue.issueId
      );
      if (detailsButton !== undefined) {
        openGraphBeadDetails(detailsButton);
      }
    }
  }
  if (mode === "graph") {
    refreshGraphPresentation();
    updateGraphViewportPreservingTransform();
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
  saveInteractionState();
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
  saveInteractionState();
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

function sortRowsAndUpdateIcons() {
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
    const orderedRows: BeadRow[] = [];
    const collectRow = (row: BeadRow) => {
      const id = row.dataset.id || "";
      if (visited.has(id)) {
        return;
      }
      visited.add(id);
      orderedRows.push(row);

      const children = [...(childrenByParent.get(id) ?? [])].sort(compareRows);
      for (const child of children) {
        collectRow(child);
      }
    };

    const roots = rows
      .filter((row) => {
        const parentId = row.dataset.parentId || "";
        return parentId === "" || !rowById.has(parentId);
      })
      .sort(compareRows);

    for (const root of roots) {
      collectRow(root);
    }
    for (const row of rows) {
      collectRow(row);
    }

    const currentRows = Array.from(tbody.children).filter((child): child is BeadRow =>
      child.classList.contains("beadRow")
    );
    if (
      currentRows.length !== orderedRows.length ||
      orderedRows.some((row, index) => currentRows[index] !== row)
    ) {
      for (const row of orderedRows) {
        tbody.appendChild(row);
      }
      if (selectedRow !== null && expandedDetailsRow !== null) {
        selectedRow.insertAdjacentElement("afterend", expandedDetailsRow);
      }
    }
  }

  for (const icon of Array.from(document.querySelectorAll<HTMLElement>(".sortIcon"))) {
    const key = icon.dataset.sortKey as SortKey | undefined;
    icon.textContent = key === sortState.key ? (sortState.desc ? "▼" : "▲") : " ";
  }
}

function applySort() {
  sortRowsAndUpdateIcons();
  refreshRowVisibility();
  saveInteractionState();
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

function refreshAgentWorkQueueVisibility() {
  for (const pane of Array.from(document.querySelectorAll<HTMLElement>(".agentWorkQueue"))) {
    for (const lane of Array.from(pane.querySelectorAll<HTMLElement>(".agentWorkLane"))) {
      let visibleCount = 0;
      for (const card of Array.from(lane.querySelectorAll<HTMLElement>(".agentWorkCard"))) {
        const status = (card.dataset.status || "other") as StatusFilter;
        const visible = activeFilters.has(status);
        card.hidden = !visible;
        if (visible) {
          visibleCount += 1;
        }
      }
      const count = lane.querySelector<HTMLElement>(".agentWorkLaneCount");
      if (count !== null) {
        count.textContent = String(visibleCount);
      }
      const empty = lane.querySelector<HTMLElement>(".agentWorkLaneEmpty");
      if (empty !== null) {
        empty.hidden = visibleCount !== 0;
      }
      const laneName = lane.dataset.workLane || "";
      const summary = pane.querySelector<HTMLElement>(`[data-work-summary="${laneName}"]`);
      if (summary !== null) {
        summary.textContent = String(visibleCount);
      }
    }
  }
}

function refreshParallelStartActions() {
  for (const button of Array.from(
    document.querySelectorAll<HTMLButtonElement>(".startParallelBeads")
  )) {
    const section = button.closest<BeadSection>("section[data-workspace-path]");
    if (section === null) {
      button.hidden = true;
      continue;
    }
    const visibleIds = new Set(
      Array.from(section.querySelectorAll<BeadRow>("tbody .beadRow"))
        .filter((row) => row.style.display !== "none")
        .map((row) => row.dataset.id || "")
        .filter((id) => id !== "")
    );
    const items =
      decodeEncodedJson<Array<{ issueId: string }>>(button.dataset.startParallelItems) ?? [];
    const skipped =
      decodeEncodedJson<Array<{ issueId: string; reason: string }>>(
        button.dataset.startParallelSkipped
      ) ?? [];
    const visibleItems = items.filter((item) => visibleIds.has(item.issueId));
    const visibleSkipped = skipped.filter((item) => visibleIds.has(item.issueId));
    button.dataset.activeStartParallelItems = encodeURIComponent(JSON.stringify(visibleItems));
    button.dataset.activeStartParallelSkipped = encodeURIComponent(JSON.stringify(visibleSkipped));
    button.hidden = visibleItems.length < 2;
    if (visibleItems.length >= 2 && button.dataset.pendingAction !== "1") {
      button.textContent = `${visibleItems.length} Start Parallel`;
      button.setAttribute(
        "aria-label",
        `Start ${visibleItems.length} currently visible parallel-ready tasks`
      );
    }
  }
}

function getVisibleGraphNodes(pane: HTMLElement) {
  return Array.from(pane.querySelectorAll<HTMLElement>(".graphNode[data-graph-id]")).filter(
    (node) => node.style.display !== "none"
  );
}

function updateGraphIssueDrawer(
  pane: HTMLElement,
  drawerSelector: string,
  itemSelector: string,
  visibleIds: ReadonlySet<string>,
  summarySelector: string,
  suffix: string
) {
  const drawer = pane.querySelector<HTMLDetailsElement>(drawerSelector);
  if (drawer === null) {
    return 0;
  }
  let visibleCount = 0;
  for (const item of Array.from(drawer.querySelectorAll<HTMLElement>(itemSelector))) {
    const id = item.dataset.warningId ?? item.dataset.riskId ?? "";
    const visible = visibleIds.has(id);
    item.hidden = !visible;
    if (visible) {
      visibleCount += 1;
    }
  }
  drawer.hidden = visibleCount === 0;
  const count = drawer.querySelector<HTMLElement>("summary strong");
  if (count !== null) {
    count.textContent = String(visibleCount);
  }
  const summary = pane.querySelector<HTMLElement>(summarySelector);
  if (summary !== null) {
    summary.hidden = visibleCount === 0;
    summary.textContent = `${visibleCount} ${suffix}`;
  }
  return visibleCount;
}

function refreshGraphDerivedState(pane: HTMLElement) {
  const visibleNodes = getVisibleGraphNodes(pane);
  const visibleIds = new Set(visibleNodes.map((node) => node.dataset.graphId || ""));
  const candidateEdges = Array.from(pane.querySelectorAll<HTMLElement>(".graphEdge")).map(
    (edge) => ({
      fromId: edge.dataset.fromId || "",
      toId: edge.dataset.toId || ""
    })
  );
  const graphState = computeVisibleGraphState(visibleIds, candidateEdges);
  const criticalIds = new Set(graphState.criticalPathIds);

  for (const node of visibleNodes) {
    const graphId = node.dataset.graphId || "";
    const critical = criticalIds.has(graphId);
    node.dataset.graphLevel = String(graphState.levelsById.get(graphId) ?? 0);
    node.dataset.critical = critical ? "1" : "0";
    node.classList.toggle("criticalGraphNode", critical);
    const badge = node.querySelector<HTMLElement>(".criticalBadge");
    if (badge !== null) {
      badge.hidden = !critical;
    }
    for (const relation of Array.from(
      node.querySelectorAll<HTMLElement>(".graphRelation[data-related-ids]")
    )) {
      const relatedIds = decodeEncodedJson<string[]>(relation.dataset.relatedIds) ?? [];
      const visibleRelatedIds = relatedIds.filter((id) => visibleIds.has(id));
      relation.hidden = visibleRelatedIds.length === 0;
      const value = relation.querySelector<HTMLElement>(".graphRelationValue");
      if (value !== null) {
        value.textContent = visibleRelatedIds.join(", ");
      }
    }
  }
  for (const edge of Array.from(pane.querySelectorAll<HTMLElement>(".graphEdge"))) {
    edge.dataset.critical = graphState.criticalEdgeKeys.has(
      graphEdgeKey(edge.dataset.fromId || "", edge.dataset.toId || "")
    )
      ? "1"
      : "0";
  }

  const dependencySummary = pane.querySelector<HTMLElement>(".dependencySummary");
  if (dependencySummary !== null) {
    dependencySummary.textContent = `${graphState.edges.length} deps`;
  }
  const criticalSummary = pane.querySelector<HTMLElement>(".criticalSummary");
  const pathLabel = graphState.criticalPathIds.join(" -> ");
  if (criticalSummary !== null) {
    criticalSummary.hidden = graphState.criticalPathIds.length === 0;
    criticalSummary.textContent = `${graphState.criticalPathIds.length} critical`;
    criticalSummary.title = pathLabel;
  }
  const pathStrip = pane.querySelector<HTMLElement>(".graphPathStrip");
  const pathValue = pane.querySelector<HTMLElement>(".graphPathValue");
  if (pathStrip !== null && pathValue !== null) {
    const empty = graphState.criticalPathIds.length === 0;
    pathStrip.classList.toggle("emptyCriticalPath", empty);
    pathValue.textContent = empty ? "No dependency path yet" : pathLabel;
    pathValue.title = pathLabel;
  }

  const warningCount = updateGraphIssueDrawer(
    pane,
    ".dependencyIssueDrawer",
    "[data-warning-id]",
    visibleIds,
    ".dependencyWarningSummary",
    "warnings"
  );
  const riskCount = updateGraphIssueDrawer(
    pane,
    ".mergeRiskIssueDrawer",
    "[data-risk-id]",
    visibleIds,
    ".mergeRiskSummary",
    "risk"
  );
  const issueStack = pane.querySelector<HTMLElement>(".graphIssueStack");
  if (issueStack !== null) {
    const hasSelectedDetails = issueStack.querySelector(".graphSelectedDetails") !== null;
    issueStack.hidden = warningCount + riskCount === 0 && !hasSelectedDetails;
  }
}

function layoutGraphPane(pane: HTMLElement) {
  const canvas = getGraphCanvas(pane);
  const content = getGraphContent(pane);
  if (canvas === null || content === null || pane.offsetParent === null) {
    return;
  }
  const visibleNodes = getVisibleGraphNodes(pane);
  const layout = computePackedGraphLayout(
    visibleNodes.map((node) => ({
      id: node.dataset.graphId || "",
      level: parseInt(node.dataset.graphLevel || "0", 10),
      height: node.offsetHeight
    })),
    {
      nodeWidth: GRAPH_NODE_WIDTH,
      levelGap: GRAPH_LEVEL_GAP,
      columnGap: GRAPH_LEVEL_COLUMN_GAP,
      laneGap: GRAPH_LANE_GAP,
      paddingX: GRAPH_PADDING_X,
      paddingY: GRAPH_PADDING_Y
    }
  );
  const positions = new Map(layout.nodes.map((node) => [node.id, node]));
  for (const node of visibleNodes) {
    const position = positions.get(node.dataset.graphId || "");
    if (position !== undefined) {
      node.style.setProperty("--graph-x", `${position.x}px`);
      node.style.setProperty("--graph-y", `${position.y}px`);
    }
  }
  const levelCenters = new Map(layout.levels.map((level) => [level.level, level.centerX]));
  for (const guide of Array.from(pane.querySelectorAll<HTMLElement>(".graphLevelGuide"))) {
    const center = levelCenters.get(parseInt(guide.dataset.graphLevel || "0", 10));
    guide.hidden = center === undefined;
    if (center !== undefined) {
      guide.style.setProperty("--graph-guide-x", `${center}px`);
    }
  }
  canvas.dataset.graphWidth = String(layout.width);
  canvas.dataset.graphHeight = String(layout.height);
  content.style.width = `${layout.width}px`;
  content.style.height = `${layout.height}px`;
}

function refreshGraphPresentation() {
  for (const pane of Array.from(document.querySelectorAll<HTMLElement>(".graphPane"))) {
    refreshGraphDerivedState(pane);
    layoutGraphPane(pane);
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

function getGraphSelectionBox(pane: HTMLElement) {
  return pane.querySelector<HTMLElement>(".graphZoomSelection");
}

function getGraphWorkspaceKey(pane: HTMLElement) {
  return pane.dataset.workspacePath || "default";
}

function getGraphTransform(pane: HTMLElement): GraphTransformState {
  return (
    graphTransforms[getGraphWorkspaceKey(pane)] ??
    graphTransforms.__legacy__ ?? { zoom: 1, pan: { x: 0, y: 0 } }
  );
}

function setGraphTransform(pane: HTMLElement, transform: GraphTransformState) {
  graphTransforms = {
    ...graphTransforms,
    [getGraphWorkspaceKey(pane)]: transform
  };
}

function getGraphBaseSize(canvas: HTMLElement) {
  return {
    width: Math.max(1, parseFloat(canvas.dataset.graphWidth || "960")),
    height: Math.max(1, parseFloat(canvas.dataset.graphHeight || "620"))
  };
}

function getGraphViewportSize(scroller: HTMLElement) {
  const rect = scroller.getBoundingClientRect();
  return {
    width: Math.max(1, rect.width || scroller.clientWidth || 1),
    height: Math.max(1, rect.height || scroller.clientHeight || 1)
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

function saveGraphTransforms() {
  const workspaceTransforms = { ...graphTransforms };
  delete workspaceTransforms.__legacy__;
  graphTransforms = workspaceTransforms;
  const nextState = { ...vscode.getState() };
  delete nextState.graphZoom;
  delete nextState.graphPan;
  vscode.setState({ ...nextState, graphTransforms: workspaceTransforms });
}

function scheduleGraphTransformSave() {
  if (graphTransformSaveTimer !== null) {
    window.clearTimeout(graphTransformSaveTimer);
  }
  graphTransformSaveTimer = window.setTimeout(() => {
    graphTransformSaveTimer = null;
    saveGraphTransforms();
  }, 100);
}

function clampGraphPanForPane(pane: HTMLElement, pan: GraphPanState, zoom: number) {
  const scroller = getGraphScroller(pane);
  const canvas = getGraphCanvas(pane);
  if (scroller === null || canvas === null) {
    return pan;
  }

  const viewport = getGraphViewportSize(scroller);
  const requiredSize = getGraphRequiredSize(pane, getGraphBaseSize(canvas));
  const scaledWidth = requiredSize.width * zoom;
  const scaledHeight = requiredSize.height * zoom;
  return clampGraphPanForVisibility(
    pan,
    viewport,
    { width: scaledWidth, height: scaledHeight },
    GRAPH_MINIMUM_VISIBLE_SIZE
  );
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

function applyGraphZoomToPane(pane: HTMLElement) {
  const scroller = getGraphScroller(pane);
  const canvas = getGraphCanvas(pane);
  const content = getGraphContent(pane);
  if (scroller === null || canvas === null || content === null) {
    return;
  }

  const base = getGraphRequiredSize(pane, getGraphBaseSize(canvas));
  const viewport = getGraphViewportSize(scroller);
  const transform = getGraphTransform(pane);
  content.style.width = `${base.width}px`;
  content.style.height = `${base.height}px`;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  content.style.setProperty("--graph-zoom", String(transform.zoom));
  content.style.setProperty("--graph-pan-x", `${transform.pan.x}px`);
  content.style.setProperty("--graph-pan-y", `${transform.pan.y}px`);
  const zoomValue = pane.querySelector<HTMLElement>(".graphZoomValue");
  if (zoomValue !== null) {
    zoomValue.textContent = `${Math.round(transform.zoom * 100)}%`;
  }
}

function applyGraphZoomToAll() {
  for (const pane of Array.from(document.querySelectorAll<HTMLElement>(".graphPane"))) {
    applyGraphZoomToPane(pane);
  }
}

function getGraphFitZoomForPane(pane: HTMLElement) {
  const scroller = getGraphScroller(pane);
  const canvas = getGraphCanvas(pane);
  if (scroller === null || canvas === null) {
    return 1;
  }

  const viewport = getGraphViewportSize(scroller);
  if (viewport.width <= 1 || viewport.height <= 1) {
    return 1;
  }

  const requiredSize = getGraphRequiredSize(pane, { width: 1, height: 1 });
  const availableWidth = Math.max(1, viewport.width - GRAPH_FIT_PADDING * 2);
  const availableHeight = Math.max(1, viewport.height - GRAPH_FIT_PADDING * 2);
  const fitZoom = Math.min(
    1,
    availableWidth / requiredSize.width,
    availableHeight / requiredSize.height
  );
  return normalizeGraphZoom(fitZoom);
}

function fitGraphToPane(pane: HTMLElement, persist: boolean = true) {
  const nextZoom = getGraphFitZoomForPane(pane);
  const scroller = getGraphScroller(pane);
  const canvas = getGraphCanvas(pane);
  let nextPan = { x: 0, y: 0 };
  if (scroller !== null && canvas !== null) {
    const viewport = getGraphViewportSize(scroller);
    const requiredSize = getGraphRequiredSize(pane, getGraphBaseSize(canvas));
    nextPan = clampGraphPanForPane(
      pane,
      computeCenteredGraphPan(viewport, {
        width: requiredSize.width * nextZoom,
        height: requiredSize.height * nextZoom
      }),
      nextZoom
    );
  }
  initializedGraphPanes.add(pane);
  setGraphTransform(pane, { zoom: nextZoom, pan: nextPan });
  applyGraphZoomToPane(pane);
  if (scroller !== null) {
    scroller.scrollLeft = 0;
    scroller.scrollTop = 0;
    saveGraphScroll(pane);
  }
  if (persist) {
    saveGraphTransforms();
  }
}

function hasPersistedGraphTransform(pane: HTMLElement) {
  return (
    Object.prototype.hasOwnProperty.call(graphTransforms, getGraphWorkspaceKey(pane)) ||
    Object.prototype.hasOwnProperty.call(graphTransforms, "__legacy__")
  );
}

function updateGraphViewportPreservingTransform(clampPan: boolean = true) {
  for (const pane of Array.from(document.querySelectorAll<HTMLElement>(".graphPane"))) {
    if (pane.offsetParent === null) {
      continue;
    }
    if (!initializedGraphPanes.has(pane) && !hasPersistedGraphTransform(pane)) {
      fitGraphToPane(pane, false);
    } else {
      const transform = getGraphTransform(pane);
      if (clampPan) {
        setGraphTransform(pane, {
          ...transform,
          pan: clampGraphPanForPane(pane, transform.pan, transform.zoom)
        });
      }
      applyGraphZoomToPane(pane);
      initializedGraphPanes.add(pane);
    }
  }
  saveGraphTransforms();
}

function rememberGraphZoomAnchor(
  pane: HTMLElement,
  clientX: number,
  clientY: number
): GraphZoomAnchor | null {
  const scroller = getGraphScroller(pane);
  if (scroller === null) {
    return null;
  }
  const rect = scroller.getBoundingClientRect();
  const anchor = {
    x: Math.min(rect.width, Math.max(0, clientX - rect.left)),
    y: Math.min(rect.height, Math.max(0, clientY - rect.top))
  };
  graphZoomAnchors.set(pane, anchor);
  return anchor;
}

function setGraphZoom(pane: HTMLElement, nextZoom: number, anchor?: GraphZoomAnchor) {
  const currentTransform = getGraphTransform(pane);
  const previousZoom = currentTransform.zoom;
  const nextNormalizedZoom = normalizeGraphZoom(nextZoom);
  if (previousZoom === nextNormalizedZoom) {
    return false;
  }

  const scroller = getGraphScroller(pane);
  let nextPan = currentTransform.pan;
  if (scroller !== null) {
    const rect = scroller.getBoundingClientRect();
    const effectiveAnchor = anchor ??
      graphZoomAnchors.get(pane) ?? {
        x: rect.width / 2,
        y: rect.height / 2
      };
    nextPan = computeAnchoredGraphPan(
      currentTransform.pan,
      previousZoom,
      nextNormalizedZoom,
      effectiveAnchor
    );
  }

  setGraphTransform(pane, {
    zoom: nextNormalizedZoom,
    pan: clampGraphPanForPane(pane, nextPan, nextNormalizedZoom)
  });
  applyGraphZoomToPane(pane);
  scheduleGraphTransformSave();
  return true;
}

function zoomGraphFromWheel(pane: HTMLElement, event: WheelEvent) {
  const scroller = getGraphScroller(pane);
  if (scroller === null) {
    return;
  }
  const transform = getGraphTransform(pane);
  const deltaPixels =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? event.deltaY * 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? event.deltaY * Math.max(1, scroller.clientHeight)
        : event.deltaY;
  const boundedDeltaPixels = Math.min(240, Math.max(-240, deltaPixels));
  const zoomFactor = Math.exp(-boundedDeltaPixels * 0.002);
  const nextZoom = normalizeGraphZoom(transform.zoom * zoomFactor);
  const anchor = rememberGraphZoomAnchor(pane, event.clientX, event.clientY);
  if (setGraphZoom(pane, nextZoom, anchor ?? undefined)) {
    event.preventDefault();
  }
}

function isGraphInteractiveTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    target.closest("button,a,input,select,textarea,[role='button']") !== null
  );
}

function getGraphPointerPosition(pane: HTMLElement, event: PointerEvent) {
  const scroller = getGraphScroller(pane);
  if (scroller === null) {
    return null;
  }

  const rect = scroller.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function updateGraphSelectionBox() {
  if (graphSelection === null) {
    return;
  }

  const selectionBox = getGraphSelectionBox(graphSelection.pane);
  if (selectionBox === null) {
    return;
  }

  const left = Math.min(graphSelection.startX, graphSelection.currentX);
  const top = Math.min(graphSelection.startY, graphSelection.currentY);
  const width = Math.abs(graphSelection.currentX - graphSelection.startX);
  const height = Math.abs(graphSelection.currentY - graphSelection.startY);
  selectionBox.hidden = false;
  selectionBox.style.left = `${left}px`;
  selectionBox.style.top = `${top}px`;
  selectionBox.style.width = `${width}px`;
  selectionBox.style.height = `${height}px`;
}

function clearGraphSelectionBox(pane: HTMLElement) {
  const selectionBox = getGraphSelectionBox(pane);
  if (selectionBox === null) {
    return;
  }

  selectionBox.hidden = true;
  selectionBox.removeAttribute("style");
}

function zoomGraphToSelection(selection: GraphSelectionState) {
  const scroller = getGraphScroller(selection.pane);
  if (scroller === null) {
    return;
  }

  const width = Math.abs(selection.currentX - selection.startX);
  const height = Math.abs(selection.currentY - selection.startY);
  if (width < GRAPH_SELECTION_MIN_SIZE || height < GRAPH_SELECTION_MIN_SIZE) {
    return;
  }

  const viewport = getGraphViewportSize(scroller);
  const transform = getGraphTransform(selection.pane);
  const left = Math.min(selection.startX, selection.currentX);
  const top = Math.min(selection.startY, selection.currentY);
  const selectedX = (left - transform.pan.x) / transform.zoom;
  const selectedY = (top - transform.pan.y) / transform.zoom;
  const selectedWidth = width / transform.zoom;
  const selectedHeight = height / transform.zoom;
  const nextZoom = normalizeGraphZoom(
    Math.min(
      GRAPH_ZOOM_MAX,
      (viewport.width - GRAPH_FIT_PADDING * 2) / selectedWidth,
      (viewport.height - GRAPH_FIT_PADDING * 2) / selectedHeight
    )
  );

  const selectedOffset = computeCenteredGraphPan(viewport, {
    width: selectedWidth * nextZoom,
    height: selectedHeight * nextZoom
  });
  const nextPan = clampGraphPanForPane(
    selection.pane,
    {
      x: selectedOffset.x - selectedX * nextZoom,
      y: selectedOffset.y - selectedY * nextZoom
    },
    nextZoom
  );
  setGraphTransform(selection.pane, { zoom: nextZoom, pan: nextPan });
  applyGraphZoomToPane(selection.pane);
  saveGraphTransforms();
  renderDependencyGraphOverlays();
}

function beginGraphSelection(pane: HTMLElement, event: PointerEvent) {
  if (
    getGraphPointerGesture(event.button, event.altKey, isGraphInteractiveTarget(event.target)) !==
    "select"
  ) {
    return;
  }

  const point = getGraphPointerPosition(pane, event);
  const scroller = getGraphScroller(pane);
  if (point === null || scroller === null) {
    return;
  }

  event.preventDefault();
  scroller.focus({ preventScroll: true });
  scroller.setPointerCapture(event.pointerId);
  graphSelection = {
    pane,
    pointerId: event.pointerId,
    startX: point.x,
    startY: point.y,
    currentX: point.x,
    currentY: point.y
  };
  updateGraphSelectionBox();
}

function updateGraphSelection(pane: HTMLElement, event: PointerEvent) {
  if (graphSelection === null || graphSelection.pane !== pane) {
    return;
  }

  const point = getGraphPointerPosition(pane, event);
  if (point === null) {
    return;
  }

  event.preventDefault();
  graphSelection.currentX = point.x;
  graphSelection.currentY = point.y;
  updateGraphSelectionBox();
}

function finishGraphSelection(pane: HTMLElement, event: PointerEvent) {
  if (graphSelection === null || graphSelection.pane !== pane) {
    return;
  }

  const point = getGraphPointerPosition(pane, event);
  if (point !== null) {
    graphSelection.currentX = point.x;
    graphSelection.currentY = point.y;
  }
  const selection = graphSelection;
  graphSelection = null;
  event.preventDefault();
  const scroller = getGraphScroller(pane);
  if (scroller?.hasPointerCapture(selection.pointerId)) {
    scroller.releasePointerCapture(selection.pointerId);
  }
  clearGraphSelectionBox(pane);
  zoomGraphToSelection(selection);
}

function beginGraphPan(pane: HTMLElement, event: PointerEvent) {
  if (
    getGraphPointerGesture(event.button, event.altKey, isGraphInteractiveTarget(event.target)) !==
    "pan"
  ) {
    return false;
  }
  const scroller = getGraphScroller(pane);
  if (scroller === null) {
    return false;
  }
  event.preventDefault();
  scroller.focus({ preventScroll: true });
  scroller.setPointerCapture(event.pointerId);
  scroller.classList.add("isPanning");
  graphPanGesture = {
    pane,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startPan: getGraphTransform(pane).pan
  };
  return true;
}

function updateGraphPan(pane: HTMLElement, event: PointerEvent) {
  if (graphPanGesture === null || graphPanGesture.pane !== pane) {
    return false;
  }
  event.preventDefault();
  const transform = getGraphTransform(pane);
  const nextPan = clampGraphPanForPane(
    pane,
    {
      x: graphPanGesture.startPan.x + event.clientX - graphPanGesture.startClientX,
      y: graphPanGesture.startPan.y + event.clientY - graphPanGesture.startClientY
    },
    transform.zoom
  );
  setGraphTransform(pane, { ...transform, pan: nextPan });
  applyGraphZoomToPane(pane);
  return true;
}

function finishGraphPan(pane: HTMLElement, event: PointerEvent) {
  if (graphPanGesture === null || graphPanGesture.pane !== pane) {
    return false;
  }
  event.preventDefault();
  const gesture = graphPanGesture;
  graphPanGesture = null;
  const scroller = getGraphScroller(pane);
  scroller?.classList.remove("isPanning");
  if (scroller?.hasPointerCapture(gesture.pointerId)) {
    scroller.releasePointerCapture(gesture.pointerId);
  }
  saveGraphTransforms();
  return true;
}

function handleGraphPointerDown(pane: HTMLElement, event: PointerEvent) {
  rememberGraphZoomAnchor(pane, event.clientX, event.clientY);
  const gesture = getGraphPointerGesture(
    event.button,
    event.altKey,
    isGraphInteractiveTarget(event.target)
  );
  if (gesture === "select") {
    beginGraphSelection(pane, event);
    return;
  }
  if (gesture === "pan") {
    beginGraphPan(pane, event);
  }
}

function handleGraphPointerMove(pane: HTMLElement, event: PointerEvent) {
  rememberGraphZoomAnchor(pane, event.clientX, event.clientY);
  if (!updateGraphPan(pane, event)) {
    updateGraphSelection(pane, event);
  }
}

function handleGraphPointerEnd(pane: HTMLElement, event: PointerEvent) {
  if (!finishGraphPan(pane, event)) {
    finishGraphSelection(pane, event);
  }
}

function panGraphByKeyboard(pane: HTMLElement, deltaX: number, deltaY: number) {
  const transform = getGraphTransform(pane);
  const pan = clampGraphPanForPane(
    pane,
    { x: transform.pan.x + deltaX, y: transform.pan.y + deltaY },
    transform.zoom
  );
  setGraphTransform(pane, { ...transform, pan });
  applyGraphZoomToPane(pane);
  saveGraphTransforms();
}

function handleGraphKeydown(pane: HTMLElement, event: KeyboardEvent) {
  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    setGraphZoom(pane, getGraphTransform(pane).zoom * 1.2);
  } else if (event.key === "-") {
    event.preventDefault();
    setGraphZoom(pane, getGraphTransform(pane).zoom / 1.2);
  } else if (event.key === "0") {
    event.preventDefault();
    fitGraphToPane(pane);
    renderDependencyGraphOverlays();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    panGraphByKeyboard(pane, GRAPH_KEYBOARD_PAN_STEP, 0);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    panGraphByKeyboard(pane, -GRAPH_KEYBOARD_PAN_STEP, 0);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    panGraphByKeyboard(pane, 0, GRAPH_KEYBOARD_PAN_STEP);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    panGraphByKeyboard(pane, 0, -GRAPH_KEYBOARD_PAN_STEP);
  }
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

    const contentRect = content.getBoundingClientRect();
    const transform = getGraphTransform(pane);
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
    const getConnectionPath = (fromNode: HTMLElement, toNode: HTMLElement) => {
      const fromRect = fromNode.getBoundingClientRect();
      const toRect = toNode.getBoundingClientRect();
      const x1 = (fromRect.right - contentRect.left) / transform.zoom;
      const y1 = (fromRect.top - contentRect.top + fromRect.height / 2) / transform.zoom;
      const x2 = (toRect.left - contentRect.left) / transform.zoom;
      const y2 = (toRect.top - contentRect.top + toRect.height / 2) / transform.zoom;
      const gap = Math.max(18, Math.abs(x2 - x1) * 0.34);
      return x2 >= x1
        ? `M${x1.toFixed(1)} ${y1.toFixed(1)} C${(x1 + gap).toFixed(1)} ${y1.toFixed(1)} ${(x2 - gap).toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
        : `M${x1.toFixed(1)} ${y1.toFixed(1)} C${(x1 + gap).toFixed(1)} ${y1.toFixed(1)} ${(x1 + gap).toFixed(1)} ${(y1 + y2) / 2} ${(x1 + 12).toFixed(1)} ${(y1 + y2) / 2} S${(x2 - gap).toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    };
    let parentPaths = "";
    for (const childNode of nodesById.values()) {
      const parentId = childNode.dataset.parentId || "";
      const parentNode = nodesById.get(parentId);
      if (parentNode === undefined) {
        continue;
      }
      parentPaths += `<path class="graphParentPath" d="${getConnectionPath(parentNode, childNode)}" />`;
    }
    let paths = "";
    for (const edge of Array.from(pane.querySelectorAll<HTMLElement>(".graphEdge"))) {
      const fromNode = nodesById.get(edge.dataset.fromId || "");
      const toNode = nodesById.get(edge.dataset.toId || "");
      if (fromNode === undefined || toNode === undefined) {
        continue;
      }

      const d = getConnectionPath(fromNode, toNode);
      const criticalClass = edge.dataset.critical === "1" ? " criticalDependencyPath" : "";
      const arrowId = edge.dataset.critical === "1" ? criticalMarkerId : markerId;
      paths += `<path class="dependencyPath${criticalClass}" marker-end="url(#${arrowId})" d="${d}" />`;
    }
    overlay.innerHTML = markerDefs + parentPaths + paths;
  }
}

addFilter.addEventListener("click", () => {
  setFilterMenuOpen(!filterMenu.classList.contains("open"), true);
});
tableViewButton.addEventListener("click", () => {
  applyViewMode("table");
});
graphViewButton.addEventListener("click", () => {
  applyViewMode("graph");
});
controlViewButton.addEventListener("click", () => {
  applyViewMode("control");
});
planViewButton.addEventListener("click", () => {
  applyViewMode("plan");
});
generatePlanDraftWithAi.addEventListener("click", () => {
  const goal = planGoalText.value.trim();
  const workspacePath = planDraftWorkspace.value;
  if (goal === "") {
    setPlanGenerationStatus("error", "Describe the project goal before generating a plan.");
    planGoalText.focus();
    return;
  }
  if (workspacePath === "") {
    setPlanGenerationStatus("error", "Choose an initialized Beads workspace first.");
    return;
  }

  const requestId = createRequestId();
  activePlanGenerationRequestId = requestId;
  generatePlanDraftWithAi.disabled = true;
  generatePlanDraftWithAi.setAttribute("aria-busy", "true");
  planDraftWorkspace.disabled = true;
  saveWebviewState({ planGoalText: planGoalText.value });
  setPlanGenerationStatus(
    "pending",
    "Waiting for provider/model selection and your send confirmation…"
  );
  vscode.postMessage({
    command: "generatePlanDraft",
    requestId,
    workspacePath,
    goal
  });
});
planGoalText.addEventListener("input", () => {
  saveWebviewState({ planGoalText: planGoalText.value });
});
loadPlanDraftExample.addEventListener("click", () => {
  planDraftText.value = PLAN_DRAFT_EXAMPLE;
  planDraftController.setText(PLAN_DRAFT_EXAMPLE);
  currentPlanPreview = planDraftController.preview();
  saveWebviewState({ planDraftText: PLAN_DRAFT_EXAMPLE });
  renderCurrentPlanPreview();
});
previewPlanDraft.addEventListener("click", () => {
  planDraftController.setText(planDraftText.value);
  currentPlanPreview = planDraftController.preview();
  saveWebviewState({ planDraftText: planDraftText.value });
  renderCurrentPlanPreview();
});
planDraftText.addEventListener("input", () => {
  planDraftController.setText(planDraftText.value);
  currentPlanPreview = null;
  saveWebviewState({ planDraftText: planDraftText.value });
  renderCurrentPlanPreview();
});
planDraftWorkspace.addEventListener("change", () => {
  saveWebviewState({ planWorkspacePath: planDraftWorkspace.value });
  generatePlanDraftWithAi.disabled =
    activePlanGenerationRequestId !== null || planDraftWorkspace.value === "";
  renderCurrentPlanPreview();
});
window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isBeadsHostMessage(event.data)) {
    return;
  }
  const message = event.data;
  if (message.command === "beadsRenderUpdate") {
    applyBeadsRenderUpdate(message);
    return;
  }
  if (message.command === "planDraftGenerationResult") {
    if (message.requestId !== activePlanGenerationRequestId) {
      return;
    }
    finishPlanGenerationRequest();
    if (message.status === "generated") {
      planDraftText.value = message.draftText;
      planDraftController.setText(message.draftText);
      currentPlanPreview = planDraftController.preview();
      saveWebviewState({ planDraftText: message.draftText });
      renderCurrentPlanPreview();
      if (message.validationErrorCount > 0) {
        document.querySelector<HTMLDetailsElement>(".planAdvanced")?.setAttribute("open", "");
        setPlanGenerationStatus(
          "error",
          `AI returned an editable draft with ${message.validationErrorCount} validation issue${message.validationErrorCount === 1 ? "" : "s"}. Fix them before import.`,
          message.artifactUri
        );
      } else {
        setPlanGenerationStatus(
          "success",
          `Draft generated with ${getAgentProviderDefinition(message.provider).label} / ${message.confirmedModel}. Review it before import.`,
          message.artifactUri
        );
      }
      return;
    }
    setPlanGenerationStatus(
      message.status === "error" ? "error" : "idle",
      message.message,
      message.artifactUri
    );
    return;
  }

  saveWebviewState({ parallelExecutionResult: message });
  renderParallelExecutionResult(message);
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
  const artifactButton = target.closest(".openAgentArtifact") as HTMLButtonElement | null;
  if (artifactButton !== null) {
    event.preventDefault();
    postOpenAgentArtifact(artifactButton);
    return;
  }
  const graphDetailsButton = target.closest(".graphDetailsBead") as HTMLButtonElement | null;
  if (graphDetailsButton !== null) {
    event.preventDefault();
    openGraphBeadDetails(graphDetailsButton);
    return;
  }
  const assignStartButton = target.closest(".assignStartBead") as HTMLButtonElement | null;
  if (assignStartButton !== null) {
    event.preventDefault();
    postAssignStartBead(assignStartButton);
    return;
  }
  if (!target.closest(".menu")) {
    setFilterMenuOpen(false);
  }
  if (!target.closest(".contextMenu")) {
    closeContextMenu();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setFilterMenuOpen(false);
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
  openContextMenu(
    row,
    row?.dataset.workspacePath || section?.dataset.workspacePath || "",
    event.clientX,
    event.clientY
  );
});
createBeadAction.addEventListener("click", () => {
  const workspacePath = contextMenuWorkspacePath;
  const disabled = createBeadAction.disabled;
  closeContextMenu();
  if (disabled || workspacePath === "") {
    return;
  }
  vscode.postMessage({ command: "createBead", workspacePath });
});
closeBeadAction.addEventListener("click", () => {
  if (closeBeadAction.disabled || contextMenuRow === null) {
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
    refreshGraphPresentation();
    updateGraphViewportPreservingTransform();
  } else {
    applyGraphZoomToAll();
  }
  renderHierarchyOverlays();
  renderDependencyGraphOverlays();
});
window.addEventListener("scroll", () => {
  if (scrollStateSaveTimer !== null) {
    window.clearTimeout(scrollStateSaveTimer);
  }
  scrollStateSaveTimer = window.setTimeout(() => {
    scrollStateSaveTimer = null;
    saveInteractionState();
  }, 120);
});
function bindGraphPanes() {
  for (const pane of Array.from(document.querySelectorAll<HTMLElement>(".graphPane"))) {
    const scroller = getGraphScroller(pane);
    if (scroller !== null && !dynamicallyBoundElements.has(scroller)) {
      dynamicallyBoundElements.add(scroller);
      scroller.addEventListener("scroll", () => {
        saveGraphScroll(pane);
      });
      scroller.addEventListener("wheel", (event) => zoomGraphFromWheel(pane, event), {
        passive: false
      });
      scroller.addEventListener("pointerdown", (event) => handleGraphPointerDown(pane, event));
      scroller.addEventListener("pointermove", (event) => handleGraphPointerMove(pane, event));
      scroller.addEventListener("pointerup", (event) => handleGraphPointerEnd(pane, event));
      scroller.addEventListener("pointercancel", (event) => handleGraphPointerEnd(pane, event));
      scroller.addEventListener("keydown", (event) => handleGraphKeydown(pane, event));
      scroller.addEventListener("dblclick", (event) => {
        if (isGraphInteractiveTarget(event.target)) {
          return;
        }
        event.preventDefault();
        fitGraphToPane(pane);
        renderDependencyGraphOverlays();
      });
    }
    for (const button of Array.from(
      pane.querySelectorAll<HTMLButtonElement>("button[data-graph-action]")
    )) {
      if (dynamicallyBoundElements.has(button)) {
        continue;
      }
      dynamicallyBoundElements.add(button);
      button.addEventListener("click", () => {
        const action = button.dataset.graphAction;
        if (action === "in") {
          setGraphZoom(pane, getGraphTransform(pane).zoom * 1.2);
        } else if (action === "out") {
          setGraphZoom(pane, getGraphTransform(pane).zoom / 1.2);
        } else if (action === "fit") {
          fitGraphToPane(pane);
          renderDependencyGraphOverlays();
        }
      });
    }
  }
}

queryElement<HTMLButtonElement>("#refresh").addEventListener("click", () => {
  vscode.postMessage({ command: "refresh" });
});
syncBeadsButton.addEventListener("click", () => {
  if (!syncAvailable || syncBeadsButton.disabled) {
    return;
  }
  if (!beginClientAction("sync-all-beads", [syncBeadsButton], "Syncing…", 3000)) {
    return;
  }
  vscode.postMessage({ command: "syncAllBeads" });
});
queryElement<HTMLButtonElement>("#openGitGraph").addEventListener("click", () => {
  vscode.postMessage({ command: "openGitGraph" });
});
function bindDynamicContent() {
  bindGraphPanes();
  for (const button of Array.from(
    document.querySelectorAll<HTMLButtonElement>("button[data-sync-workspace]")
  )) {
    if (dynamicallyBoundElements.has(button)) {
      continue;
    }
    dynamicallyBoundElements.add(button);
    button.addEventListener("click", () => {
      const workspacePath = button.dataset.syncWorkspace || "";
      if (button.disabled || workspacePath === "") {
        return;
      }
      if (!beginClientAction(`sync-beads:${workspacePath}`, [button], "Syncing…", 3000)) {
        return;
      }
      vscode.postMessage({ command: "syncBeads", workspacePath });
    });
  }
  for (const button of Array.from(
    document.querySelectorAll<HTMLButtonElement>(".startParallelBeads")
  )) {
    if (dynamicallyBoundElements.has(button)) {
      continue;
    }
    dynamicallyBoundElements.add(button);
    button.addEventListener("click", () => {
      const workspacePath = button.dataset.startParallelWorkspace || "";
      const items = decodeEncodedJson<
        Array<{
          issueId: string;
          title?: string;
          provider?: AgentProviderId;
          model?: string;
          ssot?: string;
          worktree?: string;
        }>
      >(button.dataset.activeStartParallelItems ?? button.dataset.startParallelItems);
      const skipped = decodeEncodedJson<
        Array<{
          issueId: string;
          title?: string;
          reason: string;
        }>
      >(button.dataset.activeStartParallelSkipped ?? button.dataset.startParallelSkipped);
      if (button.disabled || workspacePath === "" || items === null || items.length < 2) {
        return;
      }
      if (!beginClientAction(`start-parallel:${workspacePath}`, [button], "Starting…", 3000)) {
        return;
      }
      vscode.postMessage({
        command: "startParallelBeads",
        requestId: createRequestId(),
        workspacePath,
        items,
        skipped: skipped ?? []
      });
    });
  }
  for (const button of Array.from(
    document.querySelectorAll<HTMLButtonElement>(".mergeParallelPrs")
  )) {
    if (dynamicallyBoundElements.has(button)) {
      continue;
    }
    dynamicallyBoundElements.add(button);
    button.addEventListener("click", () => {
      const issueId = button.dataset.mergeId || "";
      const workspacePath = button.dataset.mergeWorkspace || "";
      const dependencyIds = (button.dataset.mergeDependencies || "")
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id !== "");
      if (button.disabled || issueId === "" || workspacePath === "" || dependencyIds.length === 0) {
        return;
      }

      const dependencySet = new Set(dependencyIds);
      const dependencies = findSectionRows(button)
        .map((row) => decodeRowItem(row))
        .filter((item): item is BeadRowItem => item !== null && dependencySet.has(item.id))
        .map(toExecutionTarget);
      const matchingButtons = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".mergeParallelPrs")
      ).filter(
        (candidate) =>
          candidate.dataset.mergeId === issueId &&
          candidate.dataset.mergeWorkspace === workspacePath
      );
      if (
        !beginClientAction(
          `merge-parallel:${workspacePath}:${issueId}`,
          matchingButtons,
          "Merging…",
          3000
        )
      ) {
        return;
      }
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
    if (dynamicallyBoundElements.has(button)) {
      continue;
    }
    dynamicallyBoundElements.add(button);
    button.addEventListener("click", () => {
      const key = (button.dataset.sortKey as SortKey | undefined) || "updated";
      sortState = sortState.key === key ? { key, desc: !sortState.desc } : { key, desc: true };
      applySort();
    });
  }
  for (const row of Array.from(document.querySelectorAll<BeadRow>("tbody tr.beadRow"))) {
    if (dynamicallyBoundElements.has(row)) {
      continue;
    }
    dynamicallyBoundElements.add(row);
    const toggleButton = row.querySelector<HTMLButtonElement>(".collapseToggle");
    const detailsButton = row.querySelector<HTMLButtonElement>(".beadDetailsButton");

    toggleButton?.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleRowCollapse(row);
    });
    detailsButton?.addEventListener("click", (event) => {
      event.stopPropagation();
      clearRowClickTimer();
      toggleRowDetails(row);
    });
    row.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("button")) {
        return;
      }
      clearRowClickTimer();
      const clickDelayMs = isCollapsibleRow(row) ? 260 : 160;
      rowClickTimer = window.setTimeout(() => {
        rowClickTimer = null;
        toggleRowDetails(row);
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
      toggleRowDetails(row);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key !== "F10" || !event.shiftKey) {
        return;
      }
      event.preventDefault();
      const rect = row.getBoundingClientRect();
      openContextMenu(
        row,
        row.dataset.workspacePath || "",
        rect.left + Math.min(24, rect.width / 2),
        rect.top + Math.min(24, rect.height / 2),
        true
      );
    });
  }
}
bindDynamicContent();

const restoredPlanDraftText = vscode.getState()?.planDraftText;
if (typeof restoredPlanDraftText === "string") {
  planDraftText.value = restoredPlanDraftText;
  planDraftController.setText(restoredPlanDraftText);
}
const restoredPlanGoalText = vscode.getState()?.planGoalText;
if (typeof restoredPlanGoalText === "string") {
  planGoalText.value = restoredPlanGoalText;
}
const restoredPlanWorkspacePath = vscode.getState()?.planWorkspacePath;
if (
  typeof restoredPlanWorkspacePath === "string" &&
  Array.from(planDraftWorkspace.options).some(
    (option) => option.value === restoredPlanWorkspacePath
  )
) {
  planDraftWorkspace.value = restoredPlanWorkspacePath;
}
const restoredParallelExecutionResult = vscode.getState()?.parallelExecutionResult;
renderParallelExecutionResult(
  isBeadsHostMessage(restoredParallelExecutionResult) &&
    restoredParallelExecutionResult.command === "parallelExecutionResult"
    ? restoredParallelExecutionResult
    : undefined
);

for (const row of getVisibleBeadRows()) {
  updateCollapseButton(row);
}
renderFilterChips();
restoreSelectedIssue(normalizeSelectedIssue(initialWebviewState?.selectedIssue));
applySort();
applyFilters();
applyViewMode(activeViewMode);
const restoredWindowScrollY = initialWebviewState?.windowScrollY;
if (
  typeof restoredWindowScrollY === "number" &&
  Number.isFinite(restoredWindowScrollY) &&
  restoredWindowScrollY > 0
) {
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: restoredWindowScrollY });
  });
}
