import { type BeadItem, buildBeadHierarchy } from "./beadsData";

export interface BeadRenderItem {
  item: BeadItem;
  parentId: string | null;
  epicId: string | null;
  depth: number;
  orderIndex: number;
  guideColumns: boolean[];
  isLastSibling: boolean;
}

interface BeadHierarchyOrderItem {
  item: BeadItem;
  parentId: string | null;
  epicId: string | null;
  depth: number;
  orderIndex: number;
}

export function beadUpdatedTimestamp(updatedAt: string) {
  const updatedTs = Date.parse(updatedAt);
  return Number.isNaN(updatedTs) ? 0 : updatedTs;
}

export function flattenBeadHierarchy(items: BeadItem[]): BeadRenderItem[] {
  const hierarchy: BeadHierarchyOrderItem[] = buildBeadHierarchy(items).map(
    (entry, orderIndex) => ({
      ...entry,
      orderIndex
    })
  );
  const rowsById = new Map(hierarchy.map((entry) => [entry.item.id, entry]));
  const childrenByParent = new Map<string, BeadHierarchyOrderItem[]>();
  const subtreeUpdatedCache = new Map<string, number>();

  for (const entry of hierarchy) {
    if (entry.parentId !== null && rowsById.has(entry.parentId)) {
      const children = childrenByParent.get(entry.parentId) ?? [];
      children.push(entry);
      childrenByParent.set(entry.parentId, children);
    }
  }

  const getSubtreeUpdatedTimestamp = (
    entry: BeadHierarchyOrderItem,
    visiting: Set<string>
  ): number => {
    const cached = subtreeUpdatedCache.get(entry.item.id);
    if (cached !== undefined) {
      return cached;
    }

    if (visiting.has(entry.item.id)) {
      return beadUpdatedTimestamp(entry.item.updatedAt);
    }

    visiting.add(entry.item.id);

    let latest = beadUpdatedTimestamp(entry.item.updatedAt);
    for (const child of childrenByParent.get(entry.item.id) ?? []) {
      latest = Math.max(latest, getSubtreeUpdatedTimestamp(child, visiting));
    }

    visiting.delete(entry.item.id);
    subtreeUpdatedCache.set(entry.item.id, latest);
    return latest;
  };

  const compareEntries = (a: BeadHierarchyOrderItem, b: BeadHierarchyOrderItem) => {
    const updatedDelta =
      getSubtreeUpdatedTimestamp(b, new Set<string>()) -
      getSubtreeUpdatedTimestamp(a, new Set<string>());
    if (updatedDelta !== 0) {
      return updatedDelta;
    }

    return a.orderIndex - b.orderIndex;
  };

  const roots = hierarchy
    .filter((entry) => entry.parentId === null || !rowsById.has(entry.parentId))
    .sort(compareEntries);
  const ordered: BeadRenderItem[] = [];
  const visited = new Set<string>();

  const appendSubtree = (
    entry: BeadHierarchyOrderItem,
    guideColumns: boolean[],
    isLastSibling: boolean
  ) => {
    if (visited.has(entry.item.id)) {
      return;
    }

    visited.add(entry.item.id);
    ordered.push({
      ...entry,
      guideColumns,
      isLastSibling
    });

    const children = [...(childrenByParent.get(entry.item.id) ?? [])].sort(compareEntries);
    const childGuideColumns = entry.depth > 0 ? [...guideColumns, !isLastSibling] : [];
    for (let i = 0; i < children.length; i++) {
      appendSubtree(children[i], childGuideColumns, i === children.length - 1);
    }
  };

  for (let i = 0; i < roots.length; i++) {
    appendSubtree(roots[i], [], i === roots.length - 1);
  }

  for (const entry of hierarchy) {
    appendSubtree(entry, [], true);
  }

  return ordered;
}
