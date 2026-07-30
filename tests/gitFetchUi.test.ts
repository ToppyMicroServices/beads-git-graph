import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  capabilities?: {
    untrustedWorkspaces?: { restrictedConfigurations?: string[] };
  };
  contributes?: {
    configuration?: {
      properties?: Record<string, { default?: unknown; description?: string }>;
    };
  };
};
const hostSource = readFileSync(join(repoRoot, "src", "gitGraphView.ts"), "utf8");
const webSource = readFileSync(join(repoRoot, "web", "main.ts"), "utf8");

describe("Git Graph fetch UI", () => {
  it("enables fetch-on-manual-refresh by default and restricts the setting", () => {
    const setting =
      packageJson.contributes?.configuration?.properties?.["beads-git-graph.fetchOnGraphRefresh"];
    expect(setting?.default).toBe(true);
    expect(setting?.description).toContain("git fetch --all");
    expect(packageJson.capabilities?.untrustedWorkspaces?.restrictedConfigurations).toContain(
      "beads-git-graph.fetchOnGraphRefresh"
    );
  });

  it("keeps Restricted Mode local-only and deduplicates trusted fetches", () => {
    expect(hostSource).toContain('msg.command === "refreshGraph"');
    expect(hostSource).toContain('mode: "restricted"');
    expect(hostSource).toContain("this.graphRefreshes.get(repo)");
    expect(hostSource).toContain("await this.dataSource.fetchAll(repo)");
    expect(webSource).toContain("this.currentRepo !== repo");
  });

  it("labels origin refs as local tracking data and shows fetch recency", () => {
    expect(webSource).toContain("(local remote-tracking)");
    expect(webSource).toContain("not a live view of the remote");
    expect(webSource).toContain("Last successful fetch:");
    expect(webSource).toContain('command: "refreshGraph"');
  });
});
