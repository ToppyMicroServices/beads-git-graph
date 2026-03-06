import { describe, expect, it } from "vitest";

import {
  beadsAsArray,
  beadShortDate,
  beadStatusLabel,
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
        priority: "P1",
        description: "Details",
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
      priority: "P1",
      description: "Details",
      assignee: "akira",
      labels: "ux, beads",
      createdAt: "2026-03-07T00:00:00Z",
      updatedAt: "2026-03-07T01:00:00Z",
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
        owner: "copilot",
        tags: ["parser"],
        created_at: "2026-03-06T10:00:00Z",
        modified_at: "2026-03-07T11:30:00Z",
        commit_hash: "1234567890abcdef"
      })
    ).toMatchObject({
      id: "neo-2",
      title: "Fix parser",
      type: "bug",
      status: "blocked",
      priority: "2",
      labels: "parser",
      commitHash: "1234567890abcdef"
    });
  });

  it("returns null when id or title is missing", () => {
    expect(toBeadItem({ title: "No id" })).toBeNull();
    expect(toBeadItem({ id: "neo-3" })).toBeNull();
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

describe("bead normalization helpers", () => {
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
