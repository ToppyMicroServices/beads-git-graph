import { describe, expect, it } from "vitest";

import { collectStatusVisibleGraphIds } from "../web/graphFilterVisibility";

describe("collectStatusVisibleGraphIds", () => {
  it("uses only status filters and keeps duplicate task IDs scoped by workspace", () => {
    const visibleIds = collectStatusVisibleGraphIds(
      [
        { workspacePath: "/one", issueId: "task-1", status: "open" },
        { workspacePath: "/one", issueId: "task-2", status: "closed" },
        { workspacePath: "/two", issueId: "task-1", status: "closed" },
        { workspacePath: "/two", issueId: "task-3", status: "open" }
      ],
      new Set(["open"])
    );

    expect(Array.from(visibleIds.get("/one") ?? [])).toEqual(["task-1"]);
    expect(Array.from(visibleIds.get("/two") ?? [])).toEqual(["task-3"]);
  });

  it("omits blank IDs and workspaces with no matching status", () => {
    const visibleIds = collectStatusVisibleGraphIds(
      [
        { workspacePath: "/one", issueId: "", status: "open" },
        { workspacePath: "/two", issueId: "task-2", status: "blocked" }
      ],
      new Set(["open"])
    );

    expect(visibleIds.size).toBe(0);
  });
});
