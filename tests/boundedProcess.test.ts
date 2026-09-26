import { describe, expect, it } from "vitest";

import { runBoundedProcess } from "../src/boundedProcess";

describe("bounded child processes", () => {
  it("captures a successful command result", async () => {
    await expect(
      runBoundedProcess(process.execPath, ["-e", "process.stdout.write('ok')"], {
        spawnOptions: {},
        timeoutMs: 2_000
      })
    ).resolves.toEqual({ exitCode: 0, stdout: "ok", stderr: "" });
  });

  it("terminates a command that exceeds its deadline", async () => {
    const startedAt = Date.now();
    await expect(
      runBoundedProcess(
        process.execPath,
        [
          "-e",
          "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 120)); setInterval(() => {}, 1000)"
        ],
        {
          spawnOptions: {},
          timeoutMs: 200
        }
      )
    ).rejects.toThrow(`${process.execPath} timed out after 200ms.`);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(process.platform === "win32" ? 150 : 300);
  });

  it("terminates a command before captured output can grow without bound", async () => {
    await expect(
      runBoundedProcess(process.execPath, ["-e", "process.stdout.write('12345')"], {
        spawnOptions: {},
        timeoutMs: 2_000,
        maxOutputBytes: 4
      })
    ).rejects.toThrow(`${process.execPath} exceeded the 4-byte output limit.`);
  });
});
