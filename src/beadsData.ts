export interface BeadItem {
  id: string;
  title: string;
  type: string;
  status: string;
  progress: number | null;
  priority: string;
  updatedAt: string;
  commitHash: string;
  description: string;
  notes: string;
  assignee: string;
  labels: string;
  createdAt: string;
  parentId: string;
}

export interface BeadHierarchyItem {
  item: BeadItem;
  parentId: string | null;
  epicId: string | null;
  depth: number;
}

export function beadsAsArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }

  const root = parsed as Record<string, unknown>;
  const candidateKeys = ["beads", "issues", "items", "tasks", "data"];
  for (const key of candidateKeys) {
    if (Array.isArray(root[key])) {
      return root[key] as unknown[];
    }
  }

  return [];
}

export function beadPickString(
  record: Record<string, unknown>,
  keys: string[],
  fallback: string = ""
) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return fallback;
}

export function beadPickStringArray(
  record: Record<string, unknown>,
  keys: string[],
  fallback: string = ""
) {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      const labels = value
        .filter((v): v is string => typeof v === "string" && v.trim() !== "")
        .map((v) => v.trim());
      if (labels.length > 0) return labels.join(", ");
    }
  }
  return fallback;
}

export function beadPickParentId(record: Record<string, unknown>) {
  const explicitParentId = beadPickString(
    record,
    [
      "parentId",
      "parent_id",
      "parent",
      "parentKey",
      "parent_key",
      "parentIssueId",
      "parent_issue_id",
      "epicId",
      "epic_id"
    ],
    ""
  );
  if (explicitParentId !== "") {
    return explicitParentId;
  }

  const dependencies = record.dependencies;
  if (!Array.isArray(dependencies)) {
    return "";
  }

  for (const dependency of dependencies) {
    if (typeof dependency !== "object" || dependency === null) {
      continue;
    }

    const dependencyRecord = dependency as Record<string, unknown>;
    const dependencyType = beadPickString(dependencyRecord, ["type"], "").toLowerCase();
    if (dependencyType !== "parent-child") {
      continue;
    }

    const parentId = beadPickString(dependencyRecord, ["depends_on_id", "dependsOnId"], "");
    if (parentId !== "") {
      return parentId;
    }
  }

  return "";
}

export function beadPickProgress(record: Record<string, unknown>): number | null {
  const directKeys = ["progress", "progressPercent", "progress_percentage", "percentComplete"];
  for (const key of directKeys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      if (value >= 0 && value <= 100) {
        return Math.round(value);
      }
    }
    if (typeof value === "string") {
      const match = value.match(/(100|[1-9]?\d)\s*%/);
      if (match) {
        return Number.parseInt(match[1], 10);
      }
    }
  }

  const textKeys = ["notes", "description", "body", "details", "summary"];
  for (const key of textKeys) {
    const value = record[key];
    if (typeof value !== "string") {
      continue;
    }

    const match = value.match(/(?:進捗|progress)\s*[:：]?\s*(100|[1-9]?\d)\s*%/i);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }

  return null;
}

export function toBeadItem(item: unknown): BeadItem | null {
  if (typeof item !== "object" || item === null) {
    return null;
  }

  const record = item as Record<string, unknown>;
  const id = beadPickString(record, ["id", "key", "slug", "issue", "name"]);
  const title = beadPickString(record, ["title", "summary", "name", "description"]);

  if (id === "" || title === "") {
    return null;
  }

  return {
    id,
    title,
    type: beadPickString(record, ["type", "kind", "category", "issue_type"], "task"),
    status: beadPickString(record, ["status", "state"], "open"),
    progress: beadPickProgress(record),
    priority: beadPickString(record, ["priority", "p"], "P3"),
    description: beadPickString(record, ["description", "body", "details", "summary"], "-"),
    notes: beadPickString(record, ["notes"], "-"),
    assignee: beadPickString(record, ["assignee", "owner", "assigned_to"], "-"),
    labels: beadPickStringArray(record, ["labels", "tags"], "-"),
    createdAt: beadPickString(record, ["created_at", "createdAt", "created"], "-"),
    updatedAt: beadPickString(record, ["updated_at", "updatedAt", "updated", "modified_at"], "-"),
    parentId: beadPickParentId(record),
    commitHash: beadPickString(record, ["commitHash", "commit_hash", "commit"], "")
  };
}

