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
    expect(dailyPrereleaseWorkflow).toContain('cron: "30 0 * * *"');
    expect(dailyPrereleaseWorkflow).toContain("workflow_dispatch:");
    expect(dailyPrereleaseWorkflow).toContain("node ./scripts/daily-release.mjs --write-changelog");
    expect(dailyPrereleaseWorkflow).toContain("--write-release-notes /tmp/daily-release-notes.md");
    expect(dailyPrereleaseWorkflow).toContain("gh release create");
    expect(dailyPrereleaseWorkflow).toContain("--prerelease");
  });
});
