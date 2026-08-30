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
  focusRank?: number;
  boundary?: boolean;
}

export interface GraphLayoutOptions {
  nodeWidth: number;
  levelGap: number;
  laneGap: number;
  componentGap: number;
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
  anchorY?: number;
}

export const GRAPH_ROUTE_LANE_GAP = 10;
export const GRAPH_ROUTE_X_LANE_GAP = 10;
export const GRAPH_ROUTE_EXIT_BASE = 12;
export const GRAPH_ROUTE_CORRIDOR_MARGIN = 38;
export const GRAPH_SAME_COLUMN_BASE_OFFSET = 14;
export const GRAPH_BOUNDARY_BUS_OFFSET = 24;
export const GRAPH_FANOUT_BUS_THRESHOLD = 6;
export const GRAPH_DIRECT_LEVEL_GAP_PER_COMPLEXITY = 10;
export const GRAPH_DIRECT_LEVEL_GAP_MAX = 1600;
export const GRAPH_DIRECT_CASING_ENDPOINT_CLEARANCE = 12;
export const GRAPH_CASING_BEND_CLEARANCE = 8;

export interface GraphPortConnection {
  key: string;
  nodeId: string;
  oppositeY: number;
  availableHeight: number;
}

export interface GraphRoutingEdge extends VisibleGraphEdge {
  key?: string;
  boundary?: boolean;
}

export interface GraphRoutingNode {
  id: string;
  level: number;
  centerY?: number;
}

