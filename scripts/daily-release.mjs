import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const GENERATED_START = "<!-- daily-generated:start -->";
const GENERATED_END = "<!-- daily-generated:end -->";
const CHANGELOG_PATH = path.join(process.cwd(), "CHANGELOG.md");
const PACKAGE_JSON_PATH = path.join(process.cwd(), "package.json");
const MAX_COMMIT_ITEMS = 20;
const GENERATED_COMMIT_SUBJECTS = new Set([
  "docs: refresh unreleased changelog",
  "docs: refresh unreleased changelog [skip ci]"
]);

function git(args) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function parseSemver(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
  if (match === null) {
    throw new Error(`Unsupported version format: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function getRepositoryUrl() {
  const packageJson = readJson(PACKAGE_JSON_PATH);
  const repositoryUrl =
    typeof packageJson.repository === "object" && typeof packageJson.repository.url === "string"
      ? packageJson.repository.url
      : "";
  return repositoryUrl.replace(/\.git$/, "");
}

function getLatestStableTag() {
  const tags = git(["tag", "--list", "v*", "--sort=-version:refname"])
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  return tags[0] ?? null;
}

function getStableVersion() {
  const latestStableTag = getLatestStableTag();
  if (latestStableTag !== null) {
    return latestStableTag.substring(1);
  }

  return readJson(PACKAGE_JSON_PATH).version;
}

function formatUtcDateStamp(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function computeDailyVersion(stableVersion, date = new Date()) {
  const { major, minor } = parseSemver(stableVersion);
  return `${major}.${minor + 1}.${formatUtcDateStamp(date)}`;
}

function getCommitsSince(tag) {
  const range = tag === null ? "HEAD" : `${tag}..HEAD`;
  const output = git(["log", "--format=%H%x1f%s", range]);
  if (output === "") {
    return [];
  }

  return output
    .split("\n")
    .map((line) => {
      const [hash, subject] = line.split("\x1f");
      return { hash, subject };
    })
    .filter(
      (commit) =>
        commit.subject !== undefined && !GENERATED_COMMIT_SUBJECTS.has(commit.subject.trim())
    );
}

function buildDailySnapshot(commits, repositoryUrl) {
  const lines = [GENERATED_START, "### Daily Snapshot", ""];

  if (commits.length === 0) {
    lines.push("- No unreleased commits are queued above the latest stable tag.");
  } else {
    const visibleCommits = commits.slice(0, MAX_COMMIT_ITEMS);
    for (const commit of visibleCommits) {
      const shortHash = commit.hash.substring(0, 7);
      const subject = commit.subject.trim();
      const prefix =
        repositoryUrl === ""
          ? `- ${shortHash} ${subject}`
          : `- [\`${shortHash}\`](${repositoryUrl}/commit/${commit.hash}) ${subject}`;
      lines.push(prefix);
    }
    if (commits.length > visibleCommits.length) {
      lines.push(
        `- ...and ${commits.length - visibleCommits.length} more unreleased commit${
          commits.length - visibleCommits.length === 1 ? "" : "s"
        }.`
      );
    }
  }

  lines.push(GENERATED_END, "");
  return lines.join("\n");
}

function replaceGeneratedBlock(unreleasedBody, generatedBlock) {
  const start = unreleasedBody.indexOf(GENERATED_START);
  const end = unreleasedBody.indexOf(GENERATED_END);

  if (start !== -1 && end !== -1 && end > start) {
    const before = unreleasedBody.slice(0, start).trimEnd();
    const after = unreleasedBody.slice(end + GENERATED_END.length).trimStart();
    return `${before}\n\n${generatedBlock}${after === "" ? "" : `\n${after}`}`.trim();
  }

  const trimmed = unreleasedBody.trim();
  return trimmed === "" ? generatedBlock.trim() : `${generatedBlock}${trimmed}`;
}

function updateUnreleasedSection(changelog, generatedBlock) {
  const unreleasedHeader = "## [Unreleased]";
  const start = changelog.indexOf(unreleasedHeader);
  if (start === -1) {
    throw new Error("Unable to find the [Unreleased] section in CHANGELOG.md");
  }

  const nextSectionIndex = changelog.indexOf("\n## [", start + unreleasedHeader.length);
  if (nextSectionIndex === -1) {
    throw new Error("Unable to find the next changelog release section.");
  }

  const sectionStart = start + unreleasedHeader.length;
  const unreleasedBody = changelog.slice(sectionStart, nextSectionIndex).trim();
  const updatedBody = replaceGeneratedBlock(unreleasedBody, generatedBlock);
  return `${changelog.slice(0, start)}${unreleasedHeader}\n\n${updatedBody}\n\n${changelog.slice(
    nextSectionIndex + 1
  )}`;
}

function updateUnreleasedCompareLink(changelog, repositoryUrl, latestStableTag) {
  if (repositoryUrl === "" || latestStableTag === null) {
    return changelog;
  }

  const compareLine = `[Unreleased]: ${repositoryUrl}/compare/${latestStableTag}...HEAD`;
  if (/^\[Unreleased\]: .*$/m.test(changelog)) {
    return changelog.replace(/^\[Unreleased\]: .*$/m, compareLine);
  }

  return `${changelog.trimEnd()}\n${compareLine}\n`;
}

function buildDailyReleaseState() {
  const repositoryUrl = getRepositoryUrl();
  const latestStableTag = getLatestStableTag();
  const commits = getCommitsSince(latestStableTag);
  const original = readFileSync(CHANGELOG_PATH, "utf8");
  const generatedBlock = buildDailySnapshot(commits, repositoryUrl);
  const updated = updateUnreleasedCompareLink(
    updateUnreleasedSection(original, generatedBlock),
    repositoryUrl,
    latestStableTag
  );

  return { latestStableTag, commits, originalChangelog: original, updatedChangelog: updated };
}

function extractUnreleasedBody(changelog) {
  const unreleasedHeader = "## [Unreleased]";
  const start = changelog.indexOf(unreleasedHeader);
  if (start === -1) {
    throw new Error("Unable to find the [Unreleased] section in CHANGELOG.md");
  }
  const nextSectionIndex = changelog.indexOf("\n## [", start + unreleasedHeader.length);
  if (nextSectionIndex === -1) {
    throw new Error("Unable to find the next changelog release section.");
  }
  return changelog.slice(start + unreleasedHeader.length, nextSectionIndex).trim();
}

function formatUtcTimestamp(date) {
  return date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
}

function buildReleaseNotes({ changelog, stableVersion, dailyVersion, latestStableTag }) {
  const releaseDate = new Date();
  const unreleasedBody = extractUnreleasedBody(changelog);
  const lines = [
    "# Daily Pre-release",
    "",
    `Generated: ${formatUtcTimestamp(releaseDate)}`,
    `Base stable version: \`${stableVersion}\``,
    `Daily prerelease version: \`${dailyVersion}\``,
    latestStableTag === null
      ? "Base comparison: initial repository state"
      : `Base comparison: \`${latestStableTag}\``,
    "",
    "## Unreleased Snapshot",
    "",
    unreleasedBody
  ];

  return `${lines.join("\n").trim()}\n`;
}

function setPackageVersion(version) {
  const packageJson = readJson(PACKAGE_JSON_PATH);
  packageJson.version = version;
  writeJson(PACKAGE_JSON_PATH, packageJson);
}

function getFlagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return null;
  }
  if (index === args.length - 1) {
    throw new Error(`Missing value for ${flag}`);
  }
  return args[index + 1];
}

function main() {
  const args = process.argv.slice(2);
  const shouldWriteChangelog = args.includes("--write-changelog");
  const releaseNotesPath = getFlagValue(args, "--write-release-notes");
  const versionPath = getFlagValue(args, "--write-version");
  const packageVersion = getFlagValue(args, "--set-package-version");

  const stableVersion = getStableVersion();
  const dailyVersion = computeDailyVersion(stableVersion);

  if (packageVersion !== null) {
    setPackageVersion(packageVersion);
    return;
  }

  const refreshed = buildDailyReleaseState();
  if (shouldWriteChangelog && refreshed.updatedChangelog !== refreshed.originalChangelog) {
    writeFileSync(CHANGELOG_PATH, refreshed.updatedChangelog);
  }

  if (releaseNotesPath !== null) {
    writeFileSync(
      releaseNotesPath,
      buildReleaseNotes({
        changelog: refreshed.updatedChangelog,
        stableVersion,
        dailyVersion,
        latestStableTag: refreshed.latestStableTag
      })
    );
  }

  if (versionPath !== null) {
    writeFileSync(versionPath, `${dailyVersion}\n`);
  }
}

main();
