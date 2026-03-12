import { describe, expect, it, vi } from "vitest";

import { syncBeadsWorkspace } from "../src/beadsSync";

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
});
