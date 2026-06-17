import { describe, expect, it } from "vitest";

import {
  beadPickAgent,
  beadPickDependencyIds,
  beadPickModel,
  beadPickParallelizable,
  beadPickParentId,
  beadPickProgress,
  beadPickSsot,
  beadPickWorktree,
  beadsAsArray,
  beadShortDate,
  beadStatusLabel,
  buildBeadDependencyGraph,
  buildBeadHierarchy,
  deriveParallelMergeItems,
  diffBeadItems,
  extractBeadItems,
  inferReadyParallelizableItems,
  mergeBeadItems,
  normalizeBeadPriority,
  normalizeBeadStatus,
  normalizeBeadType,
  toBeadItem
} from "../src/beadsData";

describe("beadsAsArray", () => {
  it("returns an array directly when root is an array", () => {
    const input = [{ id: "a" }];
    expect(beadsAsArray(input)).toBe(input);
  });

  it("extracts items from supported root keys", () => {
    expect(beadsAsArray({ issues: [{ id: "a" }] })).toEqual([{ id: "a" }]);
    expect(beadsAsArray({ beads: [{ id: "b" }] })).toEqual([{ id: "b" }]);
    expect(beadsAsArray({ tasks: [{ id: "c" }] })).toEqual([{ id: "c" }]);
  });

  it("returns an empty array for unsupported roots", () => {
    expect(beadsAsArray({ nope: [] })).toEqual([]);
    expect(beadsAsArray(null)).toEqual([]);
    expect(beadsAsArray("text")).toEqual([]);
  });
});

describe("toBeadItem", () => {
  it("maps common bead fields into a normalized item", () => {
    expect(
      toBeadItem({
        id: "neo-1",
        title: "Implement toggle",
        type: "feat",
        status: "in_progress",
        progress: 35,
        priority: "P1",
        description: "Details",
        notes: "進捗: 35%",
        assignee: "akira",
        labels: ["ux", "beads"],
        createdAt: "2026-03-07T00:00:00Z",
        updatedAt: "2026-03-07T01:00:00Z",
        commitHash: "abcdef1234567"
      })
    ).toEqual({
      id: "neo-1",
      title: "Implement toggle",
      type: "feat",
      status: "in_progress",
      progress: 35,
      priority: "P1",
      description: "Details",
      notes: "進捗: 35%",
      assignee: "akira",
      labels: "ux, beads",
      createdAt: "2026-03-07T00:00:00Z",
      updatedAt: "2026-03-07T01:00:00Z",
      parentId: "",
      dependencyIds: [],
      parallelizable: false,
      parallelizableSource: "",
      parallelizableSuppressed: false,
      agent: "",
      model: "",
      ssot: "",
      worktree: "",
      commitHash: "abcdef1234567",
      synthetic: false,
      syntheticKind: ""
    });
  });

  it("extracts multi-agent execution metadata from fields and labels", () => {
    expect(
      toBeadItem({
        id: "neo-agent-task",
        title: "Implement shard",
        issue_type: "task",
        parallelizable: true,
        agent: "agent-a",
        model: "gpt-5-codex",
        ssot: "AGENTS.md, .beads/issues.jsonl",
        worktree: "../beads-git-graph-agent-a"
      })
    ).toMatchObject({
      parallelizable: true,
      parallelizableSource: "explicit",
      parallelizableSuppressed: false,
      agent: "agent-a",
      model: "gpt-5-codex",
      ssot: "AGENTS.md, .beads/issues.jsonl",
      worktree: "../beads-git-graph-agent-a"
    });

    expect(
      toBeadItem({
        id: "neo-agent-labels",
        title: "Implement label shard",
        labels: [
          "parallel-ok",
          "agent:agent-b",
          "model:gpt-5",
          "ssot:README.md",
          "worktree:../beads-git-graph-agent-b"
        ]
      })
    ).toMatchObject({
      parallelizable: true,
      parallelizableSource: "explicit",
      parallelizableSuppressed: false,
      agent: "agent-b",
      model: "gpt-5",
      ssot: "README.md",
      worktree: "../beads-git-graph-agent-b"
    });
  });

  it("supports alternate field names and numeric priorities", () => {
    expect(
      toBeadItem({
        key: "neo-2",
        summary: "Fix parser",
        kind: "bug",
        state: "blocked",
        p: 2,
        body: "Broken JSONL handling",
        notes: "progress: 80%",
        owner: "copilot",
        tags: ["parser"],
        created_at: "2026-03-06T10:00:00Z",
        modified_at: "2026-03-07T11:30:00Z",
        parent_id: "neo-1",
        commit_hash: "1234567890abcdef"
      })
    ).toMatchObject({
      id: "neo-2",
      title: "Fix parser",
      type: "bug",
      status: "blocked",
      progress: 80,
      priority: "2",
      parentId: "neo-1",
      notes: "progress: 80%",
      labels: "parser",
      commitHash: "1234567890abcdef"
    });
  });

  it("returns null when id or title is missing", () => {
    expect(toBeadItem({ title: "No id" })).toBeNull();
    expect(toBeadItem({ id: "neo-3" })).toBeNull();
  });

  it("extracts parent ids from bd dependency metadata", () => {
    expect(
      toBeadItem({
        id: "neo-4",
        title: "Child task",
        dependencies: [
          {
            issue_id: "neo-4",
            depends_on_id: "neo-epic",
            type: "parent-child"
          }
        ]
      })
    ).toMatchObject({
      parentId: "neo-epic",
      dependencyIds: []
    });
  });

  it("accepts bd show style parent fields when they are present", () => {
    expect(
      toBeadItem({
        id: "neo-5",
        title: "Child task",
        parent: "neo-late-epic",
        dependencies: [
          {
            id: "neo-late-epic",
            dependency_type: "parent-child"
          }
        ]
      })
    ).toMatchObject({
      parentId: "neo-late-epic",
      dependencyIds: []
    });
  });

  it("extracts execution dependencies separately from parent-child hierarchy", () => {
    expect(
      toBeadItem({
        id: "neo-blocked",
        title: "Blocked task",
        dependencies: [
          {
            issue_id: "neo-blocked",
            depends_on_id: "neo-parent",
            type: "parent-child"
          },
          {
            issue_id: "neo-blocked",
            depends_on_id: "neo-blocker",
            type: "blocks"
          },
          {
            issue_id: "neo-blocked",
            id: "neo-show-style-blocker",
            dependency_type: "blocks"
          }
        ]
      })
    ).toMatchObject({
      parentId: "neo-parent",
      dependencyIds: ["neo-blocker", "neo-show-style-blocker"]
    });
  });

  it("reads direct dependency id fields", () => {
    expect(
      beadPickDependencyIds(
        {
          blocked_by: "neo-a, neo-b",
          dependsOn: ["neo-c", "neo-a"]
        },
        "neo-c"
      )
    ).toEqual(["neo-a", "neo-b"]);
  });
});

