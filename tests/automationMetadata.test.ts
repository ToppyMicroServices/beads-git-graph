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
const codeqlWorkflow = readFileSync(join(repoRoot, ".github", "workflows", "codeql.yml"), "utf8");
const ciWorkflow = readFileSync(join(repoRoot, ".github", "workflows", "ci.yaml"), "utf8");
const dailySafeUpdatesWorkflow = readFileSync(
  join(repoRoot, ".github", "workflows", "daily-safe-updates.yml"),
  "utf8"
);
const dailySafeUpdatesScript = readFileSync(
  join(repoRoot, "scripts", "daily-safe-updates.mjs"),
  "utf8"
);
const dependabotAutoMergeWorkflow = readFileSync(
  join(repoRoot, ".github", "workflows", "dependabot-auto-merge.yml"),
  "utf8"
);
const scorecardWorkflow = readFileSync(
  join(repoRoot, ".github", "workflows", "scorecard.yml"),
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
    expect(dailyPrereleaseWorkflow).toContain('cron: "30 1 * * *"');
    expect(dailySafeUpdatesWorkflow).toContain('cron: "50 1 * * *"');
    expect(dailyMaintenanceWorkflow).toContain('cron: "15 2 * * *"');
  });

  it("retries stale Dependabot PRs and merges labeled green updates", () => {
    expect(dailySafeUpdatesWorkflow).toContain("label:automerge");
    expect(dailySafeUpdatesWorkflow).toContain("author:app/dependabot");
    expect(dailySafeUpdatesWorkflow).toContain("head:automation/daily-changelog");
    expect(dailySafeUpdatesWorkflow).toContain('gh pr checks "$pr"');
    expect(dailySafeUpdatesWorkflow).toContain('gh pr merge "$pr"');
    expect(dailySafeUpdatesWorkflow).toContain("node ./scripts/daily-safe-updates.mjs");
    expect(dailySafeUpdatesScript).toContain("needs-rebase");
    expect(dailySafeUpdatesScript).toContain("manual-review");
    expect(dailySafeUpdatesScript).toContain("superseded");
  });

  it("keeps the workflow-run auto-merge path repository-aware", () => {
    expect(dependabotAutoMergeWorkflow).toContain("REPOSITORY: $" + "{{ github.repository }}");
    expect(dependabotAutoMergeWorkflow).toContain(
      'gh pr view "$PR_NUMBER" --repo "$REPOSITORY" --json labels'
    );
    expect(dependabotAutoMergeWorkflow).toContain(
      'gh pr merge "$PR_NUMBER" --repo "$REPOSITORY" --squash --delete-branch'
    );
  });

  it("keeps CodeQL on a daily security cadence", () => {
    expect(codeqlWorkflow).toContain("name: CodeQL");
    expect(codeqlWorkflow).toContain('cron: "0 2 * * *"');
    expect(codeqlWorkflow).toContain("workflow_dispatch:");
    expect(codeqlWorkflow).toContain("github/codeql-action/init@");
    expect(codeqlWorkflow).toContain("github/codeql-action/analyze@");
  });

  it("keeps workflow-dispatched CI lightweight unless cross-platform smoke is requested", () => {
    expect(ciWorkflow).toContain("run_cross_platform:");
    expect(ciWorkflow).toContain("type: boolean");
    expect(ciWorkflow).toContain("default: false");
    expect(ciWorkflow).toContain("github.event_name == 'schedule'");
    expect(ciWorkflow).toContain("inputs.run_cross_platform == true");
  });

  it("pins the SARIF upload source root for Scorecard results", () => {
    expect(scorecardWorkflow).toContain("github/codeql-action/upload-sarif");
    expect(scorecardWorkflow).toContain("checkout_path: $" + "{{ github.workspace }}");
  });
});
