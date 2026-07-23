import { describe, expect, it } from "vitest";

import {
  type BeadsCapabilityCommandResult,
  PLAN_CREATE_CAPABILITY_PROBE_ARGS,
  PLAN_DEPENDENCY_CAPABILITY_PROBE_ARGS,
  PLAN_UPDATE_CAPABILITY_PROBE_ARGS,
  probeBeadsWriteCapability
} from "../src/beadsWriteCapability";

function result(
  exitCode: number,
  stdout: string = "",
  stderr: string = ""
): BeadsCapabilityCommandResult {
  return { exitCode, stdout, stderr };
}

describe("Beads plan write capability", () => {
  it("does not execute a probe when bd is unavailable", async () => {
    const calls: string[][] = [];
    const capability = await probeBeadsWriteCapability(false, "bd was not found", async (args) => {
      calls.push([...args]);
      return result(0);
    });

    expect(capability).toEqual({
      supported: false,
      state: "missing-executable",
      reason: "bd was not found"
    });
    expect(calls).toEqual([]);
  });

  it("accepts only the observed create dry-run and dependency command contract", async () => {
    const calls: string[][] = [];
    const capability = await probeBeadsWriteCapability(true, null, async (args) => {
      calls.push([...args]);
      if (args[0] === "update") {
        return result(0, "Flags:\n  --acceptance string\n  --set-metadata stringArray");
      }
      return result(0, args.includes("--dry-run") ? '{"title":"probe"}' : "dependency help");
    });

    expect(capability).toEqual({
      supported: true,
      state: "supported",
      reason: "Compatible create, update, and dependency commands were observed."
    });
    expect(calls).toEqual([
      [...PLAN_CREATE_CAPABILITY_PROBE_ARGS],
      [...PLAN_UPDATE_CAPABILITY_PROBE_ARGS],
      [...PLAN_DEPENDENCY_CAPABILITY_PROBE_ARGS]
    ]);
    expect(PLAN_CREATE_CAPABILITY_PROBE_ARGS).toContain("--dry-run");
    expect(PLAN_CREATE_CAPABILITY_PROBE_ARGS).not.toContain("--readonly");
  });

  it("disables import when the required command is unknown", async () => {
    const capability = await probeBeadsWriteCapability(true, null, async () =>
      result(1, "", 'Error: unknown command "create" for "bd"')
    );

    expect(capability.state).toBe("unsupported-command");
    expect(capability.supported).toBe(false);
    expect(capability.reason).toContain("unknown command");
  });

  it("disables import on a structured remote schema migration gate", async () => {
    const capability = await probeBeadsWriteCapability(true, null, async () =>
      result(
        1,
        JSON.stringify({
          error: "remote-backed database schema mismatch",
          remote_migrate_gate: {
            current_version: 49,
            latest_version: 53,
            human_decision_required: true
          }
        })
      )
    );

    expect(capability).toEqual({
      supported: false,
      state: "schema-mismatch",
      reason: "Beads schema v49 is incompatible with v53; migration coordination is required."
    });
  });
});
