import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");
const beadsView = readFileSync(join(repoRoot, "src", "beadsView.ts"), "utf8");
const beadsMain = readFileSync(join(repoRoot, "web", "beadsMain.ts"), "utf8");

describe("Plan Import host boundary", () => {
  it("revalidates, reprobes, confirms, and reports partial results in the Extension Host", () => {
    expect(beadsView).toContain("parsePlanDraft(parsedValue)");
    expect(beadsView).toContain("probeBeadsWriteCapability(");
    expect(beadsView).toContain("modal: true");
    expect(beadsView).toContain("executePlanImport(mutations");
    expect(beadsView).toContain("No rollback was attempted.");
    expect(beadsView).not.toContain("BD_ALLOW_REMOTE_MIGRATE");
    expect(beadsView).not.toContain('"bootstrap"');
  });

  it("keeps editing and Cancel local while posting only explicit Import", () => {
    expect(beadsMain).toContain("planDraftController.cancel()");
    expect(beadsMain).toContain("planDraftController.importPlan(");
    expect(beadsMain).not.toContain('command: "migrate"');
    expect(beadsMain).not.toContain('command: "bootstrap"');
  });
});