describe("extractBeadItems", () => {
  it("sorts items by updatedAt descending when timestamps are valid", () => {
    const result = extractBeadItems({
      issues: [
        { id: "neo-2", title: "Older", updatedAt: "2026-03-07T01:00:00Z" },
        { id: "neo-1", title: "Newer", updatedAt: "2026-03-07T02:00:00Z" }
      ]
    });

    expect(result.map((item) => item.id)).toEqual(["neo-1", "neo-2"]);
  });

  it("falls back to id sorting when updatedAt is not parseable", () => {
    const result = extractBeadItems([
      { id: "neo-2", title: "B", updatedAt: "-" },
      { id: "neo-1", title: "A", updatedAt: "-" }
    ]);

    expect(result.map((item) => item.id)).toEqual(["neo-1", "neo-2"]);
  });
});

describe("buildBeadHierarchy", () => {
  it("infers dotted task ids under an epic", () => {
    const items = [
      toBeadItem({ id: "vscode-markdown-pdf-8cp.2", title: "Subtask", type: "task" }),
      toBeadItem({ id: "vscode-markdown-pdf-8cp", title: "Epic", type: "epic" }),
      toBeadItem({ id: "vscode-markdown-pdf-8cp.1", title: "Task", type: "task" })
    ].filter((item) => item !== null);

    const hierarchy = buildBeadHierarchy(items);
    const byId = new Map(hierarchy.map((entry) => [entry.item.id, entry]));

    expect(byId.get("vscode-markdown-pdf-8cp")).toMatchObject({
      parentId: null,
      epicId: "vscode-markdown-pdf-8cp",
      depth: 0
    });
    expect(byId.get("vscode-markdown-pdf-8cp.1")).toMatchObject({
      parentId: "vscode-markdown-pdf-8cp",
      epicId: "vscode-markdown-pdf-8cp",
      depth: 1
    });
    expect(byId.get("vscode-markdown-pdf-8cp.2")).toMatchObject({
      parentId: "vscode-markdown-pdf-8cp",
      epicId: "vscode-markdown-pdf-8cp",
      depth: 1
    });
  });

  it("prefers explicit parent ids and keeps nested subtasks", () => {
    const items = [
      toBeadItem({ id: "neo-epic", title: "Epic", type: "epic" }),
      toBeadItem({ id: "neo-task", title: "Task", type: "task", parentId: "neo-epic" }),
      toBeadItem({ id: "neo-task.1", title: "Subtask", type: "task" })
    ].filter((item) => item !== null);

    const hierarchy = buildBeadHierarchy(items);
    const byId = new Map(hierarchy.map((entry) => [entry.item.id, entry]));

    expect(byId.get("neo-task")).toMatchObject({
      parentId: "neo-epic",
      epicId: "neo-epic",
      depth: 1
    });
    expect(byId.get("neo-task.1")).toMatchObject({
      parentId: "neo-task",
      epicId: "neo-epic",
      depth: 2
    });
  });

  it("restores parent-child hierarchy from JSONL metadata when CLI items omit dependencies", () => {
    const cliItems = extractBeadItems([
      {
        id: "neo-task-a",
        title: "Task A",
        issue_type: "task",
        updated_at: "2026-03-10T00:00:00Z"
      },
      {
        id: "neo-task-b",
        title: "Task B",
        issue_type: "task",
        updated_at: "2026-03-10T00:01:00Z"
      },
      {
        id: "neo-late-epic",
        title: "Late epic",
        issue_type: "epic",
        updated_at: "2026-03-10T00:02:00Z"
      }
    ]);
    const jsonlItems = extractBeadItems([
      {
        id: "neo-task-a",
        title: "Task A",
        issue_type: "task",
        updated_at: "2026-03-10T00:00:00Z",
        dependencies: [{ depends_on_id: "neo-late-epic", type: "parent-child" }]
      },
      {
        id: "neo-task-b",
        title: "Task B",
        issue_type: "task",
        updated_at: "2026-03-10T00:01:00Z",
        dependencies: [{ depends_on_id: "neo-late-epic", type: "parent-child" }]
      },
      {
        id: "neo-late-epic",
        title: "Late epic",
        issue_type: "epic",
        updated_at: "2026-03-10T00:02:00Z"
      }
    ]);

    const hierarchy = buildBeadHierarchy(mergeBeadItems(cliItems, jsonlItems));
    const byId = new Map(hierarchy.map((entry) => [entry.item.id, entry]));

    expect(byId.get("neo-task-a")).toMatchObject({
      parentId: "neo-late-epic",
      epicId: "neo-late-epic",
      depth: 1
    });
    expect(byId.get("neo-task-b")).toMatchObject({
      parentId: "neo-late-epic",
      epicId: "neo-late-epic",
      depth: 1
    });
  });

  it("detects differences between local bd items and issues.jsonl", () => {
    const localItems = extractBeadItems([
      {
        id: "neo-sync-a",
        title: "Task A",
        issue_type: "task",
        status: "in_progress",
        updated_at: "2026-03-10T00:00:00Z"
      },
      {
        id: "neo-sync-only-local",
        title: "Local only",
        issue_type: "task",
        updated_at: "2026-03-10T00:01:00Z"
      }
    ]);
    const jsonlItems = extractBeadItems([
      {
        id: "neo-sync-a",
        title: "Task A",
        issue_type: "task",
        status: "open",
        updated_at: "2026-03-10T00:00:00Z"
      },
      {
        id: "neo-sync-only-jsonl",
        title: "JSONL only",
        issue_type: "task",
        updated_at: "2026-03-10T00:02:00Z"
      }
    ]);

    expect(diffBeadItems(localItems, jsonlItems)).toEqual({
      missingFromPrimary: ["neo-sync-only-jsonl"],
      missingFromSecondary: ["neo-sync-only-local"],
      changed: [{ id: "neo-sync-a", fields: ["status"] }]
    });
  });

  it("preserves execution metadata from issues.jsonl when CLI rows omit it", () => {
    const cliItems = extractBeadItems([
      {
        id: "neo-agent-task",
        title: "Task from CLI",
        issue_type: "task",
        updated_at: "2026-03-10T00:00:00Z"
      }
    ]);
    const jsonlItems = extractBeadItems([
      {
        id: "neo-agent-task",
        title: "Task from CLI",
        issue_type: "task",
        updated_at: "2026-03-10T00:00:00Z",
        parallelizable: true,
        agent: "agent-a",
        model: "gpt-5-codex",
        ssot: "AGENTS.md, .beads/issues.jsonl",
        worktree: "../beads-git-graph-agent-a"
      }
    ]);

    expect(mergeBeadItems(cliItems, jsonlItems)[0]).toMatchObject({
      parallelizable: true,
      parallelizableSource: "explicit",
      agent: "agent-a",
      model: "gpt-5-codex",
      ssot: "AGENTS.md, .beads/issues.jsonl",
      worktree: "../beads-git-graph-agent-a"
    });
  });

  it("preserves dependency metadata from issues.jsonl when CLI rows omit it", () => {
    const cliItems = extractBeadItems([
      {
        id: "neo-dependent",
        title: "Dependent",
        issue_type: "task",
        updated_at: "2026-03-10T00:00:00Z"
      }
    ]);
    const jsonlItems = extractBeadItems([
      {
        id: "neo-dependent",
        title: "Dependent",
        issue_type: "task",
        updated_at: "2026-03-10T00:00:00Z",
        dependencies: [{ depends_on_id: "neo-blocker", type: "blocks" }]
      }
    ]);

    expect(mergeBeadItems(cliItems, jsonlItems)[0]).toMatchObject({
      dependencyIds: ["neo-blocker"]
    });
  });

  it("builds a dependency graph with a critical path", () => {
    const items = extractBeadItems([
      { id: "neo-a", title: "A", issue_type: "task" },
      {
        id: "neo-b",
        title: "B",
        issue_type: "task",
        dependencies: [{ depends_on_id: "neo-a", type: "blocks" }]
      },
      {
        id: "neo-c",
        title: "C",
        issue_type: "task",
        dependencies: [{ depends_on_id: "neo-b", type: "blocks" }]
      },
      {
        id: "neo-side",
        title: "Side",
        issue_type: "task",
        dependencies: [{ depends_on_id: "neo-a", type: "blocks" }]
      }
    ]);

    const graph = buildBeadDependencyGraph(items);
    const nodesById = new Map(graph.nodes.map((node) => [node.item.id, node]));

    expect(graph.criticalPathIds).toEqual(["neo-a", "neo-b", "neo-c"]);
    expect(nodesById.get("neo-a")).toMatchObject({ level: 0, critical: true });
    expect(nodesById.get("neo-b")).toMatchObject({ level: 1, critical: true });
    expect(nodesById.get("neo-c")).toMatchObject({ level: 2, critical: true });
    expect(nodesById.get("neo-side")).toMatchObject({ level: 1, critical: false });
    expect(graph.edges).toContainEqual({
      fromId: "neo-b",
      toId: "neo-c",
      critical: true
    });
  });

  it("marks multiple ready unblocked tasks as parallel candidates", () => {
    const items = extractBeadItems([
      {
        id: "neo-ready-a",
        title: "Ready A",
        issue_type: "task",
        status: "open"
      },
      {
        id: "neo-ready-b",
        title: "Ready B",
        issue_type: "task",
        status: "open"
      },
      {
        id: "neo-blocked",
        title: "Blocked",
        issue_type: "task",
        status: "blocked"
      },
      {
        id: "neo-serial",
        title: "Serial",
        issue_type: "task",
        status: "open",
        labels: ["no-parallel"]
      }
    ]);

    const inferred = inferReadyParallelizableItems(
      items,
      new Set(["neo-ready-a", "neo-ready-b", "neo-serial"])
    );
    const byId = new Map(inferred.map((item) => [item.id, item]));

    expect(byId.get("neo-ready-a")).toMatchObject({
      parallelizable: true,
      parallelizableSource: "ready"
    });
    expect(byId.get("neo-ready-b")).toMatchObject({
      parallelizable: true,
      parallelizableSource: "ready"
    });
    expect(byId.get("neo-blocked")).toMatchObject({
      parallelizable: false,
      parallelizableSource: ""
    });
    expect(byId.get("neo-serial")).toMatchObject({
      parallelizable: false,
      parallelizableSuppressed: true
    });
  });

  it("derives merge tasks for parallel worktree siblings and links them in the graph", () => {
    const items = extractBeadItems([
      {
        id: "neo-epic",
        title: "Parallel feature",
        issue_type: "epic",
        status: "open",
        updated_at: "2026-03-08T00:00:00Z"
      },
      {
        id: "neo-a",
        title: "Agent A",
        issue_type: "task",
        parent_id: "neo-epic",
        status: "in_progress",
        parallelizable: true,
        worktree: "../repo-agent-a",
        updated_at: "2026-03-09T00:00:00Z",
        priority: "P1"
      },
      {
        id: "neo-b",
        title: "Agent B",
        issue_type: "task",
        parent_id: "neo-epic",
        status: "open",
        parallelizable: true,
        worktree: "../repo-agent-b",
        updated_at: "2026-03-10T00:00:00Z",
        priority: "P2"
      }
    ]);

    const derived = deriveParallelMergeItems(items);
    const mergeTask = derived.find((item) => item.id === "merge:neo-epic");

    expect(mergeTask).toMatchObject({
      title: "Merge parallel PRs (2)",
      parentId: "neo-epic",
      dependencyIds: ["neo-a", "neo-b"],
      status: "blocked",
      priority: "P1",
      synthetic: true,
      syntheticKind: "parallel-pr-merge"
    });

    const graph = buildBeadDependencyGraph(derived);
    const nodesById = new Map(graph.nodes.map((node) => [node.item.id, node]));
    expect(nodesById.get("merge:neo-epic")).toMatchObject({ level: 1 });
    expect(graph.edges.map((edge) => `${edge.fromId}->${edge.toId}`)).toEqual(
      expect.arrayContaining(["neo-a->merge:neo-epic", "neo-b->merge:neo-epic"])
    );
  });
});

