#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function isIsoCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function hasMatchingVersionBadge(readme, version) {
  const badges = readme.matchAll(
    /!\[Version ([^\]]+)\]\(https:\/\/img\.shields\.io\/badge\/version-([^\s)?]+)(?:\?[^\s)]*)?\)/g
  );
  return [...badges].some(([, label, valueAndColor]) => {
    const separator = valueAndColor.lastIndexOf("-");
    return (
      label === version &&
      separator > 0 &&
      separator < valueAndColor.length - 1 &&
      valueAndColor.slice(0, separator) === version
    );
  });
}

export function validateExtensionRelease({ tag, refType, manifest, readme, changelog }) {
  if (refType !== "tag" || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) {
    throw new Error("Select a stable extension tag (vMAJOR.MINOR.PATCH), not a branch.");
  }
  if (tag !== `v${manifest.version}`) {
    throw new Error(`Release tag ${tag} does not match package version ${manifest.version}.`);
  }
  if (manifest.name !== "beads-git-graph" || manifest.publisher !== "ToppyMicroServices") {
    throw new Error("The extension identity does not match the Marketplace publisher.");
  }
  if (!hasMatchingVersionBadge(readme, manifest.version)) {
    throw new Error("The README version badge is out of date.");
  }
  const changelogPrefix = `## [${manifest.version}] - `;
  if (
    !changelog
      .split(/\r?\n/)
      .some(
        (line) =>
          line.startsWith(changelogPrefix) &&
          isIsoCalendarDate(line.slice(changelogPrefix.length).trim())
      )
  ) {
    throw new Error("The release has no dated changelog entry.");
  }
  return `${manifest.name}-${manifest.version}.vsix`;
}

export function validatePublishCredentials(env) {
  const missing = ["OPEN_VSX_TOKEN", "VS_MARKETPLACE_TOKEN"].filter(
    (key) => typeof env[key] !== "string" || !env[key].trim()
  );
  if (missing.length > 0) {
    throw new Error(`Publication requires configured credentials: ${missing.join(", ")}.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const filename = validateExtensionRelease({
      tag: process.env.RELEASE_TAG || "",
      refType: process.env.RELEASE_REF_TYPE || "",
      manifest: JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")),
      readme: readFileSync(resolve(root, "README.md"), "utf8"),
      changelog: readFileSync(resolve(root, "CHANGELOG.md"), "utf8")
    });
    validatePublishCredentials(process.env);
    process.stdout.write(`${filename}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
