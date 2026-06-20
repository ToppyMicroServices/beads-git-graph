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
  dependencyIds: string[];
  parallelizable: boolean;
  parallelizableSource: "explicit" | "ready" | "";
  parallelizableSuppressed: boolean;
  agent: string;
  model: string;
  ssot: string;
  worktree: string;
  branch: string;
  pullRequest: string;
  checkStatus: string;
  syncRisk: string;
  synthetic: boolean;
  syntheticKind: "" | "parallel-pr-merge";
}

export interface BeadHierarchyItem {
  item: BeadItem;
  parentId: string | null;
  epicId: string | null;
  depth: number;
}

export interface BeadCollectionDiff {
  missingFromPrimary: string[];
  missingFromSecondary: string[];
  changed: Array<{ id: string; fields: string[] }>;
}

export interface BeadDependencyGraphNode {
  item: BeadItem;
  level: number;
  critical: boolean;
}

export interface BeadDependencyGraphEdge {
  fromId: string;
  toId: string;
  critical: boolean;
}

export interface BeadDependencyGraph {
  nodes: BeadDependencyGraphNode[];
  edges: BeadDependencyGraphEdge[];
  criticalPathIds: string[];
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

function beadPickStringTokens(record: Record<string, unknown>, keys: string[]) {
  const tokens: string[] = [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      tokens.push(...value.filter((v): v is string => typeof v === "string" && v.trim() !== ""));
    } else if (typeof value === "string") {
      tokens.push(...value.split(","));
    }
  }

  return tokens.map((token) => token.trim()).filter((token) => token !== "");
}

function normalizeToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function normalizeUniqueIds(ids: string[], selfId: string = "") {
  return [...new Set(ids.map((id) => id.trim()).filter((id) => id !== "" && id !== selfId))].sort(
    (a, b) => a.localeCompare(b)
  );
}

function compareBeadItemsByUpdatedDesc(a: BeadItem, b: BeadItem) {
  const aTime = Date.parse(a.updatedAt);
  const bTime = Date.parse(b.updatedAt);
  if (!Number.isNaN(aTime) && !Number.isNaN(bTime)) {
    return bTime - aTime;
  }
  if (!Number.isNaN(aTime)) {
    return -1;
  }
  if (!Number.isNaN(bTime)) {
    return 1;
  }
  return a.id.localeCompare(b.id);
}

function beadPickStringFromTokens(record: Record<string, unknown>, prefixes: string[]) {
  const normalizedPrefixes = prefixes.map(normalizeToken);
  for (const token of beadPickStringTokens(record, ["labels", "tags"])) {
    const trimmed = token.trim();
    const normalized = normalizeToken(trimmed);
    for (const prefix of normalizedPrefixes) {
      if (normalized.startsWith(`${prefix}:`) || normalized.startsWith(`${prefix}=`)) {
        return trimmed.slice(prefix.length + 1).trim();
      }
      if (normalized.startsWith(`${prefix}/`)) {
        return trimmed.slice(prefix.length + 1).trim();
      }
    }
  }

  return "";
}

function beadPickStructuredString(
  record: Record<string, unknown>,
  keys: string[],
  tokenPrefixes: string[]
) {
  const direct = beadPickString(record, keys, "");
  if (direct !== "") {
    return direct;
  }

  const metadata = record.metadata;
  if (typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)) {
    const metadataValue = beadPickString(metadata as Record<string, unknown>, keys);
    if (metadataValue !== "") {
      return metadataValue;
    }
  }
  if (typeof metadata === "string" && metadata.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(metadata) as Record<string, unknown>;
      const metadataValue = beadPickString(parsed, keys);
      if (metadataValue !== "") {
        return metadataValue;
      }
    } catch {}
  }

  return beadPickStringFromTokens(record, tokenPrefixes);
}

export function beadPickParallelizable(record: Record<string, unknown>) {
  return beadPickParallelizablePreference(record) === "yes";
}

