export interface VisibleGraphEdge {
  fromId: string;
  toId: string;
}

export interface VisibleGraphState {
  edges: VisibleGraphEdge[];
  levelsById: Map<string, number>;
  criticalPathIds: string[];
  criticalEdgeKeys: Set<string>;
  cycleIds: Set<string>;
  cycleEdgeKeys: Set<string>;
}

export interface GraphBoundaryState {
  startIds: Set<string>;
  endIds: Set<string>;
}

export interface GraphLayoutNode {
  id: string;
  level: number;
  height: number;
}

export interface GraphLayoutOptions {
  nodeWidth: number;
  levelGap: number;
  columnGap: number;
  laneGap: number;
  paddingX: number;
  paddingY: number;
}

export interface GraphLayoutResult {
  width: number;
  height: number;
  nodes: Array<{ id: string; x: number; y: number }>;
  levels: Array<{ level: number; centerX: number }>;
}

export interface GraphRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphConnectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface GraphRelationPartition {
  visibleIds: string[];
  hiddenIds: string[];
  missingIds: string[];
}

export function graphEdgeKey(fromId: string, toId: string) {
  return `${fromId}\0${toId}`;
}

function computeGraphComponents(nodeIds: Iterable<string>, edges: VisibleGraphEdge[]) {
  const ids = Array.from(new Set(nodeIds)).sort((left, right) => left.localeCompare(right));
  const visibleIds = new Set(ids);
  const outgoingById = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of edges) {
    if (visibleIds.has(edge.fromId) && visibleIds.has(edge.toId)) {
      outgoingById.get(edge.fromId)?.push(edge.toId);
    }
  }
  for (const outgoing of outgoingById.values()) {
    outgoing.sort((left, right) => left.localeCompare(right));
  }

  let nextIndex = 0;
  const indexById = new Map<string, number>();
  const lowLinkById = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (id: string) => {
    indexById.set(id, nextIndex);
    lowLinkById.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);

    for (const targetId of outgoingById.get(id) ?? []) {
      if (!indexById.has(targetId)) {
        visit(targetId);
        lowLinkById.set(id, Math.min(lowLinkById.get(id) ?? 0, lowLinkById.get(targetId) ?? 0));
      } else if (onStack.has(targetId)) {
        lowLinkById.set(id, Math.min(lowLinkById.get(id) ?? 0, indexById.get(targetId) ?? 0));
      }
    }

    if (lowLinkById.get(id) !== indexById.get(id)) {
      return;
    }
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop();
      if (member === undefined) {
        break;
      }
      onStack.delete(member);
      component.push(member);
      if (member === id) {
        break;
      }
    }
    component.sort((left, right) => left.localeCompare(right));
    components.push(component);
  };

  for (const id of ids) {
    if (!indexById.has(id)) {
      visit(id);
    }
  }

  const componentById = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    for (const id of component) {
      componentById.set(id, componentIndex);
    }
  });
  const cycleComponentIds = new Set<number>();
  components.forEach((component, componentIndex) => {
    if (
      component.length > 1 ||
      edges.some((edge) => edge.fromId === component[0] && edge.toId === component[0])
    ) {
      cycleComponentIds.add(componentIndex);
    }
  });
  const cycleIds = new Set(
    components.flatMap((component, componentIndex) =>
      cycleComponentIds.has(componentIndex) ? component : []
    )
  );
  const cycleEdgeKeys = new Set(
    edges
      .filter((edge) => {
        const componentIndex = componentById.get(edge.fromId);
        return (
          componentIndex !== undefined &&
          componentIndex === componentById.get(edge.toId) &&
          cycleComponentIds.has(componentIndex)
        );
      })
      .map((edge) => graphEdgeKey(edge.fromId, edge.toId))
  );

  return { components, componentById, cycleIds, cycleEdgeKeys };
}

