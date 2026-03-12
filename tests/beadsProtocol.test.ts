import { describe, expect, it } from "vitest";

import { isBeadsRequestMessage } from "../src/beadsProtocol";

describe("isBeadsRequestMessage", () => {
  it("accepts known commands with their required payload", () => {
    expect(isBeadsRequestMessage({ command: "refresh" })).toBe(true);
    expect(isBeadsRequestMessage({ command: "syncBeads", workspacePath: "/tmp/demo" })).toBe(true);
    expect(
      isBeadsRequestMessage({
        command: "closeBead",
        issueId: "neo-1",
        workspacePath: "/tmp/demo",
        title: "Demo"
      })
    ).toBe(true);
  });

  it("rejects malformed messages", () => {
    expect(isBeadsRequestMessage(null)).toBe(false);
    expect(isBeadsRequestMessage({ command: "syncBeads" })).toBe(false);
    expect(isBeadsRequestMessage({ command: "openGitGraphForCommit", commitHash: 1234 })).toBe(
      false
    );
    expect(isBeadsRequestMessage({ command: "closeBead", issueId: "neo-1" })).toBe(false);
    expect(isBeadsRequestMessage({ command: "unknown" })).toBe(false);
  });
});