export function beadPickParallelizablePreference(record: Record<string, unknown>) {
  const directKeys = [
    "parallelizable",
    "parallel",
    "parallel_ok",
    "parallelOk",
    "can_parallel",
    "canParallel",
    "can_run_parallel",
    "canRunParallel"
  ];

  for (const key of directKeys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value ? "yes" : "no";
    }
    if (typeof value === "string") {
      const normalized = normalizeToken(value);
      if (["true", "yes", "y", "1", "parallel", "parallel-ok"].includes(normalized)) {
        return "yes";
      }
      if (["false", "no", "n", "0", "serial", "sequential"].includes(normalized)) {
        return "no";
      }
    }
  }

  const labels = beadPickStringTokens(record, ["labels", "tags"]).map(normalizeToken);
  if (labels.some((label) => ["serial", "sequential", "no-parallel"].includes(label))) {
    return "no";
  }
  return labels.some((label) =>
    ["parallel", "parallel-ok", "parallelizable", "multi-agent", "multiagent"].includes(label)
  )
    ? "yes"
    : "";
}

export function beadPickAgent(record: Record<string, unknown>) {
  return beadPickStructuredString(
    record,
    ["agent", "agent_id", "agentId", "assigned_agent", "assignedAgent"],
    ["agent", "agent-id", "assigned-agent"]
  );
}

export function beadPickModel(record: Record<string, unknown>) {
  return beadPickStructuredString(
    record,
    ["model", "ai_model", "aiModel", "agent_model", "agentModel"],
    ["model", "ai-model", "agent-model"]
  );
}

export function beadPickSsot(record: Record<string, unknown>) {
  return beadPickStructuredString(
    record,
    [
      "ssot",
      "context",
      "reference_context",
      "referenceContext",
      "source_of_truth",
      "sourceOfTruth"
    ],
    ["ssot", "context", "source-of-truth"]
  );
}

export function beadPickWorktree(record: Record<string, unknown>) {
  const direct = beadPickString(
    record,
    ["worktree", "worktree_path", "worktreePath", "worktree_branch", "worktreeBranch"],
    ""
  );
  return direct !== "" ? direct : beadPickStringFromTokens(record, ["worktree", "wt"]);
}

export function beadPickBranch(record: Record<string, unknown>) {
  return beadPickStructuredString(
    record,
    ["branch", "git_branch", "gitBranch", "pr_branch", "prBranch"],
    ["branch", "git-branch", "pr-branch"]
  );
}

export function beadPickPullRequest(record: Record<string, unknown>) {
  return beadPickStructuredString(
    record,
    ["pull_request", "pullRequest", "pr", "pr_number", "prNumber", "github_pr", "githubPr"],
    ["pr", "pull-request", "github-pr"]
  );
}

export function beadPickCheckStatus(record: Record<string, unknown>) {
  return beadPickStructuredString(
    record,
    ["check_status", "checkStatus", "checks", "checks_status", "ci_status", "ciStatus"],
    ["checks", "check-status", "ci"]
  );
}

export function beadPickSyncRisk(record: Record<string, unknown>) {
  return beadPickStructuredString(
    record,
    ["sync_risk", "syncRisk", "merge_risk", "mergeRisk", "worktree_risk", "worktreeRisk"],
    ["sync-risk", "merge-risk", "worktree-risk", "risk"]
  );
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
    const dependencyType = normalizeToken(
      beadPickString(dependencyRecord, ["type", "dependency_type", "dependencyType"], "")
    );
    if (dependencyType !== "parent-child") {
      continue;
    }

    const parentId = beadPickString(
      dependencyRecord,
      ["depends_on_id", "dependsOnId", "id", "dependency_id", "dependencyId"],
      ""
    );
    if (parentId !== "") {
      return parentId;
    }
  }

  return "";
}

function beadPickStringList(record: Record<string, unknown>, keys: string[]) {
  const values: string[] = [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      values.push(
        ...value
          .filter(
            (item): item is string | number => typeof item === "string" || typeof item === "number"
          )
          .map((item) => String(item))
      );
    } else if (typeof value === "string" || typeof value === "number") {
      values.push(...String(value).split(","));
    }
  }

  return values.map((value) => value.trim()).filter((value) => value !== "");
}

function isExecutionDependencyType(type: string) {
  const normalized = normalizeToken(type);
  return (
    normalized !== "" &&
    ![
      "parent-child",
      "parent",
      "child",
      "relates-to",
      "related",
      "duplicate",
      "duplicates",
      "supersedes",
      "superseded-by"
    ].includes(normalized)
  );
}