export interface GraphCorridorSpineRoute {
  key: string;
  fromLevel: number;
  toLevel: number;
  sourceY: number;
  targetY: number;
  routeIndex: number;
  sharedTargetBus?: boolean;
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

export function resolveGraphCorridorY(
  sourceY: number,
  targetY: number,
  canvasHeight: number,
  routeIndex: number
) {
  const lane = Math.abs(routeIndex);
  const topCorridor = GRAPH_ROUTE_CORRIDOR_MARGIN + lane * GRAPH_ROUTE_LANE_GAP;
  const bottomCorridor = Math.max(
    topCorridor,
    canvasHeight - GRAPH_ROUTE_CORRIDOR_MARGIN - lane * GRAPH_ROUTE_LANE_GAP
  );
  const topDistance = Math.abs(sourceY - topCorridor) + Math.abs(targetY - topCorridor);
  const bottomDistance = Math.abs(sourceY - bottomCorridor) + Math.abs(targetY - bottomCorridor);
  return topDistance <= bottomDistance ? topCorridor : bottomCorridor;
}

export function resolveGraphBoundaryCorridorY(
  sourceY: number,
  canvasHeight: number,
  routeIndex: number
) {
  const lane = Math.abs(routeIndex);
  const topCorridor = GRAPH_ROUTE_CORRIDOR_MARGIN + lane * GRAPH_ROUTE_LANE_GAP;
  const bottomCorridor = Math.max(
    topCorridor,
    canvasHeight - GRAPH_ROUTE_CORRIDOR_MARGIN - lane * GRAPH_ROUTE_LANE_GAP
  );
  return Math.abs(sourceY - topCorridor) <= Math.abs(sourceY - bottomCorridor)
    ? topCorridor
    : bottomCorridor;
}

export function computeGraphCorridorSpineRouting(
  inputRoutes: Iterable<GraphCorridorSpineRoute>,
  canvasHeight: number
) {
  type ResolvedRoute = GraphCorridorSpineRoute & { side: "top" | "bottom" };
  const sourceGroups = new Map<string, ResolvedRoute[]>();
  const targetGroups = new Map<string, ResolvedRoute[]>();

  for (const route of inputRoutes) {
    const corridorY =
      route.sharedTargetBus === true
        ? resolveGraphBoundaryCorridorY(route.sourceY, canvasHeight, route.routeIndex)
        : resolveGraphCorridorY(route.sourceY, route.targetY, canvasHeight, route.routeIndex);
    const resolved = {
      ...route,
      side: corridorY <= canvasHeight / 2 ? ("top" as const) : ("bottom" as const)
    };
    const sourceKey = String(route.fromLevel);
    sourceGroups.set(sourceKey, [...(sourceGroups.get(sourceKey) ?? []), resolved]);
    if (route.sharedTargetBus !== true) {
      const targetKey = String(route.toLevel);
      targetGroups.set(targetKey, [...(targetGroups.get(targetKey) ?? []), resolved]);
    }
  }

  const sourceSpineIndexByKey = new Map<string, number>();
  const targetSpineIndexByKey = new Map<string, number>();
  const assign = (
    groups: ReadonlyMap<string, ResolvedRoute[]>,
    endpoint: "sourceY" | "targetY",
    output: Map<string, number>,
    shareTargetBusSpine = false
  ) => {
    for (const routes of groups.values()) {
      routes.sort((left, right) => {
        const sideOrder = left.side === right.side ? 0 : left.side === "top" ? -1 : 1;
        const endpointOrder =
          left.side === "top" ? left[endpoint] - right[endpoint] : right[endpoint] - left[endpoint];
        return (
          sideOrder ||
          endpointOrder ||
          left.routeIndex - right.routeIndex ||
          left.key.localeCompare(right.key)
        );
      });
      const sharedTargetBusRoutes = shareTargetBusSpine
        ? routes.filter((route) => route.sharedTargetBus === true)
        : [];
      const hasSharedTargetBus = sharedTargetBusRoutes.length > 0;
      for (const route of sharedTargetBusRoutes) {
        output.set(route.key, 0);
      }
      let nextIndex = hasSharedTargetBus ? 1 : 0;
      for (const route of routes) {
        if (route.sharedTargetBus === true && shareTargetBusSpine) {
          continue;
        }
        output.set(route.key, nextIndex);
        nextIndex += 1;
      }
    }
  };
  assign(sourceGroups, "sourceY", sourceSpineIndexByKey, true);
  assign(targetGroups, "targetY", targetSpineIndexByKey);
  return { sourceSpineIndexByKey, targetSpineIndexByKey };
}

export function buildObstacleAvoidingGraphPath(
  from: GraphConnectionRect,
  to: GraphConnectionRect,
  canvasHeight: number,
  routeIndex: number,
  directConnection = false,
  sameColumnConnection = false,
  selfConnection = false,
  routeCount = 1,
  sourceSpineIndex?: number,
  targetSpineIndex?: number,
  sameColumnBaseOffset = GRAPH_SAME_COLUMN_BASE_OFFSET
) {
  let sourceY = from.anchorY ?? from.top + (from.bottom - from.top) / 2;
  let targetY = to.anchorY ?? to.top + (to.bottom - to.top) / 2;
  if (selfConnection && Math.abs(sourceY - targetY) < 8) {
    const centerY = (sourceY + targetY) / 2;
    sourceY = centerY - 12;
    targetY = centerY + 12;
  }
  const point = (value: number) => value.toFixed(1);
  const sourceX = from.right;
  const targetX = to.left;
  const directGap = targetX - sourceX;
  if (directConnection && directGap >= 20) {
    const controlOffset = directGap / 2;
    return `M${point(sourceX)} ${point(sourceY)} C${point(sourceX + controlOffset)} ${point(sourceY)} ${point(targetX - controlOffset)} ${point(targetY)} ${point(targetX)} ${point(targetY)}`;
  }
  if (sameColumnConnection) {
    const useRightSide = Math.abs(routeIndex) % 2 === 0;
    const lane = Math.floor(Math.abs(routeIndex) / 2);
    const offset = sameColumnBaseOffset + lane * GRAPH_ROUTE_LANE_GAP;
    const sameColumnSourceX = useRightSide ? from.right : from.left;
    const sameColumnTargetX = useRightSide ? to.right : to.left;
    const loopX = useRightSide
      ? Math.max(from.right, to.right) + offset
      : Math.min(from.left, to.left) - offset;
    return `M${point(sameColumnSourceX)} ${point(sourceY)} H${point(loopX)} V${point(targetY)} H${point(sameColumnTargetX)}`;
  }
  const lane = Math.abs(routeIndex);
  const normalizedRouteCount = Math.max(lane + 1, Math.floor(Math.abs(routeCount)));
  const fallbackSpineIndex = normalizedRouteCount - lane - 1;
  const resolvedSourceSpineIndex = Math.max(
    0,
    Math.floor(Math.abs(sourceSpineIndex ?? fallbackSpineIndex))
  );
  const resolvedTargetSpineIndex = Math.max(
    0,
    Math.floor(Math.abs(targetSpineIndex ?? fallbackSpineIndex))
  );
  const corridorY = resolveGraphCorridorY(sourceY, targetY, canvasHeight, routeIndex);
  const sourceExitX =
    sourceX + GRAPH_ROUTE_EXIT_BASE + resolvedSourceSpineIndex * GRAPH_ROUTE_X_LANE_GAP;
  const targetEntryX =
    targetX - GRAPH_ROUTE_EXIT_BASE - resolvedTargetSpineIndex * GRAPH_ROUTE_X_LANE_GAP;
  return `M${point(sourceX)} ${point(sourceY)} H${point(sourceExitX)} V${point(corridorY)} H${point(targetEntryX)} V${point(targetY)} H${point(targetX)}`;
}

export function buildDirectGraphCasingPath(
  from: GraphConnectionRect,
  to: GraphConnectionRect,
  endpointClearance = GRAPH_DIRECT_CASING_ENDPOINT_CLEARANCE
) {
  const sourceY = from.anchorY ?? from.top + (from.bottom - from.top) / 2;
  const targetY = to.anchorY ?? to.top + (to.bottom - to.top) / 2;
  const sourceX = from.right;
  const targetX = to.left;
  const directGap = Math.max(1, targetX - sourceX);
  const controlX = sourceX + directGap / 2;
  const start = { x: sourceX, y: sourceY };
  const controlStart = { x: controlX, y: sourceY };
  const controlEnd = { x: controlX, y: targetY };
  const end = { x: targetX, y: targetY };
  const pointAt = (t: number) => {
    const inverse = 1 - t;
    return {
      x:
        inverse ** 3 * start.x +
        3 * inverse ** 2 * t * controlStart.x +
        3 * inverse * t ** 2 * controlEnd.x +
        t ** 3 * end.x,
      y:
        inverse ** 3 * start.y +
        3 * inverse ** 2 * t * controlStart.y +
        3 * inverse * t ** 2 * controlEnd.y +
        t ** 3 * end.y
    };
  };
  const clearance = Math.min(Math.max(0, endpointClearance), Math.max(0, directGap / 2 - 1));
  let lowerTrim = 0;
  let upperTrim = 0.5;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const candidate = (lowerTrim + upperTrim) / 2;
    if (pointAt(candidate).x - sourceX < clearance) {
      lowerTrim = candidate;
    } else {
      upperTrim = candidate;
    }
  }
  const startT = (lowerTrim + upperTrim) / 2;
  const endT = 1 - startT;
  const derivativeAt = (t: number) => {
    const inverse = 1 - t;
    return {
      x:
        3 * inverse ** 2 * (controlStart.x - start.x) +
        6 * inverse * t * (controlEnd.x - controlStart.x) +
        3 * t ** 2 * (end.x - controlEnd.x),
      y:
        3 * inverse ** 2 * (controlStart.y - start.y) +
        6 * inverse * t * (controlEnd.y - controlStart.y) +
        3 * t ** 2 * (end.y - controlEnd.y)
    };
  };
  const segmentStart = pointAt(startT);
  const segmentEnd = pointAt(endT);
  const segmentScale = (endT - startT) / 3;
  const startDerivative = derivativeAt(startT);
  const endDerivative = derivativeAt(endT);
  const segmentControlStart = {
    x: segmentStart.x + segmentScale * startDerivative.x,
    y: segmentStart.y + segmentScale * startDerivative.y
  };
  const segmentControlEnd = {
    x: segmentEnd.x - segmentScale * endDerivative.x,
    y: segmentEnd.y - segmentScale * endDerivative.y
  };
  const point = (value: number) => value.toFixed(1);
  return `M${point(segmentStart.x)} ${point(segmentStart.y)} C${point(segmentControlStart.x)} ${point(segmentControlStart.y)} ${point(segmentControlEnd.x)} ${point(segmentControlEnd.y)} ${point(segmentEnd.x)} ${point(segmentEnd.y)}`;
}

