const { existsSync, readFileSync } = require("node:fs");
const { resolve, win32 } = require("node:path");
const { spawnSync } = require("node:child_process");

function createWindowsElectronCli(root, insiders, env) {
  return {
    command: win32.join(root, insiders ? "Code - Insiders.exe" : "Code.exe"),
    argsPrefix: [win32.join(root, "resources", "app", "out", "cli.js")],
    environment: { ...env, ELECTRON_RUN_AS_NODE: "1" }
  };
}

function getExplicitWindowsCli(value, env) {
  const cli = value?.trim();
  if (!cli || !win32.isAbsolute(cli)) {
    return null;
  }
  const executable = win32.basename(cli).toLowerCase();
  if (executable === "code.cmd" || executable === "code-insiders.cmd") {
    return createWindowsElectronCli(
      win32.resolve(win32.dirname(cli), ".."),
      executable.includes("insiders"),
      env
    );
  }
  if (executable === "code.exe" || executable === "code - insiders.exe") {
    return createWindowsElectronCli(win32.dirname(cli), executable.includes("insiders"), env);
  }
  if (executable.endsWith(".exe")) {
    return { command: cli, argsPrefix: [] };
  }
  return null;
}

function getCliLaunchCandidates(env = process.env, platform = process.platform) {
  const candidates =
    platform === "win32"
      ? [
          getExplicitWindowsCli(env.VSCODE_CLI, env),
          ...[
            env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, "Programs"),
            env.ProgramFiles,
            env["ProgramFiles(x86)"]
          ]
            .filter((root) => root !== undefined && root !== "")
            .flatMap((root) => [
              createWindowsElectronCli(win32.join(root, "Microsoft VS Code"), false, env),
              createWindowsElectronCli(win32.join(root, "Microsoft VS Code Insiders"), true, env)
            ])
        ]
      : [
          env.VSCODE_CLI?.trim() ? { command: env.VSCODE_CLI.trim(), argsPrefix: [] } : null,
          { command: "code", argsPrefix: [] },
          ...(platform === "darwin"
            ? [
                {
                  command: "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
                  argsPrefix: []
                },
                {
                  command:
                    "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code",
                  argsPrefix: []
                }
              ]
            : [])
        ];

  const seen = new Set();
  return candidates.filter((candidate) => {
    if (candidate === null) {
      return false;
    }
    const key = `${candidate.command}\0${candidate.argsPrefix.join("\0")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function installPackage(options = {}) {
  const repoRoot = options.repoRoot ?? resolve(__dirname, "..");
  const read = options.readFileSync ?? readFileSync;
  const exists = options.existsSync ?? existsSync;
  const spawn = options.spawnSync ?? spawnSync;
  const environment = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const packageJson = JSON.parse(read(resolve(repoRoot, "package.json"), "utf8"));
  const vsixPath = resolve(repoRoot, `${packageJson.name}-${packageJson.version}.vsix`);
  if (!exists(vsixPath)) {
    throw new Error(`Packaged VSIX not found: ${vsixPath}`);
  }

  for (const candidate of getCliLaunchCandidates(environment, platform)) {
    const result = spawn(
      candidate.command,
      [...candidate.argsPrefix, "--install-extension", vsixPath, "--force"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        ...(candidate.environment === undefined ? {} : { env: candidate.environment })
      }
    );
    if (result.error?.code === "ENOENT") {
      continue;
    }
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(
        (
          result.stderr ||
          result.stdout ||
          `${candidate.command} exited with ${result.status}`
        ).trim()
      );
    }
    const output = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
    if (output !== "") {
      process.stdout.write(`${output}\n`);
    }
    return candidate.command;
  }

  throw new Error(
    "VS Code CLI was not found. Set VSCODE_CLI to a full executable or code.cmd path and retry."
  );
}

if (require.main === module) {
  try {
    installPackage();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { getCliLaunchCandidates, installPackage };
