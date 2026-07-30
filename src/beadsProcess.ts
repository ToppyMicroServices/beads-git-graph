import { type SpawnOptionsWithoutStdio } from "node:child_process";

import { type CommandAvailability } from "./commandAvailability";

export const RESTRICTED_MODE_BEADS_MESSAGE =
  "Beads CLI execution is disabled in Restricted Mode. Trust this workspace to run bd.";

type ExecutableChecker = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => Promise<CommandAvailability>;

export function createBdSpawnOptions(
  cwd?: string,
  environment: NodeJS.ProcessEnv = process.env
): SpawnOptionsWithoutStdio {
  return {
    ...(cwd === undefined ? {} : { cwd }),
    env: {
      ...environment,
      DOLT_DISABLE_EVENT_FLUSH: "true"
    }
  };
}

export function assertBeadsProcessTrusted(isTrusted: boolean) {
  if (!isTrusted) {
    throw new Error(RESTRICTED_MODE_BEADS_MESSAGE);
  }
}

export async function resolveBdExecutableStatus(
  command: string,
  isTrusted: boolean,
  checkExecutable: ExecutableChecker
): Promise<CommandAvailability> {
  if (!isTrusted) {
    return {
      available: false,
      command,
      message: RESTRICTED_MODE_BEADS_MESSAGE
    };
  }
  return checkExecutable(command, ["--version"], createBdSpawnOptions());
}