function moveGraphCoordinateToward(start: number, end: number, clearance: number) {
  const distance = end - start;
  const offset = Math.min(Math.abs(distance) / 2, Math.max(0, clearance));
  return start + Math.sign(distance) * offset;
}

export function buildObstacleAvoidingGraphCasingPath(
  from: GraphConnectionRect,
  to: GraphConnectionRect,
  canvasHeight: number,
  routeIndex: number,
  routeCount = 1,
  sourceSpineIndex?: number,
  targetSpineIndex?: number
) {
  const sourceY = from.anchorY ?? from.top + (from.bottom - from.top) / 2;
  const targetY = to.anchorY ?? to.top + (to.bottom - to.top) / 2;
  const lane = Math.abs(routeIndex);
  const normalizedRouteCount = Math.max(lane + 1, Math.floor(Math.abs(routeCount)));
  const fallbackSpineIndex = normalizedRouteCount - lane - 1;
  const resolvedSourceSpineIndex = Math.max(
    0,
    Math.floor(Math.abs(sourceSpineIndex ?? fallbackSpineIndex))
  );
  const resolvedTargetSpineIndex = Math.max(
    0,
    Math.floor(Math.abs(targetSpineIndex ?? fallbackSpineIndex))
  );
  const corridorY = resolveGraphCorridorY(sourceY, targetY, canvasHeight, routeIndex);
  const sourceExitX =
    from.right + GRAPH_ROUTE_EXIT_BASE + resolvedSourceSpineIndex * GRAPH_ROUTE_X_LANE_GAP;
  const targetEntryX =
    to.left - GRAPH_ROUTE_EXIT_BASE - resolvedTargetSpineIndex * GRAPH_ROUTE_X_LANE_GAP;
  const casingSourceY = moveGraphCoordinateToward(sourceY, corridorY, GRAPH_CASING_BEND_CLEARANCE);
  const casingTargetY = moveGraphCoordinateToward(targetY, corridorY, GRAPH_CASING_BEND_CLEARANCE);
  const point = (value: number) => value.toFixed(1);
  return `M${point(sourceExitX)} ${point(casingSourceY)} V${point(corridorY)} H${point(targetEntryX)} V${point(casingTargetY)}`;
}

export function buildSameColumnGraphCasingPath(
  from: GraphConnectionRect,
  to: GraphConnectionRect,
  routeIndex: number,
  selfConnection = false,
  sameColumnBaseOffset = GRAPH_SAME_COLUMN_BASE_OFFSET
) {
  let sourceY = from.anchorY ?? from.top + (from.bottom - from.top) / 2;
  let targetY = to.anchorY ?? to.top + (to.bottom - to.top) / 2;
  if (selfConnection && Math.abs(sourceY - targetY) < 8) {
    const centerY = (sourceY + targetY) / 2;
    sourceY = centerY - 12;
    targetY = centerY + 12;
  }
  const useRightSide = Math.abs(routeIndex) % 2 === 0;
  const lane = Math.floor(Math.abs(routeIndex) / 2);
  const offset = sameColumnBaseOffset + lane * GRAPH_ROUTE_LANE_GAP;
  const loopX = useRightSide
    ? Math.max(from.right, to.right) + offset
    : Math.min(from.left, to.left) - offset;
  const casingSourceY = moveGraphCoordinateToward(sourceY, targetY, GRAPH_CASING_BEND_CLEARANCE);
  const casingTargetY = moveGraphCoordinateToward(targetY, sourceY, GRAPH_CASING_BEND_CLEARANCE);
  const point = (value: number) => value.toFixed(1);
  return `M${point(loopX)} ${point(casingSourceY)} V${point(casingTargetY)}`;
}

export function buildBoundaryBusGraphPath(
  from: GraphConnectionRect,
  to: GraphConnectionRect,
  boundary: "start" | "end",
  canvasHeight = 0,
  longConnection = false,
  corridorIndex = 0,
  corridorCount = corridorIndex + 1,
  busOffset = GRAPH_BOUNDARY_BUS_OFFSET,
  sourceSpineIndex?: number
) {
  const sourceY = from.anchorY ?? from.top + (from.bottom - from.top) / 2;
  const targetY = to.anchorY ?? to.top + (to.bottom - to.top) / 2;
  const sourceX = from.right;
  const targetX = to.left;
  const availableGap = Math.max(0, targetX - sourceX);
  const maximumBusOffset = availableGap <= 24 ? availableGap / 2 : availableGap - 12;
  const resolvedBusOffset = Math.min(Math.max(0, busOffset), maximumBusOffset);
  const busX = boundary === "start" ? sourceX + resolvedBusOffset : targetX - resolvedBusOffset;
  const point = (value: number) => value.toFixed(1);
  if (boundary === "end" && longConnection && canvasHeight > GRAPH_ROUTE_CORRIDOR_MARGIN * 2) {
    const lane = Math.max(0, corridorIndex);
    const normalizedCorridorCount = Math.max(lane + 1, Math.floor(Math.abs(corridorCount)));
    const fallbackSpineIndex = normalizedCorridorCount - lane - 1;
    const resolvedSourceSpineIndex = Math.max(
      0,
      Math.floor(Math.abs(sourceSpineIndex ?? fallbackSpineIndex))
    );
    const corridorY = resolveGraphBoundaryCorridorY(sourceY, canvasHeight, corridorIndex);
    const sourceExitX =
      sourceX + GRAPH_ROUTE_EXIT_BASE + resolvedSourceSpineIndex * GRAPH_ROUTE_X_LANE_GAP;
    return `M${point(sourceX)} ${point(sourceY)} H${point(sourceExitX)} V${point(corridorY)} H${point(busX)} V${point(targetY)} H${point(targetX)}`;
  }
  return `M${point(sourceX)} ${point(sourceY)} H${point(busX)} V${point(targetY)} H${point(targetX)}`;
}