export function computeGraphBoundaryState(
  nodeIds: Iterable<string>,
  edges: Iterable<VisibleGraphEdge>
): GraphBoundaryState {
  const visibleIds = new Set(nodeIds);
  const visibleEdges = Array.from(edges).filter(
    (edge) => visibleIds.has(edge.fromId) && visibleIds.has(edge.toId)
  );
  const { components, componentById } = computeGraphComponents(visibleIds, visibleEdges);
  const incomingComponents = new Set<number>();
  const outgoingComponents = new Set<number>();
  for (const edge of visibleEdges) {
    const fromComponent = componentById.get(edge.fromId);
    const toComponent = componentById.get(edge.toId);
    if (fromComponent === undefined || toComponent === undefined || fromComponent === toComponent) {
      continue;
    }
    outgoingComponents.add(fromComponent);
    incomingComponents.add(toComponent);
  }

  const startIds = new Set<string>();
  const endIds = new Set<string>();
  components.forEach((component, componentIndex) => {
    if (component.length === 0) {
      return;
    }
    if (!incomingComponents.has(componentIndex)) {
      startIds.add(component[0]);
    }
    if (!outgoingComponents.has(componentIndex)) {
      endIds.add(component[component.length - 1]);
    }
  });

  return {
    startIds,
    endIds
  };
}

export function computeVisibleGraphState(
  nodeIds: Iterable<string>,
  candidateEdges: Iterable<VisibleGraphEdge>
): VisibleGraphState {
  const visibleIds = new Set(nodeIds);
  const edges = Array.from(candidateEdges).filter(
    (edge) => visibleIds.has(edge.fromId) && visibleIds.has(edge.toId)
  );
  const { components, componentById, cycleIds, cycleEdgeKeys } = computeGraphComponents(
    visibleIds,
    edges
  );
  const incomingComponents = new Map<number, Set<number>>(
    components.map((_, componentIndex) => [componentIndex, new Set<number>()])
  );
  for (const edge of edges) {
    const fromComponent = componentById.get(edge.fromId);
    const toComponent = componentById.get(edge.toId);
    if (fromComponent !== undefined && toComponent !== undefined && fromComponent !== toComponent) {
      incomingComponents.get(toComponent)?.add(fromComponent);
    }
  }
  const componentLevelCache = new Map<number, number>();
  const resolveComponentLevel = (componentIndex: number): number => {
    const cached = componentLevelCache.get(componentIndex);
    if (cached !== undefined) {
      return cached;
    }
    const incoming = Array.from(incomingComponents.get(componentIndex) ?? []);
    const level =
      incoming.length === 0
        ? 0
        : Math.max(...incoming.map((parentIndex) => resolveComponentLevel(parentIndex) + 1));
    componentLevelCache.set(componentIndex, level);
    return level;
  };
  const levelsById = new Map(
    Array.from(visibleIds, (id) => {
      const componentIndex = componentById.get(id);
      return [
        id,
        componentIndex === undefined ? 0 : resolveComponentLevel(componentIndex)
      ] as const;
    })
  );

  const incomingById = new Map<string, string[]>();
  for (const id of visibleIds) {
    incomingById.set(id, []);
  }
  for (const edge of edges) {
    incomingById.get(edge.toId)?.push(edge.fromId);
  }
  for (const incoming of incomingById.values()) {
    incoming.sort((left, right) => left.localeCompare(right));
  }

  const pathCache = new Map<string, string[]>();
  const resolveLongestPath = (id: string, visiting: Set<string>): string[] => {
    const cached = pathCache.get(id);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(id)) {
      return [];
    }

    visiting.add(id);
    const prefixes = (incomingById.get(id) ?? [])
      .map((parentId) => resolveLongestPath(parentId, visiting))
      .sort(
        (left, right) => right.length - left.length || left.join("|").localeCompare(right.join("|"))
      );
    visiting.delete(id);
    const path = prefixes.length > 0 ? [...prefixes[0], id] : [id];
    pathCache.set(id, path);
    return path;
  };

  const criticalPathIds =
    edges.length === 0 || cycleIds.size > 0
      ? []
      : (Array.from(visibleIds)
          .map((id) => resolveLongestPath(id, new Set<string>()))
          .sort(
            (left, right) =>
              right.length - left.length || left.join("|").localeCompare(right.join("|"))
          )[0] ?? []);
  const criticalEdgeKeys = new Set<string>();
  for (let index = 1; index < criticalPathIds.length; index += 1) {
    criticalEdgeKeys.add(graphEdgeKey(criticalPathIds[index - 1], criticalPathIds[index]));
  }

  return {
    edges,
    levelsById,
    criticalPathIds,
    criticalEdgeKeys,
    cycleIds,
    cycleEdgeKeys
  };
}

