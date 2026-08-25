import { describe, expect, it, vi } from "vitest";

interface CliLaunchCandidate {
  command: string;
  argsPrefix: string[];
  environment?: NodeJS.ProcessEnv;
}

const { getCliLaunchCandidates, installPackage } = require("../scripts/install-package.cjs") as {
  getCliLaunchCandidates: (
    env?: NodeJS.ProcessEnv,
    platform?: NodeJS.Platform
  ) => CliLaunchCandidate[];
  installPackage: (options?: Record<string, unknown>) => string;
};

describe("package installer", () => {
  it("prefers an explicit CLI and provides macOS app fallbacks", () => {
    expect(
      getCliLaunchCandidates({ VSCODE_CLI: "/custom/code" }, "darwin").map(
        (candidate) => candidate.command
      )
    ).toEqual([
      "/custom/code",
      "code",
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code"
    ]);
  });

  it("launches the Windows Electron binary through cli.js without a shell", () => {
    const environment = {
      LOCALAPPDATA: String.raw`C:\Users\demo\AppData\Local`,
      ProgramFiles: String.raw`C:\Program Files`
    };
    const candidates = getCliLaunchCandidates(environment, "win32");

    expect(candidates[0]).toEqual({
      command: String.raw`C:\Users\demo\AppData\Local\Programs\Microsoft VS Code\Code.exe`,
      argsPrefix: [
        String.raw`C:\Users\demo\AppData\Local\Programs\Microsoft VS Code\resources\app\out\cli.js`
      ],
      environment: { ...environment, ELECTRON_RUN_AS_NODE: "1" }
    });
    expect(candidates.map((candidate) => candidate.command)).toContain(
      String.raw`C:\Program Files\Microsoft VS Code Insiders\Code - Insiders.exe`
    );
  });

  it("derives the native launcher from an explicit Windows code.cmd path", () => {
    const environment = {
      VSCODE_CLI: String.raw`C:\Tools\Microsoft VS Code Insiders\bin\code-insiders.cmd`
    };

    expect(getCliLaunchCandidates(environment, "win32")[0]).toEqual({
      command: String.raw`C:\Tools\Microsoft VS Code Insiders\Code - Insiders.exe`,
      argsPrefix: [String.raw`C:\Tools\Microsoft VS Code Insiders\resources\app\out\cli.js`],
      environment: { ...environment, ELECTRON_RUN_AS_NODE: "1" }
    });
  });

  it("passes the exact Windows CLI script and environment to spawn", () => {
    const environment = { LOCALAPPDATA: String.raw`C:\Users\demo\AppData\Local` };
    const spawn = vi.fn().mockReturnValue({ status: 0, stdout: "", stderr: "" });
    const cli = installPackage({
      repoRoot: "/repo",
      env: environment,
      platform: "win32",
      readFileSync: () => JSON.stringify({ name: "beads-git-graph", version: "0.6.2" }),
      existsSync: () => true,
      spawnSync: spawn
    });

    const executable = String.raw`C:\Users\demo\AppData\Local\Programs\Microsoft VS Code\Code.exe`;
    const cliScript = String.raw`C:\Users\demo\AppData\Local\Programs\Microsoft VS Code\resources\app\out\cli.js`;
    expect(cli).toBe(executable);
    expect(spawn).toHaveBeenCalledWith(
      executable,
      [cliScript, "--install-extension", "/repo/beads-git-graph-0.6.2.vsix", "--force"],
      {
        cwd: "/repo",
        encoding: "utf8",
        env: { ...environment, ELECTRON_RUN_AS_NODE: "1" }
      }
    );
  });

  it("installs the package with force after skipping a missing PATH CLI", () => {
    const spawn = vi
      .fn()
      .mockReturnValueOnce({ error: Object.assign(new Error("missing"), { code: "ENOENT" }) })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });
    const cli = installPackage({
      repoRoot: "/repo",
      env: {},
      platform: "darwin",
      readFileSync: () => JSON.stringify({ name: "beads-git-graph", version: "0.6.2" }),
      existsSync: () => true,
      spawnSync: spawn
    });

    expect(cli).toBe("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code");
    expect(spawn).toHaveBeenLastCalledWith(
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      ["--install-extension", "/repo/beads-git-graph-0.6.2.vsix", "--force"],
      { cwd: "/repo", encoding: "utf8" }
    );
  });

  it("fails before launching the CLI when the VSIX is missing", () => {
    expect(() =>
      installPackage({
        repoRoot: "/repo",
        readFileSync: () => JSON.stringify({ name: "beads-git-graph", version: "0.6.2" }),
        existsSync: () => false,
        spawnSync: vi.fn()
      })
    ).toThrow("Packaged VSIX not found");
  });
});