export function buildBoundaryBusGraphCasingPath(
  from: GraphConnectionRect,
  to: GraphConnectionRect,
  canvasHeight: number,
  corridorIndex: number,
  corridorCount: number,
  busOffset = GRAPH_BOUNDARY_BUS_OFFSET,
  sourceSpineIndex?: number
) {
  const sourceY = from.anchorY ?? from.top + (from.bottom - from.top) / 2;
  const targetY = to.anchorY ?? to.top + (to.bottom - to.top) / 2;
  const sourceX = from.right;
  const targetX = to.left;
  const availableGap = Math.max(0, targetX - sourceX);
  const maximumBusOffset = availableGap <= 24 ? availableGap / 2 : availableGap - 12;
  const resolvedBusOffset = Math.min(Math.max(0, busOffset), maximumBusOffset);
  const busX = targetX - resolvedBusOffset;
  const lane = Math.max(0, corridorIndex);
  const normalizedCorridorCount = Math.max(lane + 1, Math.floor(Math.abs(corridorCount)));
  const fallbackSpineIndex = normalizedCorridorCount - lane - 1;
  const resolvedSourceSpineIndex = Math.max(
    0,
    Math.floor(Math.abs(sourceSpineIndex ?? fallbackSpineIndex))
  );
  const corridorY = resolveGraphBoundaryCorridorY(sourceY, canvasHeight, corridorIndex);
  const sourceExitX =
    sourceX + GRAPH_ROUTE_EXIT_BASE + resolvedSourceSpineIndex * GRAPH_ROUTE_X_LANE_GAP;
  const casingSourceY = moveGraphCoordinateToward(sourceY, corridorY, GRAPH_CASING_BEND_CLEARANCE);
  const casingTargetY = moveGraphCoordinateToward(targetY, corridorY, GRAPH_CASING_BEND_CLEARANCE);
  const point = (value: number) => value.toFixed(1);
  return `M${point(sourceExitX)} ${point(casingSourceY)} V${point(corridorY)} H${point(busX)} V${point(casingTargetY)}`;
}

export function buildBoundaryBusGraphBranchPath(
  from: GraphConnectionRect,
  to: GraphConnectionRect,
  busOffset = GRAPH_BOUNDARY_BUS_OFFSET,
  sourceSpineIndex = 0
) {
  const sourceY = from.anchorY ?? from.top + (from.bottom - from.top) / 2;
  const targetY = to.anchorY ?? to.top + (to.bottom - to.top) / 2;
  const sourceX = from.right;
  const targetX = to.left;
  const availableGap = Math.max(0, targetX - sourceX);
  const maximumBusOffset = availableGap <= 24 ? availableGap / 2 : availableGap - 12;
  const resolvedBusOffset = Math.min(Math.max(0, busOffset), maximumBusOffset);
  const busX = targetX - resolvedBusOffset;
  const sourceExitX =
    sourceX +
    GRAPH_ROUTE_EXIT_BASE +
    Math.max(0, Math.floor(Math.abs(sourceSpineIndex))) * GRAPH_ROUTE_X_LANE_GAP;
  const point = (value: number) => value.toFixed(1);
  return `M${point(sourceX)} ${point(sourceY)} H${point(sourceExitX)} M${point(busX)} ${point(targetY)} H${point(targetX)}`;
}

export function buildFanoutBusGraphPath(
  from: GraphConnectionRect,
  to: GraphConnectionRect,
  busOffset = GRAPH_BOUNDARY_BUS_OFFSET
) {
  return buildBoundaryBusGraphPath(from, to, "start", 0, false, 0, 1, busOffset);
}

export function buildFaninBusGraphPath(
  from: GraphConnectionRect,
  to: GraphConnectionRect,
  busOffset = GRAPH_BOUNDARY_BUS_OFFSET
) {
  return buildBoundaryBusGraphPath(from, to, "end", 0, false, 0, 1, busOffset);
}

export function computeCenteredBoundaryY(graphHeight: number, boundaryHeight: number) {
  return Math.max(0, (graphHeight - Math.max(1, boundaryHeight)) / 2);
}

export function countGraphCorridorRoutes(
  nodes: Iterable<Pick<GraphLayoutNode, "id" | "level">>,
  edges: Iterable<GraphRoutingEdge>
) {
  const levelById = new Map(Array.from(nodes, (node) => [node.id, node.level]));
  let count = 0;
  for (const edge of edges) {
    if (edge.boundary === true) {
      continue;
    }
    const fromLevel = levelById.get(edge.fromId);
    const toLevel = levelById.get(edge.toId);
    if (
      fromLevel === undefined ||
      toLevel === undefined ||
      toLevel === fromLevel ||
      toLevel === fromLevel + 1
    ) {
      continue;
    }
    count += 1;
  }
  return count;
}

