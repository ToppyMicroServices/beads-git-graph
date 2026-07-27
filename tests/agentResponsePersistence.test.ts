import { describe, expect, it, vi } from "vitest";

import { persistGeneratedAgentResponse } from "../src/agentResponsePersistence";

describe("generated agent response persistence", () => {
  it("stores, records, flushes, and then opens a generated response", async () => {
    const calls: string[] = [];
    const result = await persistGeneratedAgentResponse({
      createArtifact: async () => {
        calls.push("artifact");
        return { reference: "beads-response:run" };
      },
      updateBead: async () => {
        calls.push("update");
      },
      flushBeads: async () => {
        calls.push("flush");
      },
      openArtifact: async () => {
        calls.push("open");
        return "response-opened";
      }
    });

    expect(result).toBe("response-opened");
    expect(calls).toEqual(["artifact", "update", "flush", "open"]);
  });

  it("preserves and opens an artifact when the single Beads update fails", async () => {
    const flushBeads = vi.fn(async () => undefined);
    const openArtifact = vi.fn(async () => "response-opened" as const);

    await expect(
      persistGeneratedAgentResponse({
        createArtifact: async () => ({ reference: "beads-response:run" }),
        updateBead: async () => {
          throw new Error("schema mismatch");
        },
        flushBeads,
        openArtifact
      })
    ).rejects.toThrow(
      "No Beads update completed. The response artifact was preserved and opened for review. schema mismatch"
    );

    expect(flushBeads).not.toHaveBeenCalled();
    expect(openArtifact).toHaveBeenCalledOnce();
  });

  it("reports a completed update separately from a failed flush", async () => {
    const openArtifact = vi.fn(async () => "response-stored" as const);

    await expect(
      persistGeneratedAgentResponse({
        createArtifact: async () => ({ reference: "beads-response:run" }),
        updateBead: async () => undefined,
        flushBeads: async () => {
          throw new Error("flush failed");
        },
        openArtifact
      })
    ).rejects.toThrow(
      "The Beads update completed, but its flush failed. The response artifact was preserved in extension storage but could not be opened. flush failed"
    );

    expect(openArtifact).toHaveBeenCalledOnce();
  });
});
