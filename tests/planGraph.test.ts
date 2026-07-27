import { describe, expect, it } from "vitest";

import { type PlanDraft } from "../src/planDraft";
import { projectPlanDraftToGraph } from "../src/planGraph";

function draft(dependencyIds: string[]): PlanDraft {
  return {
    version: 1,
    goal: "Ship a local project manager",
    tasks: [
      {
        id: "A",
        title: "Foundation",
        priority: "P1",
        acceptanceCriteria: ["Foundation is ready"],
        dependencyIds: [],
        ssot: ["AGENTS.md"]
      },
      {
        id: "B",
        title: "Preview",
        priority: "P1",
        acceptanceCriteria: ["Preview works"],
        dependencyIds: ["A"],
        ssot: ["docs/plan.md"]
      },
      {
        id: "C",
        title: "Import",
        priority: "P1",
        acceptanceCriteria: ["Import works"],
        dependencyIds,
        ssot: ["docs/plan.md"]
      }
    ]
  };
}

describe("Plan Draft graph projection", () => {
  it("updates the critical path and parallel candidates after a dependency edit", () => {
    const parallel = projectPlanDraftToGraph(draft(["A"]));
    expect(parallel.edges).toEqual([
      { fromId: "A", toId: "B" },
      { fromId: "A", toId: "C" }
    ]);
    expect(parallel.criticalPathIds).toEqual(["A", "B"]);
    expect(parallel.parallelGroups).toEqual([["B", "C"]]);
    expect(parallel.requestedModelTransitions).toEqual([]);
    expect(parallel.requestedProviderModelTransitions).toEqual([]);

    const serial = projectPlanDraftToGraph(draft(["B"]));
    expect(serial.edges).toEqual([
      { fromId: "A", toId: "B" },
      { fromId: "B", toId: "C" }
    ]);
    expect(serial.criticalPathIds).toEqual(["A", "B", "C"]);
    expect(serial.parallelGroups).toEqual([]);
  });
});