export function countGraphCorridorLanes(
  nodes: Iterable<Pick<GraphLayoutNode, "id" | "level">>,
  edges: Iterable<GraphRoutingEdge>
) {
  const resolvedNodes = Array.from(nodes);
  const resolvedEdges = Array.from(edges);
  const levelById = new Map(resolvedNodes.map((node) => [node.id, node.level]));
  const hasLongEndBoundary = resolvedEdges.some((edge) => {
    if (edge.boundary !== true) {
      return false;
    }
    const fromLevel = levelById.get(edge.fromId);
    const toLevel = levelById.get(edge.toId);
    return fromLevel !== undefined && toLevel !== undefined && toLevel > fromLevel + 1;
  });
  return countGraphCorridorRoutes(resolvedNodes, resolvedEdges) + (hasLongEndBoundary ? 1 : 0);
}

export function computeGraphFanoutBusKeys(
  nodes: Iterable<Pick<GraphLayoutNode, "id" | "level">>,
  inputEdges: Iterable<GraphRoutingEdge>,
  threshold = GRAPH_FANOUT_BUS_THRESHOLD
) {
  type FanoutGroup = {
    sourceLevel: number;
    gapKey: string;
    targetIds: Set<string>;
    keys: string[];
  };
  const levelById = new Map(Array.from(nodes, (node) => [node.id, node.level]));
  const edges = Array.from(inputEdges);
  const longSourceLevels = new Set<number>();
  const longTargetLevels = new Set<number>();
  const sameColumnLevels = new Set<number>();
  for (const edge of edges) {
    const fromLevel = levelById.get(edge.fromId);
    const toLevel = levelById.get(edge.toId);
    if (fromLevel === undefined || toLevel === undefined) {
      continue;
    }
    if (edge.boundary !== true && fromLevel === toLevel) {
      sameColumnLevels.add(fromLevel);
    }
    const longConnection =
      edge.boundary === true
        ? toLevel > fromLevel + 1
        : toLevel !== fromLevel && toLevel !== fromLevel + 1;
    if (longConnection) {
      longSourceLevels.add(fromLevel);
      longTargetLevels.add(toLevel);
    }
  }

  const groups = new Map<string, FanoutGroup>();
  edges.forEach((edge, index) => {
    const fromLevel = levelById.get(edge.fromId);
    const toLevel = levelById.get(edge.toId);
    if (
      edge.boundary === true ||
      fromLevel === undefined ||
      toLevel !== fromLevel + 1 ||
      edge.fromId === edge.toId
    ) {
      return;
    }
    const groupKey = edge.fromId + "\0" + toLevel;
    const group = groups.get(groupKey) ?? {
      sourceLevel: fromLevel,
      gapKey: String(fromLevel) + "\0" + toLevel,
      targetIds: new Set<string>(),
      keys: []
    };
    group.targetIds.add(edge.toId);
    group.keys.push(edge.key ?? "fanout:" + index + ":" + edge.fromId + ":" + edge.toId);
    groups.set(groupKey, group);
  });
  const groupsByGap = new Map<string, FanoutGroup[]>();
  for (const group of groups.values()) {
    groupsByGap.set(group.gapKey, [...(groupsByGap.get(group.gapKey) ?? []), group]);
  }
  const busKeys = new Set<string>();
  for (const gapGroups of groupsByGap.values()) {
    if (gapGroups.length !== 1) {
      continue;
    }
    const group = gapGroups[0];
    if (
      group.targetIds.size < Math.max(2, threshold) ||
      longSourceLevels.has(group.sourceLevel) ||
      longTargetLevels.has(group.sourceLevel + 1) ||
      sameColumnLevels.has(group.sourceLevel) ||
      sameColumnLevels.has(group.sourceLevel + 1)
    ) {
      continue;
    }
    group.keys.forEach((key) => busKeys.add(key));
  }
  return busKeys;
}

export function computeGraphFaninBusKeys(
  nodes: Iterable<Pick<GraphLayoutNode, "id" | "level">>,
  inputEdges: Iterable<GraphRoutingEdge>,
  threshold = GRAPH_FANOUT_BUS_THRESHOLD
) {
  type FaninGroup = {
    targetLevel: number;
    gapKey: string;
    sourceIds: Set<string>;
    keys: string[];
  };
  const levelById = new Map(Array.from(nodes, (node) => [node.id, node.level]));
  const edges = Array.from(inputEdges);
  const longSourceLevels = new Set<number>();
  const longTargetLevels = new Set<number>();
  const sameColumnLevels = new Set<number>();
  for (const edge of edges) {
    const fromLevel = levelById.get(edge.fromId);
    const toLevel = levelById.get(edge.toId);
    if (fromLevel === undefined || toLevel === undefined) {
      continue;
    }
    if (edge.boundary !== true && fromLevel === toLevel) {
      sameColumnLevels.add(fromLevel);
    }
    const longConnection =
      edge.boundary === true
        ? toLevel > fromLevel + 1
        : toLevel !== fromLevel && toLevel !== fromLevel + 1;
    if (longConnection) {
      longSourceLevels.add(fromLevel);
      longTargetLevels.add(toLevel);
    }
  }

  const groups = new Map<string, FaninGroup>();
  edges.forEach((edge, index) => {
    const fromLevel = levelById.get(edge.fromId);
    const toLevel = levelById.get(edge.toId);
    if (
      edge.boundary === true ||
      fromLevel === undefined ||
      toLevel !== fromLevel + 1 ||
      edge.fromId === edge.toId
    ) {
      return;
    }
    const groupKey = String(fromLevel) + "\0" + edge.toId;
    const group = groups.get(groupKey) ?? {
      targetLevel: toLevel,
      gapKey: String(fromLevel) + "\0" + toLevel,
      sourceIds: new Set<string>(),
      keys: []
    };
    group.sourceIds.add(edge.fromId);
    group.keys.push(edge.key ?? "fanin:" + index + ":" + edge.fromId + ":" + edge.toId);
    groups.set(groupKey, group);
  });
  const groupsByGap = new Map<string, FaninGroup[]>();
  for (const group of groups.values()) {
    groupsByGap.set(group.gapKey, [...(groupsByGap.get(group.gapKey) ?? []), group]);
  }
  const busKeys = new Set<string>();
  for (const gapGroups of groupsByGap.values()) {
    if (gapGroups.length !== 1) {
      continue;
    }
    const group = gapGroups[0];
    if (
      group.sourceIds.size < Math.max(2, threshold) ||
      longSourceLevels.has(group.targetLevel - 1) ||
      longTargetLevels.has(group.targetLevel) ||
      sameColumnLevels.has(group.targetLevel - 1) ||
      sameColumnLevels.has(group.targetLevel)
    ) {
      continue;
    }
    group.keys.forEach((key) => busKeys.add(key));
  }
  return busKeys;
}

