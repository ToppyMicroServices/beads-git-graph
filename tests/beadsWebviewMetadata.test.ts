import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");
const beadsWebview = readFileSync(join(repoRoot, "src", "beadsWebview.ts"), "utf8");
const beadsView = readFileSync(join(repoRoot, "src", "beadsView.ts"), "utf8");
const agentStartGuard = readFileSync(join(repoRoot, "src", "agentStartGuard.ts"), "utf8");
const agentWorkPrompt = readFileSync(join(repoRoot, "src", "agentWorkPrompt.ts"), "utf8");
const beadsMain = readFileSync(join(repoRoot, "web", "beadsMain.ts"), "utf8");

describe("beads webview presentation metadata", () => {
  it("renders readable task summary and responsive task rows", () => {
    expect(beadsWebview).toContain("workspaceSummary");
    expect(beadsWebview).toContain("summaryPill");
    expect(beadsWebview).toContain("@media (max-width:560px)");
    expect(beadsWebview).toContain("grid-template-areas");
  });

  it("shows an agent work queue with explicit evidence limits", () => {
    expect(beadsWebview).toContain('id="controlView"');
    expect(beadsWebview).toContain("Agent Work Queue");
    expect(beadsWebview).toContain("Needs attention");
    expect(beadsWebview).toContain("Readiness unknown");
    expect(beadsWebview).toContain("does not confirm live agent activity");
    expect(beadsWebview).toContain("agentWorkOverview");
    expect(beadsWebview).toContain("agentWorkLane");
    expect(beadsWebview).toContain("agentWorkCard");
    expect(beadsWebview).toContain("buildAgentWorkQueue");
    expect(beadsMain).toContain('type ViewMode = "table" | "graph" | "control"');
    expect(beadsMain).toContain("controlViewButton");
    expect(beadsMain).toContain("refreshAgentWorkQueueVisibility");
    expect(beadsMain).toContain('applyViewMode("control")');
    expect(beadsMain).toContain("!bdAvailable || item === null");
    expect(beadsMain).toContain('syncBeadsButton.addEventListener("click"');
    expect(beadsMain).toContain("if (!bdAvailable)");
    expect(beadsMain).toContain("getDetailsReadinessLabel(item)");
    expect(beadsView).toContain('["ready", "--json", "--limit", "0"]');
  });

  it("keeps subproject collapse explicit and double-click driven", () => {
    expect(beadsWebview).toContain("data-child-count");
    expect(beadsWebview).toContain("collapseToggle");
    expect(beadsWebview).toContain("hierarchyGuideVertical");
    expect(beadsMain).toContain("rowHasCollapsedAncestor");
    expect(beadsMain).toContain("clearSelectedRow");
    expect(beadsMain).toContain("const clickDelayMs = isCollapsibleRow(row) ? 260 : 160");
    expect(beadsMain).toContain('row.addEventListener("dblclick"');
    expect(beadsMain).toContain("toggleRowCollapse(row)");
  });

  it("shows inferred parallel-ready task metadata", () => {
    expect(beadsWebview).toContain("<th>Parallel</th>");
    expect(beadsWebview).toContain("parallelCell");
    expect(beadsWebview).toContain("parallelReadyRow");
    expect(beadsWebview).toContain("data-parallel-source");
    expect(beadsWebview).toContain("readyParallelMarker");
    expect(beadsWebview).toContain("Parallel ready");
    expect(beadsWebview).toContain("parallelizableSource");
    expect(beadsMain).toContain("detailsCell.colSpan = 6");
    expect(beadsMain).toContain("Yes (ready)");
    expect(beadsMain).toContain("Parallel ready");
  });

  it("shows dependency graph controls and AI start actions", () => {
    expect(beadsWebview).toContain('id="graphView"');
    expect(beadsWebview).toContain("Execution Map");
    expect(beadsWebview).toContain("Critical Path");
    expect(beadsWebview).toContain("graphPathStrip");
    expect(beadsWebview).toContain("graphMapFrame");
    expect(beadsWebview).toContain("graphMapHeader");
    expect(beadsWebview).toContain("graphMapHeaderMain");
    expect(beadsWebview).toContain("No dependency path yet");
    expect(beadsWebview).toContain("graphIssueDrawer");
    expect(beadsWebview).toContain("graphIssueStack");
    expect(beadsWebview).toContain("graphControls");
    expect(beadsWebview).toContain('data-graph-action="out"');
    expect(beadsWebview).toContain('data-graph-action="fit"');
    expect(beadsWebview).toContain("graphGestureHint");
    expect(beadsWebview).toContain("graphScroller");
    expect(beadsWebview).toContain("graphContent");
    expect(beadsWebview).toContain("data-graph-width");
    expect(beadsWebview).toContain("data-graph-height");
    expect(beadsWebview).toContain("graphLegend");
    expect(beadsWebview).toContain("dependencyLegend");
    expect(beadsWebview).toContain("criticalLegend");
    expect(beadsWebview).toContain("parentLegend");
    expect(beadsWebview).toContain("riskLegend");
    expect(beadsWebview).toContain("dependencyOverlay");
    expect(beadsWebview).toContain("criticalGraphNode");
    expect(beadsWebview).toContain("Start AI");
    expect(beadsWebview).toContain("Start Parallel");
    expect(beadsWebview).toContain("data-start-parallel-items");
    expect(beadsWebview).toContain("item.readyByBd &&");
    expect(beadsWebview).toContain("!item.parallelizableSuppressed &&");
    expect(beadsWebview).toContain("data-assign-start-model");
    expect(beadsWebview).toContain("data-assign-start-ssot");
    expect(beadsWebview).toContain("data-assign-start-worktree");
    expect(beadsWebview).toContain("displayAgent");
    expect(beadsWebview).toContain("displayModel");
    expect(beadsWebview).toContain("displayAssignee");
    expect(beadsWebview).toContain("mergeBadge");
    expect(beadsWebview).toContain("stateBadge");
    expect(beadsWebview).toContain("ownerBadge");
    expect(beadsWebview).toContain("modelBadge");
    expect(beadsWebview).toContain("ssotBadge");
    expect(beadsWebview).toContain("dependencyWarningBadge");
    expect(beadsWebview).toContain("dependencyWarningSummary");
    expect(beadsWebview).toContain("mergeRiskWarningBadge");
    expect(beadsWebview).toContain("mergeRiskSummary");
    expect(beadsWebview).toContain("graphRiskBand");
    expect(beadsWebview).toContain("graphMergeRisk");
    expect(beadsWebview).toContain("graphParentRelation");
    expect(beadsWebview).toContain("buildMergeRiskWarnings");
    expect(beadsWebview).toContain("buildDependencyLintWarnings");
    expect(beadsWebview).toContain("isDefaultVisibleStatus");
    expect(beadsWebview).toContain('style="display:none"');
    expect(beadsWebview).toContain("initialDisplay");
    expect(beadsWebview).toContain("--graph-x");
    expect(beadsWebview).toContain("height:clamp(360px,calc(100vh - 132px),900px)");
    expect(beadsWebview).toContain(
      ".graphScroller{position:relative;flex:1 1 auto;min-height:0;overflow:hidden;"
    );
    expect(beadsWebview).not.toContain("scrollbar-gutter:stable");
    expect(beadsWebview).not.toContain("overscroll-behavior:contain");
    expect(beadsWebview).toContain(
      ".graphCanvas{position:relative;min-width:100%;min-height:100%;overflow:hidden;"
    );
    expect(beadsWebview).toContain("graphZoomSelection");
    expect(beadsWebview).toContain("cursor:crosshair");
    expect(beadsWebview).toContain("translate(var(--graph-pan-x,0px),var(--graph-pan-y,0px))");
    expect(beadsWebview).not.toContain("min-height:620px");
    expect(beadsWebview).not.toContain("min-height:560px");
    expect(beadsWebview).toContain("#clearFilters{display:none;}");
    expect(beadsMain).toContain("getGraphRequiredSize");
    expect(beadsMain).toContain("getGraphViewportSize");
    expect(beadsWebview).toContain("graphLevelGuide");
    expect(beadsWebview).toContain("graphLevelLabel");
    expect(beadsWebview).toContain("No blockers");
    expect(beadsWebview).toContain("After deps");
    expect(beadsWebview).toContain("graphNodes");
    expect(beadsWebview).toContain("data-graph-lane");
    expect(beadsWebview).toContain("data-epic-id");
    expect(beadsWebview).toContain("data-depth");
    expect(beadsWebview).toContain("--graph-x");
    expect(beadsWebview).toContain("dependencyArrowHead");
    expect(beadsWebview).toContain("const GRAPH_NODE_WIDTH = 252");
    expect(beadsWebview).toContain("const GRAPH_LEVEL_GAP = 56");
    expect(beadsWebview).toContain("const GRAPH_LEVEL_COLUMN_GAP = 24");
    expect(beadsWebview).toContain("const GRAPH_LANE_GAP = 30");
    expect(beadsWebview).toContain("const levelLayouts = Array.from");
    expect(beadsWebview).toContain("Math.ceil(Math.sqrt");
    expect(beadsWebview).toContain("stroke-width:2;");
    expect(beadsWebview).toContain("Sort by updated");
    expect(beadsWebview).not.toContain('data-sort-key="updated">▼');
    expect(beadsWebview).not.toContain("graphGrid");
    expect(beadsWebview).not.toContain("graphStage");
    expect(beadsMain).toContain('type SortKey = "order" | "updated" | "type" | "priority"');
    expect(beadsMain).toContain('key: "order", desc: false');
    expect(beadsMain).toContain('key === "order"');
    expect(beadsMain).toContain("getState(): BeadsWebviewState | undefined");
    expect(beadsMain).toContain("setState(state: BeadsWebviewState): void");
    expect(beadsMain).toContain("normalizeViewMode(vscode.getState()?.viewMode)");
    expect(beadsMain).toContain("normalizeGraphTransforms(vscode.getState())");
    expect(beadsMain).toContain("graphTransforms");
    expect(beadsMain).toContain("getGraphTransform");
    expect(beadsMain).toContain("saveGraphTransforms");
    expect(beadsMain).toContain("saveViewMode(mode)");
    expect(beadsMain).toContain("saveWebviewState");
    expect(beadsMain).toContain("saveGraphScroll");
    expect(beadsMain).toContain("setGraphZoom");
    expect(beadsMain).toContain("beginGraphSelection");
    expect(beadsMain).toContain("zoomGraphToSelection");
    expect(beadsMain).toContain("GRAPH_SELECTION_MIN_SIZE");
    expect(beadsMain).toContain("GRAPH_ZOOM_MIN");
    expect(beadsMain).toContain("const GRAPH_ZOOM_MIN = 0.05");
    expect(beadsMain).toContain("GRAPH_ZOOM_MAX");
    expect(beadsMain).toContain("GRAPH_FIT_PADDING");
    expect(beadsMain).toContain("getGraphFitZoomForPane");
    expect(beadsMain).toContain("fitGraphToViewport");
    expect(beadsMain).toContain("availableWidth / requiredSize.width");
    expect(beadsMain).toContain("availableHeight / requiredSize.height");
    const interpolationStart = String.fromCharCode(36) + "{";
    expect(beadsMain).toContain(`canvas.style.width = \`${interpolationStart}viewport.width}px\``);
    expect(beadsMain).toContain(
      `canvas.style.height = \`${interpolationStart}viewport.height}px\``
    );
    expect(beadsMain).toContain("zoomGraphFromWheel");
    expect(beadsMain).toContain("document.activeElement !== scroller");
    expect(beadsMain).toContain("event.ctrlKey");
    expect(beadsMain).toContain("event.metaKey");
    expect(beadsMain).toContain('addEventListener("wheel"');
    expect(beadsMain).toContain('addEventListener("pointerdown"');
    expect(beadsMain).toContain('addEventListener("dblclick"');
    expect(beadsMain).toContain("passive: false");
    expect(beadsMain).toContain("event.preventDefault()");
    expect(beadsMain).toContain("normalizeOptionalDatasetValue");
    expect(beadsMain).toContain("postAssignStartBead");
    expect(beadsMain).toContain('target.closest(".assignStartBead")');
    expect(beadsMain).toContain("marker-end");
    expect(beadsMain).toContain("criticalDependencyArrow");
    expect(beadsMain).toContain('markerWidth="6.5"');
    expect(beadsMain).toContain("Math.max(18, Math.abs(x2 - x1) * 0.34)");
    expect(beadsMain).toContain(
      "agent: normalizeOptionalDatasetValue(button.dataset.assignStartAgent)"
    );
    expect(beadsMain).toContain(
      "model: normalizeOptionalDatasetValue(button.dataset.assignStartModel)"
    );
    expect(beadsMain).toContain(
      "ssot: normalizeOptionalDatasetValue(button.dataset.assignStartSsot)"
    );
    expect(beadsMain).toContain(
      "worktree: normalizeOptionalDatasetValue(button.dataset.assignStartWorktree)"
    );
    expect(beadsMain).toContain("renderDependencyGraphOverlays");
    expect(beadsMain).toContain("visibleRowIds");
    expect(beadsMain).toContain('section.querySelectorAll<BeadRow>("tbody .beadRow")');
    expect(beadsMain).toContain("visibleRowIds.has(node.dataset.graphId");
    expect(beadsMain).toContain('querySelectorAll<HTMLElement>(".graphPane")');
    expect(beadsMain).toContain('querySelector<HTMLElement>(".graphScroller")');
    expect(beadsMain).toContain('scroller?.addEventListener("scroll"');
    expect(beadsMain).not.toContain("saveGraphScroll(pane);\n    renderDependencyGraphOverlays();");
    expect(beadsMain).toContain("content.style.setProperty");
    expect(beadsMain).toContain("data-graph-action");
    expect(beadsMain).toContain("refreshGraphDerivedState");
    expect(beadsMain).toContain("computeVisibleGraphState");
    expect(beadsMain).toContain("layoutGraphPane");
    expect(beadsMain).toContain("computePackedGraphLayout");
    expect(beadsMain).toContain("node.offsetHeight");
    expect(beadsMain).toContain("beginGraphPan");
    expect(beadsMain).toContain("handleGraphKeydown");
    expect(beadsMain).toContain("window.innerWidth - menuRect.width");
    expect(beadsMain).toContain("window.innerHeight - menuRect.height");
    expect(beadsWebview).toContain("beadDetailsButton");
    expect(beadsWebview).toContain("graphDetailsBead");
    expect(beadsWebview).toContain("aria-expanded");
    expect(beadsMain).toContain('command: "assignStartBead"');
    expect(beadsMain).toContain('command: "startParallelBeads"');
    expect(beadsMain).toContain("detailsCell.colSpan = 6");
    expect(beadsMain).toContain("Sync Risk");
    expect(beadsMain).toContain("Branch");
    expect(beadsMain).toContain("Checks");
  });

  it("selects a model preference before starting AI work with SSOT and worktree context", () => {
    expect(beadsView).toContain("refreshDebounceMs");
    expect(beadsView).toContain("refreshTimer");
    expect(beadsView).toContain("scheduleRefresh");
    expect(beadsView).toContain("DEFAULT_AGENT_MODEL");
    expect(beadsView).toContain("resolveAssignModel");
    expect(beadsView).toContain("pickAgentModelPreference");
    expect(beadsView).toContain("pickParallelAgentModelPreference");
    expect(beadsView).toContain('title: "Model preference (Copilot)"');
    expect(beadsView).toContain("Actual availability depends on the Copilot provider.");
    expect(beadsView).toContain("Use each task's model preference");
    expect(beadsView).toContain("Enter another model...");
    expect(beadsView).toContain("if (model === null)");
    expect(beadsView).toContain("queryReadyItemIds");
    expect(beadsView).toContain("queryDependencyIdsForStart");
    expect(beadsView).toContain("bd ready no longer reports this task as ready");
    expect(beadsView).toContain("Unable to verify current Beads dependencies for:");
    expect(beadsView).toContain("revalidateExecutionTargets");
    expect(beadsView).toContain("runReadinessGuardedStart");
    expect(agentStartGuard).toContain("readyBeforePreparation");
    expect(agentStartGuard).toContain("readyBeforeMutation");
    expect(agentStartGuard).toContain("mutateAndLaunch");
    expect(beadsView).toContain("resolveAssignSsot");
    expect(beadsView).toContain("resolveAssignWorktree");
    expect(beadsView).toContain("ensureAgentWorktree");
    expect(beadsView).toContain('"worktree", "add"');
    expect(beadsView).toContain("SSOT_USAGE_MANIFEST_CANDIDATES");
    expect(beadsView).toContain("loadAssignSsotManifestEntries");
    expect(beadsView).toContain("normalizeSsotManifestEntries");
    expect(beadsView).toContain("Unable to read SSOT usage manifest at");
    expect(beadsView).toContain("ssot-usage.json");
    expect(beadsView).toContain("inferAssignSsot");
    expect(beadsView).toContain("deriveParallelMergeItems");
    expect(beadsView).toContain("openAssignAgentSession");
    expect(beadsView).toContain("buildAgentWorkPrompt");
    expect(beadsView).toContain("startParallelBeads");
    expect(beadsView).toContain("formatSkippedParallelTargets");
    expect(beadsView).toContain("workbench.action.chat.openSessionWithPrompt.copilotcli");
    expect(beadsView).toContain("CHAT_FALLBACK_COMMAND_CANDIDATES");
    expect(beadsView).toContain("workbench.action.chat.open");
    expect(beadsView).toContain("vscode.env.clipboard.writeText(prompt)");
    expect(beadsView).toContain("Copilot agent prompt copied to clipboard");
    expect(beadsView).toContain("with requested model");
    expect(beadsView).toContain("Copied $" + "{copiedPromptCount} prompt(s)");
    expect(beadsView).toContain("vscode.Uri.file(values.worktree?.trim() || values.workspacePath)");
    expect(agentWorkPrompt).toContain("AGENTS.md");
    expect(beadsView).toContain(".beads/issues.jsonl");
    expect(beadsView).toContain("README.md");
    expect(beadsView).toContain("`model=$" + "{values.model}`");
    expect(beadsView).toContain("`ssot=$" + "{values.ssot}`");
    expect(beadsView).toContain("`worktree=$" + "{worktree}`");
    expect(beadsView).toContain("`branch=$" + "{agentWorktree.branch.trim()}`");
    expect(agentWorkPrompt).toContain("Inspect the current bead in Beads using ID");
    expect(agentWorkPrompt).toContain("Upstream bead handoff IDs");
    expect(beadsView).toContain('["show", issueId, "--json"]');
    expect(beadsView).not.toContain("Assign Agent");
    expect(beadsView).not.toContain("Assign AI Model");
  });

  it("avoids redundant Beads webview reloads", () => {
    expect(beadsView).not.toContain('createFileSystemWatcher("**/.beads/beads.db*")');
    expect(beadsView).toContain("webviewViewRenderSignature");
    expect(beadsView).toContain("panelRenderSignature");
    expect(beadsView).toContain("getRenderSignature");
    expect(beadsView).toContain("refreshWebviewHtml");
    expect(beadsView).toContain("this.webviewViewRenderSignature === signature");
    expect(beadsView).toContain("this.panelRenderSignature === signature");
    expect(beadsView).not.toContain("onDidChangeVisibility");
    expect(beadsView).not.toContain("onDidChangeViewState");
  });

  it("anonymizes email-like agent identities in display labels", () => {
    expect(beadsWebview).toContain("buildAgentAliasMap");
    expect(beadsWebview).toContain("anonymizeAgentIdentity");
  });

  it("surfaces derived parallel PR merge tasks in the table and graph", () => {
    expect(beadsWebview).toContain("parallel-pr-merge");
    expect(beadsWebview).toContain("Merge PR");
    expect(beadsWebview).toContain("Merge PRs");
    expect(beadsWebview).toContain("branchBadge");
    expect(beadsWebview).toContain("prBadge");
    expect(beadsWebview).toContain("checkBadge");
    expect(beadsWebview).toContain("syncRiskBadge");
    expect(beadsWebview).toContain("Checks passed");
    expect(beadsWebview).toContain("Sync risk");
    expect(beadsWebview).toContain("data-merge-dependencies");
    expect(beadsMain).toContain("Derived merge task");
    expect(beadsMain).toContain('command: "mergeParallelPrs"');
    expect(beadsView).toContain("mergeParallelPullRequests");
    expect(beadsView).toContain("assertWorktreesReadyForMerge");
    expect(beadsView).toContain("checkWorktreesReadyForMerge");
    expect(beadsView).toContain("assertPullRequestsReadyForMerge");
    expect(beadsView).toContain("findBlockingPullRequestCheckReasons");
    expect(beadsView).toContain("statusCheckRollup");
    expect(beadsView).toContain("Cannot merge parallel PRs until PR checks are ready");
    expect(beadsView).toContain("formatWorktreeMergeChecks");
    expect(beadsView).toContain("Cannot merge parallel PRs until agent worktrees are synced");
    expect(beadsView).toContain("waitForPullRequestMerged");
    expect(beadsView).toContain("gh");
  });
});
