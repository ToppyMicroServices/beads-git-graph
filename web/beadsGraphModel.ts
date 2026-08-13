export interface VisibleGraphEdge {
  fromId: string;
  toId: string;
}

export interface VisibleGraphState {
  edges: VisibleGraphEdge[];
  levelsById: Map<string, number>;
  criticalPathIds: string[];
  criticalEdgeKeys: Set<string>;
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

export function graphEdgeKey(fromId: string, toId: string) {
  return `${fromId}\0${toId}`;
}

export function computeGraphBoundaryState(
  nodeIds: Iterable<string>,
  edges: Iterable<VisibleGraphEdge>
): GraphBoundaryState {
  const visibleIds = new Set(nodeIds);
  const incomingIds = new Set<string>();
  const outgoingIds = new Set<string>();
  for (const edge of edges) {
    if (!visibleIds.has(edge.fromId) || !visibleIds.has(edge.toId)) {
      continue;
    }
    outgoingIds.add(edge.fromId);
    incomingIds.add(edge.toId);
  }

  return {
    startIds: new Set(Array.from(visibleIds).filter((id) => !incomingIds.has(id))),
    endIds: new Set(Array.from(visibleIds).filter((id) => !outgoingIds.has(id)))
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

  const levelCache = new Map<string, number>();
  const resolveLevel = (id: string, visiting: Set<string>): number => {
    const cached = levelCache.get(id);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(id)) {
      return 0;
    }

    visiting.add(id);
    const incoming = incomingById.get(id) ?? [];
    const level =
      incoming.length === 0
        ? 0
        : Math.max(...incoming.map((parentId) => resolveLevel(parentId, visiting) + 1));
    visiting.delete(id);
    levelCache.set(id, level);
    return level;
  };
  const levelsById = new Map(
    Array.from(visibleIds, (id) => [id, resolveLevel(id, new Set<string>())] as const)
  );

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
    edges.length === 0
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

  return { edges, levelsById, criticalPathIds, criticalEdgeKeys };
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
