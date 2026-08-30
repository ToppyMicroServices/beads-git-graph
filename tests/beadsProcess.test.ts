import { describe, expect, it, vi } from "vitest";

import {
  assertBeadsProcessTrusted,
  BEADS_LOCAL_INIT_ARGS,
  createBdSpawnOptions,
  getBdExecutableFallbackCommands,
  resolveBdExecutableStatus,
  RESTRICTED_MODE_BEADS_MESSAGE
} from "../src/beadsProcess";

describe("Beads process boundary", () => {
  it("keeps local initialization non-interactive and non-destructive", () => {
    expect(BEADS_LOCAL_INIT_ARGS).toEqual([
      "init",
      "--non-interactive",
      "--skip-agents",
      "--skip-hooks",
      "--init-if-missing"
    ]);
    expect(BEADS_LOCAL_INIT_ARGS).not.toContain("migrate");
    expect(BEADS_LOCAL_INIT_ARGS).not.toContain("bootstrap");
  });

  it("does not probe the configured executable in Restricted Mode", async () => {
    const checker = vi.fn(async () => ({
      available: true,
      command: "sentinel",
      message: null
    }));

    await expect(resolveBdExecutableStatus("sentinel", false, checker)).resolves.toEqual({
      available: false,
      command: "sentinel",
      message: RESTRICTED_MODE_BEADS_MESSAGE
    });
    expect(checker).not.toHaveBeenCalled();
  });

  it("checks trusted executables with Dolt event flushing disabled", async () => {
    const checker = vi.fn(async (command: string) => ({
      available: true,
      command,
      message: null
    }));

    await expect(resolveBdExecutableStatus("bd", true, checker)).resolves.toEqual({
      available: true,
      command: "bd",
      message: null
    });
    expect(checker).toHaveBeenCalledWith(
      "bd",
      ["--version"],
      expect.objectContaining({
        env: expect.objectContaining({ DOLT_DISABLE_EVENT_FLUSH: "true" })
      })
    );
  });

  it("auto-detects common local bd installations only after the default command fails", async () => {
    expect(getBdExecutableFallbackCommands("darwin")).toEqual([
      "/opt/homebrew/bin/bd",
      "/usr/local/bin/bd"
    ]);
    expect(getBdExecutableFallbackCommands("win32")).toEqual([]);

    const checker = vi.fn(async (command: string) => ({
      available: command === "/opt/homebrew/bin/bd",
      command,
      message: command === "/opt/homebrew/bin/bd" ? null : "not found"
    }));

    await expect(
      resolveBdExecutableStatus("bd", true, checker, ["/opt/homebrew/bin/bd", "/usr/local/bin/bd"])
    ).resolves.toEqual({
      available: true,
      command: "/opt/homebrew/bin/bd",
      message: null
    });
    expect(checker.mock.calls.map(([command]) => command)).toEqual(["bd", "/opt/homebrew/bin/bd"]);
  });

  it("does not replace an explicitly configured missing path with a fallback", async () => {
    const checker = vi.fn(async (command: string) => ({
      available: false,
      command,
      message: "not found"
    }));

    await expect(
      resolveBdExecutableStatus("/custom/bd", true, checker, ["/opt/homebrew/bin/bd"])
    ).resolves.toEqual({
      available: false,
      command: "/custom/bd",
      message: "not found"
    });
    expect(checker).toHaveBeenCalledTimes(1);
  });

  it("preserves the caller environment and rejects untrusted process starts", () => {
    expect(createBdSpawnOptions("/workspace", { SAFE_SENTINEL: "present" })).toEqual({
      cwd: "/workspace",
      env: {
        SAFE_SENTINEL: "present",
        DOLT_DISABLE_EVENT_FLUSH: "true"
      }
    });
    expect(() => assertBeadsProcessTrusted(false)).toThrow(RESTRICTED_MODE_BEADS_MESSAGE);
    expect(() => assertBeadsProcessTrusted(true)).not.toThrow();
  });
});
