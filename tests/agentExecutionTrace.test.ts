import { describe, expect, it } from "vitest";

import {
  AgentExecutionTracker,
  EXECUTION_PHASE_LABELS,
  isActiveExecutionPhase,
  isAgentExecutionSnapshot,
  MAX_EXECUTION_TRACES
} from "../src/agentExecutionTrace";
import { isBeadsHostMessage, isBeadsRequestMessage } from "../src/beadsProtocol";

const task = {
  workspacePath: "/tmp/demo",
  issueId: "demo-1",
  title: "Write a fixture",
  provider: "ollama" as const,
  model: "qwen2.5-coder:0.5b"
};

describe("session execution observations", () => {
  it("cancels queued batch tasks immediately while observed work remains active until it settles", () => {
    const tracker = new AgentExecutionTracker("host-1");
    const running = tracker.start(task);
    const waiting = tracker.start(task);
    const anotherBatch = tracker.start(task);
    tracker.update(running, "awaiting-review");
    tracker.cancelQueued([running, waiting]);
    expect(tracker.snapshot().entries.map((entry) => entry.phase)).toEqual([
      "awaiting-review",
      "cancelled",
      "queued"
    ]);
    tracker.update(waiting, "preparing");
    expect(tracker.snapshot().entries.find((entry) => entry.runId === waiting)?.phase).toBe(
      "cancelled"
    );
    expect(tracker.snapshot().entries.find((entry) => entry.runId === anotherBatch)?.phase).toBe(
      "queued"
    );
  });

  it("records real phase changes, including generation retries, without inventing acceptance", () => {
    const tracker = new AgentExecutionTracker("host-1", () => "2026-09-13T00:00:00Z");
    const id = tracker.start(task);
    for (const phase of [
      "preparing",
      "generating",
      "checking",
      "generating",
      "checking",
      "awaiting-review",
      "applying",
      "edit-applied"
    ] as const)
      tracker.update(id, phase);
    expect(tracker.snapshot()).toMatchObject({ sessionId: "host-1", revision: 9 });
    expect(tracker.snapshot().entries[0].phase).toBe("edit-applied");
    expect(EXECUTION_PHASE_LABELS["edit-applied"]).toContain("acceptance pending");
    tracker.update(id, "generating");
    expect(tracker.snapshot().revision).toBe(9);
    expect(tracker.snapshot().entries[0].phase).toBe("edit-applied");
  });

  it("keeps concurrent tasks and repeated attempts independent", () => {
    const tracker = new AgentExecutionTracker("host-1");
    const first = tracker.start(task);
    const other = tracker.start({ ...task, workspacePath: "/tmp/other" });
    tracker.update(first, "cancelled");
    const retry = tracker.start(task);
    tracker.update(retry, "generating");
    expect(new Set([first, other, retry]).size).toBe(3);
    expect(tracker.snapshot().entries.map((entry) => entry.phase)).toEqual([
      "cancelled",
      "queued",
      "generating"
    ]);
    expect(new AgentExecutionTracker("host-2").snapshot().entries).toEqual([]);
  });

  it("ignores duplicate and unknown updates and returns independent snapshots", () => {
    const tracker = new AgentExecutionTracker("host-1");
    const id = tracker.start(task);
    tracker.update(id, "queued");
    tracker.update("missing", "failed");
    const snapshot = tracker.snapshot();
    snapshot.entries[0].title = "Changed outside the tracker";
    snapshot.entries.length = 0;
    expect(tracker.snapshot().revision).toBe(1);
    expect(tracker.snapshot().entries[0].title).toBe(task.title);
  });

  it("bounds recent history and removes finished observations before active ones", () => {
    const tracker = new AgentExecutionTracker("host-1");
    const active = tracker.start(task);
    const finished = tracker.start(task);
    tracker.update(finished, "failed");
    for (let index = 0; index < MAX_EXECUTION_TRACES; index++) tracker.start(task);
    const entries = tracker.snapshot().entries;
    expect(entries).toHaveLength(MAX_EXECUTION_TRACES);
    expect(entries.some((entry) => entry.runId === finished)).toBe(false);
    expect(entries.some((entry) => entry.runId === active)).toBe(false);
    expect(isAgentExecutionSnapshot(tracker.snapshot())).toBe(true);
  });

  it("whitelists observation metadata and keeps text within message bounds", () => {
    const tracker = new AgentExecutionTracker("host-1");
    const input = {
      ...task,
      title: "x\n".repeat(600),
      model: "m\r".repeat(100),
      ssot: "private prompt",
      signal: new AbortController().signal,
      worktree: "/private/path"
    };
    tracker.start(input);
    const entry = tracker.snapshot().entries[0];
    expect(Object.keys(entry).sort()).toEqual([
      "issueId",
      "model",
      "phase",
      "provider",
      "runId",
      "startedAt",
      "title",
      "updatedAt",
      "workspacePath"
    ]);
    expect(entry.title).toHaveLength(500);
    expect(entry.model).toHaveLength(100);
    expect(isAgentExecutionSnapshot(tracker.snapshot())).toBe(true);
    expect(JSON.stringify(entry)).not.toContain("private prompt");
  });

  it("treats handoff and completed responses as terminal observations, not live workers", () => {
    for (const phase of [
      "session-opened",
      "prompt-prepared",
      "response-ready",
      "edit-applied"
    ] as const)
      expect(isActiveExecutionPhase(phase)).toBe(false);
    expect(EXECUTION_PHASE_LABELS["session-opened"]).toContain("not monitored");
    expect(EXECUTION_PHASE_LABELS["response-ready"]).toContain("not accepted");
  });
});

describe("execution snapshot protocol", () => {
  it("accepts the read-only handshake and valid host snapshot", () => {
    const tracker = new AgentExecutionTracker("host-1");
    tracker.start(task);
    expect(isBeadsRequestMessage({ command: "getAgentExecutionSnapshot" })).toBe(true);
    expect(
      isBeadsHostMessage({ command: "agentExecutionSnapshot", snapshot: tracker.snapshot() })
    ).toBe(true);
  });

  it("rejects malformed, oversized, duplicate and unknown-phase observations", () => {
    const tracker = new AgentExecutionTracker("host-1");
    tracker.start(task);
    const valid = tracker.snapshot();
    for (const snapshot of [
      null,
      {},
      { ...valid, sessionId: "" },
      { ...valid, revision: -1 },
      { ...valid, entries: [valid.entries[0], valid.entries[0]] },
      { ...valid, entries: Array(MAX_EXECUTION_TRACES + 1).fill(valid.entries[0]) },
      ...[
        { phase: "accepted" },
        { phase: "constructor" },
        { provider: "unknown" },
        { model: "bad\nvalue" },
        { issueId: "" },
        { runId: "" },
        { title: "x".repeat(501) },
        { updatedAt: "not a timestamp" }
      ].map((change) => ({ ...valid, entries: [{ ...valid.entries[0], ...change }] }))
    ])
      expect(isBeadsHostMessage({ command: "agentExecutionSnapshot", snapshot })).toBe(false);
  });
});
