import { describe, expect, it } from "vitest";

import {
  getAgentArtifactRunId,
  normalizeAgentArtifactReference
} from "../src/agentArtifactReference";

describe("agent artifact references", () => {
  it("accepts only canonical response run references", () => {
    expect(
      normalizeAgentArtifactReference(" BEADS-RESPONSE:12345678-1234-4234-8234-123456789ABC ")
    ).toBe("beads-response:12345678-1234-4234-8234-123456789abc");
    expect(getAgentArtifactRunId("beads-response:12345678-1234-4234-8234-123456789abc")).toBe(
      "12345678-1234-4234-8234-123456789abc"
    );
    expect(normalizeAgentArtifactReference("file:///tmp/response.txt")).toBeNull();
    expect(normalizeAgentArtifactReference("beads-response:../../secret")).toBeNull();
  });
});
