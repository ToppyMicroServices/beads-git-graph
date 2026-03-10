import { describe, expect, it } from "vitest";

import { extractBeadItems } from "../src/beadsData";
import { flattenBeadHierarchy } from "../src/beadsHierarchy";

describe("flattenBeadHierarchy", () => {
  it("orders roots by the most recent timestamp found in each subtree", () => {
    const items = extractBeadItems([
      {
        id: "demo-root-a",
        title: "Older epic with fresh child",
        issue_type: "epic",
        updated_at: "2026-03-08T00:00:00Z"
      },
      {
        id: "demo-root-a.1",
        title: "Fresh child",
        issue_type: "task",
        updated_at: "2026-03-10T00:00:00Z"
      },
      {
        id: "demo-root-b",
        title: "Newer root with stale subtree",
        issue_type: "epic",
        updated_at: "2026-03-09T00:00:00Z"
      }
    ]);

    expect(flattenBeadHierarchy(items).map((entry) => entry.item.id)).toEqual([
      "demo-root-a",
      "demo-root-a.1",
      "demo-root-b"
    ]);
  });

  it("produces guide column metadata for nested demo tasks", () => {
    const items = extractBeadItems([
      {
        id: "neo-git-graph-demo-epic",
        title: "Demo epic",
        issue_type: "epic",
        updated_at: "2026-03-08T00:00:00Z"
      },
      {
        id: "neo-git-graph-demo-epic.1",
        title: "Demo task A",
        issue_type: "task",
        updated_at: "2026-03-08T00:01:00Z"
      },
      {
        id: "neo-git-graph-demo-epic.1.1",
        title: "Nested subtask",
        issue_type: "task",
        updated_at: "2026-03-08T00:02:00Z"
      },
      {
        id: "neo-git-graph-demo-epic.2",
        title: "Demo task B",
        issue_type: "task",
        updated_at: "2026-03-08T00:03:00Z"
      }
    ]);

    const rows = flattenBeadHierarchy(items);
    const byId = new Map(rows.map((entry) => [entry.item.id, entry]));

    expect(byId.get("neo-git-graph-demo-epic")).toMatchObject({
      depth: 0,
      guideColumns: [],
      isLastSibling: true
    });
    expect(byId.get("neo-git-graph-demo-epic.1")).toMatchObject({
      depth: 1,
      guideColumns: [],
      isLastSibling: true
    });
    expect(byId.get("neo-git-graph-demo-epic.1.1")).toMatchObject({
      depth: 2,
      guideColumns: [false],
      isLastSibling: true
    });
    expect(byId.get("neo-git-graph-demo-epic.2")).toMatchObject({
      depth: 1,
      guideColumns: [],
      isLastSibling: false
    });
  });

  it("keeps every item exactly once even when parent references are cyclic", () => {
    const rows = flattenBeadHierarchy(
      extractBeadItems([
        {
          id: "cycle-a",
          title: "Cycle A",
          issue_type: "task",
          parent_id: "cycle-b",
          updated_at: "2026-03-08T00:00:00Z"
        },
        {
          id: "cycle-b",
          title: "Cycle B",
          issue_type: "task",
          parent_id: "cycle-a",
          updated_at: "2026-03-08T00:01:00Z"
        }
      ])
    );

    expect(rows.map((entry) => entry.item.id).sort()).toEqual(["cycle-a", "cycle-b"]);
    expect(new Set(rows.map((entry) => entry.item.id)).size).toBe(2);
  });
});
