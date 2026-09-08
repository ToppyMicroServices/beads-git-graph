import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));
vi.mock("../src/beadsWebview", () => ({
  renderBeadsWebviewHtml: vi.fn()
}));

import {
  BeadsViewProvider,
  getAgentStartBlockReason,
  isUnsupportedReadyLimitOptionError,
  queryReadyItemIdsWithLimitFallback
} from "../src/beadsView";
import { type BeadWarning } from "../src/beadsViewTypes";

type ReadyLoaderHost = {
  queryReadyItemIds(cwd: string): Promise<Set<string>>;
};

const loadReadyItemIds = (
  BeadsViewProvider.prototype as unknown as {
    loadReadyItemIds(
      this: ReadyLoaderHost,
      cwd: string,
      warnings: BeadWarning[]
    ): Promise<{ itemIds: Set<string>; known: boolean }>;
  }
).loadReadyItemIds;

describe("bd ready compatibility", () => {
  it.each([
    "unknown flag: --limit",
    "unknown option '--limit'",
    "unsupported option: --limit",
    "unrecognized option '--limit'",
    "no such option: --limit",
    "flag provided but not defined: -limit",
    "this version does not support --limit"
  ])("recognizes an unsupported limit option: %s", (message) => {
    expect(isUnsupportedReadyLimitOptionError(new Error(message))).toBe(true);
  });

  it.each([
    "database schema is older than the CLI",
    "unknown flag: --all",
    "unknown flag: --all\nOptions:\n  --limit int",
    "permission denied while reading the database",
    "invalid JSON returned for --limit"
  ])("does not treat another bd failure as an option mismatch: %s", (message) => {
    expect(isUnsupportedReadyLimitOptionError(new Error(message))).toBe(false);
  });

  it("uses the modern ready command when it succeeds", async () => {
    const calls: string[][] = [];
    const ids = await queryReadyItemIdsWithLimitFallback(async (args) => {
      calls.push(args);
      return JSON.stringify([{ id: "task-1", title: "Ready task" }]);
    });

    expect([...ids]).toEqual(["task-1"]);
    expect(calls).toEqual([["ready", "--json", "--limit", "0"]]);
  });

  it("retries without limit only for an unsupported limit option", async () => {
    const calls: string[][] = [];
    const ids = await queryReadyItemIdsWithLimitFallback(async (args) => {
      calls.push(args);
      if (calls.length === 1) throw new Error("unknown flag: --limit");
      return JSON.stringify([{ id: "task-2", title: "Legacy ready task" }]);
    });

    expect([...ids]).toEqual(["task-2"]);
    expect(calls).toEqual([
      ["ready", "--json", "--limit", "0"],
      ["ready", "--json"]
    ]);
  });

  it("preserves non-option failures without retrying", async () => {
    const runBdCommand = vi.fn(async () => {
      throw new Error("schema migration required");
    });

    await expect(queryReadyItemIdsWithLimitFallback(runBdCommand)).rejects.toThrow(
      "schema migration required"
    );
    expect(runBdCommand).toHaveBeenCalledTimes(1);
  });

  it("marks a successful empty ready result as known", async () => {
    const warnings: BeadWarning[] = [];
    const result = await loadReadyItemIds.call(
      {
        queryReadyItemIds: async () => new Set<string>()
      },
      "/tmp/project",
      warnings
    );

    expect(result).toEqual({ itemIds: new Set<string>(), known: true });
    expect(warnings).toEqual([]);
  });

  it("marks a failed ready query as unknown instead of not-ready", async () => {
    const warnings: BeadWarning[] = [];
    const result = await loadReadyItemIds.call(
      {
        queryReadyItemIds: async () => {
          throw new Error("schema migration required");
        }
      },
      "/tmp/project",
      warnings
    );

    expect(result).toEqual({ itemIds: new Set<string>(), known: false });
    expect(warnings).toEqual([
      {
        source: "/tmp/project/.beads",
        workspacePath: "/tmp/project",
        message:
          "Unable to determine ready tasks because bd ready failed. Start AI remains unavailable until readiness can be confirmed."
      }
    ]);
  });
});

describe("live Start AI task validation", () => {
  it("allows an open non-epic task", () => {
    expect(getAgentStartBlockReason({ id: "task-1", status: "open", type: "task" })).toBeNull();
  });

  it("rejects an epic even when it is open", () => {
    expect(getAgentStartBlockReason({ id: "epic-1", status: "open", type: "EPIC" })).toBe(
      "Refusing to start epic-1: epics organize work and cannot be started by AI. Start an open child task instead."
    );
  });

  it.each(["in_progress", "blocked", "closed"])(
    "rejects a task whose live status is %s",
    (status) => {
      expect(getAgentStartBlockReason({ id: "task-1", status, type: "task" })).toBe(
        `Refusing to start task-1: current Beads status is ${status}; only open tasks can be started.`
      );
    }
  );
});
