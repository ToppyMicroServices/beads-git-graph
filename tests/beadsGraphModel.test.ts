import { describe, expect, it } from "vitest";

import {
  computeGraphBoundaryState,
  computePackedGraphLayout,
  computeVisibleGraphState,
  graphEdgeKey
} from "../web/beadsGraphModel";

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
});