export function computeGraphDirectLevelGap(
  nodes: Iterable<Pick<GraphLayoutNode, "id" | "level">>,
  inputEdges: Iterable<GraphRoutingEdge>,
  minimumGap: number
) {
  type GapGroup = {
    sourceIds: Set<string>;
    targetIds: Set<string>;
    sourceDegree: Map<string, number>;
    targetDegree: Map<string, number>;
  };
  const levelById = new Map(Array.from(nodes, (node) => [node.id, node.level]));
  const groups = new Map<string, GapGroup>();
  for (const edge of inputEdges) {
    if (edge.boundary === true) {
      continue;
    }
    const fromLevel = levelById.get(edge.fromId);
    const toLevel = levelById.get(edge.toId);
    if (fromLevel === undefined || toLevel !== fromLevel + 1) {
      continue;
    }
    const gapKey = `${fromLevel}\0${toLevel}`;
    const group = groups.get(gapKey) ?? {
      sourceIds: new Set<string>(),
      targetIds: new Set<string>(),
      sourceDegree: new Map<string, number>(),
      targetDegree: new Map<string, number>()
    };
    group.sourceIds.add(edge.fromId);
    group.targetIds.add(edge.toId);
    group.sourceDegree.set(edge.fromId, (group.sourceDegree.get(edge.fromId) ?? 0) + 1);
    group.targetDegree.set(edge.toId, (group.targetDegree.get(edge.toId) ?? 0) + 1);
    groups.set(gapKey, group);
  }
  let maximumMixedComplexity = 0;
  for (const group of groups.values()) {
    if (group.sourceIds.size < 2 || group.targetIds.size < 2) {
      continue;
    }
    maximumMixedComplexity = Math.max(
      maximumMixedComplexity,
      group.sourceIds.size,
      group.targetIds.size,
      ...group.sourceDegree.values(),
      ...group.targetDegree.values()
    );
  }
  const expandedGap =
    minimumGap + Math.max(0, maximumMixedComplexity - 3) * GRAPH_DIRECT_LEVEL_GAP_PER_COMPLEXITY;
  return Math.max(minimumGap, Math.min(GRAPH_DIRECT_LEVEL_GAP_MAX, expandedGap));
}

export function computeGraphPortOffsets(connections: Iterable<GraphPortConnection>) {
  const groupedByNode = new Map<string, GraphPortConnection[]>();
  for (const connection of connections) {
    groupedByNode.set(connection.nodeId, [
      ...(groupedByNode.get(connection.nodeId) ?? []),
      connection
    ]);
  }
  const offsets = new Map<string, number>();
  for (const grouped of groupedByNode.values()) {
    grouped.sort(
      (left, right) => left.oppositeY - right.oppositeY || left.key.localeCompare(right.key)
    );
    const availableHeight = Math.min(...grouped.map((connection) => connection.availableHeight));
    const span = Math.min(36, Math.max(0, availableHeight - 24));
    grouped.forEach((connection, index) => {
      offsets.set(
        connection.key,
        grouped.length < 2 ? 0 : -span / 2 + (index * span) / (grouped.length - 1)
      );
    });
  }
  return offsets;
}

