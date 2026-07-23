import { type PlanDraft } from "./planDraft";

export interface PlanGraphNode {
  id: string;
  title: string;
  priority: string;
  model?: string;
  ssot: string[];
  level: number;
}

export interface PlanGraphEdge {
  fromId: string;
  toId: string;
}

export interface PlanGraphProjection {
  nodes: PlanGraphNode[];
  edges: PlanGraphEdge[];
  criticalPathIds: string[];
  parallelGroups: string[][];
}

export function projectPlanDraftToGraph(draft: PlanDraft): PlanGraphProjection {
  const orderById = new Map(draft.tasks.map((task, index) => [task.id, index]));
  const taskById = new Map(draft.tasks.map((task) => [task.id, task]));
  const levelsById = new Map<string, number>();
  const pathById = new Map<string, string[]>();
  const visiting = new Set<string>();

  const resolve = (id: string): { level: number; path: string[] } => {
    const cachedLevel = levelsById.get(id);
    const cachedPath = pathById.get(id);
    if (cachedLevel !== undefined && cachedPath !== undefined) {
      return { level: cachedLevel, path: cachedPath };
    }
    if (visiting.has(id)) {
      return { level: 0, path: [id] };
    }
    visiting.add(id);
    const task = taskById.get(id);
    const incoming = (task?.dependencyIds ?? [])
      .map((dependencyId) => resolve(dependencyId))
      .sort((left, right) => {
        if (right.path.length !== left.path.length) {
          return right.path.length - left.path.length;
        }
        return left.path.join("\0").localeCompare(right.path.join("\0"));
      });
    const bestIncoming = incoming[0];
    const path = bestIncoming === undefined ? [id] : [...bestIncoming.path, id];
    const level = bestIncoming === undefined ? 0 : bestIncoming.level + 1;
    visiting.delete(id);
    levelsById.set(id, level);
    pathById.set(id, path);
    return { level, path };
  };

  const nodes = draft.tasks.map((task) => {
    const { level } = resolve(task.id);
    return {
      id: task.id,
      title: task.title,
      priority: task.priority,
      ...(task.model === undefined ? {} : { model: task.model }),
      ssot: [...task.ssot],
      level
    };
  });
  const edges = draft.tasks.flatMap((task) =>
    task.dependencyIds.map((dependencyId) => ({ fromId: dependencyId, toId: task.id }))
  );
  const criticalPathIds =
    edges.length === 0
      ? []
      : (draft.tasks
          .map((task) => pathById.get(task.id) ?? [task.id])
          .sort((left, right) => {
            if (right.length !== left.length) {
              return right.length - left.length;
            }
            return left.join("\0").localeCompare(right.join("\0"));
          })[0] ?? []);
  const groupedByLevel = new Map<number, string[]>();
  for (const node of nodes) {
    const ids = groupedByLevel.get(node.level) ?? [];
    ids.push(node.id);
    groupedByLevel.set(node.level, ids);
  }
  const parallelGroups = Array.from(groupedByLevel.entries())
    .sort(([left], [right]) => left - right)
    .map(([, ids]) =>
      ids.sort((left, right) => (orderById.get(left) ?? 0) - (orderById.get(right) ?? 0))
    )
    .filter((ids) => ids.length > 1);

  return { nodes, edges, criticalPathIds, parallelGroups };
}
