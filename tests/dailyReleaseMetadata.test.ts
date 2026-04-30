import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");
const dailyPrereleaseWorkflow = readFileSync(
  join(repoRoot, ".github", "workflows", "daily-prerelease.yml"),
  "utf8"
);
const dailyReleaseScript = readFileSync(join(repoRoot, "scripts", "daily-release.mjs"), "utf8");

describe("daily prerelease automation", () => {
  it("uses the tracked CHANGELOG.md path consistently", () => {
    expect(dailyPrereleaseWorkflow).toContain("CHANGELOG.md");
    expect(dailyPrereleaseWorkflow).not.toContain("changelog.md");
    expect(dailyReleaseScript).toContain('path.join(process.cwd(), "CHANGELOG.md")');
    expect(dailyReleaseScript).not.toContain('path.join(process.cwd(), "changelog.md")');
  });

  it("keeps a scheduled prerelease workflow wired to the daily release script", () => {
    expect(dailyPrereleaseWorkflow).toContain("name: Daily Prerelease");
    expect(dailyPrereleaseWorkflow).toContain('cron: "30 1 * * *"');
    expect(dailyPrereleaseWorkflow).toContain("workflow_dispatch:");
    expect(dailyPrereleaseWorkflow).toContain("actions: write");
    expect(dailyPrereleaseWorkflow).toContain("node ./scripts/daily-release.mjs --write-changelog");
    expect(dailyPrereleaseWorkflow).toContain(
      "node ./scripts/daily-release.mjs --write-has-unreleased /tmp/daily-has-unreleased.txt"
    );
    expect(dailyPrereleaseWorkflow).toContain("HAS_UNRELEASED_COMMITS");
    expect(dailyPrereleaseWorkflow).toContain("pnpm exec oxfmt CHANGELOG.md");
    expect(dailyPrereleaseWorkflow).toContain(
      'gh workflow run ci.yaml --repo "$REPOSITORY" --ref "$BRANCH" -f run_cross_platform=false'
    );
    expect(dailyPrereleaseWorkflow).toContain("--write-release-notes /tmp/daily-release-notes.md");
    expect(dailyPrereleaseWorkflow).toContain(
      "@vscode/vsce package --no-dependencies --pre-release"
    );
    expect(dailyPrereleaseWorkflow).toContain("gh release create");
    expect(dailyPrereleaseWorkflow).toContain("--prerelease");
    expect(dailyPrereleaseWorkflow).toContain("Publish daily prerelease to VS Marketplace");
    expect(dailyPrereleaseWorkflow).toContain("--skip-duplicate --pre-release");
    expect(dailyReleaseScript).toContain("const hasUnreleasedPath = getFlagValue(args,");
    expect(dailyReleaseScript).toContain("refreshed.commits.length > 0");
  });
});
