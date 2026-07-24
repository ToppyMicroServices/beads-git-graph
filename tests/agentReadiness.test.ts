import { describe, expect, it } from "vitest";

import { revalidateExecutionTargets } from "../src/agentReadiness";

describe("agent execution readiness revalidation", () => {
  it("keeps only IDs still reported ready immediately before execution", () => {
    const result = revalidateExecutionTargets(
      [
        { issueId: " ready-a ", title: "Ready A", model: "reasoning-model" },
        { issueId: "stale-b", title: "Stale B", model: "coding-model" },
        { issueId: "ready-a", title: "Duplicate A", model: "other-model" },
        { issueId: " " }
      ],
      new Set(["ready-a"])
    );

    expect(result.ready).toEqual([
      { issueId: "ready-a", title: "Duplicate A", model: "other-model" }
    ]);
    expect(result.noLongerReady).toEqual([
      {
        issueId: "stale-b",
        title: "Stale B",
        reason: "no longer reported ready by bd"
      }
    ]);
  });
});
