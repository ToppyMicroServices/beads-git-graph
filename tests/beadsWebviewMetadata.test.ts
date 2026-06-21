import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");
const beadsWebview = readFileSync(join(repoRoot, "src", "beadsWebview.ts"), "utf8");
const beadsView = readFileSync(join(repoRoot, "src", "beadsView.ts"), "utf8");
const beadsMain = readFileSync(join(repoRoot, "web", "beadsMain.ts"), "utf8");

describe("beads webview presentation metadata", () => {
  it("renders readable task summary and responsive task rows", () => {
    expect(beadsWebview).toContain("workspaceSummary");
    expect(beadsWebview).toContain("summaryPill");
    expect(beadsWebview).toContain("@media (max-width:560px)");
    expect(beadsWebview).toContain("grid-template-areas");
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
    expect(beadsWebview).toContain("No dependency path yet");
    expect(beadsWebview).toContain("graphIssueDrawer");
    expect(beadsWebview).toContain("graphIssueStack");
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
    expect(beadsWebview).toContain('item.parallelizable && !item.synthetic && status === "open"');
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
    expect(beadsWebview).toContain("max-height:calc(100vh - 132px)");
    expect(beadsWebview).toContain("graphLevelGuide");
    expect(beadsWebview).toContain("graphLevelLabel");
    expect(beadsWebview).toContain("No blockers");
    expect(beadsWebview).toContain("After deps");
    expect(beadsWebview).toContain("graphNodes");
    expect(beadsWebview).toContain("data-graph-lane");
    expect(beadsWebview).toContain("data-epic-id");
    expect(beadsWebview).toContain("data-depth");
    expect(beadsWebview).toContain("--graph-x");
    expect(beadsWebview).toContain("--graph-height");
    expect(beadsWebview).toContain("dependencyArrowHead");
    expect(beadsWebview).not.toContain("graphGrid");
    expect(beadsWebview).not.toContain("graphStage");
    expect(beadsMain).toContain("getState(): BeadsWebviewState | undefined");
    expect(beadsMain).toContain("setState(state: BeadsWebviewState): void");
    expect(beadsMain).toContain("normalizeViewMode(vscode.getState()?.viewMode)");
    expect(beadsMain).toContain("saveViewMode(mode)");
    expect(beadsMain).toContain("normalizeOptionalDatasetValue");
    expect(beadsMain).toContain("marker-end");
    expect(beadsMain).toContain("criticalDependencyArrow");
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
    expect(beadsMain).toContain('pane.addEventListener("scroll"');
    expect(beadsMain).toContain('command: "assignStartBead"');
    expect(beadsMain).toContain('command: "startParallelBeads"');
    expect(beadsMain).toContain("detailsCell.colSpan = 6");
    expect(beadsMain).toContain("Sync Risk");
    expect(beadsMain).toContain("Branch");
    expect(beadsMain).toContain("Checks");
  });

  it("starts AI work with automatic model, SSOT, and worktree context", () => {
    expect(beadsView).toContain("DEFAULT_ASSIGN_MODEL");
    expect(beadsView).toContain("resolveAssignModel");
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
    expect(beadsView).toContain("startParallelBeads");
    expect(beadsView).toContain("formatSkippedParallelTargets");
    expect(beadsView).toContain("workbench.action.chat.openSessionWithPrompt.copilotcli");
    expect(beadsView).toContain("CHAT_FALLBACK_COMMAND_CANDIDATES");
    expect(beadsView).toContain("workbench.action.chat.open");
    expect(beadsView).toContain("vscode.env.clipboard.writeText(prompt)");
    expect(beadsView).toContain("Copilot agent prompt copied to clipboard");
    expect(beadsView).toContain("Copied $" + "{copiedPromptCount} prompt(s)");
    expect(beadsView).toContain("vscode.Uri.file(values.worktree?.trim() || values.workspacePath)");
    expect(beadsView).toContain("AGENTS.md");
    expect(beadsView).toContain(".beads/issues.jsonl");
    expect(beadsView).toContain("README.md");
    expect(beadsView).toContain("`model=$" + "{values.model}`");
    expect(beadsView).toContain("`ssot=$" + "{values.ssot}`");
    expect(beadsView).toContain("`worktree=$" + "{worktree}`");
    expect(beadsView).toContain("`branch=$" + "{agentWorktree.branch.trim()}`");
    expect(beadsView).toContain("Inspect the bead details with bd show");
    expect(beadsView).not.toContain("Assign Agent");
    expect(beadsView).not.toContain("Assign AI Model");
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
