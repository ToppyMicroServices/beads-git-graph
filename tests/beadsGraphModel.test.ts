import { describe, expect, it } from "vitest";

import {
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