describe("bead normalization helpers", () => {
  it("reads parent ids from explicit fields or dependency metadata", () => {
    expect(beadPickParentId({ parent_id: "neo-epic" })).toBe("neo-epic");
    expect(
      beadPickParentId({
        dependencies: [{ depends_on_id: "neo-parent", type: "parent-child" }]
      })
    ).toBe("neo-parent");
    expect(
      beadPickParentId({ dependencies: [{ depends_on_id: "neo-parent", type: "blocks" }] })
    ).toBe("");
  });

  it("reads parallel, model, ssot, agent, and worktree hints from direct fields or labels", () => {
    expect(beadPickParallelizable({ parallel: "yes" })).toBe(true);
    expect(beadPickParallelizable({ labels: ["sequential", "parallel-ok"] })).toBe(false);
    expect(beadPickAgent({ labels: ["agent:agent-a"] })).toBe("agent-a");
    expect(beadPickModel({ metadata: { model: "gpt-5-codex" } })).toBe("gpt-5-codex");
    expect(beadPickModel({ labels: ["model:gpt-5"] })).toBe("gpt-5");
    expect(beadPickSsot({ metadata: '{"ssot":"AGENTS.md"}' })).toBe("AGENTS.md");
    expect(beadPickSsot({ tags: ["context:README.md"] })).toBe("README.md");
    expect(beadPickWorktree({ tags: ["wt:../repo-agent-a"] })).toBe("../repo-agent-a");
  });

  it("extracts progress percentages from direct fields or notes", () => {
    expect(beadPickProgress({ progress: 42 })).toBe(42);
    expect(beadPickProgress({ progress: "65%" })).toBe(65);
    expect(beadPickProgress({ notes: "進捗: 80%" })).toBe(80);
    expect(beadPickProgress({ description: "progress: 15%" })).toBe(15);
    expect(beadPickProgress({ notes: "not started" })).toBeNull();
  });

  it("normalizes statuses and labels", () => {
    expect(normalizeBeadStatus("in progress")).toBe("in_progress");
    expect(normalizeBeadStatus("resolved")).toBe("closed");
    expect(normalizeBeadStatus("waiting")).toBe("other");
    expect(beadStatusLabel("in_progress")).toBe("In Progress");
  });

  it("normalizes priorities", () => {
    expect(normalizeBeadPriority("p0")).toBe("P0");
    expect(normalizeBeadPriority("Priority 2")).toBe("P2");
    expect(normalizeBeadPriority("unknown")).toBe("P3");
  });

  it("normalizes item types", () => {
    expect(normalizeBeadType("feat")).toBe("feature");
    expect(normalizeBeadType("fix")).toBe("bug");
    expect(normalizeBeadType("chore")).toBe("task");
    expect(normalizeBeadType("unknown")).toBe("other");
  });

  it("formats short dates", () => {
    expect(beadShortDate("2026-03-07T09:05:00Z")).toMatch(/^03\/07 /);
    expect(beadShortDate("not-a-date")).toBe("not-a-date");
  });
});