export function partitionGraphRelationIds(
  relatedIds: Iterable<string>,
  visibleIds: ReadonlySet<string>,
  missingIds: ReadonlySet<string> = new Set<string>()
): GraphRelationPartition {
  const visible: string[] = [];
  const hidden: string[] = [];
  const missing: string[] = [];
  for (const id of Array.from(new Set(relatedIds)).sort((left, right) =>
    left.localeCompare(right)
  )) {
    if (missingIds.has(id)) {
      missing.push(id);
    } else if (visibleIds.has(id)) {
      visible.push(id);
    } else {
      hidden.push(id);
    }
  }
  return { visibleIds: visible, hiddenIds: hidden, missingIds: missing };
}

export function formatGraphRelationPartition(partition: GraphRelationPartition) {
  return [
    ...partition.visibleIds,
    ...partition.hiddenIds.map((id) => `${id} (hidden)`),
    ...partition.missingIds.map((id) => `${id} (missing)`)
  ].join(", ");
}

export function buildObstacleAvoidingGraphPath(
  from: GraphConnectionRect,
  to: GraphConnectionRect,
  canvasHeight: number,
  routeIndex: number
) {
  const sourceX = from.right;
  const sourceY = from.top + (from.bottom - from.top) / 2;
  const targetX = to.left;
  const targetY = to.top + (to.bottom - to.top) / 2;
  const lane = Math.abs(routeIndex) % 4;
  const topCorridor = 12 + lane * 6;
  const bottomCorridor = Math.max(topCorridor, canvasHeight - 12 - lane * 6);
  const topDistance = Math.abs(sourceY - topCorridor) + Math.abs(targetY - topCorridor);
  const bottomDistance = Math.abs(sourceY - bottomCorridor) + Math.abs(targetY - bottomCorridor);
  const corridorY = topDistance <= bottomDistance ? topCorridor : bottomCorridor;
  const sourceExitX = sourceX + 12;
  const targetEntryX = targetX - 12;
  const point = (value: number) => value.toFixed(1);
  return `M${point(sourceX)} ${point(sourceY)} H${point(sourceExitX)} V${point(corridorY)} H${point(targetEntryX)} V${point(targetY)} H${point(targetX)}`;
}

export function computeCenteredBoundaryY(graphHeight: number, boundaryHeight: number) {
  return Math.max(0, (graphHeight - Math.max(1, boundaryHeight)) / 2);
}

export function computePackedGraphLayout(
  inputNodes: GraphLayoutNode[],
  options: GraphLayoutOptions
): GraphLayoutResult {
  const nodesByLevel = new Map<number, GraphLayoutNode[]>();
  for (const node of inputNodes) {
    const nodes = nodesByLevel.get(node.level) ?? [];
    nodes.push(node);
    nodesByLevel.set(node.level, nodes);
  }

  const levels = [...nodesByLevel.keys()].sort((left, right) => left - right);
  const positionedNodes: GraphLayoutResult["nodes"] = [];
  const positionedLevels: GraphLayoutResult["levels"] = [];
  let nextLevelX = options.paddingX;
  let graphHeight = options.paddingY * 2;

  for (const level of levels) {
    const nodes = nodesByLevel.get(level) ?? [];
    const rowCount = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    const columnCount = Math.max(1, Math.ceil(nodes.length / rowCount));
    const levelWidth =
      columnCount * options.nodeWidth + Math.max(0, columnCount - 1) * options.columnGap;
    let levelHeight = options.paddingY * 2;

    for (let column = 0; column < columnCount; column += 1) {
      let nextY = options.paddingY;
      const columnNodes = nodes.slice(column * rowCount, (column + 1) * rowCount);
      for (const node of columnNodes) {
        positionedNodes.push({
          id: node.id,
          x: nextLevelX + column * (options.nodeWidth + options.columnGap),
          y: nextY
        });
        nextY += Math.max(1, node.height) + options.laneGap;
      }
      if (columnNodes.length > 0) {
        nextY -= options.laneGap;
      }
      levelHeight = Math.max(levelHeight, nextY + options.paddingY);
    }

    positionedLevels.push({ level, centerX: nextLevelX + levelWidth / 2 });
    graphHeight = Math.max(graphHeight, levelHeight);
    nextLevelX += levelWidth + options.levelGap;
  }

  const graphWidth =
    levels.length === 0 ? options.paddingX * 2 : nextLevelX - options.levelGap + options.paddingX;
  return {
    width: Math.max(1, graphWidth),
    height: Math.max(1, graphHeight),
    nodes: positionedNodes,
    levels: positionedLevels
  };
}
