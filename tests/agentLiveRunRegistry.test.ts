import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_LIVE_HEARTBEAT_INTERVAL_MS,
  AGENT_LIVE_STALE_AFTER_MS,
  AgentLiveRunRegistry
} from "../src/agentLiveRunRegistry";

describe("AgentLiveRunRegistry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks one live run, refreshes its heartbeat, and stops idempotently", () => {
    vi.useFakeTimers();
    let now = Date.parse("2026-07-15T00:00:00.000Z");
    const onDidChange = vi.fn();
    const registry = new AgentLiveRunRegistry(onDidChange, () => now);

    const handle = registry.start({
      workspacePath: "/tmp/demo",
      issueId: "task-1",
      provider: "ollama",
      model: "qwen2.5-coder:0.5b"
    });
    const started = registry.get("/tmp/demo", "task-1");

    expect(started).toMatchObject({
      provider: "ollama",
      model: "qwen2.5-coder:0.5b",
      startedAt: "2026-07-15T00:00:00.000Z",
      heartbeatAt: "2026-07-15T00:00:00.000Z"
    });
    expect(started?.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(onDidChange).toHaveBeenCalledTimes(1);
    expect(() =>
      registry.start({
        workspacePath: "/tmp/demo",
        issueId: "task-1",
        provider: "openai",
        model: "gpt-5"
      })
    ).toThrow("already has a live AI execution");

    now += AGENT_LIVE_HEARTBEAT_INTERVAL_MS;
    vi.advanceTimersByTime(AGENT_LIVE_HEARTBEAT_INTERVAL_MS);
    expect(registry.get("/tmp/demo", "task-1")?.heartbeatAt).toBe("2026-07-15T00:00:05.000Z");

    handle.stop();
    handle.stop();
    expect(registry.get("/tmp/demo", "task-1")).toBeNull();
    expect(onDidChange).toHaveBeenCalledTimes(2);
    registry.dispose();
  });

  it("prunes a stale heartbeat instead of leaving a false Live state", () => {
    vi.useFakeTimers();
    let now = Date.parse("2026-07-15T00:00:00.000Z");
    const onDidChange = vi.fn();
    const registry = new AgentLiveRunRegistry(onDidChange, () => now);

    registry.start({
      workspacePath: "/tmp/demo",
      issueId: "task-stale",
      provider: "openai",
      model: "gpt-5"
    });
    now += AGENT_LIVE_STALE_AFTER_MS + 1;

    expect(registry.get("/tmp/demo", "task-stale")).toBeNull();
    expect(onDidChange).toHaveBeenCalledTimes(2);
    registry.dispose();
  });
});
