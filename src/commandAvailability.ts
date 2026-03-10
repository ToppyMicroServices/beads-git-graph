import * as cp from "node:child_process";

const eolRegex = /\r\n|\r|\n/g;

export interface CommandAvailability {
  available: boolean;
  command: string;
  message: string | null;
}

export function checkExecutable(
  command: string,
  args: string[] = ["--version"]
): Promise<CommandAvailability> {
  return new Promise<CommandAvailability>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (available: boolean, message: string | null) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve({ available, command, message });
    };

    const child = cp.spawn(command, args);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
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
