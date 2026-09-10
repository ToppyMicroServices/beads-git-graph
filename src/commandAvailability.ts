import * as cp from "node:child_process";

const eolRegex = /\r\n|\r|\n/g;
const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const MAX_PROBE_OUTPUT_LENGTH = 4096;

export interface CommandAvailability {
  available: boolean;
  command: string;
  message: string | null;
}

export function checkExecutable(
  command: string,
  args: string[] = ["--version"],
  options: cp.SpawnOptionsWithoutStdio = {}
): Promise<CommandAvailability> {
  return new Promise<CommandAvailability>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (available: boolean, message: string | null) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve({ available, command, message });
    };

    if (command.trim() === "") {
      finish(false, "No executable is configured.");
      return;
    }

    const { timeout: configuredTimeout, ...spawnOptions } = options;
    const timeout =
      typeof configuredTimeout === "number" &&
      Number.isFinite(configuredTimeout) &&
      configuredTimeout > 0
        ? configuredTimeout
        : DEFAULT_PROBE_TIMEOUT_MS;
    let child: cp.ChildProcessWithoutNullStreams;
    try {
      child = cp.spawn(command, args, spawnOptions);
    } catch (error) {
      finish(false, error instanceof Error ? error.message : "Unable to check the executable.");
      return;
    }
    timer = setTimeout(() => {
      finish(false, `Executable "${command}" did not respond within ${timeout / 1000} seconds.`);
      child.kill("SIGKILL");
    }, timeout);
    child.stdout.on("data", (chunk) => {
      if (!settled) stdout = (stdout + chunk.toString()).slice(0, MAX_PROBE_OUTPUT_LENGTH);
    });
    child.stderr.on("data", (chunk) => {
      if (!settled) stderr = (stderr + chunk.toString()).slice(0, MAX_PROBE_OUTPUT_LENGTH);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        finish(false, `Executable "${command}" could not be found.`);
        return;
      }

      finish(false, error.message);
    });
    child.on("close", (code) => {
      if (code === 0) {
        finish(true, null);
        return;
      }

      const output = (stderr.trim() || stdout.trim()).split(eolRegex)[0]?.trim() ?? "";
      finish(false, output !== "" ? output : `${command} exited with code ${code ?? -1}.`);
    });
  });
}