export function beadPickDependencyIds(record: Record<string, unknown>, selfId: string = "") {
  const dependencyIds = beadPickStringList(record, [
    "dependencyIds",
    "dependency_ids",
    "dependencies_ids",
    "dependsOn",
    "depends_on",
    "depends_on_ids",
    "blockedBy",
    "blocked_by",
    "blocked_by_ids",
    "blockers"
  ]);

  const dependencies = record.dependencies;
  if (Array.isArray(dependencies)) {
    for (const dependency of dependencies) {
      if (typeof dependency !== "object" || dependency === null) {
        continue;
      }

      const dependencyRecord = dependency as Record<string, unknown>;
      const dependencyType = beadPickString(
        dependencyRecord,
        ["type", "dependency_type", "dependencyType"],
        "blocks"
      );
      if (!isExecutionDependencyType(dependencyType)) {
        continue;
      }

      const dependencyId = beadPickString(
        dependencyRecord,
        ["depends_on_id", "dependsOnId", "dependency_id", "dependencyId", "id"],
        ""
      );
      if (dependencyId !== "") {
        dependencyIds.push(dependencyId);
      }
    }
  }

  return normalizeUniqueIds(dependencyIds, selfId);
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
  const parallelizablePreference = beadPickParallelizablePreference(record);

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
    dependencyIds: beadPickDependencyIds(record, id),
    parallelizable: parallelizablePreference === "yes",
    parallelizableSource: parallelizablePreference === "yes" ? "explicit" : "",
    parallelizableSuppressed: parallelizablePreference === "no",
    agent: beadPickAgent(record),
    model: beadPickModel(record),
    ssot: beadPickSsot(record),
    worktree: beadPickWorktree(record),
    branch: beadPickBranch(record),
    pullRequest: beadPickPullRequest(record),
    checkStatus: beadPickCheckStatus(record),
    syncRisk: beadPickSyncRisk(record),
    commitHash: beadPickString(record, ["commitHash", "commit_hash", "commit"], ""),
    synthetic: false,
    syntheticKind: ""
  };
}