export function computeSameColumnGraphRouting(
  nodes: Iterable<GraphRoutingNode>,
  inputEdges: Iterable<GraphRoutingEdge>,
  baseOffset = GRAPH_SAME_COLUMN_BASE_OFFSET
) {
  const resolvedNodes = Array.from(nodes);
  const levelById = new Map(resolvedNodes.map((node) => [node.id, node.level]));
  const centerYById = new Map(
    resolvedNodes.flatMap((node) =>
      Number.isFinite(node.centerY) ? [[node.id, node.centerY as number] as const] : []
    )
  );
  const edges = Array.from(inputEdges)
    .map((edge, index) => ({
      ...edge,
      resolvedKey: edge.key ?? `same-column:${index}:${edge.fromId}:${edge.toId}`
    }))
    .filter(
      (edge) =>
        edge.boundary !== true &&
        levelById.has(edge.fromId) &&
        levelById.get(edge.fromId) === levelById.get(edge.toId)
    );
  const routeIndexByKey = new Map<string, number>();
  let maximumGroupSize = 0;

  const canUseRenderedIntervals = edges.every(
    (edge) => centerYById.has(edge.fromId) && centerYById.has(edge.toId)
  );
  if (canUseRenderedIntervals) {
    const edgesByLevel = new Map<number, typeof edges>();
    for (const edge of edges) {
      const level = levelById.get(edge.fromId) ?? 0;
      edgesByLevel.set(level, [...(edgesByLevel.get(level) ?? []), edge]);
    }
    for (const levelEdges of edgesByLevel.values()) {
      const intervals = levelEdges
        .map((edge) => {
          const fromY = centerYById.get(edge.fromId) ?? 0;
          const toY = centerYById.get(edge.toId) ?? 0;
          return { edge, start: Math.min(fromY, toY), end: Math.max(fromY, toY) };
        })
        .sort(
          (left, right) =>
            left.start - right.start ||
            left.end - right.end ||
            left.edge.fromId.localeCompare(right.edge.fromId) ||
            left.edge.toId.localeCompare(right.edge.toId) ||
            left.edge.resolvedKey.localeCompare(right.edge.resolvedKey)
        );
      const routeEndY: number[] = [];
      for (const interval of intervals) {
        let routeIndex = routeEndY.findIndex((endY) => endY < interval.start);
        if (routeIndex < 0) {
          routeIndex = routeEndY.length;
          routeEndY.push(interval.end);
        } else {
          routeEndY[routeIndex] = interval.end;
        }
        routeIndexByKey.set(interval.edge.resolvedKey, routeIndex);
      }
      maximumGroupSize = Math.max(maximumGroupSize, routeEndY.length);
    }
  } else {
    const parentById = new Map<string, string>();
    const find = (id: string): string => {
      const parent = parentById.get(id);
      if (parent === undefined) {
        parentById.set(id, id);
        return id;
      }
      if (parent === id) {
        return id;
      }
      const root = find(parent);
      parentById.set(id, root);
      return root;
    };
    const union = (left: string, right: string) => {
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot === rightRoot) {
        return;
      }
      if (leftRoot.localeCompare(rightRoot) <= 0) {
        parentById.set(rightRoot, leftRoot);
      } else {
        parentById.set(leftRoot, rightRoot);
      }
    };
    for (const edge of edges) {
      union(edge.fromId, edge.toId);
    }
    const groupedEdges = new Map<string, typeof edges>();
    const countByLevel = new Map<number, number>();
    for (const edge of edges) {
      const level = levelById.get(edge.fromId) ?? 0;
      const groupKey = `${level}\0${find(edge.fromId)}`;
      groupedEdges.set(groupKey, [...(groupedEdges.get(groupKey) ?? []), edge]);
      countByLevel.set(level, (countByLevel.get(level) ?? 0) + 1);
    }
    maximumGroupSize = Math.max(0, ...countByLevel.values());
    for (const grouped of groupedEdges.values()) {
      grouped.sort(
        (left, right) =>
          left.fromId.localeCompare(right.fromId) ||
          left.toId.localeCompare(right.toId) ||
          left.resolvedKey.localeCompare(right.resolvedKey)
      );
      grouped.forEach((edge, index) => {
        routeIndexByKey.set(edge.resolvedKey, index);
      });
    }
  }

  const maximumOffset =
    maximumGroupSize === 0
      ? 0
      : baseOffset + Math.floor((maximumGroupSize - 1) / 2) * GRAPH_ROUTE_LANE_GAP;
  return { routeIndexByKey, maximumOffset, maximumGroupSize };
}

