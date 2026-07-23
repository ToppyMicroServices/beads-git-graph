import { describe, expect, it } from "vitest";

import { type PlanDraft } from "../src/planDraft";
import { renderPlanDraftPreview } from "../src/planPreview";

const draft: PlanDraft = {
  version: 1,
  goal: "Ship <safe> & useful planning",
  tasks: [
    {
      id: "plan-a",
      title: 'Design "preview"',
      priority: "P1",
      acceptanceCriteria: ["Unsafe <text> is escaped"],
      dependencyIds: [],
      ssot: ["AGENTS.md"]
    },
    {
      id: "plan-b",
      title: "Import",
      priority: "P2",
      acceptanceCriteria: ["Dependency is visible"],
      dependencyIds: ["plan-a"],
      ssot: ["docs/plan.md"],
      model: "small-model"
    }
  ]
};

describe("Plan Draft preview", () => {
  it("renders escaped plan details, graph summaries, and exact mutations", () => {
    const html = renderPlanDraftPreview({
      draft,
      errors: [],
      capability: { supported: true, state: "supported", reason: "compatible" }
    });

    expect(html).toContain("Ship &lt;safe&gt; &amp; useful planning");
    expect(html).not.toContain("<safe>");
    expect(html).toContain("Critical Path");
    expect(html).toContain("plan-a → plan-b");
    expect(html).toContain("Depends on:");
    expect(html).toContain("Unsafe &lt;text&gt; is escaped");
    expect(html).toContain("small-model");
    expect(html).toContain("Pending Beads mutations (5)");
    expect(html).toContain("bd dep add &lt;created:plan-b&gt; &lt;created:plan-a&gt;");
    expect(html).toContain('id="importPlanDraft" type="button"');
    expect(html).not.toContain('id="importPlanDraft" type="button" title="compatible" disabled');
  });

  it.each([
    ["missing-executable", "bd missing"],
    ["unsupported-command", "create unavailable"],
    ["schema-mismatch", "schema v49 to v53"]
  ] as const)("disables Import for %s with the observed reason", (state, reason) => {
    const html = renderPlanDraftPreview({
      draft,
      errors: [],
      capability: { supported: false, state, reason }
    });

    expect(html).toContain("Import disabled");
    expect(html).toContain(reason);
    expect(html).toMatch(/id="importPlanDraft"[^>]* disabled/);
  });

  it("renders local validation errors without mutations", () => {
    const html = renderPlanDraftPreview({
      draft: null,
      errors: [
        {
          code: "missing-dependency",
          path: "tasks[1].dependencyIds[0]",
          taskId: "plan-b",
          message: "missing dependency"
        }
      ],
      capability: { supported: true, state: "supported", reason: "compatible" }
    });

    expect(html).toContain("tasks[1].dependencyIds[0]");
    expect(html).toContain("missing dependency");
    expect(html).not.toContain("Pending Beads mutations");
    expect(html).toMatch(/id="importPlanDraft"[^>]* disabled/);
  });
});
