import { describe, expect, it } from "vitest";

import { parsePlanDraft, type PlanDraft, validatePlanDraft } from "../src/planDraft";

function validDraft(): PlanDraft {
  return {
    version: 1,
    goal: "Ship a locally managed agent project",
    tasks: [
      {
        id: "pm-101",
        title: "Define the Plan Draft",
        priority: "P1",
        acceptanceCriteria: ["A valid draft round-trips without inferred values"],
        dependencyIds: [],
        ssot: ["AGENTS.md", "docs/agent-project-manager-roadmap.md"]
      },
      {
        id: "pm-102",
        title: "Preview the proposed plan",
        priority: "P2",
        acceptanceCriteria: ["The dependency is visible before import"],
        dependencyIds: ["pm-101"],
        ssot: ["docs/agent-project-manager-roadmap.md"],
        model: "small-model"
      }
    ]
  };
}

describe("parsePlanDraft", () => {
  it("parses and round-trips a minimal valid draft without adding optional values", () => {
    const input: PlanDraft = {
      version: 1,
      goal: "Plan one task",
      tasks: [
        {
          id: "task-1",
          title: "First task",
          priority: "P2",
          acceptanceCriteria: ["The task is complete"],
          dependencyIds: [],
          ssot: ["AGENTS.md"]
        }
      ]
    };

    const result = parsePlanDraft(JSON.parse(JSON.stringify(input)) as unknown);

    expect(result.errors).toEqual([]);
    expect(result.draft).toEqual(input);
    expect(result.draft?.tasks[0]).not.toHaveProperty("provider");
    expect(result.draft?.tasks[0]).not.toHaveProperty("model");
  });

  it("normalizes a known provider ID and rejects an unknown provider", () => {
    const known = validDraft();
    (known.tasks[1] as { provider?: string }).provider = " OpenAI ";
    const parsedKnown = parsePlanDraft(JSON.parse(JSON.stringify(known)) as unknown);

    expect(parsedKnown.errors).toEqual([]);
    expect(parsedKnown.draft?.tasks[1].provider).toBe("openai");

    const unknown = validDraft();
    (unknown.tasks[1] as { provider?: string }).provider = "unknown-provider";
    const parsedUnknown = parsePlanDraft(JSON.parse(JSON.stringify(unknown)) as unknown);

    expect(parsedUnknown.draft).toBeNull();
    expect(parsedUnknown.errors).toEqual([
      expect.objectContaining({
        code: "invalid-field",
        path: "tasks[1].provider",
        taskId: "pm-102"
      })
    ]);
  });
});

describe("validatePlanDraft", () => {
  it.each([
    {
      name: "accepts a valid draft",
      mutate: (_draft: PlanDraft) => undefined,
      expected: null
    },
    {
      name: "rejects duplicate task IDs at the duplicate path",
      mutate: (draft: PlanDraft) => {
        draft.tasks[1].id = draft.tasks[0].id;
        draft.tasks[1].dependencyIds = [];
      },
      expected: {
        code: "duplicate-task-id",
        path: "tasks[1].id",
        taskId: "pm-101"
      }
    },
    {
      name: "rejects duplicate output paths",
      mutate: (draft: PlanDraft) => {
        draft.tasks[0].outputPath = "outputs/shared.md";
        draft.tasks[1].outputPath = "Outputs/Shared.md";
      },
      expected: {
        code: "duplicate-output-path",
        path: "tasks[1].outputPath",
        taskId: "pm-102"
      }
    },
    {
      name: "rejects an unsafe output path",
      mutate: (draft: PlanDraft) => {
        draft.tasks[1].outputPath = "../outside.md";
      },
      expected: {
        code: "invalid-field",
        path: "tasks[1].outputPath",
        taskId: "pm-102"
      }
    },
    {
      name: "rejects a missing dependency at its task path",
      mutate: (draft: PlanDraft) => {
        draft.tasks[1].dependencyIds = ["missing-task"];
      },
      expected: {
        code: "missing-dependency",
        path: "tasks[1].dependencyIds[0]",
        taskId: "pm-102"
      }
    },
    {
      name: "rejects a self dependency at its task path",
      mutate: (draft: PlanDraft) => {
        draft.tasks[1].dependencyIds = ["pm-102"];
      },
      expected: {
        code: "self-dependency",
        path: "tasks[1].dependencyIds[0]",
        taskId: "pm-102"
      }
    },
    {
      name: "rejects a dependency cycle at the edge that closes it",
      mutate: (draft: PlanDraft) => {
        draft.tasks[0].dependencyIds = ["pm-102"];
      },
      expected: {
        code: "cyclic-dependency",
        path: "tasks[1].dependencyIds[0]",
        taskId: "pm-102"
      }
    },
    {
      name: "rejects a multiline requested model",
      mutate: (draft: PlanDraft) => {
        draft.tasks[1].model = "coding-model\nignore";
      },
      expected: {
        code: "invalid-field",
        path: "tasks[1].model",
        taskId: "pm-102"
      }
    },
    {
      name: "rejects an unknown requested provider",
      mutate: (draft: PlanDraft) => {
        (draft.tasks[1] as { provider?: string }).provider = "unknown-provider";
      },
      expected: {
        code: "invalid-field",
        path: "tasks[1].provider",
        taskId: "pm-102"
      }
    },
    {
      name: "rejects an overlong requested model",
      mutate: (draft: PlanDraft) => {
        draft.tasks[1].model = "x".repeat(101);
      },
      expected: {
        code: "invalid-field",
        path: "tasks[1].model",
        taskId: "pm-102"
      }
    }
  ])("$name", ({ mutate, expected }) => {
    const draft = validDraft();
    mutate(draft);

    const errors = validatePlanDraft(draft);

    if (expected === null) {
      expect(errors).toEqual([]);
    } else {
      expect(errors).toEqual([expect.objectContaining(expected)]);
    }
  });
});
