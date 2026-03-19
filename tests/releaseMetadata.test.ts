import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  version: string;
};
const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
const publishWorkflow = readFileSync(join(repoRoot, ".github", "workflows", "publish.yml"), "utf8");

describe("release metadata", () => {
  it("keeps the README version badge in sync with package.json", () => {
    expect(readme).toContain(`Version ${packageJson.version}`);
    expect(readme).toContain(`version-${packageJson.version}`);
  });

  it("publishes without the deprecated HaaLeo action", () => {
    expect(publishWorkflow).not.toContain("HaaLeo/publish-vscode-extension");
    expect(publishWorkflow).toContain('pnpm dlx ovsx -p "$OPEN_VSX_TOKEN" publish -i');
    expect(publishWorkflow).toContain("pnpm dlx @vscode/vsce publish --packagePath");
  });
});
