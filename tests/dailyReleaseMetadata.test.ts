import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readFileSync as readTextFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");
const dailyPrereleaseWorkflow = readFileSync(
  join(repoRoot, ".github", "workflows", "daily-prerelease.yml"),
  "utf8"
);
const generatedCommitSubjects = new Set([
  "docs: refresh unreleased changelog",
  "docs: refresh unreleased changelog [skip ci]"
]);
const tempDirectories: string[] = [];

function git(args: string[]) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8"
  }).trim();
}

function getLatestStableTag() {
  const tags = git(["tag", "--list", "v*", "--sort=-version:refname"])
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));

  return tags[0] ?? null;
}

function hasUnreleasedCommits() {
  const latestStableTag = getLatestStableTag();
  const range = latestStableTag === null ? "HEAD" : `${latestStableTag}..HEAD`;
  const output = git(["log", "--format=%s", range]);
  if (output === "") {
    return false;
  }

  return (
    output
      .split("\n")
      .map((subject) => subject.trim())
      .filter((subject) => !generatedCommitSubjects.has(subject)).length > 0
  );
}

afterEach(() => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { force: true, recursive: true });
    }
  }
});

describe("daily prerelease automation", () => {
  it("uses the tracked CHANGELOG.md path consistently", () => {
    expect(dailyPrereleaseWorkflow).toContain("CHANGELOG.md");
    expect(dailyPrereleaseWorkflow).not.toContain("changelog.md");
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
      "pnpm exec vsce package --no-dependencies --pre-release"
    );
    expect(dailyPrereleaseWorkflow).not.toContain("pnpm dlx");
    expect(dailyPrereleaseWorkflow).toContain("gh release create");
    expect(dailyPrereleaseWorkflow).toContain("--prerelease");
    expect(dailyPrereleaseWorkflow).toContain("Publish daily prerelease to VS Marketplace");
    expect(dailyPrereleaseWorkflow).toContain("--skip-duplicate --pre-release");
  });

  it("writes whether unreleased commits are queued above the latest stable tag", () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), "beads-git-graph-daily-release-"));
    tempDirectories.push(tempDirectory);
    const outputPath = join(tempDirectory, "has-unreleased.txt");

    execFileSync("node", ["./scripts/daily-release.mjs", "--write-has-unreleased", outputPath], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    const output = readTextFileSync(outputPath, "utf8").trim();
    expect(output).toBe(hasUnreleasedCommits() ? "true" : "false");
  });
});
