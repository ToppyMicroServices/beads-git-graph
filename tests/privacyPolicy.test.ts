import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  capabilities?: {
    untrustedWorkspaces?: {
      restrictedConfigurations?: string[];
    };
  };
  contributes?: {
    commands?: Array<{ command?: string }>;
    configuration?: { properties?: Record<string, { scope?: string }> };
  };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
const extensionSource = readFileSync(join(repoRoot, "src", "extension.ts"), "utf8");
const beadsViewSource = readFileSync(join(repoRoot, "src", "beadsView.ts"), "utf8");

describe("privacy and security posture", () => {
  it("does not expose avatar-fetch settings or commands in the extension manifest", () => {
    const commands = (packageJson.contributes?.commands ?? []).map((entry) => entry.command);
    const configKeys = Object.keys(packageJson.contributes?.configuration?.properties ?? {});

    expect(commands).not.toContain("beads-git-graph.clearAvatarCache");
    expect(configKeys).not.toContain("beads-git-graph.fetchAvatars");
  });

  it("does not include telemetry runtime dependencies", () => {
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };
    const names = Object.keys(allDeps);

    expect(names).not.toContain("vscode-extension-telemetry");
    expect(names).not.toContain("applicationinsights");
  });

  it("keeps provider credentials out of settings and gates execution on Workspace Trust", () => {
    const configKeys = Object.keys(packageJson.contributes?.configuration?.properties ?? {});
    expect(
      configKeys.some((key) => /api.?key|credential|secret|hf.?token|access.?token/i.test(key))
    ).toBe(false);
    expect(extensionSource).toContain("context.secrets");
    expect(beadsViewSource).toContain("vscode.workspace.isTrusted");
    expect(beadsViewSource).not.toContain("OPENAI_API_KEY");
    expect(beadsViewSource).not.toContain("ANTHROPIC_API_KEY");
    expect(beadsViewSource).not.toContain("HF_TOKEN");
  });

  it("keeps the Beads executable machine-scoped and restricted", () => {
    const properties = packageJson.contributes?.configuration?.properties ?? {};
    expect(properties["beads-git-graph.bdPath"]?.scope).toBe("machine");
    expect(packageJson.capabilities?.untrustedWorkspaces?.restrictedConfigurations).toContain(
      "beads-git-graph.bdPath"
    );
  });

  it("exposes a command to clear retained AI response artifacts", () => {
    const commands = (packageJson.contributes?.commands ?? []).map((entry) => entry.command);
    expect(commands).toContain("beads-git-graph.clearAgentResponseArtifacts");
    expect(extensionSource).toContain("agentArtifactStore.clearAll()");
  });

  it("checks Beads write safety before provider preparation and persists with one update", () => {
    expect(beadsViewSource).toContain("probeBeadsAgentWriteCapability(");
    expect(beadsViewSource).toContain("preflight: values.writeCapabilityAlreadyChecked");
    expect(beadsViewSource).toContain(
      ": () => this.assertAgentWriteCapability(values.workspacePath)"
    );
    expect(beadsViewSource).toContain("persistGeneratedAgentResponse({");
    expect(beadsViewSource).toContain("buildAgentBeadUpdateArgs({");
    expect(beadsViewSource).not.toContain('this.runBdCommand(["assign"');
  });

  it("documents no-telemetry, privacy-first, and security-first positioning", () => {
    const normalizedReadme = readme.toLowerCase();

    expect(normalizedReadme).toContain("no telemetry");
    expect(normalizedReadme).toContain("privacy-first");
    expect(normalizedReadme).toContain("security-first");
  });
});
