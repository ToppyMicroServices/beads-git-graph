import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");
const beadsMain = readFileSync(join(repoRoot, "web", "beadsMain.ts"), "utf8");
const beadsWebview = readFileSync(join(repoRoot, "src", "beadsWebview.ts"), "utf8");

function sourceBetween(start: string, end: string) {
  const startIndex = beadsMain.indexOf(start);
  const endIndex = beadsMain.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return beadsMain.slice(startIndex, endIndex);
}

describe("Graph webview UX contracts", () => {
  it("keeps Graph visibility independent from collapsed Table rows", () => {
    const visibilitySource = sourceBetween(
      "function refreshGraphNodeVisibility",
      "function refreshAgentWorkQueueVisibility"
    );

    expect(visibilitySource).toContain("visibleIdsByWorkspace");
    expect(visibilitySource).not.toContain("row.style.display");
    expect(visibilitySource).not.toContain("collapsedIds");
    expect(visibilitySource).not.toContain("collapsedEpicIds");
  });

  it("renders Graph details in an absolute overlay instead of the warning stack", () => {
    const detailsSource = sourceBetween("function openGraphBeadDetails", "function findIssueRow");

    expect(detailsSource).toContain(".graphDetailsHost");
    expect(detailsSource).not.toContain(".graphIssueStack");
    expect(beadsWebview).toContain(".graphDetailsHost{position:absolute");
    expect(beadsWebview).toContain(".graphDetailsHost{inset:auto 0 0");
    expect(beadsWebview).toContain(".graphIssueStack{position:absolute");
  });

  it("keeps Graph and Manage details selected through Table-only collapse", () => {
    const restoreSource = sourceBetween(
      "function restoreSelectedIssue",
      "function updatePlanWorkspaceOptions"
    );
    const visibilitySource = sourceBetween(
      "function refreshRowVisibility",
      "function updateViewModeControls"
    );

    expect(restoreSource).toContain("activeFilters.has");
    expect(restoreSource).toContain("hiddenOnlyByTableCollapse");
    expect(visibilitySource).toContain('activeViewMode === "table"');
    expect(visibilitySource).toContain("removeExpandedDetails");
    expect(visibilitySource).not.toContain(
      'selectedRow !== null && selectedRow.style.display === "none"'
    );
  });

  it("updates only the minimap viewport during pan and zoom", () => {
    const applyTransformSource = sourceBetween(
      "function applyGraphZoomToPane",
      "function applyGraphZoomToAll"
    );
    const viewportSource = sourceBetween(
      "function updateGraphMiniMapViewport",
      "function scheduleGraphMiniMapViewportUpdate"
    );
    const geometrySource = sourceBetween(
      "function rebuildGraphMiniMapGeometry",
      "function updateGraphMiniMapViewport"
    );

    expect(applyTransformSource).toContain("scheduleGraphMiniMapViewportUpdate");
    expect(applyTransformSource).not.toContain("rebuildGraphMiniMapGeometry");
    expect(applyTransformSource).not.toContain("getGraphRequiredSize");
    expect(viewportSource).not.toContain("replaceChildren");
    expect(viewportSource).not.toContain("getVisibleGraphLayoutNodes");
    expect(geometrySource).toContain("replaceChildren");
  });

  it("keys reordered Manage cards and settles Retry through the host protocol", () => {
    const keySource = sourceBetween(
      "function getStableRenderKey",
      "function canReconcileRenderNode"
    );
    const retrySource = sourceBetween(
      "function renderParallelExecutionResult",
      "function normalizeOptionalDatasetValue"
    );

    expect(keySource).toContain('node.getAttribute("data-work-item-id")');
    expect(keySource).toContain("agent-work:");
    expect(keySource).toContain('node.getAttribute("data-work-lane")');
    expect(keySource).toContain("agent-lane:");
    expect(retrySource).toContain("beginClientAction(");
    expect(retrySource).toContain("clientActionId,");
    expect(retrySource).not.toContain('retry.textContent = "Retrying…"');
  });

  it("restores focus when keyboard-opened menus close", () => {
    const contextMenuSource = sourceBetween("function openContextMenu", "function setsEqual");
    const filterMenuSource = sourceBetween(
      "function setFilterMenuOpen",
      "function renderFilterChips"
    );

    expect(contextMenuSource).toContain("trigger: HTMLElement | null");
    expect(beadsMain).toContain(`true,
        row
      );`);
    expect(filterMenuSource).toContain("restoreFocus");
    expect(filterMenuSource).toContain("addFilter.focus()");
    expect(beadsMain).toContain("setFilterMenuOpen(false, false, true)");
  });
});
