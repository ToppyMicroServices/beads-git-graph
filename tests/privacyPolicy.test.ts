import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  contributes?: {
    commands?: Array<{ command?: string }>;
    configuration?: { properties?: Record<string, unknown> };
  };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const readme = readFileSync(join(repoRoot, "README.md"), "utf8");

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

  it("documents no-telemetry, privacy-first, and security-first positioning", () => {
    const normalizedReadme = readme.toLowerCase();

    expect(normalizedReadme).toContain("no telemetry");
    expect(normalizedReadme).toContain("privacy-first");
    expect(normalizedReadme).toContain("security-first");
  });
});
