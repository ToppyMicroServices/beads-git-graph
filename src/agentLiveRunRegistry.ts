import { randomUUID } from "node:crypto";

import { type AgentLiveExecution } from "./agentLiveExecution";
import { type AgentProviderId } from "./agentProvider";

export const AGENT_LIVE_HEARTBEAT_INTERVAL_MS = 5_000;
export const AGENT_LIVE_STALE_AFTER_MS = 20_000;

export interface AgentLiveRunHandle {
  stop(): void;
}

interface AgentLiveRunEntry extends AgentLiveExecution {
  workspacePath: string;
  issueId: string;
  heartbeatAtMs: number;
  timer: ReturnType<typeof setInterval>;
}

function getLiveRunKey(workspacePath: string, issueId: string) {
  return `${workspacePath}\u0000${issueId}`;
}

export class AgentLiveRunRegistry {
  private readonly entries = new Map<string, AgentLiveRunEntry>();

  constructor(
    private readonly onDidChange: () => void = () => undefined,
    private readonly now: () => number = () => Date.now()
  ) {}

  public start(values: {
    workspacePath: string;
    issueId: string;
    provider: AgentProviderId;
    model: string;
  }): AgentLiveRunHandle {
    const key = getLiveRunKey(values.workspacePath, values.issueId);
    if (this.entries.has(key)) {
      throw new Error(`Task ${values.issueId} already has a live AI execution.`);
    }

    const startedAtMs = this.now();
    const entry: AgentLiveRunEntry = {
      ...values,
      runId: randomUUID(),
      startedAt: new Date(startedAtMs).toISOString(),
      heartbeatAt: new Date(startedAtMs).toISOString(),
      heartbeatAtMs: startedAtMs,
      timer: undefined as never
    };
    entry.timer = setInterval(() => {
      const heartbeatAtMs = this.now();
      entry.heartbeatAtMs = heartbeatAtMs;
      entry.heartbeatAt = new Date(heartbeatAtMs).toISOString();
    }, AGENT_LIVE_HEARTBEAT_INTERVAL_MS);
    entry.timer.unref?.();
    this.entries.set(key, entry);
    this.onDidChange();

    let stopped = false;
    return {
      stop: () => {
        if (stopped) {
          return;
        }
        stopped = true;
        clearInterval(entry.timer);
        if (this.entries.get(key)?.runId === entry.runId) {
          this.entries.delete(key);
          this.onDidChange();
        }
      }
    };
  }

  public get(workspacePath: string, issueId: string): AgentLiveExecution | null {
    const key = getLiveRunKey(workspacePath, issueId);
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return null;
    }
    if (this.now() - entry.heartbeatAtMs > AGENT_LIVE_STALE_AFTER_MS) {
      clearInterval(entry.timer);
      this.entries.delete(key);
      this.onDidChange();
      return null;
    }
    return {
      runId: entry.runId,
      provider: entry.provider,
      model: entry.model,
      startedAt: entry.startedAt,
      heartbeatAt: entry.heartbeatAt
    };
  }

  public dispose() {
    for (const entry of this.entries.values()) {
      clearInterval(entry.timer);
    }
    this.entries.clear();
  }
}
