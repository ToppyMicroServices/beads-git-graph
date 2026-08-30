import { describe, expect, it } from "vitest";

import {
  buildBoundaryBusGraphBranchPath,
  buildBoundaryBusGraphCasingPath,
  buildBoundaryBusGraphPath,
  buildDirectGraphCasingPath,
  buildFaninBusGraphPath,
  buildFanoutBusGraphPath,
  buildObstacleAvoidingGraphCasingPath,
  buildObstacleAvoidingGraphPath,
  buildSameColumnGraphCasingPath,
  computeCenteredBoundaryY,
  computeDependencyConnectedGraphLayout,
  computeGraphBoundaryState,
  computeGraphCorridorSpineRouting,
  computeGraphDirectLevelGap,
  computeGraphFaninBusKeys,
  computeGraphFanoutBusKeys,
  computeGraphPortOffsets,
  computeSameColumnGraphRouting,
  computeVisibleGraphState,
  countGraphCorridorLanes,
  countGraphCorridorRoutes,
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

const graphLayoutOptions = {
  nodeWidth: 252,
  levelGap: 56,
  laneGap: 30,
  componentGap: 52,
  paddingX: 28,
  paddingY: 44
};

describe("beads graph layout", () => {
  it("keeps isolated variable-height cards in one semantic column without overlap", () => {
    const layout = computeDependencyConnectedGraphLayout(
      [
        { id: "short", level: 0, height: 100 },
        { id: "tall", level: 0, height: 260 },
        { id: "next", level: 0, height: 120 }
      ],
      [],
      graphLayoutOptions
    );
    const short = layout.nodes.find((node) => node.id === "short");
    const tall = layout.nodes.find((node) => node.id === "tall");
    const next = layout.nodes.find((node) => node.id === "next");

    expect(next).toEqual({ id: "next", x: 28, y: 44 });
    expect(short?.x).toBe(next?.x);
    expect(tall?.x).toBe(next?.x);
    expect(short?.y).toBeGreaterThanOrEqual((next?.y ?? 0) + 120 + 52);
    expect(tall?.y).toBeGreaterThanOrEqual((short?.y ?? 0) + 100 + 52);
  });

  it("uses one physical column for each dependency level", () => {
    const childIds = ["a", "b", "c", "d", "e"];
    const edges = childIds.flatMap((id) => [
      { fromId: "root", toId: id },
      { fromId: id, toId: "join" }
    ]);
    const state = computeVisibleGraphState(["root", ...childIds, "join"], edges);
    const layout = computeDependencyConnectedGraphLayout(
      Array.from(state.levelsById, ([id, level]) => ({ id, level, height: 100 })),
      state.edges,
      graphLayoutOptions
    );
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    const childX = new Set(childIds.map((id) => byId.get(id)?.x));
    const childY = new Set(childIds.map((id) => byId.get(id)?.y));

    expect(childX.size).toBe(1);
    expect(childY.size).toBe(childIds.length);
    expect(byId.get("root")?.x).toBeLessThan(byId.get("a")?.x ?? 0);
    expect(byId.get("a")?.x).toBeLessThan(byId.get("join")?.x ?? 0);
  });

  it("orders children near their connected parent instead of by child id", () => {
    const layout = computeDependencyConnectedGraphLayout(
      [
        { id: "root-a", level: 0, height: 100 },
        { id: "root-b", level: 0, height: 100 },
        { id: "a-child", level: 1, height: 100 },
        { id: "z-child", level: 1, height: 100 }
      ],
      [
        { fromId: "root-a", toId: "z-child" },
        { fromId: "root-b", toId: "a-child" }
      ],
      graphLayoutOptions
    );
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));

    expect(byId.get("root-a")?.y).toBeLessThan(byId.get("root-b")?.y ?? 0);
    expect(byId.get("z-child")?.y).toBeLessThan(byId.get("a-child")?.y ?? 0);
  });

  it("keeps disconnected chains in stable horizontal bands", () => {
    const layout = computeDependencyConnectedGraphLayout(
      [
        { id: "a-root", level: 0, height: 100 },
        { id: "a-leaf", level: 1, height: 100 },
        { id: "b-root", level: 0, height: 120 },
        { id: "b-leaf", level: 1, height: 120 }
      ],
      [
        { fromId: "a-root", toId: "a-leaf" },
        { fromId: "b-root", toId: "b-leaf" }
      ],
      graphLayoutOptions
    );
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));

    expect(byId.get("a-root")?.y).toBe(byId.get("a-leaf")?.y);
    expect(byId.get("b-root")?.y).toBe(byId.get("b-leaf")?.y);
    expect(byId.get("b-root")?.y).toBeGreaterThan(byId.get("a-root")?.y ?? 0);
  });

  it("keeps component bands invariant when input order changes", () => {
    const nodes = [
      { id: "z-root", level: 0, height: 100 },
      { id: "a-leaf", level: 1, height: 100 },
      { id: "b-root", level: 0, height: 120 },
      { id: "c-leaf", level: 1, height: 120 }
    ];
    const edges = [
      { fromId: "z-root", toId: "a-leaf" },
      { fromId: "b-root", toId: "c-leaf" }
    ];
    const positions = (layoutNodes: typeof nodes, layoutEdges: typeof edges) =>
      Object.fromEntries(
        computeDependencyConnectedGraphLayout(layoutNodes, layoutEdges, graphLayoutOptions)
          .nodes.map((node) => [node.id, { x: node.x, y: node.y }])
          .sort(([left], [right]) => left.localeCompare(right))
      );

    expect(positions([...nodes].reverse(), [...edges].reverse())).toEqual(positions(nodes, edges));
    expect(positions(nodes, edges)["b-root"].y).toBeLessThan(positions(nodes, edges)["z-root"].y);
  });

  it("uses connection barycenters before focus badges to avoid crossed pairs", () => {
    const layout = computeDependencyConnectedGraphLayout(
      [
        { id: "r1", level: 0, height: 100, focusRank: 0 },
        { id: "r2", level: 0, height: 100, focusRank: 2 },
        { id: "c1", level: 1, height: 100, focusRank: 2 },
        { id: "c2", level: 1, height: 100, focusRank: 0 },
        { id: "join", level: 2, height: 100, focusRank: 2 }
      ],
      [
        { fromId: "r1", toId: "c1" },
        { fromId: "r2", toId: "c2" },
        { fromId: "c1", toId: "join" },
        { fromId: "c2", toId: "join" }
      ],
      graphLayoutOptions
    );
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));

    const rootOrder = (byId.get("r1")?.y ?? 0) - (byId.get("r2")?.y ?? 0);
    const childOrder = (byId.get("c1")?.y ?? 0) - (byId.get("c2")?.y ?? 0);
    expect(rootOrder).not.toBe(0);
    expect(childOrder).not.toBe(0);
    expect(rootOrder * childOrder).toBeGreaterThan(0);
  });

  it("keeps cycle members finite and non-overlapping before downstream work", () => {
    const state = computeVisibleGraphState(
      ["cycle-a", "cycle-b", "after"],
      [
        { fromId: "cycle-a", toId: "cycle-b" },
        { fromId: "cycle-b", toId: "cycle-a" },
        { fromId: "cycle-b", toId: "after" }
      ]
    );
    const layout = computeDependencyConnectedGraphLayout(
      Array.from(state.levelsById, ([id, level]) => ({ id, level, height: 100 })),
      state.edges,
      graphLayoutOptions
    );
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));

    expect(Number.isFinite(byId.get("cycle-a")?.y)).toBe(true);
    expect(byId.get("cycle-a")?.x).toBe(byId.get("cycle-b")?.x);
    expect(byId.get("cycle-a")?.y).not.toBe(byId.get("cycle-b")?.y);
    expect(byId.get("after")?.x).toBeGreaterThan(byId.get("cycle-a")?.x ?? 0);
  });

  it("relevels visible nodes after a filtered bridge disappears", () => {
    const state = computeVisibleGraphState(
      ["root", "leaf"],
      [
        { fromId: "root", toId: "bridge" },
        { fromId: "bridge", toId: "leaf" },
        { fromId: "missing", toId: "leaf" }
      ]
    );
    const layout = computeDependencyConnectedGraphLayout(
      Array.from(state.levelsById, ([id, level]) => ({ id, level, height: 100 })),
      state.edges,
      graphLayoutOptions
    );
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));

    expect(state.edges).toEqual([]);
    expect(byId.get("root")?.x).toBe(byId.get("leaf")?.x);
    expect(byId.get("root")?.y).not.toBe(byId.get("leaf")?.y);
  });

  it("counts long routes and reserves a separate End boundary lane", () => {
    const nodes = [
      { id: "start", level: 0 },
      { id: "a", level: 1 },
      { id: "b", level: 2 },
      { id: "end", level: 4 }
    ];
    const edges = [
      { fromId: "start", toId: "a" },
      { fromId: "a", toId: "b" },
      { fromId: "b", toId: "b" },
      { fromId: "a", toId: "end", boundary: true },
      { fromId: "b", toId: "end" }
    ];

    expect(countGraphCorridorRoutes(nodes, edges)).toBe(1);
    expect(countGraphCorridorLanes(nodes, edges)).toBe(2);
  });

  it("connects adjacent levels directly through the column gap", () => {
    const path = buildObstacleAvoidingGraphPath(
      { left: 28, top: 44, right: 280, bottom: 144 },
      { left: 336, top: 174, right: 588, bottom: 274 },
      500,
      0,
      true
    );

    expect(path).toBe("M280.0 94.0 C308.0 94.0 308.0 224.0 336.0 224.0");
    expect(
      buildDirectGraphCasingPath(
        { left: 28, top: 44, right: 280, bottom: 144 },
        { left: 336, top: 174, right: 588, bottom: 274 }
      )
    ).toBe("M292.0 103.8 C305.4 127.9 310.6 190.1 324.0 214.2");
  });

  it("adds central bridges when dense adjacent-level edges cannot share a fan bus", () => {
    const nodes = [
      ...Array.from({ length: 3 }, (_, index) => ({ id: `source-${index}`, level: 0 })),
      ...Array.from({ length: 3 }, (_, index) => ({ id: `target-${index}`, level: 1 }))
    ];
    const edges = Array.from({ length: 3 }, (_, sourceIndex) =>
      Array.from({ length: 3 }, (_, targetIndex) => ({
        key: `edge-${sourceIndex}-${targetIndex}`,
        fromId: `source-${sourceIndex}`,
        toId: `target-${targetIndex}`
      }))
    ).flat();
    const topToBottom = buildDirectGraphCasingPath(
      { left: 28, top: 44, right: 280, bottom: 144, anchorY: 94 },
      { left: 336, top: 304, right: 588, bottom: 404, anchorY: 354 }
    );
    const bottomToTop = buildDirectGraphCasingPath(
      { left: 28, top: 304, right: 280, bottom: 404, anchorY: 354 },
      { left: 336, top: 44, right: 588, bottom: 144, anchorY: 94 }
    );

    expect(computeGraphFanoutBusKeys(nodes, edges).size).toBe(0);
    expect(computeGraphFaninBusKeys(nodes, edges).size).toBe(0);
    expect(computeGraphDirectLevelGap(nodes, edges, 56)).toBe(56);
    expect(topToBottom).not.toBe(bottomToTop);
    expect(topToBottom).not.toContain("M280.0 94.0");
    expect(bottomToTop).not.toContain("336.0 94.0");
  });

  it("widens only dense mixed adjacent-level dependency gaps", () => {
    const nodes = [
      ...Array.from({ length: 20 }, (_, index) => ({ id: `source-${index}`, level: 0 })),
      ...Array.from({ length: 20 }, (_, index) => ({ id: `target-${index}`, level: 1 }))
    ];
    const denseEdges = Array.from({ length: 20 }, (_, sourceIndex) =>
      Array.from({ length: 20 }, (_, targetIndex) => ({
        fromId: `source-${sourceIndex}`,
        toId: `target-${targetIndex}`
      }))
    ).flat();
    const pureFanoutEdges = Array.from({ length: 20 }, (_, targetIndex) => ({
      fromId: "source-0",
      toId: `target-${targetIndex}`
    }));

    const sparseMixedEdges = Array.from({ length: 15 }, (_, sourceIndex) => ({
      fromId: `source-${sourceIndex}`,
      toId: `target-${14 - sourceIndex}`
    }));

    expect(computeGraphDirectLevelGap(nodes, denseEdges, 56)).toBe(226);
    expect(computeGraphDirectLevelGap(nodes, sparseMixedEdges, 56)).toBe(176);
    expect(computeGraphDirectLevelGap(nodes, pureFanoutEdges, 56)).toBe(56);
    expect(
      buildDirectGraphCasingPath(
        { left: 28, top: 44, right: 280, bottom: 144 },
        { left: 438, top: 174, right: 690, bottom: 274 }
      )
    ).toMatch(/^M292\.0 /);
  });

  it("routes non-adjacent dependency lines through a corridor outside card bounds", () => {
    const path = buildObstacleAvoidingGraphPath(
      { left: 28, top: 44, right: 280, bottom: 144 },
      { left: 588, top: 174, right: 840, bottom: 274 },
      500,
      0
    );

    expect(path).toBe("M280.0 94.0 H292.0 V38.0 H576.0 V224.0 H588.0");
    expect(
      buildObstacleAvoidingGraphCasingPath(
        { left: 28, top: 44, right: 280, bottom: 144 },
        { left: 588, top: 174, right: 840, bottom: 274 },
        500,
        0
      )
    ).toBe("M292.0 86.0 V38.0 H576.0 V216.0");
  });

  it("assigns source and target spine lanes from final anchor order", () => {
    const routes = [
      {
        key: "a",
        fromLevel: 1,
        toLevel: 3,
        sourceY: 200,
        targetY: 100,
        routeIndex: 0
      },
      {
        key: "z",
        fromLevel: 1,
        toLevel: 3,
        sourceY: 100,
        targetY: 200,
        routeIndex: 1
      }
    ];
    const routing = computeGraphCorridorSpineRouting(routes, 500);
    const from = { left: 28, top: 44, right: 280, bottom: 244 };
    const to = { left: 644, top: 44, right: 896, bottom: 244 };
    const pathA = buildObstacleAvoidingGraphPath(
      { ...from, anchorY: 200 },
      { ...to, anchorY: 100 },
      500,
      0,
      false,
      false,
      false,
      2,
      routing.sourceSpineIndexByKey.get("a"),
      routing.targetSpineIndexByKey.get("a")
    );
    const pathZ = buildObstacleAvoidingGraphPath(
      { ...from, anchorY: 100 },
      { ...to, anchorY: 200 },
      500,
      1,
      false,
      false,
      false,
      2,
      routing.sourceSpineIndexByKey.get("z"),
      routing.targetSpineIndexByKey.get("z")
    );

    expect(routing.sourceSpineIndexByKey).toEqual(
      new Map([
        ["z", 0],
        ["a", 1]
      ])
    );
    expect(routing.targetSpineIndexByKey).toEqual(
      new Map([
        ["a", 0],
        ["z", 1]
      ])
    );
    expect(pathA).toBe("M280.0 200.0 H302.0 V38.0 H632.0 V100.0 H644.0");
    expect(pathZ).toBe("M280.0 100.0 H292.0 V48.0 H622.0 V200.0 H644.0");
  });

  it("does not reuse a spine X between top and bottom corridors", () => {
    const routing = computeGraphCorridorSpineRouting(
      [
        {
          key: "top",
          fromLevel: 1,
          toLevel: 3,
          sourceY: 100,
          targetY: 100,
          routeIndex: 0
        },
        {
          key: "bottom",
          fromLevel: 1,
          toLevel: 3,
          sourceY: 400,
          targetY: 400,
          routeIndex: 1
        }
      ],
      500
    );

    expect(routing.sourceSpineIndexByKey.get("top")).not.toBe(
      routing.sourceSpineIndexByKey.get("bottom")
    );
    expect(routing.targetSpineIndexByKey.get("top")).not.toBe(
      routing.targetSpineIndexByKey.get("bottom")
    );
  });

  it("shares one source spine across long End boundary branches", () => {
    const routes = Array.from({ length: 6 }, (_, index) => ({
      key: `end-${index}`,
      fromLevel: 1,
      toLevel: 3,
      sourceY: 80 + index * 60,
      targetY: 250,
      routeIndex: 0,
      sharedTargetBus: true
    }));
    const routing = computeGraphCorridorSpineRouting(routes, 500);
    const sourceSpineIndexes = routes.map((route) => routing.sourceSpineIndexByKey.get(route.key));
    const paths = routes.map((route) =>
      buildBoundaryBusGraphPath(
        { left: 336, top: route.sourceY - 50, right: 588, bottom: route.sourceY + 50 },
        { left: 644, top: 219, right: 700, bottom: 281 },
        "end",
        500,
        true,
        0,
        1,
        24,
        routing.sourceSpineIndexByKey.get(route.key)
      )
    );

    expect(new Set(sourceSpineIndexes)).toEqual(new Set([0]));
    expect(paths.every((path) => path.includes("H600.0"))).toBe(true);
    expect(paths.every((path) => !path.includes("H650.0"))).toBe(true);
  });

  it("keeps a shared End spine inside non-boundary source spines", () => {
    const routing = computeGraphCorridorSpineRouting(
      [
        {
          key: "regular",
          fromLevel: 1,
          toLevel: 3,
          sourceY: 120,
          targetY: 220,
          routeIndex: 0
        },
        {
          key: "end-a",
          fromLevel: 1,
          toLevel: 4,
          sourceY: 260,
          targetY: 300,
          routeIndex: 1,
          sharedTargetBus: true
        },
        {
          key: "end-b",
          fromLevel: 1,
          toLevel: 4,
          sourceY: 380,
          targetY: 300,
          routeIndex: 1,
          sharedTargetBus: true
        }
      ],
      500
    );

    expect(routing.sourceSpineIndexByKey.get("end-a")).toBe(0);
    expect(routing.sourceSpineIndexByKey.get("end-b")).toBe(0);
    expect(routing.sourceSpineIndexByKey.get("regular")).toBe(1);
  });

  it("uses short side loops for same-column parent and cycle edges", () => {
    const from = { left: 28, top: 44, right: 280, bottom: 144 };
    const to = { left: 28, top: 174, right: 280, bottom: 274 };

    expect(buildObstacleAvoidingGraphPath(from, to, 500, 0, false, true)).toBe(
      "M280.0 94.0 H294.0 V224.0 H280.0"
    );
    expect(buildObstacleAvoidingGraphPath(from, to, 500, 1, false, true)).toBe(
      "M28.0 94.0 H14.0 V224.0 H28.0"
    );
  });

  it("draws a visible self-cycle loop with separate anchors", () => {
    const rect = { left: 28, top: 44, right: 280, bottom: 144 };

    expect(buildObstacleAvoidingGraphPath(rect, rect, 500, 0, false, true, true)).toBe(
      "M280.0 82.0 H294.0 V106.0 H280.0"
    );
    expect(buildSameColumnGraphCasingPath(rect, rect, 0, true)).toBe("M294.0 90.0 V98.0");
  });

  it("orders fan ports by rendered Y instead of task ID", () => {
    const offsets = computeGraphPortOffsets([
      {
        key: "edge:root:z-running",
        nodeId: "root",
        oppositeY: 44,
        availableHeight: 100
      },
      {
        key: "edge:root:a-normal",
        nodeId: "root",
        oppositeY: 174,
        availableHeight: 100
      }
    ]);

    expect(offsets.get("edge:root:z-running")).toBe(-18);
    expect(offsets.get("edge:root:a-normal")).toBe(18);

    const sharedPhysicalSideOffsets = computeGraphPortOffsets([
      {
        key: "start-target",
        nodeId: "task\0left",
        oppositeY: 94,
        availableHeight: 100
      },
      {
        key: "cycle-source",
        nodeId: "task\0left",
        oppositeY: 354,
        availableHeight: 100
      }
    ]);
    expect(sharedPhysicalSideOffsets.get("start-target")).not.toBe(
      sharedPhysicalSideOffsets.get("cycle-source")
    );
  });

  it("uses a shared boundary bus with distinct task branches", () => {
    const from = { left: 28, top: 44, right: 280, bottom: 106 };
    const paths = Array.from({ length: 55 }, (_, index) =>
      buildBoundaryBusGraphPath(
        from,
        {
          left: 336,
          top: 44 + index * 120,
          right: 588,
          bottom: 144 + index * 120
        },
        "start"
      )
    );

    expect(new Set(paths).size).toBe(paths.length);
    expect(paths[0]).toContain("H304.0");
    expect(paths[54]).toContain("H304.0");
  });

  it("keeps the End bus in the final boundary gap", () => {
    const path = buildBoundaryBusGraphPath(
      { left: 336, top: 44, right: 588, bottom: 184 },
      { left: 952, top: 275, right: 1008, bottom: 337 },
      "end"
    );

    expect(path).toBe("M588.0 114.0 H928.0 V306.0 H952.0");
    expect(path).not.toContain("H770.0");
  });

  it("routes long End branches through an outer corridor", () => {
    const path = buildBoundaryBusGraphPath(
      { left: 644, top: 174, right: 896, bottom: 374 },
      { left: 1260, top: 178, right: 1316, bottom: 240 },
      "end",
      500,
      true,
      1
    );

    expect(path).toBe("M896.0 274.0 H908.0 V452.0 H1236.0 V209.0 H1260.0");
    expect(
      buildBoundaryBusGraphCasingPath(
        { left: 644, top: 174, right: 896, bottom: 374 },
        { left: 1260, top: 178, right: 1316, bottom: 240 },
        500,
        1,
        2,
        24,
        0
      )
    ).toBe("M908.0 282.0 V452.0 H1236.0 V217.0");
    expect(
      buildBoundaryBusGraphBranchPath(
        { left: 644, top: 174, right: 896, bottom: 374 },
        { left: 1260, top: 178, right: 1316, bottom: 240 },
        24,
        0
      )
    ).toBe("M896.0 274.0 H908.0 M1236.0 209.0 H1260.0");
    expect(path).not.toContain("V462.0");
  });

  it("bundles high fan-out dependencies on a shared gap bus", () => {
    const nodes = [
      { id: "goal", level: 1 },
      ...Array.from({ length: 20 }, (_, index) => ({ id: `task-${index}`, level: 2 }))
    ];
    const edges = Array.from({ length: 20 }, (_, index) => ({
      key: `edge-${index}`,
      fromId: "goal",
      toId: `task-${index}`
    }));
    const keys = computeGraphFanoutBusKeys(nodes, edges);
    const belowThreshold = computeGraphFanoutBusKeys(nodes, edges.slice(0, 5));
    const path = buildFanoutBusGraphPath(
      { left: 28, top: 44, right: 280, bottom: 144, anchorY: 94 },
      { left: 336, top: 174, right: 588, bottom: 274, anchorY: 224 }
    );

    const secondNodes = [
      { id: "other-goal", level: 1 },
      ...Array.from({ length: 20 }, (_, index) => ({
        id: "other-task-" + index,
        level: 2
      }))
    ];
    const secondEdges = Array.from({ length: 20 }, (_, index) => ({
      key: "other-edge-" + index,
      fromId: "other-goal",
      toId: "other-task-" + index
    }));

    expect(keys).toEqual(new Set(edges.map((edge) => edge.key)));
    expect(belowThreshold.size).toBe(0);
    expect(
      computeGraphFanoutBusKeys([...nodes, ...secondNodes], [...edges, ...secondEdges]).size
    ).toBe(0);
    expect(
      computeGraphFanoutBusKeys(
        [...nodes, { id: "small-goal", level: 1 }, { id: "small-target", level: 2 }],
        [...edges, { key: "small-edge", fromId: "small-goal", toId: "small-target" }]
      ).size
    ).toBe(0);
    expect(
      computeGraphFanoutBusKeys(
        [...nodes, { id: "long-target", level: 3 }],
        [...edges, { key: "long-edge", fromId: "goal", toId: "long-target" }]
      ).size
    ).toBe(0);
    expect(
      computeGraphFanoutBusKeys(
        [{ id: "long-source", level: 0 }, ...nodes],
        [{ key: "long-edge", fromId: "long-source", toId: "task-0" }, ...edges]
      ).size
    ).toBe(0);
    expect(path).toBe("M280.0 94.0 H304.0 V224.0 H336.0");
  });

  it("bundles high fan-in dependencies before the merge task", () => {
    const nodes = [
      ...Array.from({ length: 20 }, (_, index) => ({ id: `task-${index}`, level: 1 })),
      { id: "merge", level: 2 }
    ];
    const edges = Array.from({ length: 20 }, (_, index) => ({
      key: `edge-${index}`,
      fromId: `task-${index}`,
      toId: "merge"
    }));
    const keys = computeGraphFaninBusKeys(nodes, edges);
    const belowThreshold = computeGraphFaninBusKeys(nodes, edges.slice(0, 5));
    const path = buildFaninBusGraphPath(
      { left: 28, top: 44, right: 280, bottom: 144, anchorY: 94 },
      { left: 336, top: 174, right: 588, bottom: 274, anchorY: 224 }
    );

    const secondNodes = [
      ...Array.from({ length: 20 }, (_, index) => ({
        id: "other-task-" + index,
        level: 1
      })),
      { id: "other-merge", level: 2 }
    ];
    const secondEdges = Array.from({ length: 20 }, (_, index) => ({
      key: "other-edge-" + index,
      fromId: "other-task-" + index,
      toId: "other-merge"
    }));

    expect(keys).toEqual(new Set(edges.map((edge) => edge.key)));
    expect(belowThreshold.size).toBe(0);
    expect(
      computeGraphFaninBusKeys([...nodes, ...secondNodes], [...edges, ...secondEdges]).size
    ).toBe(0);
    expect(
      computeGraphFaninBusKeys(
        [...nodes, { id: "small-source", level: 1 }, { id: "small-merge", level: 2 }],
        [...edges, { key: "small-edge", fromId: "small-source", toId: "small-merge" }]
      ).size
    ).toBe(0);
    expect(
      computeGraphFaninBusKeys(
        [{ id: "long-source", level: 0 }, ...nodes],
        [{ key: "long-edge", fromId: "long-source", toId: "merge" }, ...edges]
      ).size
    ).toBe(0);
    expect(
      computeGraphFaninBusKeys(
        [...nodes, { id: "long-target", level: 3 }],
        [...edges, { key: "long-edge", fromId: "task-0", toId: "long-target" }]
      ).size
    ).toBe(0);
    expect(path).toBe("M280.0 94.0 H312.0 V224.0 H336.0");
  });

  it("falls back when fan-out and fan-in groups share a level gap", () => {
    const nodes = [
      { id: "source", level: 0 },
      { id: "merge", level: 1 },
      ...Array.from({ length: 5 }, (_, index) => ({ id: "input-" + index, level: 0 })),
      ...Array.from({ length: 5 }, (_, index) => ({ id: "target-" + index, level: 1 }))
    ];
    const edges = [
      { key: "source-merge", fromId: "source", toId: "merge" },
      ...Array.from({ length: 5 }, (_, index) => ({
        key: "source-target-" + index,
        fromId: "source",
        toId: "target-" + index
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        key: "input-merge-" + index,
        fromId: "input-" + index,
        toId: "merge"
      }))
    ];

    expect(computeGraphFanoutBusKeys(nodes, edges).size).toBe(0);
    expect(computeGraphFaninBusKeys(nodes, edges).size).toBe(0);
  });

  it("allocates same-column lanes per component and reports required gutter", () => {
    const componentNodes = Array.from({ length: 21 }, (_, index) => ({
      id: `a-${index}`,
      level: 1
    }));
    const componentEdges = Array.from({ length: 20 }, (_, index) => ({
      key: `a-edge-${index}`,
      fromId: `a-${index}`,
      toId: `a-${index + 1}`
    }));
    const base = computeSameColumnGraphRouting(componentNodes, componentEdges);
    const withUnrelatedComponent = computeSameColumnGraphRouting(
      [...componentNodes, { id: "b-0", level: 1 }, { id: "b-1", level: 1 }],
      [...componentEdges, { key: "b-edge", fromId: "b-0", toId: "b-1" }]
    );

    expect(base.maximumGroupSize).toBe(20);
    expect(base.maximumOffset).toBe(104);
    for (const edge of componentEdges) {
      expect(withUnrelatedComponent.routeIndexByKey.get(edge.key)).toBe(
        base.routeIndexByKey.get(edge.key)
      );
    }
  });

  it("separates overlapping same-column intervals across components", () => {
    const routing = computeSameColumnGraphRouting(
      [
        { id: "a", level: 1, centerY: 94 },
        { id: "b", level: 1, centerY: 224 },
        { id: "c", level: 1, centerY: 354 },
        { id: "d", level: 1, centerY: 484 }
      ],
      [
        { key: "a-c", fromId: "a", toId: "c" },
        { key: "b-d", fromId: "b", toId: "d" }
      ]
    );

    expect(routing.maximumGroupSize).toBe(2);
    expect(routing.routeIndexByKey.get("a-c")).not.toBe(routing.routeIndexByKey.get("b-d"));
  });

  it("disables fan buses next to same-column loops", () => {
    const fanoutNodes = [
      { id: "source", level: 0 },
      ...Array.from({ length: 6 }, (_, index) => ({ id: `target-${index}`, level: 1 }))
    ];
    const fanoutEdges = [
      ...Array.from({ length: 6 }, (_, index) => ({
        key: `fanout-${index}`,
        fromId: "source",
        toId: `target-${index}`
      })),
      { key: "target-loop", fromId: "target-0", toId: "target-1" }
    ];
    const faninNodes = [
      ...Array.from({ length: 6 }, (_, index) => ({ id: `input-${index}`, level: 0 })),
      { id: "merge", level: 1 }
    ];
    const faninEdges = [
      ...Array.from({ length: 6 }, (_, index) => ({
        key: `fanin-${index}`,
        fromId: `input-${index}`,
        toId: "merge"
      })),
      { key: "input-loop", fromId: "input-0", toId: "input-1" }
    ];

    expect(computeGraphFanoutBusKeys(fanoutNodes, fanoutEdges).size).toBe(0);
    expect(computeGraphFaninBusKeys(faninNodes, faninEdges).size).toBe(0);
  });

  it("places same-column loops outside long-route spines", () => {
    const nodes = [
      { id: "a", level: 1 },
      { id: "b", level: 1 }
    ];
    const edges = [{ key: "loop", fromId: "a", toId: "b" }];
    const baseOffset = 44;
    const routing = computeSameColumnGraphRouting(nodes, edges, baseOffset);
    const rect = { left: 28, top: 44, right: 280, bottom: 144 };

    expect(routing.maximumOffset).toBe(baseOffset);
    expect(
      buildObstacleAvoidingGraphPath(
        rect,
        rect,
        500,
        0,
        false,
        true,
        true,
        1,
        undefined,
        undefined,
        baseOffset
      )
    ).toContain("H324.0");
    expect(buildSameColumnGraphCasingPath(rect, rect, 0, true, baseOffset)).toBe(
      "M324.0 90.0 V98.0"
    );
  });

  it("keeps more than four long-edge corridors distinct", () => {
    const routeCount = 6;
    const paths = Array.from({ length: routeCount }, (_, routeIndex) =>
      buildObstacleAvoidingGraphPath(
        { left: 28, top: 80, right: 280, bottom: 180 },
        { left: 588, top: 200, right: 840, bottom: 300 },
        1000,
        routeIndex,
        false,
        false,
        false,
        routeCount
      )
    );

    expect(new Set(paths).size).toBe(paths.length);
  });

  it("centers Start and End nodes within the graph height", () => {
    expect(computeCenteredBoundaryY(500, 62)).toBe(219);
  });
});
