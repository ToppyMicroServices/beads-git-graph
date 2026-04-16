import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");
const gitGraphView = readFileSync(join(repoRoot, "src", "gitGraphView.ts"), "utf8");
const webMain = readFileSync(join(repoRoot, "web", "main.ts"), "utf8");

describe("git graph branch selector metadata", () => {
  it("renders a visible branch selector control in the webview HTML", () => {
    expect(gitGraphView).toContain(
      '<span id="branchControl"><span class="unselectable">Branch: </span><div id="branchSelect" class="dropdown"></div></span>'
    );
    expect(gitGraphView).not.toContain('id="branchControl" hidden');
  });

  it("shows the branch selector once branch options are loaded", () => {
    expect(webMain).toContain("this.updateBranchControl();");
    expect(webMain).toContain("private updateBranchControl()");
    expect(webMain).toContain(
      'branchControlElem.style.display = this.gitBranches.length > 0 ? "inline" : "none";'
    );
  });
});
