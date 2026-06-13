import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");
const beadsWebview = readFileSync(join(repoRoot, "src", "beadsWebview.ts"), "utf8");
const beadsMain = readFileSync(join(repoRoot, "web", "beadsMain.ts"), "utf8");

describe("beads webview presentation metadata", () => {
  it("renders readable task summary and responsive task rows", () => {
    expect(beadsWebview).toContain("workspaceSummary");
    expect(beadsWebview).toContain("summaryPill");
    expect(beadsWebview).toContain("@media (max-width:560px)");
    expect(beadsWebview).toContain("grid-template-areas");
  });

  it("keeps subproject collapse explicit and double-click driven", () => {
    expect(beadsWebview).toContain("data-child-count");
    expect(beadsWebview).toContain("collapseToggle");
    expect(beadsMain).toContain("rowHasCollapsedAncestor");
    expect(beadsMain).toContain('row.addEventListener("dblclick"');
    expect(beadsMain).toContain("toggleRowCollapse(row)");
  });
});
