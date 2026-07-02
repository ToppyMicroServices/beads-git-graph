import * as vscode from "vscode";

import { anonymizeAgentIdentity, buildAgentAliasMap } from "./agentDisplay";
import {
  type BeadHierarchyItem,
  type BeadItem,
  beadShortDate,
  beadStatusLabel,
  buildBeadDependencyGraph,
  normalizeBeadPriority,
  normalizeBeadStatus,
  normalizeBeadType
} from "./beadsData";
import { beadUpdatedTimestamp, flattenBeadHierarchy } from "./beadsHierarchy";
import { type BeadLoadResult } from "./beadsViewTypes";
import { escapeHtml, getNonce } from "./utils";

const BEADS_WEBVIEW_SCRIPT = "beadsWebview.min.js";
const GRAPH_NODE_WIDTH = 280;
const GRAPH_NODE_HEIGHT_ESTIMATE = 150;
const GRAPH_LEVEL_GAP = 96;
const GRAPH_LANE_GAP = 54;
const GRAPH_PADDING_X = 44;
const GRAPH_PADDING_Y = 56;

function getRawAssigneeLabel(item: BeadItem) {
  return item.assignee.trim() !== "" && item.assignee !== "-" ? item.assignee.trim() : "";
}

function getRawAgentLabel(item: BeadItem, normalizedStatus: string) {
  if (item.agent.trim() !== "") {
    return item.agent.trim();
  }

  return normalizedStatus === "in_progress" ? getRawAssigneeLabel(item) : "";
}

function getRawModelLabel(item: BeadItem, normalizedStatus: string) {
  return item.model.trim() !== "" ? item.model.trim() : getRawAgentLabel(item, normalizedStatus);
}

function getDisplayLabel(value: string, agentAliases: ReadonlyMap<string, string>) {
  return anonymizeAgentIdentity(value, agentAliases);
}

function isDerivedMergeTask(item: BeadItem) {
  return item.synthetic && item.syntheticKind === "parallel-pr-merge";
}

function encodeJsonData(value: unknown) {
  return escapeHtml(encodeURIComponent(JSON.stringify(value)));
}

function getWorktreeLabel(item: BeadItem) {
  if (item.worktree.trim() === "") {
    return "";
  }

  return (
    item.worktree
      .split(/[\\/]/)
      .filter((part) => part !== "")
      .pop() ?? item.worktree
  );
}

function getPullRequestLabel(item: BeadItem) {
  const value = item.pullRequest.trim();
  if (value === "") {
    return "";
  }

  return value.startsWith("#") ? value : `#${value}`;
}

function hasPassedChecks(item: BeadItem) {
  return ["passed", "success", "successful", "green", "ready"].includes(
    item.checkStatus.trim().toLowerCase()
  );
}

function hasBlockingSyncRisk(item: BeadItem) {
  return ["blocked", "dirty", "detached", "high", "stale"].includes(
    item.syncRisk.trim().toLowerCase()
  );
}

function getExecutionStateLabel(item: BeadItem, normalizedStatus: string, derivedMerge: boolean) {
  if (derivedMerge) {
    return normalizedStatus === "open" ? "Merge ready" : "Waiting PRs";
  }
  if (hasBlockingSyncRisk(item)) {
    return "Sync risk";
  }
  if (item.pullRequest.trim() !== "" && hasPassedChecks(item)) {
    return "Checks passed";
  }
  if (item.pullRequest.trim() !== "") {
    return "PR open";
  }
  if (normalizedStatus === "in_progress") {
    return "Running";
  }
  if (normalizedStatus === "closed") {
    return "Done";
  }
  if (item.worktree.trim() !== "" || item.model.trim() !== "" || item.agent.trim() !== "") {
    return "Assigned";
  }
  if (item.parallelizableSource === "ready") {
    return "Ready";
  }
  return "";
}

function hasNoDependencyIntent(item: BeadItem) {
  return item.labels
    .split(/[, ]+/)
    .map((label) => label.trim().toLowerCase())
    .some((label) => ["no-deps", "no-dependencies", "independent"].includes(label));
}

function buildDependencyLintWarnings(items: BeadItem[]) {
  const siblingCounts = new Map<string, number>();
  for (const item of items) {
    const parentId = item.parentId.trim();
    if (parentId !== "") {
      siblingCounts.set(parentId, (siblingCounts.get(parentId) ?? 0) + 1);
    }
  }

  const warnings = new Map<string, string>();
  for (const item of items) {
    const status = normalizeBeadStatus(item.status);
    if (
      item.synthetic ||
      status === "closed" ||
      normalizeBeadType(item.type) === "epic" ||
      item.dependencyIds.length > 0 ||
      hasNoDependencyIntent(item)
    ) {
      continue;
    }

    if (item.parallelizableSource === "ready") {
      warnings.set(item.id, "Ready with no blocked-by dependency.");
      continue;
    }

    const parentId = item.parentId.trim();
    if (
      parentId !== "" &&
      (siblingCounts.get(parentId) ?? 0) > 1 &&
      (status === "open" || status === "in_progress")
    ) {
      warnings.set(item.id, "Sibling task has no dependency edge.");
    }
  }

  return warnings;
}

function isLowMergeRisk(value: string) {
  return ["", "low", "ok", "ready", "clean", "synced"].includes(value.trim().toLowerCase());
}

function hasReadyCheckStatus(value: string) {
  return ["", "passed", "success", "successful", "green", "ready", "skipped"].includes(
    value.trim().toLowerCase()
  );
}

function buildMergeRiskWarnings(items: BeadItem[]) {
  const warnings = new Map<string, string>();
  for (const item of items) {
    if (item.synthetic && item.syntheticKind !== "parallel-pr-merge") {
      continue;
    }

    const reasons = [];
    const syncRisk = item.syncRisk.trim();
    const checkStatus = item.checkStatus.trim();
    const status = normalizeBeadStatus(item.status);
    if (syncRisk !== "" && !isLowMergeRisk(syncRisk)) {
      reasons.push(`sync risk: ${syncRisk}`);
    }
    if (checkStatus !== "" && !hasReadyCheckStatus(checkStatus)) {
      reasons.push(`checks: ${checkStatus}`);
    }
    if (
      item.parallelizable &&
      !item.synthetic &&
      (status === "open" || status === "in_progress") &&
      item.worktree.trim() === ""
    ) {
      reasons.push("missing worktree");
    }
    if (item.syntheticKind === "parallel-pr-merge" && item.dependencyIds.length > 0) {
      reasons.push(`merge gate for ${item.dependencyIds.length} task(s)`);
    }

    if (reasons.length > 0) {
      warnings.set(item.id, reasons.join("; "));
    }
  }

  return warnings;
}

