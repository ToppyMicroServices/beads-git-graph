import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";

export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
export const DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
const FORCE_KILL_DELAY_MS = 1_000;

export interface BoundedProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface BoundedProcessOptions {
  spawnOptions: SpawnOptionsWithoutStdio;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export function runBoundedProcess(
  command: string,
  args: readonly string[],
  options: BoundedProcessOptions
): Promise<BoundedProcessResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES;
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], options.spawnOptions);
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let terminalError: Error | undefined;
    let timeout: NodeJS.Timeout | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const stop = () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }, FORCE_KILL_DELAY_MS);
        forceKillTimer.unref?.();
      }
    };
    const stopWith = (error: Error) => {
      if (settled || terminalError !== undefined) return;
      terminalError = error;
      if (timeout !== undefined) clearTimeout(timeout);
      stop();
    };
    const append = (target: "stdout" | "stderr", chunk: Buffer | string) => {
      if (terminalError !== undefined) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      outputBytes += bytes;
      if (outputBytes > maxOutputBytes) {
        stopWith(new Error(`${command} exceeded the ${maxOutputBytes}-byte output limit.`));
        return;
      }
      if (target === "stdout") stdout += chunk.toString();
      else stderr += chunk.toString();
    };

    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      reject(error);
    });
    child.once("close", (code) => {
      if (timeout !== undefined) clearTimeout(timeout);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      if (settled) return;
      settled = true;
      if (terminalError !== undefined) {
        reject(terminalError);
        return;
      }
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });

    timeout = setTimeout(() => {
      stopWith(new Error(`${command} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    timeout.unref?.();
  });
}