export function extractBeadItems(parsed: unknown): BeadItem[] {
  const items = beadsAsArray(parsed);
  const mapped = items
    .map((item) => toBeadItem(item))
    .filter((item): item is BeadItem => item !== null);

  return mapped.sort((a, b) => {
    const aTime = Date.parse(a.updatedAt);
    const bTime = Date.parse(b.updatedAt);
    if (!Number.isNaN(aTime) && !Number.isNaN(bTime)) {
      return bTime - aTime;
    }
    return a.id.localeCompare(b.id);
  });
}

function inferParentIdFromId(id: string, knownIds: Set<string>) {
  const lastDot = id.lastIndexOf(".");
  if (lastDot <= 0) {
    return null;
  }

  const candidate = id.slice(0, lastDot).trim();
  return candidate !== "" && knownIds.has(candidate) ? candidate : null;
}

export function buildBeadHierarchy(items: BeadItem[]): BeadHierarchyItem[] {
  const knownIds = new Set(items.map((item) => item.id));
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const parentCache = new Map<string, string | null>();
  const ancestryCache = new Map<string, { depth: number; epicId: string | null }>();

  const resolveParentId = (item: BeadItem) => {
    const cached = parentCache.get(item.id);
    if (cached !== undefined) {
      return cached;
    }

    const explicitParentId = item.parentId.trim();
    const resolvedParentId =
      explicitParentId !== "" && explicitParentId !== item.id && knownIds.has(explicitParentId)
        ? explicitParentId
        : inferParentIdFromId(item.id, knownIds);

    parentCache.set(item.id, resolvedParentId);
    return resolvedParentId;
  };

  const resolveAncestry = (
    itemId: string,
    visiting: Set<string>
  ): { depth: number; epicId: string | null } => {
    const cached = ancestryCache.get(itemId);
    if (cached) {
      return cached;
    }

    if (visiting.has(itemId)) {
      const fallback = { depth: 0, epicId: null };
      ancestryCache.set(itemId, fallback);
      return fallback;
    }

    const item = itemsById.get(itemId);
    if (!item) {
      return { depth: 0, epicId: null };
    }

    visiting.add(itemId);

    const parentId = resolveParentId(item);
    let depth = 0;
    let epicId: string | null = normalizeBeadType(item.type) === "epic" ? item.id : null;

    if (parentId !== null) {
      const parent = itemsById.get(parentId);
      if (parent) {
        const parentMeta = resolveAncestry(parentId, visiting);
        depth = parentMeta.depth + 1;
        epicId =
          parentMeta.epicId ?? (normalizeBeadType(parent.type) === "epic" ? parent.id : epicId);
      }
    }

    visiting.delete(itemId);

    const resolved = { depth, epicId };
    ancestryCache.set(itemId, resolved);
    return resolved;
  };

  return items.map((item) => {
    const parentId = resolveParentId(item);
    const ancestry = resolveAncestry(item.id, new Set<string>());
    return {
      item,
      parentId,
      epicId: ancestry.epicId,
      depth: ancestry.depth
    };
  });
}

export function normalizeBeadStatus(status: string) {
  const value = status.toLowerCase().replace(/\s+/g, "_");
  if (value === "open") return "open";
  if (value === "in_progress" || value === "in-progress" || value === "progress") {
    return "in_progress";
  }
  if (value === "blocked") return "blocked";
  if (value === "closed" || value === "done" || value === "resolved") return "closed";
  return "other";
}

export function beadStatusLabel(status: string) {
  if (status === "open") return "Open";
  if (status === "in_progress") return "In Progress";
  if (status === "blocked") return "Blocked";
  if (status === "closed") return "Closed";
  return "Other";
}

export function normalizeBeadPriority(priority: string) {
  const value = priority.trim().toUpperCase();
  const match = value.match(/P\s*([0-4])/i) ?? value.match(/([0-4])/);
  return match ? `P${match[1]}` : "P3";
}

export function normalizeBeadType(type: string) {
  const value = type.trim().toLowerCase();
  if (value === "feature" || value === "feat") return "feature";
  if (value === "bug" || value === "fix") return "bug";
  if (value === "task" || value === "chore") return "task";
  if (value === "epic") return "epic";
  return "other";
}

export function beadShortDate(raw: string): string {
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return raw;
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${min}`;
}
