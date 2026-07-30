import { describe, expect, it } from "vitest";

import { buildAgentBeadUpdateArgs } from "../src/agentBeadUpdate";

describe("agent Beads persistence", () => {
  it("uses one update command for assignment, status, notes, and metadata", () => {
    expect(
      buildAgentBeadUpdateArgs({
        issueId: "task-1",
        assignee: "openai:review-model",
        notes: ["provider=openai", "artifact=beads-response:run-id"],
        metadata: ["provider=openai", "model=review-model"]
      })
    ).toEqual([
      "update",
      "task-1",
      "--assignee",
      "openai:review-model",
      "--status",
      "in_progress",
      "--append-notes",
      "provider=openai\nartifact=beads-response:run-id",
      "--set-metadata",
      "provider=openai",
      "--set-metadata",
      "model=review-model"
    ]);
  });
});
