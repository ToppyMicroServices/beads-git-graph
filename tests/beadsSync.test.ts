import { describe, expect, it, vi } from "vitest";

import {
  flushBeadsWorkspace,
  probeBeadsSyncCapability,
  syncBeadsWorkspace
} from "../src/beadsSync";

describe("probeBeadsSyncCapability", () => {
  it("reports sync support without mutating the workspace", async () => {
    const runBdCommand = vi.fn(async () => "Synchronize Beads data");

    await expect(probeBeadsSyncCapability(runBdCommand, "/tmp/demo")).resolves.toEqual({
      supported: true,
      reason: "The active Beads CLI provides bd sync."
    });
    expect(runBdCommand).toHaveBeenCalledWith(["sync", "--help"], "/tmp/demo");
  });

  it("reports an unsupported sync command", async () => {
    const runBdCommand = vi.fn(async () => {
      throw new Error('unknown command "sync" for "bd"');
    });

    await expect(probeBeadsSyncCapability(runBdCommand, "/tmp/demo")).resolves.toEqual({
      supported: false,
      reason: "The active Beads CLI does not provide bd sync."
    });
  });

  it("reports an unexpected probe failure without claiming support", async () => {
    const runBdCommand = vi.fn(async () => {
      throw new Error("schema inspection failed");
    });

    await expect(probeBeadsSyncCapability(runBdCommand, "/tmp/demo")).resolves.toEqual({
      supported: false,
      reason: "Unable to verify bd sync support with the active Beads CLI."
    });
  });
});

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

  it.each([
    "unknown flag: --flush-only",
    "unknown option '--flush-only'",
    "unrecognized option '--flush-only'",
    "flag provided but not defined: -flush-only"
  ])("reports an unsupported flush option for: %s", async (message) => {
    const runBdCommand = vi.fn(async () => {
      throw new Error(message);
    });

    await expect(flushBeadsWorkspace(runBdCommand, "/tmp/demo")).resolves.toEqual({
      status: "unsupported"
    });
  });

  it("does not hide unrelated sync failures", async () => {
    const runBdCommand = vi.fn(async () => {
      throw new Error("database connection failed");
    });

    await expect(flushBeadsWorkspace(runBdCommand, "/tmp/demo")).rejects.toThrow(
      "database connection failed"
    );
  });
});
