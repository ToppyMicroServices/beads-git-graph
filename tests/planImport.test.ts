import { describe, expect, it } from "vitest";

import { type PlanDraft } from "../src/planDraft";
import {
  executePlanImport,
  formatPlanMutation,
  projectPlanDraftMutations
} from "../src/planImport";

const draft: PlanDraft = {
  version: 1,
  goal: "Plan safely",
  tasks: [
    {
      id: "draft-a",
      title: "First task",
      instructions: "Create the first artifact and verify the first criterion.",
      priority: "P1",
      acceptanceCriteria: ["First passes"],
      dependencyIds: [],
      ssot: ["AGENTS.md"],
      outputPath: "outputs/draft-a.md",
      provider: "openai",
      model: "gpt-5"
    },
    {
      id: "draft-b",
      title: "Second task",
      priority: "P2",
      acceptanceCriteria: ["Second passes"],
      dependencyIds: ["draft-a"],
      ssot: ["README.md"],
      outputPath: "outputs/draft-b.md"
    }
  ]
};

describe("Plan Draft mutations", () => {
  it("shows ordered create, update, and dependency arguments before execution", () => {
    const mutations = projectPlanDraftMutations(draft);

    expect(mutations.map((mutation) => mutation.kind)).toEqual([
      "create",
      "create",
      "update",
      "update",
      "dependency"
    ]);
    expect(mutations.map(formatPlanMutation)).toMatchInlineSnapshot(`
      [
        "bd create --title "First task" --priority P1 --type task --silent",
        "bd create --title "Second task" --priority P2 --type task --silent",
        "bd update <created:draft-a> --acceptance "First passes" --set-metadata "plan_goal=Plan safely" --set-metadata plan_draft_version=1 --set-metadata "task_instructions=Create the first artifact and verify the first criterion." --set-metadata provider=openai --set-metadata model=gpt-5 --set-metadata ssot=AGENTS.md --set-metadata output_path=outputs/draft-a.md",
        "bd update <created:draft-b> --acceptance "Second passes" --set-metadata "plan_goal=Plan safely" --set-metadata plan_draft_version=1 --set-metadata ssot=README.md --set-metadata output_path=outputs/draft-b.md",
        "bd dep add <created:draft-b> <created:draft-a>",
      ]
    `);
  });

  it("reports created IDs, one failure, and unexecuted operations without rollback claims", async () => {
    const mutations = projectPlanDraftMutations(draft);
    const calls: string[][] = [];
    const result = await executePlanImport(mutations, async (args) => {
      calls.push([...args]);
      if (calls.length === 1) {
        return "bg-101\n";
      }
      if (calls.length === 2) {
        return "bg-102\n";
      }
      throw new Error("simulated operation three failure");
    });

    expect(calls).toEqual([
      ["create", "--title", "First task", "--priority", "P1", "--type", "task", "--silent"],
      ["create", "--title", "Second task", "--priority", "P2", "--type", "task", "--silent"],
      [
        "update",
        "bg-101",
        "--acceptance",
        "First passes",
        "--set-metadata",
        "plan_goal=Plan safely",
        "--set-metadata",
        "plan_draft_version=1",
        "--set-metadata",
        "task_instructions=Create the first artifact and verify the first criterion.",
        "--set-metadata",
        "provider=openai",
        "--set-metadata",
        "model=gpt-5",
        "--set-metadata",
        "ssot=AGENTS.md",
        "--set-metadata",
        "output_path=outputs/draft-a.md"
      ]
    ]);
    expect(result.createdIds).toEqual([
      { taskId: "draft-a", issueId: "bg-101" },
      { taskId: "draft-b", issueId: "bg-102" }
    ]);
    expect(result.completed).toHaveLength(2);
    expect(result.failed?.error).toBe("simulated operation three failure");
    expect(result.failed?.mutation.kind).toBe("update");
    expect(result.unexecuted.map((mutation) => mutation.kind)).toEqual(["update", "dependency"]);
  });
});
