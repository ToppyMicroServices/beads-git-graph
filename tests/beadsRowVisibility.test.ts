import { describe, expect, it } from "vitest";

import {
  DEFAULT_ACTIVE_STATUSES,
  getDetailsReadinessLabel,
  isCollapsedByEpic,
  shouldShowBeadRow
} from "../web/beadsRowVisibility";

describe("bead row visibility", () => {
  it("keeps unrecognized active states visible for intervention by default", () => {
    expect(DEFAULT_ACTIVE_STATUSES).toEqual(["open", "in_progress", "blocked", "other"]);
  });

  it("shows readiness only where starting open work is applicable", () => {
    expect(
      getDetailsReadinessLabel({ normalizedStatus: "open", readyByBd: true, synthetic: false })
    ).toBe("Confirmed by bd ready");
    expect(
      getDetailsReadinessLabel({ normalizedStatus: "open", readyByBd: false, synthetic: false })
    ).toBe("Not confirmed");
    expect(
      getDetailsReadinessLabel({
        normalizedStatus: "in_progress",
        readyByBd: true,
        synthetic: false
      })
    ).toBe("N/A");
    expect(
      getDetailsReadinessLabel({ normalizedStatus: "closed", readyByBd: false, synthetic: false })
    ).toBe("N/A");
    expect(
      getDetailsReadinessLabel({ normalizedStatus: "open", readyByBd: false, synthetic: true })
    ).toBe("N/A");
  });

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
