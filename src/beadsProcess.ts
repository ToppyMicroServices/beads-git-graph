import { type SpawnOptionsWithoutStdio } from "node:child_process";

import { type CommandAvailability } from "./commandAvailability";

export const RESTRICTED_MODE_BEADS_MESSAGE =
  "Beads CLI execution is disabled in Restricted Mode. Trust this workspace to run bd.";

export const BEADS_LOCAL_INIT_ARGS = [
  "init",
  "--non-interactive",
  "--skip-agents",
  "--skip-hooks",
  "--init-if-missing"
] as const;

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

export function getBdExecutableFallbackCommands(
  platform: NodeJS.Platform = process.platform
): string[] {
  if (platform === "darwin") {
    return ["/opt/homebrew/bin/bd", "/usr/local/bin/bd"];
  }
  if (platform === "linux") {
    return ["/home/linuxbrew/.linuxbrew/bin/bd", "/usr/local/bin/bd"];
  }
  return [];
}

export async function resolveBdExecutableStatus(
  command: string,
  isTrusted: boolean,
  checkExecutable: ExecutableChecker,
  fallbackCommands: readonly string[] = getBdExecutableFallbackCommands()
): Promise<CommandAvailability> {
  if (!isTrusted) {
    return {
      available: false,
      command,
      message: RESTRICTED_MODE_BEADS_MESSAGE
    };
  }
  const primary = await checkExecutable(command, ["--version"], createBdSpawnOptions());
  if (primary.available || command !== "bd") {
    return primary;
  }
  for (const fallback of fallbackCommands) {
    const status = await checkExecutable(fallback, ["--version"], createBdSpawnOptions());
    if (status.available) {
      return status;
    }
  }
  return primary;
}
