import { type AgentProviderId, normalizeAgentProviderId } from "./agentProvider";

export const EXECUTION_PHASE_LABELS = {
  queued: "Queued",
  preparing: "Preparing",
  generating: "Generating",
  checking: "Model checking",
  "awaiting-review": "Human review",
  applying: "Applying reviewed edit",
  "opening-session": "Opening session",
  "edit-applied": "Edit applied · acceptance pending",
  "session-opened": "Session opened · not monitored",
  "prompt-prepared": "Prompt prepared · not started",
  "response-ready": "Response ready · not accepted",
  "not-ready": "Skipped · not ready",
  failed: "Failed · inspect notification",
  cancelled: "Cancelled"
} as const;

export type AgentExecutionPhase = keyof typeof EXECUTION_PHASE_LABELS;

export interface AgentExecutionTrace {
  runId: string;
  workspacePath: string;
  issueId: string;
  title: string;
  provider: AgentProviderId;
  model: string;
  phase: AgentExecutionPhase;
  startedAt: string;
  updatedAt: string;
}

export interface AgentExecutionSnapshot {
  sessionId: string;
  revision: number;
  entries: AgentExecutionTrace[];
}

export const MAX_EXECUTION_TRACES = 100;

export function isActiveExecutionPhase(phase: AgentExecutionPhase) {
  return [
    "queued",
    "preparing",
    "generating",
    "checking",
    "awaiting-review",
    "applying",
    "opening-session"
  ].includes(phase);
}

function boundedText(value: unknown, limit: number) {
  return (
    typeof value === "string" &&
    value.length <= limit &&
    !value.includes("\u0000") &&
    !/[\r\n]/.test(value)
  );
}

export function isAgentExecutionSnapshot(value: unknown): value is AgentExecutionSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    boundedText(data.sessionId, 100) &&
    data.sessionId !== "" &&
    Number.isSafeInteger(data.revision) &&
    Number(data.revision) >= 0 &&
    Array.isArray(data.entries) &&
    data.entries.length <= MAX_EXECUTION_TRACES &&
    data.entries.every((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return false;
      const row = entry as Record<string, unknown>;
      return (
        boundedText(row.runId, 150) &&
        row.runId !== "" &&
        boundedText(row.workspacePath, 4096) &&
        row.workspacePath !== "" &&
        boundedText(row.issueId, 200) &&
        row.issueId !== "" &&
        boundedText(row.title, 500) &&
        boundedText(row.model, 100) &&
        normalizeAgentProviderId(row.provider) !== null &&
        typeof row.phase === "string" &&
        Object.prototype.hasOwnProperty.call(EXECUTION_PHASE_LABELS, row.phase) &&
        typeof row.startedAt === "string" &&
        row.startedAt.length <= 30 &&
        Number.isFinite(Date.parse(row.startedAt)) &&
        typeof row.updatedAt === "string" &&
        row.updatedAt.length <= 30 &&
        Number.isFinite(Date.parse(row.updatedAt))
      );
    }) &&
    new Set(data.entries.map((row) => row.runId)).size === data.entries.length
  );
}

/** Session-scoped observations only: not a durable task status or an external worker heartbeat. */
export class AgentExecutionTracker {
  private revision = 0;
  private nextRun = 0;
  private entries: AgentExecutionTrace[] = [];

  constructor(
    private readonly sessionId: string,
    private readonly now = () => new Date().toISOString()
  ) {}

  start(
    values: Pick<AgentExecutionTrace, "workspacePath" | "issueId" | "title" | "provider" | "model">
  ) {
    const time = this.now();
    const runId = `${this.sessionId}:${++this.nextRun}`;
    const oneLine = (text: string, max: number) =>
      text
        .replace(/[\r\n]/g, " ")
        .split("\u0000")
        .join(" ")
        .slice(0, max);
    this.entries.push({
      workspacePath: values.workspacePath,
      issueId: values.issueId,
      provider: values.provider,
      title: oneLine(values.title, 500),
      model: oneLine(values.model, 100),
      runId,
      phase: "queued",
      startedAt: time,
      updatedAt: time
    });
    if (this.entries.length > MAX_EXECUTION_TRACES) {
      const finished = this.entries.findIndex((entry) => !isActiveExecutionPhase(entry.phase));
      this.entries.splice(finished < 0 ? 0 : finished, 1);
    }
    this.revision++;
    return runId;
  }

  update(runId: string, phase: AgentExecutionPhase) {
    const entry = this.entries.find((row) => row.runId === runId);
    if (!entry || entry.phase === phase || !isActiveExecutionPhase(entry.phase)) return;
    entry.phase = phase;
    entry.updatedAt = this.now();
    this.revision++;
  }

  cancelQueued(runIds: Iterable<string>) {
    const selected = new Set(runIds);
    for (const entry of this.entries) {
      if (selected.has(entry.runId) && entry.phase === "queued")
        this.update(entry.runId, "cancelled");
    }
  }

  snapshot(): AgentExecutionSnapshot {
    return {
      sessionId: this.sessionId,
      revision: this.revision,
      entries: this.entries.map((entry) => ({ ...entry }))
    };
  }
}
