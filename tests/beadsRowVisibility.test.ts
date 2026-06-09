import { describe, expect, it } from "vitest";

import { isCollapsedByEpic, shouldShowBeadRow } from "../web/beadsRowVisibility";

describe("bead row visibility", () => {
  it("keeps the epic visible while hiding descendants of collapsed epics", () => {
    const collapsedEpicIds = new Set(["epic-a"]);

    expect(
      isCollapsedByEpic({ id: "epic-a", epicId: "epic-a", status: "open" }, collapsedEpicIds)
    ).toBe(false);
    expect(
      isCollapsedByEpic({ id: "epic-a.1", epicId: "epic-a", status: "open" }, collapsedEpicIds)
    ).toBe(true);
  });

  it("combines status filters with collapsed epic state", () => {
    const activeStatuses = new Set(["open", "blocked"]);
    const collapsedEpicIds = new Set(["epic-a"]);

    expect(
      shouldShowBeadRow(
        { id: "task-a", epicId: "", status: "open" },
        activeStatuses,
        collapsedEpicIds
      )
    ).toBe(true);
    expect(
      shouldShowBeadRow(
        { id: "epic-a.1", epicId: "epic-a", status: "open" },
        activeStatuses,
        collapsedEpicIds
      )
    ).toBe(false);
    expect(
      shouldShowBeadRow(
        { id: "task-b", epicId: "", status: "closed" },
        activeStatuses,
        collapsedEpicIds
      )
    ).toBe(false);
  });
});
