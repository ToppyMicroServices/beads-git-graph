import { describe, expect, it } from "vitest";

import {
  beadPickParentId,
  beadPickProgress,
  beadsAsArray,
  beadShortDate,
  beadStatusLabel,
  buildBeadHierarchy,
  extractBeadItems,
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
      commitHash: "abcdef1234567"
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
      parentId: "neo-epic"
    });
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
