import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  version: string;
};
const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
const publishWorkflow = readFileSync(join(repoRoot, ".github", "workflows", "publish.yml"), "utf8");
const agentPluginReleaseWorkflow = readFileSync(
  join(repoRoot, ".github", "workflows", "agent-plugin-release.yml"),
  "utf8"
);
const ciWorkflow = readFileSync(join(repoRoot, ".github", "workflows", "ci.yaml"), "utf8");

describe("release metadata", () => {
  it("keeps the README version badge in sync with package.json", () => {
    expect(readme).toContain(`Version ${packageJson.version}`);
    expect(readme).toContain(`version-${packageJson.version}`);
  });

  it("publishes without the deprecated HaaLeo action", () => {
    expect(publishWorkflow).not.toContain("HaaLeo/publish-vscode-extension");
    expect(publishWorkflow).toContain("!startsWith(github.event.release.tag_name, 'daily-')");
    expect(publishWorkflow).toContain(
      "!startsWith(github.event.release.tag_name, 'agent-plugin-')"
    );
    expect(publishWorkflow).toContain("!startsWith(github.ref_name, 'daily-')");
    expect(publishWorkflow).toContain("!startsWith(github.ref_name, 'agent-plugin-')");
    expect(publishWorkflow).toContain('pnpm exec ovsx -p "$OPEN_VSX_TOKEN" publish -i');
    expect(publishWorkflow).toContain("pnpm exec vsce publish --packagePath");
    expect(publishWorkflow).not.toContain("pnpm dlx");
  });

  it("checks Agent Plugin version bumps and release tags", () => {
    expect(ciWorkflow).toContain(
      // eslint-disable-next-line no-template-curly-in-string
      'node ./scripts/check-agent-plugin-release.mjs --base "origin/${{ github.base_ref }}"'
    );
    expect(agentPluginReleaseWorkflow).toContain("agent-plugin-v*");
    expect(agentPluginReleaseWorkflow).toContain("fetch-depth: 0");
    expect(agentPluginReleaseWorkflow).toContain("github.event.repository.default_branch");
    expect(agentPluginReleaseWorkflow).toContain(
      'node ./scripts/check-agent-plugin-release.mjs --tag "$AGENT_PLUGIN_TAG"'
    );
  });
});
