import { describe, expect, it } from "vitest";

import {
  applyAgentModelOverride,
  buildAgentModelOptions,
  DEFAULT_AGENT_MODEL,
  normalizeAgentModelName
} from "../src/agentModelSelection";

describe("agent model selection", () => {
  it("places the task preference first and deduplicates configured models", () => {
    expect(
      buildAgentModelOptions(" task-model ", ["configured-model", "task-model", "", "in\nvalid"])
    ).toEqual(["task-model", "configured-model", DEFAULT_AGENT_MODEL]);
  });

  it("rejects empty, multiline, and overlong custom model names", () => {
    expect(normalizeAgentModelName(" custom-model ")).toBe("custom-model");
    expect(normalizeAgentModelName("")).toBeNull();
    expect(normalizeAgentModelName("first\nsecond")).toBeNull();
    expect(normalizeAgentModelName("x".repeat(101))).toBeNull();
  });

  it("keeps per-task models or applies one explicit parallel override", () => {
    const items = [{ issueId: "one", model: "small" }, { issueId: "two" }];

    expect(applyAgentModelOverride(items, null)).toEqual(items);
    expect(applyAgentModelOverride(items, " large ")).toEqual([
      { issueId: "one", model: "large" },
      { issueId: "two", model: "large" }
    ]);
  });
});