function renderBeadsDependencyGraph(
  hierarchyItems: BeadHierarchyItem[],
  workspacePath: string,
  agentAliases: ReadonlyMap<string, string>
) {
  const items = hierarchyItems.map((entry) => entry.item);
  const graph = buildBeadDependencyGraph(items);
  const dependencyWarnings = buildDependencyLintWarnings(items);
  const mergeRiskWarnings = buildMergeRiskWarnings(items);
  const maxLevel = Math.max(0, ...graph.nodes.map((node) => node.level));
  const nodesByLevel = new Map<number, typeof graph.nodes>();
  const blockersById = new Map<string, string[]>();
  const blocksById = new Map<string, string[]>();
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const hierarchyById = new Map(hierarchyItems.map((entry) => [entry.item.id, entry]));

  for (const edge of graph.edges) {
    blockersById.set(edge.toId, [...(blockersById.get(edge.toId) ?? []), edge.fromId]);
    blocksById.set(edge.fromId, [...(blocksById.get(edge.fromId) ?? []), edge.toId]);
  }
  for (const node of graph.nodes) {
    const nodes = nodesByLevel.get(node.level) ?? [];
    nodes.push(node);
    nodesByLevel.set(node.level, nodes);
  }

  const edgeHtml = graph.edges
    .map(
      (edge) =>
        `<span class="graphEdge" data-from-id="${escapeHtml(edge.fromId)}" data-to-id="${escapeHtml(edge.toId)}" data-critical="${edge.critical ? "1" : "0"}"></span>`
    )
    .join("");
  const laneCount = Math.max(1, ...Array.from(nodesByLevel.values()).map((nodes) => nodes.length));
  const levelCount = maxLevel + 1;
  const graphWidth =
    GRAPH_PADDING_X * 2 +
    levelCount * GRAPH_NODE_WIDTH +
    Math.max(0, levelCount - 1) * GRAPH_LEVEL_GAP;
  const graphHeight =
    GRAPH_PADDING_Y * 2 +
    laneCount * GRAPH_NODE_HEIGHT_ESTIMATE +
    Math.max(0, laneCount - 1) * GRAPH_LANE_GAP;
  const levelGuideHtml = Array.from({ length: levelCount }, (_, level) => {
    const x = GRAPH_PADDING_X + level * (GRAPH_NODE_WIDTH + GRAPH_LEVEL_GAP) + GRAPH_NODE_WIDTH / 2;
    const label = level === 0 ? "Ready" : `L${level + 1}`;
    const detail = level === 0 ? "No blockers" : "After deps";

    return `<span class="graphLevelGuide" style="--graph-guide-x:${x}px"><span class="graphLevelLabel"><strong>${label}</strong><small>${detail}</small></span></span>`;
  }).join("");
  const nodeHtml = Array.from({ length: levelCount }, (_, level) => {
    const nodes = nodesByLevel.get(level) ?? [];
    const laneOffset =
      ((laneCount - nodes.length) * (GRAPH_NODE_HEIGHT_ESTIMATE + GRAPH_LANE_GAP)) / 2;

    return nodes
      .map((node, lane) => {
        const item = node.item;
        const x = GRAPH_PADDING_X + level * (GRAPH_NODE_WIDTH + GRAPH_LEVEL_GAP);
        const y =
          GRAPH_PADDING_Y + laneOffset + lane * (GRAPH_NODE_HEIGHT_ESTIMATE + GRAPH_LANE_GAP);
        const normalizedStatus = normalizeBeadStatus(item.status);
        const normalizedPriority = normalizeBeadPriority(item.priority);
        const normalizedType = normalizeBeadType(item.type);
        const rawAgentLabel = getRawAgentLabel(item, normalizedStatus);
        const rawModelLabel = getRawModelLabel(item, normalizedStatus);
        const ownerLabel = getDisplayLabel(rawAgentLabel, agentAliases);
        const modelLabel = getDisplayLabel(rawModelLabel, agentAliases);
        const worktreeLabel = getWorktreeLabel(item);
        const pullRequestLabel = getPullRequestLabel(item);
        const ssotLabel = item.ssot.trim();
        const branchLabel = item.branch.trim();
        const checkStatusLabel = item.checkStatus.trim();
        const syncRiskLabel = item.syncRisk.trim();
        const derivedMerge = isDerivedMergeTask(item);
        const executionStateLabel = getExecutionStateLabel(item, normalizedStatus, derivedMerge);
        const dependencyWarning = dependencyWarnings.get(item.id) ?? "";
        const mergeRiskWarning = mergeRiskWarnings.get(item.id) ?? "";
        const blockers = (blockersById.get(item.id) ?? []).sort((a, b) => a.localeCompare(b));
        const blocks = (blocksById.get(item.id) ?? []).sort((a, b) => a.localeCompare(b));
        const hierarchyEntry = hierarchyById.get(item.id);
        const parentId = hierarchyEntry?.parentId ?? item.parentId.trim();
        const epicId = hierarchyEntry?.epicId ?? "";
        const depth = hierarchyEntry?.depth ?? 0;
        const dependencyLines = [
          parentId !== "" && itemsById.has(parentId)
            ? `<div class="graphRelation graphParentRelation"><span>Parent</span>${escapeHtml(parentId)}</div>`
            : "",
          blockers.length > 0
            ? `<div class="graphRelation"><span>Depends</span>${escapeHtml(blockers.join(", "))}</div>`
            : "",
          blocks.length > 0
            ? `<div class="graphRelation"><span>Blocks</span>${escapeHtml(blocks.join(", "))}</div>`
            : ""
        ]
          .filter((line) => line !== "")
          .join("");
        const assignDisabled = normalizedStatus === "closed" ? " disabled" : "";
        const assignTitle =
          normalizedStatus === "closed"
            ? "Closed beads cannot be started."
            : "Assign the default AI model, attach SSOT/context, and mark this bead in progress.";
        const actionHtml = derivedMerge
          ? `<button class="mergeParallelPrs" type="button" data-merge-id="${escapeHtml(item.id)}" data-merge-workspace="${escapeHtml(workspacePath)}" data-merge-title="${escapeHtml(item.title)}" data-merge-dependencies="${escapeHtml(item.dependencyIds.join(","))}" title="Check agent worktrees, auto-merge their PRs, then sync Beads.">Merge PRs</button>`
          : `<button class="assignStartBead" type="button" data-assign-start-id="${escapeHtml(item.id)}" data-assign-start-workspace="${escapeHtml(workspacePath)}" data-assign-start-title="${escapeHtml(item.title)}" data-assign-start-agent="${escapeHtml(item.agent.trim())}" data-assign-start-model="${escapeHtml(item.model.trim())}" data-assign-start-ssot="${escapeHtml(ssotLabel)}" data-assign-start-worktree="${escapeHtml(item.worktree.trim())}" title="${escapeHtml(assignTitle)}"${assignDisabled}>Start AI</button>`;
        const graphBadges = [
          executionStateLabel === ""
            ? ""
            : `<span class="executionBadge stateBadge">${escapeHtml(executionStateLabel)}</span>`,
          derivedMerge ? `<span class="executionBadge mergeBadge">Merge PR</span>` : "",
          ownerLabel === ""
            ? ""
            : `<span class="executionBadge ownerBadge">Owner ${escapeHtml(ownerLabel)}</span>`,
          modelLabel === ""
            ? ""
            : `<span class="executionBadge modelBadge">Model ${escapeHtml(modelLabel)}</span>`,
          worktreeLabel === ""
            ? ""
            : `<span class="executionBadge worktreeBadge">WT ${escapeHtml(worktreeLabel)}</span>`,
          branchLabel === ""
            ? ""
            : `<span class="executionBadge branchBadge">BR ${escapeHtml(branchLabel)}</span>`,
          pullRequestLabel === ""
            ? ""
            : `<span class="executionBadge prBadge">PR ${escapeHtml(pullRequestLabel)}</span>`,
          checkStatusLabel === ""
            ? ""
            : `<span class="executionBadge checkBadge">Checks ${escapeHtml(checkStatusLabel)}</span>`,
          syncRiskLabel === ""
            ? ""
            : `<span class="executionBadge syncRiskBadge" title="Merge/sync risk">${escapeHtml(syncRiskLabel)}</span>`,
          ssotLabel === "" ? "" : `<span class="executionBadge ssotBadge">SSOT</span>`,
          dependencyWarning === ""
            ? ""
            : `<span class="executionBadge dependencyWarningBadge" title="${escapeHtml(dependencyWarning)}">Dep warn</span>`,
          mergeRiskWarning === ""
            ? ""
            : `<span class="executionBadge mergeRiskWarningBadge" title="${escapeHtml(mergeRiskWarning)}">Risk</span>`
        ]
          .filter((badge) => badge !== "")
          .join("");
        return `<div class="graphNode ${node.critical ? "criticalGraphNode" : ""}${dependencyWarning === "" ? "" : " dependencyWarningGraphNode"}${mergeRiskWarning === "" ? "" : " mergeRiskGraphNode"}" data-graph-id="${escapeHtml(item.id)}" data-graph-level="${level}" data-graph-lane="${lane}" data-status="${escapeHtml(normalizedStatus)}" data-critical="${node.critical ? "1" : "0"}" data-parent-id="${escapeHtml(parentId)}" data-epic-id="${escapeHtml(epicId ?? "")}" data-depth="${depth}" style="--graph-x:${x}px;--graph-y:${y}px"><div class="graphNodeTop"><span class="typeBadge type-${escapeHtml(normalizedType)}">${escapeHtml(item.type)}</span>${node.critical ? '<span class="criticalBadge">Critical path</span>' : ""}</div><div class="beadId">${escapeHtml(item.id)}</div><div class="graphNodeTitle">${escapeHtml(item.title)}</div><div class="graphNodeBadges"><span class="statusBadge status-${escapeHtml(normalizedStatus.replace(/_/g, "-"))}">${escapeHtml(beadStatusLabel(normalizedStatus))}</span><span class="priorityBadge priority-${escapeHtml(normalizedPriority.toLowerCase())}">${escapeHtml(normalizedPriority)}</span>${graphBadges}</div>${dependencyWarning === "" ? "" : `<div class="graphWarning">${escapeHtml(dependencyWarning)}</div>`}${mergeRiskWarning === "" ? "" : `<div class="graphWarning graphMergeRisk">${escapeHtml(mergeRiskWarning)}</div>`}${dependencyLines === "" ? "" : `<div class="graphRelations">${dependencyLines}</div>`}<div class="graphNodeActions">${actionHtml}</div></div>`;
      })
      .join("");
  }).join("");
  const dependencyWarningSummary =
    dependencyWarnings.size > 0
      ? `<span class="summaryPill dependencyWarningSummary">${dependencyWarnings.size} warnings</span>`
      : "";
  const dependencyWarningHtml =
    dependencyWarnings.size > 0
      ? `<details class="graphIssueDrawer dependencyIssueDrawer"><summary><span>Dependency warnings</span><strong>${dependencyWarnings.size}</strong></summary><div class="graphWarningBand">${Array.from(
          dependencyWarnings.entries()
        )
          .map(([id, message]) => `<span>${escapeHtml(id)}: ${escapeHtml(message)}</span>`)
          .join("")}</div></details>`
      : "";
  const mergeRiskSummary =
    mergeRiskWarnings.size > 0
      ? `<span class="summaryPill mergeRiskSummary">${mergeRiskWarnings.size} risk</span>`
      : "";
  const mergeRiskHtml =
    mergeRiskWarnings.size > 0
      ? `<details class="graphIssueDrawer mergeRiskIssueDrawer"><summary><span>Merge/worktree risk</span><strong>${mergeRiskWarnings.size}</strong></summary><div class="graphRiskBand">${Array.from(
          mergeRiskWarnings.entries()
        )
          .map(([id, message]) => `<span>${escapeHtml(id)}: ${escapeHtml(message)}</span>`)
          .join("")}</div></details>`
      : "";
  const criticalSummary =
    graph.criticalPathIds.length > 0
      ? `<span class="summaryPill criticalSummary" title="${escapeHtml(graph.criticalPathIds.join(" -> "))}">${graph.criticalPathIds.length} critical</span>`
      : "";
  const criticalPathHtml =
    graph.criticalPathIds.length > 0
      ? `<div class="graphPathStrip"><span>Critical Path</span><strong title="${escapeHtml(graph.criticalPathIds.join(" -> "))}">${escapeHtml(graph.criticalPathIds.join(" -> "))}</strong></div>`
      : `<div class="graphPathStrip emptyCriticalPath"><span>Critical Path</span><strong>No dependency path yet</strong></div>`;
  const graphLegendHtml =
    '<div class="graphLegend"><span class="dependencyLegend">Dependency</span><span class="criticalLegend">Critical path</span><span class="parentLegend">Parent</span><span class="riskLegend">Merge/worktree risk</span></div>';
  const graphControlsHtml =
    '<div class="graphControls" aria-label="Graph zoom controls"><button class="graphZoomButton" type="button" data-graph-zoom-action="out" title="Zoom out" aria-label="Zoom out">-</button><span class="graphZoomValue" data-graph-zoom-value>100%</span><button class="graphZoomButton" type="button" data-graph-zoom-action="in" title="Zoom in" aria-label="Zoom in">+</button><button class="graphZoomButton graphZoomReset" type="button" data-graph-zoom-action="reset" title="Reset zoom" aria-label="Reset zoom">1:1</button></div>';
  const graphIssuesHtml =
    dependencyWarningHtml === "" && mergeRiskHtml === ""
      ? ""
      : `<div class="graphIssueStack">${dependencyWarningHtml}${mergeRiskHtml}</div>`;

  return `<div class="graphPane" data-workspace-path="${escapeHtml(workspacePath)}"><div class="graphHeader"><div class="workspaceName">Execution Map</div><div class="workspaceSummary"><span class="summaryPill">${graph.edges.length} deps</span>${criticalSummary}${dependencyWarningSummary}${mergeRiskSummary}</div></div>${graphIssuesHtml}<div class="graphMapFrame"><div class="graphMapHeader"><div class="graphMapHeaderMain">${criticalPathHtml}${graphLegendHtml}</div>${graphControlsHtml}</div><div class="graphScroller"><div class="graphCanvas" data-graph-width="${graphWidth}" data-graph-height="${graphHeight}" style="width:${graphWidth}px;height:${graphHeight}px"><div class="graphContent" style="width:${graphWidth}px;height:${graphHeight}px;--graph-node-width:${GRAPH_NODE_WIDTH}px">${edgeHtml}<svg class="dependencyOverlay" aria-hidden="true"></svg>${levelGuideHtml}<div class="graphNodes">${nodeHtml}</div></div></div></div></div></div>`;
}

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
    const agentAliases = buildAgentAliasMap(
      rows.flatMap((group) =>
        group.items.flatMap((item) => [item.agent, item.assignee, item.model])
      )
    );
    const populatedHtml = rows
      .map((group) => {
        const flatItems = flattenBeadHierarchy(group.items);
        const childCountByParent = new Map<string, number>();
        let activeCount = 0;
        let blockedCount = 0;
        let parallelCount = 0;
        const models = new Set<string>();
        for (const entry of flatItems) {
          const status = normalizeBeadStatus(entry.item.status);
          if (status === "open" || status === "in_progress" || status === "blocked") {
            activeCount += 1;
          }
          if (status === "blocked") {
            blockedCount += 1;
          }
          if (entry.item.parallelizable) {
            parallelCount += 1;
          }
          const modelLabel = getDisplayLabel(getRawModelLabel(entry.item, status), agentAliases);
          if (modelLabel !== "") {
            models.add(modelLabel);
          }
          if (entry.parentId !== null) {
            childCountByParent.set(
              entry.parentId,
              (childCountByParent.get(entry.parentId) ?? 0) + 1
            );
          }
        }
        const workspaceTitle = showWorkspaceLabel ? group.workspace : "Beads";
        const parallelStartTargets = flatItems
          .map((entry) => entry.item)
          .filter((item) => {
            const status = normalizeBeadStatus(item.status);
            return item.parallelizable && !item.synthetic && status === "open";
          })
          .map((item) => ({
            issueId: item.id,
            title: item.title,
            model: item.model,
            ssot: item.ssot,
            worktree: item.worktree
          }));
        const parallelStartTargetIds = new Set(
          parallelStartTargets.map((target) => target.issueId)
        );
        const skippedParallelTargets = flatItems
          .map((entry) => entry.item)
          .filter((item) => {
            const status = normalizeBeadStatus(item.status);
            return (
              !parallelStartTargetIds.has(item.id) &&
              !item.synthetic &&
              (status === "open" || status === "in_progress" || status === "blocked")
            );
          })
          .map((item) => {
            const status = normalizeBeadStatus(item.status);
            const reason =
              status === "blocked"
                ? "blocked"
                : status === "in_progress"
                  ? "already in progress"
                  : item.parallelizable
                    ? "not open"
                    : "not marked parallel";
            return { issueId: item.id, title: item.title, reason };
          });
        const workspaceSummary = [
          `<span class="summaryPill">${flatItems.length} total</span>`,
          `<span class="summaryPill activeSummary">${activeCount} active</span>`,
          blockedCount > 0
            ? `<span class="summaryPill blockedSummary">${blockedCount} blocked</span>`
            : "",
          parallelCount > 0
            ? `<span class="summaryPill parallelSummary">${parallelCount} parallel</span>`
            : "",
          models.size > 0
            ? `<span class="summaryPill modelSummary">${models.size} models</span>`
            : ""
        ]
          .filter((pill) => pill !== "")
          .join("");
        const dependencyWarnings = buildDependencyLintWarnings(
          flatItems.map((entry) => entry.item)
        );
        const itemRows = flatItems
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
            const worktreeLabel = getWorktreeLabel(item);
            const pullRequestLabel = getPullRequestLabel(item);
            const rawAgentLabel = getRawAgentLabel(item, normalizedStatus);
            const rawModelLabel = getRawModelLabel(item, normalizedStatus);
            const rowAgentLabel = getDisplayLabel(rawAgentLabel, agentAliases);
            const rowModelLabel = getDisplayLabel(rawModelLabel, agentAliases);
            const rowAssigneeLabel = getDisplayLabel(getRawAssigneeLabel(item), agentAliases);
            const branchLabel = item.branch.trim();
            const checkStatusLabel = item.checkStatus.trim();
            const syncRiskLabel = item.syncRisk.trim();
            const executionStateLabel = getExecutionStateLabel(
              item,
              normalizedStatus,
              isDerivedMergeTask(item)
            );
            const dependencyWarning = dependencyWarnings.get(item.id) ?? "";
            const executionBadges = [
              executionStateLabel === ""
                ? ""
                : `<span class="executionBadge stateBadge">${escapeHtml(executionStateLabel)}</span>`,
              isDerivedMergeTask(item)
                ? `<span class="executionBadge mergeBadge">Merge PR</span>`
                : "",
              item.parallelizable
                ? `<span class="executionBadge parallelBadge" title="${escapeHtml(item.parallelizableSource === "ready" ? "Ready and unblocked; can run alongside other ready tasks." : "Marked as parallelizable.")}">${escapeHtml(item.parallelizableSource === "ready" ? "Parallel ready" : "Parallel OK")}</span>`
                : "",
              rowAgentLabel === ""
                ? ""
                : `<span class="executionBadge ownerBadge">Owner ${escapeHtml(rowAgentLabel)}</span>`,
              rowModelLabel === ""
                ? ""
                : `<span class="executionBadge modelBadge">Model ${escapeHtml(rowModelLabel)}</span>`,
              item.ssot.trim() === "" ? "" : `<span class="executionBadge ssotBadge">SSOT</span>`,
              worktreeLabel === ""
                ? ""
                : `<span class="executionBadge worktreeBadge">WT ${escapeHtml(worktreeLabel)}</span>`,
              branchLabel === ""
                ? ""
                : `<span class="executionBadge branchBadge">BR ${escapeHtml(branchLabel)}</span>`,
              pullRequestLabel === ""
                ? ""
                : `<span class="executionBadge prBadge">PR ${escapeHtml(pullRequestLabel)}</span>`,
              checkStatusLabel === ""
                ? ""
                : `<span class="executionBadge checkBadge">Checks ${escapeHtml(checkStatusLabel)}</span>`,
              syncRiskLabel === ""
                ? ""
                : `<span class="executionBadge syncRiskBadge" title="Merge/sync risk">${escapeHtml(syncRiskLabel)}</span>`,
              dependencyWarning === ""
                ? ""
                : `<span class="executionBadge dependencyWarningBadge" title="${escapeHtml(dependencyWarning)}">Dep warn</span>`
            ]
              .filter((badge) => badge !== "")
              .join("");
            const parallelTitle = item.parallelizable
              ? item.parallelizableSource === "ready"
                ? "Ready and unblocked; can run alongside other ready tasks."
                : "Marked as parallelizable."
              : "Not marked as parallelizable.";
            const parallelLabel =
              item.parallelizableSource === "ready" ? "Ready" : item.parallelizable ? "OK" : "";
            const parallelCell =
              parallelLabel === ""
                ? `<span class="parallelEmpty" title="${escapeHtml(parallelTitle)}">-</span>`
                : `<span class="parallelMarker ${escapeHtml(item.parallelizableSource === "ready" ? "readyParallelMarker" : "explicitParallelMarker")}" title="${escapeHtml(parallelTitle)}">${escapeHtml(parallelLabel)}</span>`;
            const serializedItem = {
              ...item,
              displayAgent: rowAgentLabel,
              displayAssignee: rowAssigneeLabel === "" ? "-" : rowAssigneeLabel,
              displayModel: rowModelLabel === "" ? "-" : rowModelLabel,
              parentId: parentId ?? "",
              epicId: epicId ?? ""
            };
            const treeWidth = depth > 0 ? depth * 18 : 0;
            const childCount = childCountByParent.get(item.id) ?? 0;
            const rowClasses = [
              "beadRow",
              childCount > 0 ? "hasChildren" : "",
              dependencyWarning === "" ? "" : "dependencyWarningRow",
              item.parallelizable ? "parallelRow" : "",
              item.parallelizableSource === "ready"
                ? "parallelReadyRow"
                : item.parallelizable
                  ? "parallelExplicitRow"
                  : ""
            ]
              .filter((className) => className !== "")
              .join(" ");
            const hierarchyToggle =
              childCount > 0
                ? `<button class="collapseToggle" type="button" aria-expanded="true" title="Toggle subprojects"><span class="collapseIcon" aria-hidden="true">▾</span></button>`
                : '<span class="collapseSpacer" aria-hidden="true"></span>';
            return `<tr class="${rowClasses}" data-id="${escapeHtml(item.id)}" data-workspace-path="${escapeHtml(group.workspacePath)}" data-parent-id="${escapeHtml(parentId ?? "")}" data-epic-id="${escapeHtml(epicId ?? "")}" data-bead-type="${escapeHtml(normalizedType)}" data-depth="${depth}" data-child-count="${childCount}" data-order-index="${orderIndex}" data-guide-columns="${guideColumns.map((value) => (value ? "1" : "0")).join("")}" data-last-sibling="${isLastSibling ? "1" : "0"}" data-status="${escapeHtml(normalizedStatus)}" data-parallelizable="${item.parallelizable ? "1" : "0"}" data-parallel-source="${escapeHtml(item.parallelizableSource)}" data-item="${escapeHtml(encodeURIComponent(JSON.stringify(serializedItem)))}" data-updated-ts="${updatedTs}" data-type-sort="${typeSortOrder}" data-priority-sort="${Number.isNaN(prioritySortOrder) ? 9 : prioritySortOrder}"><td><span class="typeBadge type-${escapeHtml(normalizedType)}">${escapeHtml(item.type)}</span></td><td class="parallelCell">${parallelCell}</td><td><div class="titleCell" style="--tree-width:${treeWidth}px">${hierarchyToggle}<div class="titleContent"><div class="beadId">${escapeHtml(item.id)}</div><div class="beadTitle">${escapeHtml(item.title)}</div>${executionBadges === "" ? "" : `<div class="beadMeta">${executionBadges}</div>`}</div></div></td><td><div class="statusCell"><span class="statusBadge status-${escapeHtml(normalizedStatus.replace(/_/g, "-"))}">${escapeHtml(statusLabel)}</span>${progressLabel === "" ? "" : `<span class="progressText">${escapeHtml(progressLabel)}</span>`}</div></td><td><span class="priorityBadge priority-${escapeHtml(normalizedPriority.toLowerCase())}">${escapeHtml(normalizedPriority)}</span></td><td class="updatedCell" title="${escapeHtml(item.updatedAt)}">${escapeHtml(shortUpdated)}</td></tr>`;
          })
          .join("");
        const graphHtml = renderBeadsDependencyGraph(flatItems, group.workspacePath, agentAliases);
        const parallelAction =
          parallelStartTargets.length > 0
            ? `<button class="startParallelBeads workspaceAction" type="button" data-start-parallel-workspace="${escapeHtml(group.workspacePath)}" data-start-parallel-items="${encodeJsonData(parallelStartTargets)}" data-start-parallel-skipped="${encodeJsonData(skippedParallelTargets)}" title="Assign and start all parallel-ready tasks with Copilot${skippedParallelTargets.length > 0 ? `; ${skippedParallelTargets.length} active task(s) skipped with reasons` : ""}">${parallelStartTargets.length} Start Parallel</button>`
            : "";

        return `<section data-workspace-path="${escapeHtml(group.workspacePath)}"><div class="workspaceHeader"><div class="workspaceName">${escapeHtml(workspaceTitle)}</div><div class="workspaceHeaderRight"><div class="workspaceSummary">${workspaceSummary}</div>${parallelAction}</div></div><div class="tableWrap"><svg class="hierarchyOverlay" aria-hidden="true"></svg><table><thead><tr><th><button class="sortToggle" data-sort-key="type" type="button" title="Sort by type">Type <span class="sortIcon" data-sort-key="type"> </span></button></th><th>Parallel</th><th>Title</th><th>Status</th><th><button class="sortToggle" data-sort-key="priority" type="button" title="Sort by priority">Priority <span class="sortIcon" data-sort-key="priority"> </span></button></th><th><button class="sortToggle" data-sort-key="updated" type="button" title="Sort by updated">Updated <span class="sortIcon" data-sort-key="updated">▼</span></button></th></tr></thead><tbody>${itemRows}</tbody></table></div>${graphHtml}</section>`;
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
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:6px;background:var(--vscode-editor-background);font-size:13px;}
.toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:8px;margin-bottom:6px;padding:6px;border:1px solid var(--vscode-panel-border);border-radius:8px;background:var(--vscode-sideBar-background,var(--vscode-editor-background));box-shadow:0 1px 4px rgba(0,0,0,.12);}
.toolbarMain{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;}
.toolbarActions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex:0 0 auto;}
.toolbarStatsRow{display:flex;justify-content:flex-end;margin:0 0 8px;}
.viewToggle{display:inline-flex;border:1px solid var(--vscode-panel-border);border-radius:6px;overflow:hidden;background:rgba(128,128,128,.08);}
.viewToggle button{height:24px;border:none;border-radius:0;background:transparent;color:var(--vscode-foreground);padding:0 9px;}
.viewToggle button.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground);font-weight:700;}
.preset{height:24px;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));border-radius:6px;padding:0 6px;font-size:11px;}
.chips{display:flex;gap:6px;flex-wrap:wrap;}
.chips:empty{display:none;}
.chip{display:inline-flex;align-items:center;gap:6px;min-height:20px;padding:2px 8px;border-radius:999px;font-size:11px;border:1px solid var(--vscode-panel-border);background:rgba(128,128,128,.12);}
.chip .remove{background:transparent;border:none;color:inherit;cursor:pointer;line-height:1;padding:0;font-size:12px;opacity:.8;}
.chip.status-open{border-left:3px solid #10b981;}
.chip.status-in_progress{border-left:3px solid #3b82f6;}
.chip.status-blocked{border-left:3px solid #ef4444;}
.chip.status-closed{border-left:3px solid #6b7280;}
.menu{position:relative;}
.menuPopup{display:none;position:absolute;top:30px;left:0;z-index:20;min-width:140px;background:var(--vscode-menu-background);border:1px solid var(--vscode-menu-border, var(--vscode-panel-border));box-shadow:0 4px 14px var(--vscode-widget-shadow);padding:6px;border-radius:8px;}
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
#clearFilters{display:none;}
.actionBtn{display:inline-flex;align-items:center;justify-content:center;height:24px;padding:0 10px;border-radius:6px;background:rgba(128,128,128,.1);border:1px solid rgba(128,128,128,.5);gap:6px;transition:border-color .18s ease, background-color .18s ease, box-shadow .18s ease;}
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
.workspaceHeader{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0 5px;min-width:0;}
.workspaceName{font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.workspaceHeaderRight{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap;min-width:0;}
.workspaceSummary{display:flex;justify-content:flex-end;gap:4px;flex-wrap:wrap;}
.workspaceAction{height:22px;padding:0 8px;border-radius:6px;border-color:rgba(34,197,94,.55);background:rgba(34,197,94,.16);color:var(--vscode-testing-iconPassed,#22c55e);font-weight:750;white-space:nowrap;}
.summaryPill{display:inline-flex;align-items:center;min-height:18px;padding:1px 6px;border:1px solid var(--vscode-panel-border);border-radius:999px;background:rgba(128,128,128,.1);color:var(--vscode-descriptionForeground);font-size:10px;font-weight:600;white-space:nowrap;}
.activeSummary{border-color:rgba(59,130,246,.4);color:var(--vscode-textLink-foreground,#3b82f6);}
.blockedSummary{border-color:rgba(239,68,68,.5);color:var(--vscode-errorForeground,#ef4444);}
.parallelSummary{border-color:rgba(34,197,94,.45);color:var(--vscode-testing-iconPassed,#22c55e);}
.modelSummary{border-color:rgba(234,179,8,.5);color:var(--vscode-charts-yellow,#d97706);}
section{margin-bottom:12px;}
.tableWrap{position:relative;border:1px solid var(--vscode-panel-border);border-radius:8px;overflow:hidden;background:var(--vscode-editor-background);}
body[data-view-mode="graph"] .tableWrap{display:none;}
body[data-view-mode="table"] .graphPane{display:none;}
.hierarchyOverlay{position:absolute;inset:0;z-index:0;width:100%;height:100%;pointer-events:none;overflow:visible;}
table{position:relative;z-index:1;width:100%;border-collapse:separate;border-spacing:0;font-size:13px;table-layout:fixed;}
th,td{text-align:left;border-bottom:1px solid var(--vscode-panel-border);padding:6px 5px;vertical-align:middle;font-size:13px;}
tbody tr:last-child td{border-bottom:none;}
th{position:sticky;top:0;z-index:2;font-weight:700;line-height:18px;padding:6px 5px;opacity:.95;background:var(--vscode-sideBar-background,var(--vscode-editor-background));box-shadow:0 1px 0 var(--vscode-panel-border);}
th:nth-child(1){width:52px;}th:nth-child(2){width:72px;}th:nth-child(4){width:78px;}th:nth-child(5){width:56px;}th:nth-child(6){width:84px;}
.sortToggle{display:inline-flex;align-items:center;justify-content:flex-start;width:100%;gap:4px;background:transparent;border:none;color:inherit;padding:0;cursor:pointer;font:inherit;}
.sortToggle:hover{text-decoration:underline;}
.beadRow{cursor:pointer;transition:background-color .12s ease;}
.beadRow:hover{background:rgba(128,128,128,.08);}
.beadRow.selected{background:rgba(59,130,246,.16);}
.beadRow.selected td:first-child{box-shadow:inset 3px 0 0 var(--vscode-textLink-foreground,#3b82f6);}
.beadRow.parallelReadyRow td{background:linear-gradient(90deg, rgba(34,197,94,.1), transparent 190px);}
.beadRow.dependencyWarningRow td{background:linear-gradient(90deg, rgba(245,158,11,.13), transparent 210px);}
.parallelCell{text-align:center;}
.parallelMarker{display:inline-flex;align-items:center;justify-content:center;min-width:42px;min-height:19px;padding:1px 6px;border-radius:999px;border:1px solid rgba(34,197,94,.62);font-size:10px;font-weight:750;line-height:15px;color:var(--vscode-testing-iconPassed, #22c55e);background:rgba(34,197,94,.16);white-space:nowrap;}
.explicitParallelMarker{border-color:rgba(59,130,246,.62);color:var(--vscode-textLink-foreground, #3b82f6);background:rgba(59,130,246,.14);}
.parallelEmpty{display:inline-flex;align-items:center;justify-content:center;min-width:42px;color:var(--vscode-descriptionForeground);opacity:.45;font-size:11px;}
.beadId{font-size:10px;color:var(--vscode-descriptionForeground);margin-bottom:2px;}
.titleCell{position:relative;display:flex;align-items:flex-start;gap:6px;min-width:0;padding-left:calc(var(--tree-width, 0px) + 4px);}
.titleContent{min-width:0;flex:1 1 auto;}
.collapseToggle{display:inline-flex;align-items:center;justify-content:center;flex:0 0 18px;width:18px;height:18px;margin-top:1px;padding:0;border-radius:5px;border:1px solid transparent;background:transparent;color:var(--vscode-descriptionForeground);}
.collapseToggle:hover{border-color:var(--vscode-panel-border);background:rgba(128,128,128,.12);}
.collapseToggle[aria-expanded="false"] .collapseIcon{transform:rotate(-90deg);}
.collapseIcon{display:block;line-height:1;transition:transform .12s ease;}
.collapseSpacer{flex:0 0 18px;width:18px;height:18px;}
.hierarchyGuideShadow{fill:none;stroke:rgba(0,0,0,.18);stroke-width:3.8;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;opacity:.45;}
.hierarchyGuideLine{fill:none;stroke:var(--vscode-textLink-foreground, #4da3ff);stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;opacity:1;}
.hierarchyGuideVertical{stroke-linecap:butt;}
.hierarchyGuideNodeShadow{fill:rgba(0,0,0,.22);vector-effect:non-scaling-stroke;opacity:.4;}
.hierarchyGuideNode{fill:var(--vscode-textLink-foreground, #4da3ff);vector-effect:non-scaling-stroke;opacity:1;}
.beadTitle{font-size:13px;font-weight:650;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.beadMeta{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:4px;}
.executionBadge{display:inline-flex;align-items:center;max-width:100%;padding:1px 6px;border-radius:6px;border:1px solid rgba(128,128,128,.42);font-size:10px;font-weight:650;line-height:15px;color:var(--vscode-descriptionForeground);background:rgba(128,128,128,.1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.stateBadge{border-color:rgba(20,184,166,.55);color:var(--vscode-charts-cyan,#14b8a6);background:rgba(20,184,166,.13);}
.ownerBadge{border-color:rgba(14,165,233,.55);color:var(--vscode-textLink-foreground,#0ea5e9);background:rgba(14,165,233,.12);}
.parallelBadge{border-color:rgba(34,197,94,.65);color:var(--vscode-testing-iconPassed, #22c55e);background:rgba(34,197,94,.16);}
.mergeBadge{border-color:rgba(249,115,22,.55);color:var(--vscode-charts-orange, #f97316);background:rgba(249,115,22,.14);}
.modelBadge{border-color:rgba(59,130,246,.55);color:var(--vscode-textLink-foreground, #3b82f6);background:rgba(59,130,246,.12);}
.ssotBadge{border-color:rgba(168,85,247,.5);color:var(--vscode-charts-purple,#a855f7);background:rgba(168,85,247,.12);}
.worktreeBadge{border-color:rgba(234,179,8,.55);color:var(--vscode-charts-yellow, #d97706);background:rgba(234,179,8,.12);}
.branchBadge{border-color:rgba(20,184,166,.5);color:var(--vscode-charts-cyan,#14b8a6);background:rgba(20,184,166,.12);}
.prBadge{border-color:rgba(249,115,22,.55);color:var(--vscode-charts-orange,#f97316);background:rgba(249,115,22,.13);}
.checkBadge{border-color:rgba(34,197,94,.55);color:var(--vscode-testing-iconPassed,#22c55e);background:rgba(34,197,94,.13);}
.syncRiskBadge{border-color:rgba(239,68,68,.55);color:var(--vscode-errorForeground,#ef4444);background:rgba(239,68,68,.13);}
.dependencyWarningBadge{border-color:rgba(245,158,11,.62);color:var(--vscode-editorWarning-foreground,#f59e0b);background:rgba(245,158,11,.15);}
.statusCell{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.typeBadge,.statusBadge,.priorityBadge{display:inline-flex;align-items:center;justify-content:center;padding:1px 6px;border-radius:6px;font-size:10px;font-weight:650;white-space:nowrap;}
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
.details{margin:0;padding:10px;border:1px solid var(--vscode-panel-border);font-size:12px;background:var(--vscode-sideBar-background,var(--vscode-editor-background));border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.1);}
.detailsHeader{display:grid;gap:4px;margin-bottom:8px;}
.detailsTitle{font-size:13px;font-weight:700;line-height:1.3;}
.detailsId{color:var(--vscode-descriptionForeground);font-size:11px;}
.detailsPills{display:flex;flex-wrap:wrap;gap:4px;}
.detailPill{display:inline-flex;align-items:center;min-height:18px;padding:1px 6px;border-radius:6px;border:1px solid var(--vscode-panel-border);background:rgba(128,128,128,.1);font-size:10px;font-weight:650;color:var(--vscode-descriptionForeground);}
.detailsGrid{display:grid;grid-template-columns:minmax(80px,110px) minmax(0,1fr);gap:5px 10px;}
.detailsGrid .key{opacity:.78;font-size:11px;}
.detailsGrid div:nth-child(2n){min-width:0;overflow-wrap:anywhere;}
.detailsDescription{margin-top:8px;padding-top:8px;border-top:1px solid var(--vscode-panel-border);white-space:pre-wrap;line-height:1.45;}
.graphPane{position:relative;display:flex;flex-direction:column;height:clamp(360px,calc(100vh - 132px),900px);border:1px solid var(--vscode-panel-border);border-radius:8px;background:var(--vscode-editor-background);overflow:hidden;padding:0;}
.graphHeader{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0;position:sticky;top:0;left:0;z-index:5;background:var(--vscode-editor-background);padding:10px 12px 8px;border-bottom:1px solid var(--vscode-panel-border);}
.criticalSummary{border-color:rgba(236,72,153,.5);color:var(--vscode-charts-pink,#ec4899);}
.dependencyWarningSummary{border-color:rgba(245,158,11,.55);color:var(--vscode-editorWarning-foreground,#f59e0b);}
.mergeRiskSummary{border-color:rgba(239,68,68,.55);color:var(--vscode-errorForeground,#ef4444);}
.graphIssueStack{display:grid;gap:6px;padding:8px 12px 0;}
.graphIssueDrawer{border:1px solid var(--vscode-panel-border);border-radius:8px;background:var(--vscode-sideBar-background,var(--vscode-editor-background));}
.graphIssueDrawer summary{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:28px;padding:4px 8px;cursor:pointer;list-style:none;font-size:11px;font-weight:750;color:var(--vscode-descriptionForeground);}
.graphIssueDrawer summary::-webkit-details-marker{display:none;}
.graphIssueDrawer summary::before{content:"";width:0;height:0;border-top:4px solid transparent;border-bottom:4px solid transparent;border-left:5px solid currentColor;opacity:.8;}
.graphIssueDrawer[open] summary::before{transform:rotate(90deg);}
.graphIssueDrawer summary span{margin-right:auto;}
.graphIssueDrawer summary strong{display:inline-flex;align-items:center;min-height:18px;padding:1px 7px;border-radius:999px;border:1px solid currentColor;font-size:10px;}
.dependencyIssueDrawer summary{color:var(--vscode-editorWarning-foreground,#f59e0b);}
.mergeRiskIssueDrawer summary{color:var(--vscode-errorForeground,#ef4444);}
.graphMapFrame{display:flex;flex:1 1 auto;flex-direction:column;min-height:0;margin:10px 12px 12px;border:1px solid var(--vscode-panel-border);border-radius:8px;background:var(--vscode-sideBar-background,var(--vscode-editor-background));overflow:hidden;}
.graphMapHeader{display:grid;grid-template-columns:minmax(280px,1fr) auto;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--vscode-panel-border);background:rgba(128,128,128,.06);}
.graphMapHeaderMain{display:grid;gap:6px;min-width:0;}
.graphPathStrip{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:8px;min-width:0;}
.graphPathStrip span{font-size:10px;font-weight:800;text-transform:uppercase;color:var(--vscode-charts-pink,#ec4899);letter-spacing:0;}
.graphPathStrip strong{font-size:11px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.emptyCriticalPath span,.emptyCriticalPath strong{color:var(--vscode-descriptionForeground);}
.graphLegend{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;margin:0;}
.graphLegend span{display:inline-flex;align-items:center;gap:5px;min-height:18px;padding:1px 7px;border-radius:999px;border:1px solid var(--vscode-panel-border);font-size:10px;font-weight:700;color:var(--vscode-descriptionForeground);background:rgba(128,128,128,.08);}
.graphLegend span::before{content:"";width:14px;height:0;border-top:2px solid currentColor;}
.dependencyLegend{color:rgba(148,163,184,.95)!important;}
.criticalLegend{color:var(--vscode-charts-pink,#ec4899)!important;}
.criticalLegend::before{border-top-width:3px!important;}
.parentLegend{color:var(--vscode-textLink-foreground,#3b82f6)!important;}
.parentLegend::before{border-top-style:dashed!important;}
.riskLegend{color:var(--vscode-errorForeground,#ef4444)!important;}
.graphControls{display:flex;align-items:center;gap:4px;white-space:nowrap;}
.graphZoomButton{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:24px;padding:0 7px;border-radius:6px;font-size:12px;font-weight:800;line-height:1;}
.graphZoomReset{font-size:10px;}
.graphZoomValue{min-width:42px;text-align:center;font-size:11px;font-weight:750;color:var(--vscode-descriptionForeground);}
.graphWarningBand{display:flex;flex-wrap:wrap;gap:4px;margin:0;padding:0 8px 8px;max-height:92px;overflow:auto;}
.graphWarningBand span{display:inline-flex;align-items:center;min-height:18px;padding:1px 6px;border-radius:6px;border:1px solid rgba(245,158,11,.5);background:rgba(245,158,11,.12);color:var(--vscode-editorWarning-foreground,#f59e0b);font-size:10px;font-weight:650;}
.graphRiskBand{display:flex;flex-wrap:wrap;gap:4px;margin:0;padding:0 8px 8px;max-height:92px;overflow:auto;}
.graphRiskBand span{display:inline-flex;align-items:center;min-height:18px;padding:1px 6px;border-radius:6px;border:1px solid rgba(239,68,68,.5);background:rgba(239,68,68,.12);color:var(--vscode-errorForeground,#ef4444);font-size:10px;font-weight:650;}
.graphScroller{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;background:var(--vscode-editor-background);}
.graphCanvas{position:relative;min-width:100%;min-height:620px;background-color:var(--vscode-editor-background);background-image:linear-gradient(rgba(128,128,128,.1) 1px, transparent 1px),linear-gradient(90deg, rgba(128,128,128,.1) 1px, transparent 1px);background-size:48px 48px;}
.graphContent{position:absolute;left:0;top:0;transform:scale(var(--graph-zoom,1));transform-origin:0 0;}
.dependencyOverlay{position:absolute;inset:0;z-index:1;width:100%;height:100%;pointer-events:none;overflow:visible;}
.dependencyPath{fill:none;stroke:rgba(148,163,184,.8);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;}
.dependencyPath.criticalDependencyPath{stroke:var(--vscode-charts-pink,#ec4899);stroke-width:2.8;}
.dependencyArrowHead{fill:rgba(148,163,184,.88);}
.criticalDependencyArrowHead{fill:var(--vscode-charts-pink,#ec4899);}
.graphLevelGuide{position:absolute;top:0;bottom:18px;left:var(--graph-guide-x);z-index:0;border-left:1px dashed rgba(128,128,128,.28);}
.graphLevelLabel{position:absolute;top:10px;left:8px;display:grid;gap:1px;min-width:82px;color:var(--vscode-descriptionForeground);letter-spacing:0;}
.graphLevelLabel strong{font-size:11px;font-weight:800;line-height:1.1;color:var(--vscode-foreground);}
.graphLevelLabel small{font-size:10px;font-weight:650;line-height:1.15;color:var(--vscode-descriptionForeground);}
.graphNodes{position:absolute;inset:0;z-index:2;}
.graphNode{position:absolute;left:var(--graph-x);top:var(--graph-y);width:var(--graph-node-width,280px);border:1px solid var(--vscode-panel-border);border-radius:8px;background:var(--vscode-sideBar-background,var(--vscode-editor-background));padding:8px;box-shadow:0 1px 3px rgba(0,0,0,.12);}
.graphNode.criticalGraphNode{border-color:rgba(236,72,153,.62);box-shadow:inset 3px 0 0 var(--vscode-charts-pink,#ec4899), 0 1px 3px rgba(0,0,0,.12);}
.graphNode.dependencyWarningGraphNode{border-color:rgba(245,158,11,.58);box-shadow:inset 3px 0 0 var(--vscode-editorWarning-foreground,#f59e0b), 0 1px 3px rgba(0,0,0,.12);}
.graphNode.mergeRiskGraphNode{border-color:rgba(239,68,68,.58);box-shadow:inset 3px 0 0 var(--vscode-errorForeground,#ef4444), 0 1px 3px rgba(0,0,0,.12);}
.graphNodeTop{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:5px;}
.criticalBadge{display:inline-flex;align-items:center;min-height:17px;padding:1px 6px;border-radius:999px;border:1px solid rgba(236,72,153,.55);background:rgba(236,72,153,.14);color:var(--vscode-charts-pink,#ec4899);font-size:10px;font-weight:750;white-space:nowrap;}
.graphNodeTitle{font-size:12px;font-weight:700;line-height:1.3;margin:2px 0 7px;overflow-wrap:anywhere;}
.graphNodeBadges{display:flex;align-items:center;gap:4px;flex-wrap:wrap;}
.graphWarning{margin-top:7px;padding:5px 6px;border-radius:6px;border:1px solid rgba(245,158,11,.5);background:rgba(245,158,11,.12);color:var(--vscode-editorWarning-foreground,#f59e0b);font-size:10px;font-weight:650;line-height:1.35;}
.graphMergeRisk{border-color:rgba(239,68,68,.5);background:rgba(239,68,68,.12);color:var(--vscode-errorForeground,#ef4444);}
.graphRelations{display:grid;gap:3px;margin-top:7px;padding-top:7px;border-top:1px solid var(--vscode-panel-border);}
.graphRelation{display:grid;grid-template-columns:54px minmax(0,1fr);gap:5px;font-size:10px;color:var(--vscode-descriptionForeground);line-height:1.35;}
.graphRelation span{font-weight:700;color:var(--vscode-foreground);}
.graphParentRelation{border-left:2px dashed var(--vscode-textLink-foreground,#3b82f6);padding-left:5px;}
.graphNodeActions{position:relative;z-index:3;display:flex;justify-content:flex-end;margin-top:8px;}
.assignStartBead,.mergeParallelPrs{height:24px;padding:0 8px;font-weight:650;}
.mergeParallelPrs{border-color:rgba(249,115,22,.55);background:rgba(249,115,22,.16);color:var(--vscode-charts-orange,#f97316);}
.assignStartBead:disabled{opacity:.45;cursor:default;}
@media (max-width:560px){
  .toolbar{grid-template-columns:1fr;gap:6px;}
  .toolbarActions{justify-content:stretch;}
  .toolbarActions .actionBtn{flex:1 1 0;min-width:0;}
  .workspaceHeader{align-items:flex-start;flex-direction:column;gap:4px;}
  .workspaceHeaderRight{justify-content:flex-start;}
  .workspaceSummary{justify-content:flex-start;}
  .hierarchyOverlay{display:none;}
  table,tbody{display:block;}
  thead{display:none;}
  .beadRow{display:grid;grid-template-columns:48px 56px minmax(0,1fr) 44px 74px;grid-template-areas:"type parallel title title title" "type parallel status priority updated";gap:4px 6px;padding:7px 6px;border-bottom:1px solid var(--vscode-panel-border);}
  .beadRow td{display:flex;align-items:center;min-width:0;border-bottom:none;padding:0;}
  .beadRow td:first-child{grid-area:type;align-items:flex-start;padding-top:2px;}
  .beadRow td:nth-child(2){grid-area:parallel;align-items:flex-start;padding-top:2px;}
  .beadRow td:nth-child(3){grid-area:title;}
  .beadRow td:nth-child(4){grid-area:status;}
  .beadRow td:nth-child(5){grid-area:priority;}
  .beadRow td:nth-child(6){grid-area:updated;justify-content:flex-end;}
  .titleCell{width:100%;padding-left:calc(var(--tree-width, 0px) * .65);}
  .beadTitle{white-space:normal;overflow:hidden;}
  .executionBadge{max-width:132px;}
  .statusCell{gap:4px;}
  .updatedCell{text-align:right;}
  .inlineDetailsRow{display:block;}
  .inlineDetailsRow td{display:block;padding:0 6px 8px;}
  .detailsGrid{grid-template-columns:82px minmax(0,1fr);}
  .graphPane{height:clamp(320px,calc(100vh - 118px),820px);padding:8px;}
  .graphHeader{position:relative;padding:8px;margin:-8px -8px 0;}
  .graphIssueStack{padding:8px 0 0;}
  .graphMapFrame{margin:8px 0 0;}
  .graphMapHeader{grid-template-columns:1fr;align-items:start;}
  .graphControls{justify-content:flex-start;}
  .graphLegend{justify-content:flex-start;}
  .graphCanvas{min-height:560px;}
}
code{font-family:var(--vscode-editor-font-family);}
</style>
</head>
<body data-bd-available="${result.bdExecutableStatus.available ? "1" : "0"}" data-has-sync-warnings="${result.warnings.length > 0 ? "1" : "0"}" data-view-mode="table">
<div class="toolbar">
  <div class="toolbarMain">
    <div class="viewToggle" role="group" aria-label="Beads view mode">
      <button id="tableView" class="active" type="button">Table</button>
      <button id="graphView" type="button">Graph</button>
    </div>
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
