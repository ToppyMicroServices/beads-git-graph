import { describe, expect, it } from "vitest";

import { checkExecutable } from "../src/commandAvailability";

describe("executable availability", () => {
  it.each(["", "   "])(
    "reports an empty configured executable without rejecting: %j",
    async (command) => {
      await expect(checkExecutable(command)).resolves.toEqual({
        available: false,
        command,
        message: "No executable is configured."
      });
    }
  );

  it("reports invalid executable arguments without rejecting the initial view load", async () => {
    await expect(checkExecutable("invalid\u0000path")).resolves.toMatchObject({
      available: false,
      command: "invalid\u0000path",
      message: expect.any(String)
    });
  });

  it("reports a missing executable", async () => {
    await expect(checkExecutable("/missing/beads-git-graph/test-executable")).resolves.toEqual({
      available: false,
      command: "/missing/beads-git-graph/test-executable",
      message: 'Executable "/missing/beads-git-graph/test-executable" could not be found.'
    });
  });

  it("accepts a successful version check", async () => {
    await expect(checkExecutable(process.execPath)).resolves.toEqual({
      available: true,
      command: process.execPath,
      message: null
    });
  });

  it("keeps only the first diagnostic line when the check fails", async () => {
    await expect(
      checkExecutable(process.execPath, [
        "-e",
        'process.stderr.write("Version check failed\\nDetailed diagnostic\\n"); process.exit(2);'
      ])
    ).resolves.toEqual({
      available: false,
      command: process.execPath,
      message: "Version check failed"
    });
  });

  it("bounds diagnostic output from a broken executable", async () => {
    const result = await checkExecutable(process.execPath, [
      "-e",
      'process.stderr.write("x".repeat(100_000), () => process.exit(2));'
    ]);
    expect(result.available).toBe(false);
    expect(result.message).toHaveLength(4096);
  });

  it("settles and terminates a version check that never exits", async () => {
    const startedAt = Date.now();
    const result = await checkExecutable(
      process.execPath,
      ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'],
      { timeout: 100 }
    );
    expect(result).toEqual({
      available: false,
      command: process.execPath,
      message: `Executable "${process.execPath}" did not respond within 0.1 seconds.`
    });
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });
});
