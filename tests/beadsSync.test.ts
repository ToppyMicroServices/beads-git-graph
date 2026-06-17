import { describe, expect, it, vi } from "vitest";

import { flushBeadsWorkspace, syncBeadsWorkspace } from "../src/beadsSync";

describe("syncBeadsWorkspace", () => {
  it("flushes issues.jsonl after a sync completes", async () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const runBdCommand = vi.fn(async (args: string[], cwd: string) => {
      calls.push({ args, cwd });
      return "";
    });

    await syncBeadsWorkspace(runBdCommand, "/tmp/demo");

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

  it("treats missing sync support as a no-op for newer bd builds", async () => {
    const runBdCommand = vi.fn(async () => {
      throw new Error('unknown command "sync" for "bd"');
    });

    await expect(syncBeadsWorkspace(runBdCommand, "/tmp/demo")).resolves.toBeUndefined();
    expect(runBdCommand).toHaveBeenCalledWith(["sync"], "/tmp/demo");
  });
});

describe("flushBeadsWorkspace", () => {
  it("ignores missing sync support", async () => {
    const runBdCommand = vi.fn(async () => {
      throw new Error('unknown command "sync" for "bd"');
    });

    await expect(flushBeadsWorkspace(runBdCommand, "/tmp/demo")).resolves.toBeUndefined();
    expect(runBdCommand).toHaveBeenCalledWith(["sync", "--flush-only"], "/tmp/demo");
  });
});
