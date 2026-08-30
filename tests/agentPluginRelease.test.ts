import { describe, expect, it } from "vitest";

import {
  changesPluginRelease,
  checkTagVersion,
  checkVersionBump,
  compareSemver,
  parseArguments,
  PLUGIN_NAME_PATTERN,
  validatePluginMetadata
} from "../scripts/check-agent-plugin-release.mjs";

const validPlugin = {
  $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  name: "beads-agent-project-manager",
  version: "0.1.1",
  description: "Coordinate Beads tasks safely.",
  extensions: { "com.github.copilot": {} }
};

const validMarketplace = {
  metadata: { version: "0.1.1" },
  plugins: [
    {
      name: "beads-agent-project-manager",
      version: "0.1.1",
      description: "Coordinate Beads tasks safely.",
      source: "./agent-plugin"
    }
  ]
};

describe("Agent Plugin release checks", () => {
  it("uses the canonical Agent Plugins 1.0 name pattern", () => {
    expect(PLUGIN_NAME_PATTERN.test("beads-agent-project-manager")).toBe(true);
    expect(PLUGIN_NAME_PATTERN.test("beads.project-manager")).toBe(true);
    expect(PLUGIN_NAME_PATTERN.test("beads--manager")).toBe(false);
    expect(PLUGIN_NAME_PATTERN.test("beads..manager")).toBe(false);
    expect(PLUGIN_NAME_PATTERN.test("beads-manager-")).toBe(false);
  });

  it("rejects unknown, duplicate, and incomplete CLI options", () => {
    expect(parseArguments([])).toEqual({ base: null, tag: null });
    expect(parseArguments(["--base", "origin/main"])).toEqual({ base: "origin/main", tag: null });
    expect(() => parseArguments(["--unknown", "value"])).toThrow("Usage");
    expect(() => parseArguments(["--base"])).toThrow("Usage");
    expect(() => parseArguments(["--base", "main", "--tag", "agent-plugin-v0.1.1"])).toThrow(
      "Usage"
    );
  });

  it("compares semantic versions numerically", () => {
    expect(compareSemver("0.1.1", "0.1.0")).toBe(1);
    expect(compareSemver("0.10.0", "0.9.9")).toBe(1);
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
  });

  it("requires a version increase when the plugin release changes", () => {
    expect(changesPluginRelease(["docs/agent-plugin.md"])).toBe(false);
    expect(changesPluginRelease(["agent-plugin/README.md"])).toBe(true);
    expect(changesPluginRelease([".github/plugin/marketplace.json"])).toBe(true);
    expect(() => checkVersionBump("0.1.0", "0.1.0", ["agent-plugin/README.md"])).toThrow(
      "without a version increase"
    );
    expect(() => checkVersionBump("0.1.1", "0.1.0", ["agent-plugin/README.md"])).not.toThrow();
  });

  it("matches Agent Plugin tags to manifest versions", () => {
    expect(() => checkTagVersion("agent-plugin-v0.1.1", "0.1.1")).not.toThrow();
    expect(() => checkTagVersion("agent-plugin-v0.1.0", "0.1.1")).toThrow(
      "does not match plugin version"
    );
    expect(() => checkTagVersion("v0.1.1", "0.1.1")).toThrow("Invalid Agent Plugin tag");
  });

  it("keeps the marketplace entry aligned with the plugin manifest", () => {
    expect(() => validatePluginMetadata(validPlugin, validMarketplace)).not.toThrow();
    for (const invalidExtension of [null, []]) {
      expect(() =>
        validatePluginMetadata(
          { ...validPlugin, extensions: { "com.github.copilot": invalidExtension } },
          validMarketplace
        )
      ).toThrow("must be a JSON object");
    }
    expect(() =>
      validatePluginMetadata({ ...validPlugin, unsupported: true }, validMarketplace)
    ).toThrow("unsupported field");
    expect(() =>
      validatePluginMetadata({ ...validPlugin, author: "invalid" }, validMarketplace)
    ).toThrow("author must be a JSON object");
    expect(() =>
      validatePluginMetadata({ ...validPlugin, keywords: ["beads", 1] }, validMarketplace)
    ).toThrow("keywords must be an array of strings");
    expect(() =>
      validatePluginMetadata(validPlugin, {
        ...validMarketplace,
        plugins: [{ ...validMarketplace.plugins[0], source: "../agent-plugin" }]
      })
    ).toThrow("marketplace source must remain ./agent-plugin");
  });
});