export function extractBeadItems(parsed: unknown): BeadItem[] {
  const items = beadsAsArray(parsed);
  const mapped = items
    .map((item) => toBeadItem(item))
    .filter((item): item is BeadItem => item !== null);

  return mapped.sort(compareBeadItemsByUpdatedDesc);
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

export function mergeBeadItems(primaryItems: BeadItem[], fallbackItems: BeadItem[]): BeadItem[] {
  if (fallbackItems.length === 0) {
    return primaryItems;
  }

  const fallbackById = new Map(fallbackItems.map((item) => [item.id, item]));
  const merged = primaryItems.map((item) => {
    const fallback = fallbackById.get(item.id);
    if (!fallback) {
      return item;
    }

    const parallelizable = item.parallelizable || fallback.parallelizable;
    const parallelizableSource = item.parallelizable
      ? item.parallelizableSource
      : fallback.parallelizable
        ? fallback.parallelizableSource
        : "";
    const dependencyIds = normalizeUniqueIds(
      [...item.dependencyIds, ...fallback.dependencyIds],
      item.id
    );

    return {
      ...fallback,
      ...item,
      parentId: item.parentId.trim() !== "" ? item.parentId : fallback.parentId,
      dependencyIds,
      parallelizable,
      parallelizableSource,
      parallelizableSuppressed:
        !parallelizable && (item.parallelizableSuppressed || fallback.parallelizableSuppressed),
      agent: item.agent.trim() !== "" ? item.agent : fallback.agent,
      model: item.model.trim() !== "" ? item.model : fallback.model,
      ssot: item.ssot.trim() !== "" ? item.ssot : fallback.ssot,
      worktree: item.worktree.trim() !== "" ? item.worktree : fallback.worktree,
      branch: item.branch.trim() !== "" ? item.branch : fallback.branch,
      pullRequest: item.pullRequest.trim() !== "" ? item.pullRequest : fallback.pullRequest,
      checkStatus: item.checkStatus.trim() !== "" ? item.checkStatus : fallback.checkStatus,
      syncRisk: item.syncRisk.trim() !== "" ? item.syncRisk : fallback.syncRisk,
      synthetic: item.synthetic || fallback.synthetic,
      syntheticKind: item.syntheticKind || fallback.syntheticKind
    };
  });

  const seenIds = new Set(merged.map((item) => item.id));
  for (const fallback of fallbackItems) {
    if (!seenIds.has(fallback.id)) {
      merged.push(fallback);
    }
  }

  return merged;
}

export function inferReadyParallelizableItems(
  items: BeadItem[],
  readyItemIds: ReadonlySet<string>
) {
  const eligibleReadyIds = new Set(
    items
      .filter((item) => {
        if (item.parallelizable || item.parallelizableSuppressed) {
          return false;
        }
        if (!readyItemIds.has(item.id)) {
          return false;
        }
        if (normalizeBeadType(item.type) === "epic") {
          return false;
        }
        const status = normalizeBeadStatus(item.status);
        return status === "open" || status === "in_progress";
      })
      .map((item) => item.id)
  );

  if (eligibleReadyIds.size < 2) {
    return items;
  }

  return items.map((item) =>
    eligibleReadyIds.has(item.id)
      ? { ...item, parallelizable: true, parallelizableSource: "ready" as const }
      : item
  );
}

export function deriveParallelMergeItems(items: BeadItem[]) {
  const hierarchy = buildBeadHierarchy(items);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const groups = new Map<string, { anchorId: string; anchorTitle: string; entries: BeadItem[] }>();

  for (const entry of hierarchy) {
    const item = entry.item;
    if (item.synthetic || !item.parallelizable || item.worktree.trim() === "") {
      continue;
    }

    const anchorId = entry.parentId ?? entry.epicId;
    const anchor = anchorId ? itemsById.get(anchorId) : undefined;
    if (!anchorId || !anchor || anchor.synthetic) {
      continue;
    }

    const group = groups.get(anchorId) ?? {
      anchorId,
      anchorTitle: anchor.title,
      entries: []
    };
    group.entries.push(item);
    groups.set(anchorId, group);
  }

  const derivedItems: BeadItem[] = [];
  for (const group of groups.values()) {
    const uniqueWorktrees = new Set(
      group.entries.map((item) => item.worktree.trim()).filter((worktree) => worktree !== "")
    );
    if (group.entries.length < 2 || uniqueWorktrees.size < 2) {
      continue;
    }

    const dependencyItems = [...group.entries].sort((a, b) => a.id.localeCompare(b.id));
    const dependencyIds = dependencyItems.map((item) => item.id);
    const mergeId = `merge:${group.anchorId}`;
    if (itemsById.has(mergeId)) {
      continue;
    }

    const latestItem = [...dependencyItems].sort(compareBeadItemsByUpdatedDesc)[0];
    const priority = dependencyItems
      .map((item) => normalizeBeadPriority(item.priority))
      .sort((a, b) => Number.parseInt(a.slice(1), 10) - Number.parseInt(b.slice(1), 10))[0];
    const readyToMerge = dependencyItems.every(
      (item) => normalizeBeadStatus(item.status) === "closed"
    );
    const worktreeSummary = dependencyItems
      .map((item) => `${item.id} (${item.worktree.trim()})`)
      .join(", ");

    derivedItems.push({
      id: mergeId,
      title: `Merge parallel PRs (${dependencyIds.length})`,
      type: "task",
      status: readyToMerge ? "open" : "blocked",
      progress: null,
      priority,
      updatedAt: latestItem?.updatedAt ?? "-",
      commitHash: "",
      description: `Derived merge step for parallel worktrees under ${group.anchorTitle}: ${worktreeSummary}`,
      notes: "Wait for each parallel worktree PR to be ready, then merge them in sequence.",
      assignee: "-",
      labels: "derived, pr-merge",
      createdAt: latestItem?.createdAt ?? "-",
      parentId: group.anchorId,
      dependencyIds,
      parallelizable: false,
      parallelizableSource: "",
      parallelizableSuppressed: false,
      agent: "",
      model: "",
      ssot: dependencyIds.map((id) => `bd:${id}`).join(", "),
      worktree: "",
      branch: "",
      pullRequest: "",
      checkStatus: readyToMerge ? "ready" : "waiting",
      syncRisk: readyToMerge ? "pending preflight" : "blocked",
      synthetic: true,
      syntheticKind: "parallel-pr-merge"
    });
  }

  return [...items, ...derivedItems].sort(compareBeadItemsByUpdatedDesc);
}

export function buildBeadDependencyGraph(items: BeadItem[]): BeadDependencyGraph {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const edges = items.flatMap((item) =>
    item.dependencyIds
      .filter((dependencyId) => itemsById.has(dependencyId))
      .map((dependencyId) => ({ fromId: dependencyId, toId: item.id, critical: false }))
  );
  const incomingById = new Map<string, string[]>();
  const outgoingById = new Map<string, string[]>();
  for (const item of items) {
    incomingById.set(item.id, []);
    outgoingById.set(item.id, []);
  }
  for (const edge of edges) {
    incomingById.get(edge.toId)?.push(edge.fromId);
    outgoingById.get(edge.fromId)?.push(edge.toId);
  }

  const levelCache = new Map<string, number>();
  const resolveLevel = (id: string, visiting: Set<string>): number => {
    const cached = levelCache.get(id);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(id)) {
      levelCache.set(id, 0);
      return 0;
    }

    visiting.add(id);
    const blockers = incomingById.get(id) ?? [];
    const level =
      blockers.length === 0
        ? 0
        : Math.max(...blockers.map((blockerId) => resolveLevel(blockerId, visiting) + 1));
    visiting.delete(id);
    levelCache.set(id, level);
    return level;
  };

  const longestPathCache = new Map<string, string[]>();
  const resolveLongestPath = (id: string, visiting: Set<string>): string[] => {
    const cached = longestPathCache.get(id);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(id)) {
      return [id];
    }

    visiting.add(id);
    const blockers = incomingById.get(id) ?? [];
    const prefix = blockers
      .map((blockerId) => resolveLongestPath(blockerId, visiting))
      .sort((a, b) => b.length - a.length || a.join("|").localeCompare(b.join("|")))[0];
    visiting.delete(id);

    const path = prefix ? [...prefix, id] : [id];
    longestPathCache.set(id, path);
    return path;
  };

  const criticalPathIds =
    edges.length === 0
      ? []
      : (items
          .map((item) => resolveLongestPath(item.id, new Set<string>()))
          .sort((a, b) => b.length - a.length || a.join("|").localeCompare(b.join("|")))[0] ?? []);
  const criticalIds = new Set(criticalPathIds);
  const criticalEdges = new Set<string>();
  for (let i = 1; i < criticalPathIds.length; i += 1) {
    criticalEdges.add(`${criticalPathIds[i - 1]}\u0000${criticalPathIds[i]}`);
  }

  return {
    nodes: items
      .map((item) => ({
        item,
        level: resolveLevel(item.id, new Set<string>()),
        critical: criticalIds.has(item.id)
      }))
      .sort((a, b) => a.level - b.level || a.item.id.localeCompare(b.item.id)),
    edges: edges.map((edge) => ({
      ...edge,
      critical: criticalEdges.has(`${edge.fromId}\u0000${edge.toId}`)
    })),
    criticalPathIds
  };
}

