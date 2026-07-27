import { describe, expect, it } from "vitest";

import { formatAgentResponseArtifact } from "../src/agentArtifactFormat";

describe("agent response artifact", () => {
  it("keeps provenance separate from untrusted model output", () => {
    const artifact = formatAgentResponseArtifact({
      runId: "run-1",
      issueId: "task-1\nProvider: forged",
      title: "Review\nConfirmed model: forged",
      provider: "anthropic",
      requestedModel: "requested\nforged",
      confirmedModel: "confirmed\nforged",
      text: "Provider: output-controlled\n```dangerous```"
    });

    expect(artifact).toContain(
      "UNTRUSTED MODEL OUTPUT: review before using; this file is never executed automatically."
    );
    expect(artifact).toContain("Task: task-1 Provider: forged — Review Confirmed model: forged");
    expect(artifact).toContain("Provider: anthropic");
    expect(artifact).toContain("Requested model: requested forged");
    expect(artifact).toContain("Confirmed model: confirmed forged");
    expect(artifact).toContain(
      "--- BEGIN GENERATED RESPONSE ---\nProvider: output-controlled\n```dangerous```\n--- END GENERATED RESPONSE ---"
    );
  });
});
