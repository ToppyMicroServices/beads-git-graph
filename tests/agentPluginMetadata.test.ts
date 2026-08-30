import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");
const pluginRoot = join(repoRoot, "agent-plugin");
const plugin = JSON.parse(readFileSync(join(pluginRoot, "plugin.json"), "utf8")) as {
  $schema: string;
  name: string;
  version: string;
  description: string;
  extensions?: Record<string, unknown>;
};
const marketplace = JSON.parse(
  readFileSync(join(repoRoot, ".github", "plugin", "marketplace.json"), "utf8")
) as {
  name: string;
  metadata: { version: string };
  plugins: Array<{ name: string; version: string; source: string; description: string }>;
};
const skill = readFileSync(join(pluginRoot, "skills", "beads-project-manager", "SKILL.md"), "utf8");
const agent = readFileSync(
  join(pluginRoot, "com.github.copilot", "agents", "beads-project-manager.agent.md"),
  "utf8"
);
const pluginReadme = readFileSync(join(pluginRoot, "README.md"), "utf8");
const pluginChangelog = readFileSync(join(pluginRoot, "CHANGELOG.md"), "utf8");
const docs = readFileSync(join(repoRoot, "docs", "agent-plugin.md"), "utf8");

describe("agent plugin metadata", () => {
  it("declares an Agent Plugins 1.0 manifest", () => {
    expect(plugin.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
    expect(plugin.name.length).toBeLessThanOrEqual(64);
    expect(plugin.name).toMatch(/^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(plugin.description.length).toBeGreaterThan(20);
    expect(plugin.extensions).toHaveProperty("com.github.copilot");
  });

  it("publishes the isolated plugin through the repository marketplace", () => {
    expect(marketplace.name).toBe("toppymicroservices-agent-plugins");
    expect(marketplace.metadata.version).toBe(plugin.version);
    expect(marketplace.plugins).toEqual([
      expect.objectContaining({
        name: plugin.name,
        version: plugin.version,
        source: "./agent-plugin",
        description: plugin.description
      })
    ]);
  });

  it("provides a discoverable skill and Copilot custom agent", () => {
    expect(skill).toMatch(/^---\nname: beads-project-manager\ndescription: .+\n---\n/);
    expect(agent).toMatch(/^---\nname: Beads Project Manager\ndescription: .+\n---\n/);
    expect(agent).toContain("`beads-project-manager` skill");
  });

  it("keeps dangerous Beads recovery actions operator-gated", () => {
    expect(skill).toContain(
      "Never automatically run `bd migrate`, `bd bootstrap`, or `--ignore-schema-skew`"
    );
    expect(skill).toContain("does not by itself\nmean that the task was accepted");
    expect(skill).toContain("Ask for approval before creating\nor rewiring tasks");
    expect(skill).toContain("only when the host client exposes compatible agent or task tools");
  });

  it("documents supported marketplace installation without conflating cache or VSIX boundaries", () => {
    expect(docs).toContain('"chat.plugins.enabled": true');
    expect(docs).toContain('"chat.plugins.marketplaces"');
    expect(docs).toContain("copilot plugin marketplace add ToppyMicroServices/beads-git-graph");
    expect(docs).toContain("ToppyMicroServices/beads-git-graph:agent-plugin");
    expect(docs).not.toContain(
      "copilot plugin install ToppyMicroServices/beads-git-graph:agent-plugin"
    );
    expect(docs).toContain("It is separate from the Beads Git Graph VSIX");
    expect(docs).toContain("full public repository into a separate marketplace source cache");
    expect(docs).toContain("outside the active plugin payload");
    expect(docs).toContain("a separate review and\nsubmission process");
  });

  it("provides a safe first prompt and plugin-specific release history", () => {
    expect(pluginReadme).toContain("## Start safely");
    expect(pluginReadme).toContain("Do not mutate Beads or start agents.");
    expect(pluginReadme).toContain("compatible agent or task tools from the host client");
    expect(pluginChangelog).toContain(`## [${plugin.version}] - 2026-08-30`);
  });
});
