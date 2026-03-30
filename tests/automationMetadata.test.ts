import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");
const dependabotConfig = readFileSync(join(repoRoot, ".github", "dependabot.yml"), "utf8");
const dailyMaintenanceWorkflow = readFileSync(
  join(repoRoot, ".github", "workflows", "daily-maintenance.yml"),
  "utf8"
);
const dailyPrereleaseWorkflow = readFileSync(
  join(repoRoot, ".github", "workflows", "daily-prerelease.yml"),
  "utf8"
);
const dailySafeUpdatesWorkflow = readFileSync(
  join(repoRoot, ".github", "workflows", "daily-safe-updates.yml"),
  "utf8"
);

describe("scheduled automation metadata", () => {
  it("schedules dependabot updates deterministically for npm and GitHub Actions", () => {
    expect(dependabotConfig).toContain('package-ecosystem: "npm"');
    expect(dependabotConfig).toContain('package-ecosystem: "github-actions"');
    expect(dependabotConfig).toContain('time: "00:00"');
    expect(dependabotConfig).toContain('time: "00:10"');
    expect(dependabotConfig).toContain('timezone: "UTC"');
    expect(dependabotConfig).toContain("open-pull-requests-limit: 10");
    expect(dependabotConfig).toContain('- "security"');
  });

  it("runs the safe-update sweep before maintenance and prerelease jobs", () => {
    expect(dailySafeUpdatesWorkflow).toContain('cron: "45 0 * * *"');
    expect(dailyMaintenanceWorkflow).toContain('cron: "15 1 * * *"');
    expect(dailyPrereleaseWorkflow).toContain('cron: "30 1 * * *"');
  });

  it("retries stale Dependabot PRs and merges labeled green updates", () => {
    expect(dailySafeUpdatesWorkflow).toContain("label:automerge");
    expect(dailySafeUpdatesWorkflow).toContain("author:app/dependabot");
    expect(dailySafeUpdatesWorkflow).toContain('gh pr checks "$pr"');
    expect(dailySafeUpdatesWorkflow).toContain("@dependabot rebase");
    expect(dailySafeUpdatesWorkflow).toContain('gh pr merge "$pr"');
  });
});
