import { describe, expect, it } from "vitest";

import {
  AGENT_UPDATE_CAPABILITY_PROBE_ARGS,
  type BeadsCapabilityCommandResult,
  PLAN_CREATE_CAPABILITY_PROBE_ARGS,
  PLAN_DEPENDENCY_CAPABILITY_PROBE_ARGS,
  PLAN_UPDATE_CAPABILITY_PROBE_ARGS,
  probeBeadsAgentWriteCapability,
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

    expect(capability).toEqual({
      supported: false,
      state: "unsupported-command",
      reason:
        "The active Beads CLI does not support one or more commands or options required by this extension."
    });
  });

  it.each([
    "unknown option '--metadata'",
    "unrecognized option '--metadata'",
    "no such option: --metadata",
    "flag provided but not defined: -metadata"
  ])("classifies an unsupported CLI option for: %s", async (message) => {
    const capability = await probeBeadsWriteCapability(true, null, async () =>
      result(1, "", message)
    );

    expect(capability).toEqual({
      supported: false,
      state: "unsupported-command",
      reason:
        "The active Beads CLI does not support one or more commands or options required by this extension."
    });
    expect(capability.reason).not.toContain(message);
  });

  it("does not expose raw CLI help or stderr in a failed probe reason", async () => {
    const rawOutput = `fatal: capability probe failed
Usage: bd create [flags]
${"verbose diagnostic ".repeat(200)}`;
    const capability = await probeBeadsWriteCapability(true, null, async () =>
      result(2, "", rawOutput)
    );

    expect(capability).toEqual({
      supported: false,
      state: "probe-failed",
      reason: "The Beads capability probe could not confirm a compatible CLI (exit code 2)."
    });
    expect(capability.reason).not.toContain("Usage:");
    expect(capability.reason).not.toContain("verbose diagnostic");
    expect(capability.reason).not.toContain("\n");
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

describe("Beads agent write capability", () => {
  it("accepts a non-mutating schema probe and the single-update contract", async () => {
    const calls: string[][] = [];
    const capability = await probeBeadsAgentWriteCapability(true, null, async (args) => {
      calls.push([...args]);
      return args[0] === "update"
        ? result(
            0,
            "Flags:\n  --assignee string\n  --append-notes string\n  --set-metadata stringArray\n  --status string"
          )
        : result(0, '{"title":"probe"}');
    });

    expect(capability).toEqual({
      supported: true,
      state: "supported",
      reason: "Compatible dry-run and agent update commands were observed."
    });
    expect(calls).toEqual([
      [...PLAN_CREATE_CAPABILITY_PROBE_ARGS],
      [...AGENT_UPDATE_CAPABILITY_PROBE_ARGS]
    ]);
  });

  it("blocks agent work when the dry-run observes schema skew", async () => {
    const capability = await probeBeadsAgentWriteCapability(true, null, async () =>
      result(
        1,
        JSON.stringify({
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

  it("summarizes a structured remote migration gate received on stderr", async () => {
    const capability = await probeBeadsAgentWriteCapability(true, null, async () =>
      result(
        1,
        "",
        JSON.stringify({
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

  it("blocks agent work when one-command persistence flags are unavailable", async () => {
    const capability = await probeBeadsAgentWriteCapability(true, null, async (args) =>
      args[0] === "update"
        ? result(0, "Flags:\n  --assignee string\n  --status string")
        : result(0, '{"title":"probe"}')
    );

    expect(capability.supported).toBe(false);
    expect(capability.state).toBe("unsupported-command");
    expect(capability.reason).toContain("--append-notes");
    expect(capability.reason).toContain("--set-metadata");
  });
});