export function diffBeadItems(
  primaryItems: BeadItem[],
  secondaryItems: BeadItem[]
): BeadCollectionDiff {
  const primaryById = new Map(primaryItems.map((item) => [item.id, item]));
  const secondaryById = new Map(secondaryItems.map((item) => [item.id, item]));
  const comparableFields: Array<keyof BeadItem> = [
    "title",
    "type",
    "status",
    "progress",
    "priority",
    "updatedAt",
    "description",
    "notes",
    "assignee",
    "labels",
    "createdAt",
    "parentId",
    "dependencyIds",
    "parallelizable",
    "parallelizableSuppressed",
    "agent",
    "model",
    "ssot",
    "worktree",
    "commitHash"
  ];
  const missingFromPrimary: string[] = [];
  const missingFromSecondary: string[] = [];
  const changed: Array<{ id: string; fields: string[] }> = [];

  for (const id of secondaryById.keys()) {
    if (!primaryById.has(id)) {
      missingFromPrimary.push(id);
    }
  }

  for (const id of primaryById.keys()) {
    const primary = primaryById.get(id);
    const secondary = secondaryById.get(id);
    if (!secondary) {
      missingFromSecondary.push(id);
      continue;
    }

    const fields = comparableFields.filter((field) => {
      const primaryValue = primary?.[field];
      const secondaryValue = secondary[field];
      if (Array.isArray(primaryValue) && Array.isArray(secondaryValue)) {
        return primaryValue.join("\u0000") !== secondaryValue.join("\u0000");
      }
      return primaryValue !== secondaryValue;
    });
    if (fields.length > 0) {
      changed.push({ id, fields });
    }
  }

  return {
    missingFromPrimary: missingFromPrimary.sort((a, b) => a.localeCompare(b)),
    missingFromSecondary: missingFromSecondary.sort((a, b) => a.localeCompare(b)),
    changed: changed.sort((a, b) => a.id.localeCompare(b.id))
  };
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
