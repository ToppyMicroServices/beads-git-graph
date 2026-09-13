import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));
vi.mock("../src/beadsWebview", () => ({ renderBeadsWebviewHtml: vi.fn() }));

import { type AgentExecutionPhase, AgentExecutionTracker } from "../src/agentExecutionTrace";
import { type AgentProviderId } from "../src/agentProvider";
import { AgentProviderError } from "../src/agentProviderClient";
import { type BeadsHostMessage } from "../src/beadsProtocol";
import { BeadsViewProvider } from "../src/beadsView";

const values = {
  workspacePath: "/tmp/demo",
  issueId: "demo-1",
  title: "Fixture",
  provider: "ollama" as AgentProviderId,
  model: "qwen2.5-coder:0.5b",
  ssot: "AGENTS.md",
  worktree: ""
};

function fixture() {
  const messages: BeadsHostMessage[] = [];
  const provider = Object.create(BeadsViewProvider.prototype) as {
    handleMessage: BeadsViewProvider["handleMessage"];
    refresh: BeadsViewProvider["refresh"];
    executionTracker: AgentExecutionTracker;
    postHostMessage: ReturnType<typeof vi.fn>;
    executeAssignedBead: ReturnType<typeof vi.fn>;
    assignAndStartBead: (input: typeof values & { executionRunId?: string }) => Promise<unknown>;
    webviewView: null;
    panel: { webview: object };
    refreshTimer: null;
    refreshGeneration: number;
    loadBeads: ReturnType<typeof vi.fn>;
    refreshWebviewHtml: ReturnType<typeof vi.fn>;
  };
  Object.assign(provider, {
    executionTracker: new AgentExecutionTracker("host-test"),
    postHostMessage: vi.fn((message: BeadsHostMessage) => messages.push(message)),
    executeAssignedBead: vi.fn()
  });
  return { provider, messages };
}

function phases(messages: BeadsHostMessage[]) {
  return messages.flatMap((message) =>
    message.command === "agentExecutionSnapshot"
      ? message.snapshot.entries.map((entry) => entry.phase)
      : []
  );
}

describe("host execution events", () => {
  it.each([true, false])(
    "observes the guarded handoff only when readiness is %s",
    async (ready) => {
      const { provider, messages } = fixture();
      const openSession = vi.fn(async () => {
        expect(phases(messages)).toEqual(["preparing", "opening-session"]);
        return "session-opened";
      });
      const ensureWorktree = vi
        .fn()
        .mockResolvedValue({ path: "/tmp/worker", branch: "task/demo" });
      const runBd = vi.fn().mockResolvedValue("");
      Object.assign(provider, {
        executeAssignedBead: Object.getPrototypeOf(provider).executeAssignedBead,
        queryReadyItemIds: vi.fn().mockResolvedValue(new Set(ready ? [values.issueId] : [])),
        queryDependencyIdsForStart: vi.fn().mockResolvedValue(new Map()),
        assertAgentWriteCapability: vi.fn().mockResolvedValue(undefined),
        agentExecutionQueue: {
          enqueue: (_workspace: string, operation: () => unknown) => operation()
        },
        ensureAgentWorktree: ensureWorktree,
        openAssignAgentSession: openSession,
        runBdCommand: runBd
      });
      await provider.assignAndStartBead({ ...values, provider: "copilot" });
      expect(phases(messages)).toEqual(
        ready ? ["preparing", "opening-session", "session-opened"] : ["preparing", "not-ready"]
      );
      expect(openSession).toHaveBeenCalledTimes(ready ? 1 : 0);
      expect(ensureWorktree).toHaveBeenCalledTimes(ready ? 1 : 0);
      expect(runBd).toHaveBeenCalledTimes(ready ? 2 : 0);
    }
  );

  it("publishes pipeline phase changes and keeps applied output awaiting acceptance", async () => {
    const { provider, messages } = fixture();
    provider.executeAssignedBead.mockImplementation(
      async (_input, phase: (value: AgentExecutionPhase) => void) => {
        for (const value of ["generating", "checking", "awaiting-review", "applying"] as const)
          phase(value);
        return { status: "started", result: "edit-applied" };
      }
    );
    await provider.assignAndStartBead(values);
    expect(phases(messages)).toEqual([
      "preparing",
      "generating",
      "checking",
      "awaiting-review",
      "applying",
      "edit-applied"
    ]);
    expect(provider.executionTracker.snapshot().entries).toHaveLength(1);
  });

  it.each([
    ["session-opened", "session-opened"],
    ["prompt-prepared", "prompt-prepared"],
    ["response-opened", "response-ready"],
    ["response-stored", "response-ready"],
    ["failed", "failed"]
  ])("reports %s without claiming a running worker", async (result, expected) => {
    const { provider, messages } = fixture();
    provider.executeAssignedBead.mockResolvedValue({ status: "started", result });
    await provider.assignAndStartBead(values);
    expect(phases(messages)).toEqual(["preparing", expected]);
  });

  it("settles a no-longer-ready task without starting a second observation", async () => {
    const { provider, messages } = fixture();
    const executionRunId = provider.executionTracker.start(values);
    provider.executeAssignedBead.mockResolvedValue({
      status: "not-ready",
      phase: "before-preparation"
    });
    await provider.assignAndStartBead({ ...values, executionRunId });
    expect(phases(messages)).toEqual(["preparing", "not-ready"]);
    expect(provider.executionTracker.snapshot().entries).toHaveLength(1);
  });

  it.each([
    [new Error("private response text"), "failed"],
    [new AgentProviderError("cancelled", "private cancellation detail"), "cancelled"]
  ])("reports a safe terminal phase and preserves the original error", async (error, expected) => {
    const { provider, messages } = fixture();
    provider.executeAssignedBead.mockRejectedValue(error);
    await expect(provider.assignAndStartBead(values)).rejects.toBe(error);
    expect(phases(messages)).toEqual(["preparing", expected]);
    expect(JSON.stringify(messages)).not.toContain("private");
  });

  it("answers a snapshot request without reading Beads or requiring trust", async () => {
    const { provider, messages } = fixture();
    const source = { postMessage: vi.fn() };
    await provider.handleMessage({ command: "getAgentExecutionSnapshot" }, source as never);
    expect(provider.executeAssignedBead).not.toHaveBeenCalled();
    expect(provider.postHostMessage).toHaveBeenCalledWith(
      {
        command: "agentExecutionSnapshot",
        snapshot: { sessionId: "host-test", revision: 0, entries: [] }
      },
      source
    );
    expect(messages).toHaveLength(1);
  });

  it("resends observations after a normal data refresh without adding them to render signatures", async () => {
    const { provider, messages } = fixture();
    const result = { workspaces: [] };
    Object.assign(provider, {
      webviewView: null,
      panel: { webview: {} },
      refreshTimer: null,
      refreshGeneration: 0,
      loadBeads: vi.fn().mockResolvedValue(result),
      refreshWebviewHtml: vi.fn().mockResolvedValue(undefined)
    });
    provider.executionTracker.start(values);
    await provider.refresh();
    expect(provider.refreshWebviewHtml.mock.calls[0][3]).toBe(JSON.stringify(result));
    expect(phases(messages)).toEqual(["queued"]);
  });
});