export function computeDependencyConnectedGraphLayout(
  inputNodes: GraphLayoutNode[],
  inputEdges: Iterable<VisibleGraphEdge>,
  options: GraphLayoutOptions
): GraphLayoutResult {
  const seenIds = new Set<string>();
  const nodes: GraphLayoutNode[] = [];
  for (const node of inputNodes) {
    if (node.id === "" || seenIds.has(node.id)) {
      continue;
    }
    seenIds.add(node.id);
    nodes.push(node);
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edges = Array.from(inputEdges).filter(
    (edge) => nodesById.has(edge.fromId) && nodesById.has(edge.toId)
  );
  const taskNodes = nodes.filter((node) => node.boundary !== true);
  const taskIds = new Set(taskNodes.map((node) => node.id));
  const adjacentIds = new Map(taskNodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of edges) {
    if (!taskIds.has(edge.fromId) || !taskIds.has(edge.toId)) {
      continue;
    }
    adjacentIds.get(edge.fromId)?.add(edge.toId);
    adjacentIds.get(edge.toId)?.add(edge.fromId);
  }

  const focusRank = (node: GraphLayoutNode) =>
    Number.isFinite(node.focusRank) ? (node.focusRank as number) : 2;
  const compareBaseOrder = (left: GraphLayoutNode, right: GraphLayoutNode) =>
    focusRank(left) - focusRank(right) || left.id.localeCompare(right.id);

  const remainingTaskIds = new Set(taskNodes.map((node) => node.id));
  const components: GraphLayoutNode[][] = [];
  for (const seed of [...taskNodes].sort(compareBaseOrder)) {
    if (!remainingTaskIds.delete(seed.id)) {
      continue;
    }
    const componentIds: string[] = [];
    const pending = [seed.id];
    while (pending.length > 0) {
      const id = pending.pop();
      if (id === undefined) {
        continue;
      }
      componentIds.push(id);
      for (const adjacentId of adjacentIds.get(id) ?? []) {
        if (remainingTaskIds.delete(adjacentId)) {
          pending.push(adjacentId);
        }
      }
    }
    components.push(
      componentIds
        .map((id) => nodesById.get(id))
        .filter((node): node is GraphLayoutNode => node !== undefined)
        .sort(compareBaseOrder)
    );
  }
  const componentFocusRank = (component: GraphLayoutNode[]) =>
    Math.min(...component.map(focusRank));
  const componentRoot = (component: GraphLayoutNode[]) => {
    const minimumLevel = Math.min(...component.map((node) => node.level));
    return component.filter((node) => node.level === minimumLevel).sort(compareBaseOrder)[0];
  };
  components.sort((left, right) => {
    const leftRoot = componentRoot(left);
    const rightRoot = componentRoot(right);
    return (
      componentFocusRank(left) - componentFocusRank(right) ||
      (leftRoot === undefined
        ? rightRoot === undefined
          ? 0
          : 1
        : rightRoot === undefined
          ? -1
          : compareBaseOrder(leftRoot, rightRoot)) ||
      (left[0]?.id ?? "").localeCompare(right[0]?.id ?? "")
    );
  });

  const incomingById = new Map(taskNodes.map((node) => [node.id, [] as string[]]));
  const outgoingById = new Map(taskNodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    if (!taskIds.has(edge.fromId) || !taskIds.has(edge.toId)) {
      continue;
    }
    outgoingById.get(edge.fromId)?.push(edge.toId);
    incomingById.get(edge.toId)?.push(edge.fromId);
  }

  const orderComponentLevels = (component: GraphLayoutNode[]) => {
    const componentIds = new Set(component.map((node) => node.id));
    const byLevel = new Map<number, GraphLayoutNode[]>();
    for (const node of component) {
      const levelNodes = byLevel.get(node.level) ?? [];
      levelNodes.push(node);
      byLevel.set(node.level, levelNodes);
    }
    for (const levelNodes of byLevel.values()) {
      levelNodes.sort(compareBaseOrder);
    }
    const levels = [...byLevel.keys()].sort((left, right) => left - right);
    const positions = new Map<string, number>();
    const updateLevelPositions = (level: number) => {
      const levelNodes = byLevel.get(level) ?? [];
      const denominator = Math.max(1, levelNodes.length);
      levelNodes.forEach((node, index) => {
        positions.set(node.id, (index + 0.5) / denominator);
      });
    };
    for (const level of levels) {
      updateLevelPositions(level);
    }
    const reorderLevel = (
      level: number,
      neighborIdsById: ReadonlyMap<string, string[]>,
      direction: "incoming" | "outgoing"
    ) => {
      const levelNodes = byLevel.get(level);
      if (levelNodes === undefined || levelNodes.length < 2) {
        return;
      }
      const barycenterById = new Map<string, number>();
      for (const node of levelNodes) {
        let total = 0;
        let count = 0;
        for (const id of neighborIdsById.get(node.id) ?? []) {
          if (!componentIds.has(id)) {
            continue;
          }
          const neighbor = nodesById.get(id);
          if (
            neighbor === undefined ||
            (direction === "incoming" ? neighbor.level >= node.level : neighbor.level <= node.level)
          ) {
            continue;
          }
          const position = positions.get(id);
          if (position !== undefined) {
            total += position;
            count += 1;
          }
        }
        if (count > 0) {
          barycenterById.set(node.id, total / count);
        }
      }
      levelNodes.sort((left, right) => {
        const leftCenter = barycenterById.get(left.id);
        const rightCenter = barycenterById.get(right.id);
        if (leftCenter !== undefined && rightCenter !== undefined && leftCenter !== rightCenter) {
          return leftCenter - rightCenter;
        }
        if (leftCenter !== undefined && rightCenter === undefined) {
          return -1;
        }
        if (leftCenter === undefined && rightCenter !== undefined) {
          return 1;
        }
        return compareBaseOrder(left, right);
      });
      updateLevelPositions(level);
    };

    for (let pass = 0; pass < 4; pass += 1) {
      for (const level of levels) {
        reorderLevel(level, incomingById, "incoming");
      }
      for (const level of [...levels].reverse()) {
        reorderLevel(level, outgoingById, "outgoing");
      }
    }
    return byLevel;
  };

  const levels = [...new Set(nodes.map((node) => node.level))].sort((left, right) => left - right);
  const xByLevel = new Map(
    levels.map((level, index) => [
      level,
      options.paddingX + index * (options.nodeWidth + options.levelGap)
    ])
  );
  const positionedNodes: GraphLayoutResult["nodes"] = [];
  const positionedLevels = levels.map((level) => ({
    level,
    centerX: (xByLevel.get(level) ?? options.paddingX) + options.nodeWidth / 2
  }));

  const componentLayouts = components.map((component) => {
    const byLevel = orderComponentLevels(component);
    const stackHeightByLevel = new Map<number, number>();
    for (const [level, levelNodes] of byLevel) {
      stackHeightByLevel.set(
        level,
        levelNodes.reduce((total, node) => total + Math.max(1, node.height), 0) +
          Math.max(0, levelNodes.length - 1) * options.laneGap
      );
    }
    return {
      byLevel,
      height: Math.max(1, ...stackHeightByLevel.values()),
      stackHeightByLevel
    };
  });
  const componentGap = Math.max(0, options.componentGap);
  const taskBodyHeight =
    componentLayouts.reduce((total, component) => total + component.height, 0) +
    Math.max(0, componentLayouts.length - 1) * componentGap;
  const boundaryHeight = Math.max(
    1,
    ...nodes.filter((node) => node.boundary === true).map((node) => Math.max(1, node.height))
  );
  const bodyHeight = Math.max(1, taskBodyHeight, boundaryHeight);
  let nextComponentY = options.paddingY;
  for (const component of componentLayouts) {
    for (const [level, levelNodes] of component.byLevel) {
      const stackHeight = component.stackHeightByLevel.get(level) ?? 1;
      let nextY = nextComponentY + (component.height - stackHeight) / 2;
      for (const node of levelNodes) {
        positionedNodes.push({
          id: node.id,
          x: xByLevel.get(level) ?? options.paddingX,
          y: nextY
        });
        nextY += Math.max(1, node.height) + options.laneGap;
      }
    }
    nextComponentY += component.height + componentGap;
  }

  for (const node of nodes.filter((candidate) => candidate.boundary === true)) {
    positionedNodes.push({
      id: node.id,
      x: xByLevel.get(node.level) ?? options.paddingX,
      y: options.paddingY + (bodyHeight - Math.max(1, node.height)) / 2
    });
  }

  const graphWidth =
    levels.length === 0
      ? options.paddingX * 2
      : options.paddingX * 2 +
        levels.length * options.nodeWidth +
        Math.max(0, levels.length - 1) * options.levelGap;
  return {
    width: Math.max(1, graphWidth),
    height: Math.max(1, options.paddingY * 2 + bodyHeight),
    nodes: positionedNodes,
    levels: positionedLevels
  };
}
