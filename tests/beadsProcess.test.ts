import { describe, expect, it, vi } from "vitest";

import {
  assertBeadsProcessTrusted,
  createBdSpawnOptions,
  resolveBdExecutableStatus,
  RESTRICTED_MODE_BEADS_MESSAGE
} from "../src/beadsProcess";

describe("Beads process boundary", () => {
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
