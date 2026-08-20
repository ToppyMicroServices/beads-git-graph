import { describe, expect, it } from "vitest";

import {
  buildObstacleAvoidingGraphPath,
  computeCenteredBoundaryY,
  computeGraphBoundaryState,
  computePackedGraphLayout,
  computeVisibleGraphState,
  formatGraphRelationPartition,
  graphEdgeKey,
  partitionGraphRelationIds
} from "../src/beadsGraphModel";

describe("visible beads graph state", () => {
  it("recomputes the critical path after filtered nodes disappear", () => {
    const edges = [
      { fromId: "closed", toId: "middle" },
      { fromId: "middle", toId: "last" },
      { fromId: "ready", toId: "last" }
    ];

    const state = computeVisibleGraphState(["middle", "ready", "last"], edges);

    expect(state.edges).toEqual([
      { fromId: "middle", toId: "last" },
      { fromId: "ready", toId: "last" }
    ]);
    expect(state.criticalPathIds).toEqual(["middle", "last"]);
    expect(state.criticalEdgeKeys).toEqual(new Set([graphEdgeKey("middle", "last")]));
    expect(state.cycleIds).toEqual(new Set());
    expect(state.cycleEdgeKeys).toEqual(new Set());
    expect(state.levelsById).toEqual(
      new Map([
        ["middle", 0],
        ["ready", 0],
        ["last", 1]
      ])
    );
  });

  it("does not report isolated nodes as a dependency path", () => {
    expect(computeVisibleGraphState(["ready"], []).criticalPathIds).toEqual([]);
  });

  it("connects roots to Start and leaves to End", () => {
    const boundary = computeGraphBoundaryState(
      ["root-a", "root-b", "middle", "leaf"],
      [
        { fromId: "root-a", toId: "middle" },
        { fromId: "root-b", toId: "middle" },
        { fromId: "middle", toId: "leaf" }
      ]
    );

    expect(boundary.startIds).toEqual(new Set(["root-a", "root-b"]));
    expect(boundary.endIds).toEqual(new Set(["leaf"]));
  });

  it("connects every isolated task through Start and End", () => {
    const boundary = computeGraphBoundaryState(["parallel-a", "parallel-b"], []);

    expect(boundary.startIds).toEqual(new Set(["parallel-a", "parallel-b"]));
    expect(boundary.endIds).toEqual(new Set(["parallel-a", "parallel-b"]));
  });

  it("marks dependency cycles without publishing a misleading longest chain", () => {
    const edges = [
      { fromId: "a", toId: "b" },
      { fromId: "b", toId: "a" }
    ];

    const state = computeVisibleGraphState(["a", "b"], edges);
    const boundary = computeGraphBoundaryState(["a", "b"], edges);

    expect(state.levelsById).toEqual(
      new Map([
        ["a", 0],
        ["b", 0]
      ])
    );
    expect(state.criticalPathIds).toEqual([]);
    expect(state.criticalEdgeKeys).toEqual(new Set());
    expect(state.cycleIds).toEqual(new Set(["a", "b"]));
    expect(state.cycleEdgeKeys).toEqual(new Set([graphEdgeKey("a", "b"), graphEdgeKey("b", "a")]));
    expect(boundary.startIds).toEqual(new Set(["a"]));
    expect(boundary.endIds).toEqual(new Set(["b"]));
  });

  it("treats a self-dependency as a cycle", () => {
    const state = computeVisibleGraphState(["self"], [{ fromId: "self", toId: "self" }]);

    expect(state.cycleIds).toEqual(new Set(["self"]));
    expect(state.cycleEdgeKeys).toEqual(new Set([graphEdgeKey("self", "self")]));
    expect(state.criticalPathIds).toEqual([]);
  });

  it("keeps filtered and missing dependency IDs visible in relation text", () => {
    const partition = partitionGraphRelationIds(
      ["visible", "filtered", "missing"],
      new Set(["visible"]),
      new Set(["missing"])
    );

    expect(partition).toEqual({
      visibleIds: ["visible"],
      hiddenIds: ["filtered"],
      missingIds: ["missing"]
    });
    expect(formatGraphRelationPartition(partition)).toBe(
      "visible, filtered (hidden), missing (missing)"
    );
  });
});

describe("beads graph layout", () => {
  it("stacks variable-height cards without overlap", () => {
    const layout = computePackedGraphLayout(
      [
        { id: "short", level: 0, height: 100 },
        { id: "tall", level: 0, height: 260 },
        { id: "next", level: 0, height: 120 }
      ],
      {
        nodeWidth: 252,
        levelGap: 56,
        columnGap: 24,
        laneGap: 30,
        paddingX: 28,
        paddingY: 44
      }
    );
    const short = layout.nodes.find((node) => node.id === "short");
    const tall = layout.nodes.find((node) => node.id === "tall");

    expect(short).toEqual({ id: "short", x: 28, y: 44 });
    expect(tall).toEqual({ id: "tall", x: 28, y: 174 });
    expect(layout.height).toBeGreaterThanOrEqual(478);
  });

  it("routes dependency lines through a corridor outside card bounds", () => {
    const path = buildObstacleAvoidingGraphPath(
      { left: 28, top: 44, right: 280, bottom: 144 },
      { left: 588, top: 174, right: 840, bottom: 274 },
      500,
      0
    );

    expect(path).toBe("M280.0 94.0 H292.0 V12.0 H576.0 V224.0 H588.0");
  });

  it("centers Start and End nodes within the graph height", () => {
    expect(computeCenteredBoundaryY(500, 62)).toBe(219);
  });
});
