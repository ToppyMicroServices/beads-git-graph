#!/usr/bin/env node
/* eslint-disable no-console */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "..");
const pluginManifestPath = "agent-plugin/plugin.json";
const marketplacePath = ".github/plugin/marketplace.json";

export const PLUGIN_NAME_PATTERN = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

const pluginKeys = new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions"
]);
const authorKeys = new Set(["name", "email", "url"]);

function isJsonObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertOnlyKeys(value, allowedKeys, label) {
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} contains unsupported field(s): ${unexpected.join(", ")}`);
  }
}

function assertOptionalString(value, field) {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`plugin.json ${field} must be a string`);
  }
}

export function parseSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) {
    throw new Error(`Invalid semantic version: ${value}`);
  }
  return match.slice(1).map(Number);
}

export function compareSemver(left, right) {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1;
    }
  }
  return 0;
}

export function changesPluginRelease(changedPaths) {
  return changedPaths.some(
    (path) =>
      path === marketplacePath || path === "agent-plugin" || path.startsWith("agent-plugin/")
  );
}

export function validatePluginMetadata(plugin, marketplace) {
  if (!isJsonObject(plugin)) {
    throw new Error("plugin.json must contain a JSON object");
  }
  assertOnlyKeys(plugin, pluginKeys, "plugin.json");
  if (plugin.$schema !== "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json") {
    throw new Error("plugin.json does not use the Agent Plugins 1.0 schema");
  }
  if (
    typeof plugin.name !== "string" ||
    plugin.name.length > 64 ||
    !PLUGIN_NAME_PATTERN.test(plugin.name)
  ) {
    throw new Error(`Invalid plugin name: ${plugin.name}`);
  }
  if (typeof plugin.version !== "string") {
    throw new Error("plugin.json version must be a string");
  }
  parseSemver(plugin.version);
  if (typeof plugin.description !== "string") {
    throw new Error("plugin.json description must be a string");
  }
  for (const field of ["homepage", "repository", "license"]) {
    assertOptionalString(plugin[field], field);
  }
  if (plugin.author !== undefined) {
    if (!isJsonObject(plugin.author)) {
      throw new Error("plugin.json author must be a JSON object");
    }
    assertOnlyKeys(plugin.author, authorKeys, "plugin.json author");
    if (Object.values(plugin.author).some((value) => typeof value !== "string")) {
      throw new Error("plugin.json author fields must be strings");
    }
  }
  if (
    plugin.keywords !== undefined &&
    (!Array.isArray(plugin.keywords) ||
      plugin.keywords.some((keyword) => typeof keyword !== "string"))
  ) {
    throw new Error("plugin.json keywords must be an array of strings");
  }
  if (!isJsonObject(plugin.extensions)) {
    throw new Error("plugin.json extensions must be a JSON object");
  }
  for (const [namespace, value] of Object.entries(plugin.extensions)) {
    if (!isJsonObject(value)) {
      throw new Error(`plugin.json extension ${namespace} must be a JSON object`);
    }
  }
  if (!Object.hasOwn(plugin.extensions, "com.github.copilot")) {
    throw new Error("plugin.json must declare the com.github.copilot extension namespace");
  }
  if (!isJsonObject(marketplace) || !isJsonObject(marketplace.metadata)) {
    throw new Error("marketplace.json and metadata must contain JSON objects");
  }
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length !== 1) {
    throw new Error("marketplace.json must publish exactly one plugin");
  }

  const entry = marketplace.plugins[0];
  if (!isJsonObject(entry)) {
    throw new Error("marketplace plugin entry must contain a JSON object");
  }
  const versions = [marketplace.metadata?.version, entry.version];
  if (versions.some((version) => version !== plugin.version)) {
    throw new Error("plugin and marketplace versions do not match");
  }
  if (entry.name !== plugin.name) {
    throw new Error("plugin and marketplace names do not match");
  }
  if (entry.description !== plugin.description) {
    throw new Error("plugin and marketplace descriptions do not match");
  }
  if (entry.source !== "./agent-plugin") {
    throw new Error("marketplace source must remain ./agent-plugin");
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
}

function readJsonAtRef(ref, path) {
  try {
    execFileSync("git", ["cat-file", "-e", `${ref}:${path}`], {
      cwd: repoRoot,
      stdio: "ignore"
    });
  } catch {
    return null;
  }
  return JSON.parse(
    execFileSync("git", ["show", `${ref}:${path}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    })
  );
}

function gitOutput(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

export function parseArguments(args) {
  if (args.length === 0) {
    return { base: null, tag: null };
  }
  if (args.length !== 2) {
    throw new Error("Usage: check-agent-plugin-release.mjs [--base <ref> | --tag <tag>]");
  }
  const [name, value] = args;
  if ((name !== "--base" && name !== "--tag") || !value || value.startsWith("--")) {
    throw new Error("Usage: check-agent-plugin-release.mjs [--base <ref> | --tag <tag>]");
  }
  return name === "--base" ? { base: value, tag: null } : { base: null, tag: value };
}

export function checkVersionBump(currentVersion, baseVersion, changedPaths) {
  if (!changesPluginRelease(changedPaths) || baseVersion === null) {
    return;
  }
  if (compareSemver(currentVersion, baseVersion) <= 0) {
    throw new Error(
      `Agent Plugin files changed without a version increase (base ${baseVersion}, current ${currentVersion})`
    );
  }
}

export function checkTagVersion(tag, version) {
  const match = /^agent-plugin-v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match) {
    throw new Error(`Invalid Agent Plugin tag: ${tag}`);
  }
  if (match[1] !== version) {
    throw new Error(`Tag ${tag} does not match plugin version ${version}`);
  }
}

export function main(args = process.argv.slice(2)) {
  const { base, tag } = parseArguments(args);
  if (tag) {
    const tagRef = `refs/tags/${tag}`;
    const tagPlugin = readJsonAtRef(tagRef, pluginManifestPath);
    const tagMarketplace = readJsonAtRef(tagRef, marketplacePath);
    if (!tagPlugin || !tagMarketplace) {
      throw new Error(`Tag ${tag} does not contain the Agent Plugin manifests`);
    }
    validatePluginMetadata(tagPlugin, tagMarketplace);
    checkTagVersion(tag, tagPlugin.version);
    console.log(`Agent Plugin tag ${tag} matches version ${tagPlugin.version}.`);
    return;
  }

  const plugin = readJson(pluginManifestPath);
  const marketplace = readJson(marketplacePath);
  validatePluginMetadata(plugin, marketplace);

  if (base) {
    const changedPaths = gitOutput(["diff", "--name-only", `${base}...HEAD`])
      .split("\n")
      .filter(Boolean);
    const basePlugin = readJsonAtRef(base, pluginManifestPath);
    checkVersionBump(plugin.version, basePlugin?.version ?? null, changedPaths);
    console.log(`Agent Plugin metadata and version bump are valid against ${base}.`);
    return;
  }

  console.log(`Agent Plugin metadata is valid for version ${plugin.version}.`);
}

if (resolve(process.argv[1] ?? "") === scriptPath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
