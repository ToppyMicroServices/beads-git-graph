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
function countOccurrences(source: string, value: string) {
  return source.split(value).length - 1;
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

  it("shows Parent edges only around the selected task without filtering dependencies", () => {
    const openDetailsSource = sourceBetween(
      "function openGraphBeadDetails",
      "function findIssueRow"
    );
    const clearDetailsSource = sourceBetween(
      "function clearSelectedRow",
      "function expandDetailsRow"
    );
    const overlaySource = sourceBetween(
      "function renderDependencyGraphOverlays",
      'addFilter.addEventListener("click"'
    );

    expect(openDetailsSource).toContain("renderDependencyGraphOverlays()");
    expect(clearDetailsSource).toContain("renderDependencyGraphOverlays()");
    expect(overlaySource).toContain("selectedGraphId");
    expect(overlaySource).toContain("childId === selectedGraphId || parentId === selectedGraphId");
    expect(overlaySource).toContain(".filter((edge) => !edge.hidden)");
    expect(overlaySource).not.toContain("selectedGraphId === fromId");
    expect(overlaySource).toContain("parentRouteIndex");
    expect(overlaySource).toContain("dependencyRouteIndex");
  });

  it("routes visible dependency edges deterministically around card obstacles", () => {
    const overlaySource = sourceBetween(
      "function renderDependencyGraphOverlays",
      'addFilter.addEventListener("click"'
    );

    expect(overlaySource).toContain("nodeRectsById");
    expect(overlaySource).toContain("const obstacles = Array.from(nodeRectsById)");
    expect(overlaySource).toContain("buildRoutedGraphPath");
    expect(overlaySource).toContain("left.dataset.fromId");
    expect(overlaySource).toContain("left.dataset.toId");
    expect(overlaySource).toContain("dependencyRouteIndexes");
    expect(overlaySource).toContain("routeGroup");
  });

  it("paints emphasized dependencies after ordinary paths in both maps", () => {
    const overlaySource = sourceBetween(
      "function renderDependencyGraphOverlays",
      'addFilter.addEventListener("click"'
    );
    const miniMapSource = sourceBetween(
      "function rebuildGraphMiniMapGeometry",
      "function updateGraphMiniMapViewport"
    );

    expect(overlaySource).toContain("ordinaryPaths += path");
    expect(overlaySource).toContain("emphasizedPaths += path");
    expect(overlaySource).toContain('edge.dataset.critical === "1" || edge.dataset.cycle === "1"');
    expect(overlaySource).toContain("markerDefs + parentPaths + ordinaryPaths + emphasizedPaths");
    expect(miniMapSource).toContain("getEdgePaintLayer");
    expect(miniMapSource.indexOf(".sort(")).toBeLessThan(
      miniMapSource.indexOf("for (const edge of miniMapEdges)")
    );
  });

  it("batches Graph overlay rebuilding around layout changes", () => {
    const openDetailsSource = sourceBetween(
      "function openGraphBeadDetails",
      "function findIssueRow"
    );
    const clearDetailsSource = sourceBetween(
      "function clearSelectedRow",
      "function expandDetailsRow"
    );
    const renderUpdateSource = sourceBetween(
      "function applyBeadsRenderUpdate",
      "function closeContextMenu"
    );
    const visibilitySource = sourceBetween(
      "function refreshRowVisibility",
      "function updateViewModeControls"
    );
    const viewModeSource = sourceBetween("function applyViewMode", "function isCollapsibleRow");

    expect(openDetailsSource).toContain("options.renderOverlay !== false");
    expect(clearDetailsSource).toContain("options.renderOverlay !== false");
    expect(renderUpdateSource).toContain("renderOverlay: false");
    expect(visibilitySource).toContain("clearSelectedRow({ renderOverlay: false })");
    expect(viewModeSource).toContain(
      "openGraphBeadDetails(detailsButton, { renderOverlay: false })"
    );
    expect(countOccurrences(renderUpdateSource, "renderDependencyGraphOverlays()")).toBe(1);
    expect(countOccurrences(visibilitySource, "renderDependencyGraphOverlays()")).toBe(1);
    expect(countOccurrences(viewModeSource, "renderDependencyGraphOverlays()")).toBe(1);
    expect(beadsMain).toContain(
      "restoreSelectedIssue(normalizeSelectedIssue(initialWebviewState?.selectedIssue),"
    );
    expect(beadsMain).toContain(
      "refreshRowVisibility({ refreshGraph: false, renderHierarchy: false })"
    );
    expect(beadsMain).toContain("openGraphBeadDetails(graphDetailsButton);");
    expect(openDetailsSource).toContain("clearSelectedRow();");
  });

  it("blocks aria-disabled Start AI actions before posting", () => {
    const startSource = sourceBetween(
      "function postAssignStartBead",
      "function postOpenAgentArtifact"
    );

    expect(startSource).toContain('button.getAttribute("aria-disabled") === "true"');
    expect(startSource.indexOf('button.getAttribute("aria-disabled")')).toBeLessThan(
      startSource.indexOf("beginClientAction(")
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
