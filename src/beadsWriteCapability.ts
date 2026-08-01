export type BeadsWriteCapabilityState =
  | "supported"
  | "missing-executable"
  | "unsupported-command"
  | "schema-mismatch"
  | "probe-failed";

export interface BeadsWriteCapability {
  supported: boolean;
  state: BeadsWriteCapabilityState;
  reason: string;
}

export interface BeadsCapabilityCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type BeadsCapabilityCommandRunner = (
  args: readonly string[]
) => Promise<BeadsCapabilityCommandResult>;

export const PLAN_CREATE_CAPABILITY_PROBE_ARGS = [
  "create",
  "--dry-run",
  "--json",
  "--type",
  "task",
  "--priority",
  "P2",
  "--title",
  "__beads_git_graph_capability_probe__",
  "--acceptance",
  "capability probe only",
  "--metadata",
  '{"beads_git_graph_probe":true}'
] as const;

export const PLAN_UPDATE_CAPABILITY_PROBE_ARGS = ["update", "--help"] as const;
export const PLAN_DEPENDENCY_CAPABILITY_PROBE_ARGS = ["dep", "add", "--help"] as const;
export const AGENT_UPDATE_CAPABILITY_PROBE_ARGS = ["update", "--help"] as const;

function getObservedOutput(result: BeadsCapabilityCommandResult) {
  return [result.stdout, result.stderr]
    .map((value) => value.trim())
    .filter((value) => value !== "")
    .join("\n");
}

function parseRemoteMigrationGate(stdout: string) {
  try {
    const parsed = JSON.parse(stdout) as {
      remote_migrate_gate?: {
        current_version?: unknown;
        latest_version?: unknown;
        human_decision_required?: unknown;
      };
    };
    const gate = parsed.remote_migrate_gate;
    if (gate?.human_decision_required !== true) {
      return null;
    }
    const currentVersion =
      typeof gate.current_version === "number" ? String(gate.current_version) : "unknown";
    const latestVersion =
      typeof gate.latest_version === "number" ? String(gate.latest_version) : "unknown";
    return `Beads schema v${currentVersion} is incompatible with v${latestVersion}; migration coordination is required.`;
  } catch {
    return null;
  }
}

function classifyFailedProbe(
  result: BeadsCapabilityCommandResult
): Exclude<BeadsWriteCapability, { state: "supported" }> {
  const observed = getObservedOutput(result);
  const migrationGateReason = parseRemoteMigrationGate(result.stdout);
  if (
    migrationGateReason !== null ||
    /schema (?:migration|mismatch|skew)|pending schema|remote-backed database/i.test(observed)
  ) {
    return {
      supported: false,
      state: "schema-mismatch",
      reason:
        migrationGateReason ?? (observed || "The Beads schema is incompatible with the active CLI.")
    };
  }
  if (
    /unknown command|command not found|no such command|unknown (?:flag|option)|unrecognized option|no such option|flag provided but not defined/i.test(
      observed
    )
  ) {
    return {
      supported: false,
      state: "unsupported-command",
      reason: observed || "The active Beads CLI does not support the required command."
    };
  }
  return {
    supported: false,
    state: "probe-failed",
    reason: observed || `The Beads capability probe exited with code ${result.exitCode}.`
  };
}

export async function probeBeadsWriteCapability(
  executableAvailable: boolean,
  unavailableReason: string | null,
  run: BeadsCapabilityCommandRunner
): Promise<BeadsWriteCapability> {
  if (!executableAvailable) {
    return {
      supported: false,
      state: "missing-executable",
      reason: unavailableReason?.trim() || "The Beads CLI is unavailable."
    };
  }

  let createProbe: BeadsCapabilityCommandResult;
  try {
    createProbe = await run(PLAN_CREATE_CAPABILITY_PROBE_ARGS);
  } catch (error) {
    return {
      supported: false,
      state: "probe-failed",
      reason:
        error instanceof Error
          ? error.message
          : "The Beads create capability probe could not be executed."
    };
  }
  if (createProbe.exitCode !== 0) {
    return classifyFailedProbe(createProbe);
  }

  let updateProbe: BeadsCapabilityCommandResult;
  try {
    updateProbe = await run(PLAN_UPDATE_CAPABILITY_PROBE_ARGS);
  } catch (error) {
    return {
      supported: false,
      state: "probe-failed",
      reason:
        error instanceof Error
          ? error.message
          : "The Beads update capability probe could not be executed."
    };
  }
  if (updateProbe.exitCode !== 0) {
    return classifyFailedProbe(updateProbe);
  }
  const updateHelp = getObservedOutput(updateProbe);
  if (!updateHelp.includes("--acceptance") || !updateHelp.includes("--set-metadata")) {
    return {
      supported: false,
      state: "unsupported-command",
      reason: "The active Beads update command lacks --acceptance or --set-metadata."
    };
  }

  let dependencyProbe: BeadsCapabilityCommandResult;
  try {
    dependencyProbe = await run(PLAN_DEPENDENCY_CAPABILITY_PROBE_ARGS);
  } catch (error) {
    return {
      supported: false,
      state: "probe-failed",
      reason:
        error instanceof Error
          ? error.message
          : "The Beads dependency capability probe could not be executed."
    };
  }
  if (dependencyProbe.exitCode !== 0) {
    return classifyFailedProbe(dependencyProbe);
  }

  return {
    supported: true,
    state: "supported",
    reason: "Compatible create, update, and dependency commands were observed."
  };
}

export async function probeBeadsAgentWriteCapability(
  executableAvailable: boolean,
  unavailableReason: string | null,
  run: BeadsCapabilityCommandRunner
): Promise<BeadsWriteCapability> {
  if (!executableAvailable) {
    return {
      supported: false,
      state: "missing-executable",
      reason: unavailableReason?.trim() || "The Beads CLI is unavailable."
    };
  }

  let dryRunProbe: BeadsCapabilityCommandResult;
  try {
    dryRunProbe = await run(PLAN_CREATE_CAPABILITY_PROBE_ARGS);
  } catch (error) {
    return {
      supported: false,
      state: "probe-failed",
      reason:
        error instanceof Error
          ? error.message
          : "The Beads write capability probe could not be executed."
    };
  }
  if (dryRunProbe.exitCode !== 0) {
    return classifyFailedProbe(dryRunProbe);
  }

  let updateProbe: BeadsCapabilityCommandResult;
  try {
    updateProbe = await run(AGENT_UPDATE_CAPABILITY_PROBE_ARGS);
  } catch (error) {
    return {
      supported: false,
      state: "probe-failed",
      reason:
        error instanceof Error
          ? error.message
          : "The Beads update capability probe could not be executed."
    };
  }
  if (updateProbe.exitCode !== 0) {
    return classifyFailedProbe(updateProbe);
  }

  const updateHelp = getObservedOutput(updateProbe);
  const requiredFlags = ["--assignee", "--append-notes", "--set-metadata", "--status"];
  const missingFlags = requiredFlags.filter((flag) => !updateHelp.includes(flag));
  if (missingFlags.length > 0) {
    return {
      supported: false,
      state: "unsupported-command",
      reason: `The active Beads update command lacks ${missingFlags.join(", ")}.`
    };
  }

  return {
    supported: true,
    state: "supported",
    reason: "Compatible dry-run and agent update commands were observed."
  };
}
