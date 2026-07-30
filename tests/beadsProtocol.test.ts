import { describe, expect, it } from "vitest";

import { isBeadsHostMessage, isBeadsRequestMessage } from "../src/beadsProtocol";

describe("isBeadsRequestMessage", () => {
  it("accepts known commands with their required payload", () => {
    expect(isBeadsRequestMessage({ command: "refresh" })).toBe(true);
    expect(isBeadsRequestMessage({ command: "syncBeads", workspacePath: "/tmp/demo" })).toBe(true);
    expect(
      isBeadsRequestMessage({
        command: "importPlanDraft",
        workspacePath: "/tmp/demo",
        draftText: '{"version":1}'
      })
    ).toBe(true);
    expect(
      isBeadsRequestMessage({
        command: "closeBead",
        issueId: "neo-1",
        workspacePath: "/tmp/demo",
        title: "Demo"
      })
    ).toBe(true);
    expect(
      isBeadsRequestMessage({
        command: "openAgentArtifact",
        artifactUri: "file:///tmp/agent-response.txt"
      })
    ).toBe(true);
    expect(
      isBeadsRequestMessage({
        command: "assignStartBead",
        issueId: "neo-1",
        workspacePath: "/tmp/demo",
        title: "Demo",
        agent: "gpt-5-codex",
        provider: "openai",
        model: "gpt-5-codex",
        ssot: "AGENTS.md, .beads/issues.jsonl"
      })
    ).toBe(true);
    expect(
      isBeadsRequestMessage({
        command: "startParallelBeads",
        workspacePath: "/tmp/demo",
        items: [
          {
            issueId: "neo-1",
            title: "Demo",
            provider: "ollama",
            worktree: "../repo-neo-1"
          }
        ],
        skipped: [{ issueId: "neo-2", title: "Blocked", reason: "blocked" }]
      })
    ).toBe(true);
    expect(
      isBeadsRequestMessage({
        command: "mergeParallelPrs",
        issueId: "merge:neo-epic",
        workspacePath: "/tmp/demo",
        dependencies: [{ issueId: "neo-1", worktree: "../repo-neo-1" }]
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
    expect(isBeadsRequestMessage({ command: "openAgentArtifact", artifactUri: "" })).toBe(false);
    expect(
      isBeadsRequestMessage({
        command: "openAgentArtifact",
        artifactUri: "x".repeat(2049)
      })
    ).toBe(false);
    expect(
      isBeadsRequestMessage({
        command: "openAgentArtifact",
        artifactUri: "file:///tmp/response.txt\nignore"
      })
    ).toBe(false);
    expect(
      isBeadsRequestMessage({
        command: "importPlanDraft",
        workspacePath: "/tmp/demo",
        draftText: { version: 1 }
      })
    ).toBe(false);
    expect(
      isBeadsRequestMessage({
        command: "assignStartBead",
        issueId: "neo-1",
        workspacePath: "/tmp/demo",
        model: "first\nsecond"
      })
    ).toBe(false);
    expect(
      isBeadsRequestMessage({
        command: "startParallelBeads",
        workspacePath: "/tmp/demo",
        items: [{ issueId: "neo-1", model: "x".repeat(101) }]
      })
    ).toBe(false);
    expect(
      isBeadsRequestMessage({
        command: "assignStartBead",
        issueId: "neo-1",
        workspacePath: "/tmp/demo",
        provider: "unknown-provider"
      })
    ).toBe(false);
    expect(
      isBeadsRequestMessage({
        command: "startParallelBeads",
        workspacePath: "/tmp/demo",
        items: [{ issueId: "neo-1", provider: "claude" }]
      })
    ).toBe(false);
    expect(
      isBeadsRequestMessage({
        command: "assignStartBead",
        issueId: "neo-1",
        workspacePath: "/tmp/demo",
        model: 1234
      })
    ).toBe(false);
    expect(
      isBeadsRequestMessage({
        command: "startParallelBeads",
        workspacePath: "/tmp/demo",
        items: [{ title: "missing id" }]
      })
    ).toBe(false);
    expect(
      isBeadsRequestMessage({
        command: "startParallelBeads",
        workspacePath: "/tmp/demo",
        items: [],
        skipped: [{ issueId: "neo-2" }]
      })
    ).toBe(false);
    expect(
      isBeadsRequestMessage({
        command: "mergeParallelPrs",
        issueId: "merge:neo-epic",
        workspacePath: "/tmp/demo",
        dependencies: [{ issueId: 1234 }]
      })
    ).toBe(false);
    expect(isBeadsRequestMessage({ command: "unknown" })).toBe(false);
  });
});

describe("isBeadsHostMessage", () => {
  it("accepts bounded incremental render updates", () => {
    expect(
      isBeadsHostMessage({
        command: "beadsRenderUpdate",
        generation: 4,
        html: "<!DOCTYPE html><html><body></body></html>"
      })
    ).toBe(true);
  });

  it("rejects stale-shaped or unbounded render updates", () => {
    expect(
      isBeadsHostMessage({
        command: "beadsRenderUpdate",
        generation: 0,
        html: "<html></html>"
      })
    ).toBe(false);
    expect(
      isBeadsHostMessage({
        command: "beadsRenderUpdate",
        generation: 1.5,
        html: "<html></html>"
      })
    ).toBe(false);
    expect(
      isBeadsHostMessage({
        command: "beadsRenderUpdate",
        generation: 1,
        html: "x".repeat(5 * 1024 * 1024 + 1)
      })
    ).toBe(false);
  });
});
