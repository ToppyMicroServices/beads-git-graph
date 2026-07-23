import { describe, expect, it, vi } from "vitest";

import { flushBeadsWorkspace, syncBeadsWorkspace } from "../src/beadsSync";

describe("syncBeadsWorkspace", () => {
  it("flushes issues.jsonl after a sync completes", async () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const runBdCommand = vi.fn(async (args: string[], cwd: string) => {
      calls.push({ args, cwd });
      return "";
    });

    await expect(syncBeadsWorkspace(runBdCommand, "/tmp/demo")).resolves.toEqual({
      status: "synced",
      flush: { status: "flushed" }
    });

    expect(calls).toEqual([
      { args: ["sync"], cwd: "/tmp/demo" },
      { args: ["sync", "--flush-only"], cwd: "/tmp/demo" }
    ]);
  });

  it("does not run the flush step when sync fails", async () => {
    const runBdCommand = vi.fn(async (args: string[]) => {
      if (args.length === 1 && args[0] === "sync") {
        throw new Error("sync failed");
      }
      return "";
    });

    await expect(syncBeadsWorkspace(runBdCommand, "/tmp/demo")).rejects.toThrow("sync failed");
    expect(runBdCommand).toHaveBeenCalledTimes(1);
  });

  it("reports missing sync support without claiming success", async () => {
    const runBdCommand = vi.fn(async () => {
      throw new Error('unknown command "sync" for "bd"');
    });

    await expect(syncBeadsWorkspace(runBdCommand, "/tmp/demo")).resolves.toEqual({
      status: "unsupported"
    });
    expect(runBdCommand).toHaveBeenCalledWith(["sync"], "/tmp/demo");
    expect(runBdCommand).toHaveBeenCalledTimes(1);
  });

  it("reports a successful sync separately from an unsupported flush", async () => {
    const runBdCommand = vi.fn(async (args: string[]) => {
      if (args.length > 1) {
        throw new Error('unknown command "sync" for "bd"');
      }
      return "";
    });

    await expect(syncBeadsWorkspace(runBdCommand, "/tmp/demo")).resolves.toEqual({
      status: "synced",
      flush: { status: "unsupported" }
    });
  });
});

describe("flushBeadsWorkspace", () => {
  it("reports missing sync support", async () => {
    const runBdCommand = vi.fn(async () => {
      throw new Error('unknown command "sync" for "bd"');
    });

    await expect(flushBeadsWorkspace(runBdCommand, "/tmp/demo")).resolves.toEqual({
      status: "unsupported"
    });
    expect(runBdCommand).toHaveBeenCalledWith(["sync", "--flush-only"], "/tmp/demo");
  });

  it("reports a completed flush", async () => {
    const runBdCommand = vi.fn(async () => "");

    await expect(flushBeadsWorkspace(runBdCommand, "/tmp/demo")).resolves.toEqual({
      status: "flushed"
    });
  });
});
