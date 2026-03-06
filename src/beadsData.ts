export interface BeadItem {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  updatedAt: string;
  commitHash: string;
  description: string;
  assignee: string;
  labels: string;
  createdAt: string;
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
    type: beadPickString(record, ["type", "kind", "category"], "task"),
    status: beadPickString(record, ["status", "state"], "open"),
    priority: beadPickString(record, ["priority", "p"], "P3"),
    description: beadPickString(record, ["description", "body", "details", "summary"], "-"),
    assignee: beadPickString(record, ["assignee", "owner", "assigned_to"], "-"),
    labels: beadPickStringArray(record, ["labels", "tags"], "-"),
    createdAt: beadPickString(record, ["created_at", "createdAt", "created"], "-"),
    updatedAt: beadPickString(record, ["updated_at", "updatedAt", "updated", "modified_at"], "-"),
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
