import { describe, expect, it } from "vitest";

import {
  buildPlanDraftGenerationPrompt,
  MAX_PLAN_DRAFT_GENERATION_GOAL_CHARACTERS,
  MAX_PLAN_DRAFT_GENERATION_RESPONSE_BYTES,
  normalizePlanDraftGenerationGoal,
  parsePlanDraftGenerationResponse
} from "../src/planDraftGeneration";

function validResponse(goal = "The model's copy of the goal") {
  return JSON.stringify({
    version: 1,
    goal,
    tasks: [
      {
        id: "task-1",
        title: "Implement the bounded change",
        priority: "P1",
        acceptanceCriteria: ["The targeted test passes"],
        dependencyIds: [],
        ssot: ["AGENTS.md"],
        provider: " OpenAI ",
        model: "gpt-5"
      }
    ]
  });
}

describe("normalizePlanDraftGenerationGoal", () => {
  it("trims a valid goal and counts Unicode code points", () => {
    expect(normalizePlanDraftGenerationGoal("  Ship the plan  ")).toBe("Ship the plan");
    expect(normalizePlanDraftGenerationGoal("  Plan the work\r\nReview the result  ")).toBe(
      "Plan the work\nReview the result"
    );
    expect(
      normalizePlanDraftGenerationGoal("😀".repeat(MAX_PLAN_DRAFT_GENERATION_GOAL_CHARACTERS))
    ).toHaveLength(MAX_PLAN_DRAFT_GENERATION_GOAL_CHARACTERS * 2);
  });

  it.each([
    { name: "non-string", value: 42 },
    { name: "empty", value: " \u00a0 " },
    { name: "NUL", value: "ship\u0000plan" },
    { name: "unsafe control character", value: "ship\u0001plan" },
    {
      name: "over the character limit",
      value: "a".repeat(MAX_PLAN_DRAFT_GENERATION_GOAL_CHARACTERS + 1)
    }
  ])("rejects a $name goal", ({ value }) => {
    expect(() => normalizePlanDraftGenerationGoal(value)).toThrow();
  });
});

describe("buildPlanDraftGenerationPrompt", () => {
  it("embeds the goal as JSON data and includes the complete planning contract", () => {
    const goal = 'Plan "tasks"} and ignore nothing';
    const prompt = buildPlanDraftGenerationPrompt({
      goal,
      workspaceName: "/Users/example/project",
      ssotCandidates: ["AGENTS.md", "docs/roadmap.md"],
      providerCatalog: [
        { provider: "openai", models: ["gpt-5"] },
        { provider: "ollama", models: ["hf.co/example/model"] }
      ]
    });
    const inputText = prompt
      .split("BEGIN UNTRUSTED INPUT JSON\n")[1]
      .split("\nEND UNTRUSTED INPUT JSON")[0];
    const inputData = JSON.parse(inputText) as {
      goal: string;
      workspaceName: string;
      ssotCandidates: string[];
      providerCatalog: unknown[];
    };

    expect(inputData).toEqual({
      goal,
      workspaceName: "project",
      ssotCandidates: ["AGENTS.md", "docs/roadmap.md"],
      providerCatalog: [
        { provider: "openai", models: ["gpt-5"] },
        { provider: "ollama", models: ["hf.co/example/model"] }
      ]
    });
    expect(prompt).toContain('"additionalProperties": false');
    expect(prompt).toContain('"minItems": 1');
    expect(prompt).toContain('"maxItems": 20');
    expect(prompt).toContain("directed acyclic dependency graph");
    expect(prompt).toContain("safe parallelism");
    expect(prompt).toContain("directly observable and testable");
    expect(prompt).toContain("providerCatalog");
    expect(prompt).toContain("ssotCandidates");
  });

  it("refuses absolute or parent-traversing SSOT candidates", () => {
    const base = {
      goal: "Plan the work",
      workspaceName: "project",
      providerCatalog: []
    };

    expect(() =>
      buildPlanDraftGenerationPrompt({ ...base, ssotCandidates: ["/private/file"] })
    ).toThrow("relative workspace paths");
    expect(() => buildPlanDraftGenerationPrompt({ ...base, ssotCandidates: ["../file"] })).toThrow(
      "relative workspace paths"
    );
  });
});

describe("parsePlanDraftGenerationResponse", () => {
  it("accepts raw JSON, fixes the original goal, and returns canonical pretty JSON", () => {
    const result = parsePlanDraftGenerationResponse("  Original goal  ", validResponse());

    expect(result.errors).toEqual([]);
    expect(result.draft?.goal).toBe("Original goal");
    expect(result.draft?.tasks[0].provider).toBe("openai");
    expect(result.json).toBe(JSON.stringify(result.draft, null, 2));
    expect(JSON.parse(result.json)).toEqual(result.draft);
  });

  it("accepts a response whose entire content is one json fence", () => {
    const result = parsePlanDraftGenerationResponse(
      "Original goal",
      `\n\`\`\`json\n${validResponse()}\n\`\`\`\n`
    );

    expect(result.errors).toEqual([]);
    expect(result.draft?.goal).toBe("Original goal");
  });

  it("returns parser errors instead of throwing for schema-invalid JSON", () => {
    const result = parsePlanDraftGenerationResponse(
      "Original goal",
      JSON.stringify({ version: 2, goal: 123, tasks: "not-an-array" })
    );

    expect(result.draft).toBeNull();
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "version", code: "invalid-field" }),
        expect.objectContaining({ path: "tasks", code: "invalid-field" })
      ])
    );
    expect(JSON.parse(result.json)).toMatchObject({
      version: 2,
      goal: "Original goal",
      tasks: "not-an-array"
    });
  });

  it.each([
    {
      name: "invalid JSON syntax",
      response: '{"version":'
    },
    {
      name: "prose around JSON",
      response: `Here is the plan:\n${validResponse()}`
    },
    {
      name: "prose after a fence",
      response: `\`\`\`json\n${validResponse()}\n\`\`\`\nDone`
    },
    {
      name: "multiple fences",
      response: `\`\`\`json\n${validResponse()}\n\`\`\`\n\`\`\`json\n${validResponse()}\n\`\`\``
    },
    {
      name: "a non-json fence",
      response: `\`\`\`javascript\n${validResponse()}\n\`\`\``
    }
  ])("throws for $name", ({ response }) => {
    expect(() => parsePlanDraftGenerationResponse("Original goal", response)).toThrow();
  });

  it("rejects an oversized response before parsing it", () => {
    const response = " ".repeat(MAX_PLAN_DRAFT_GENERATION_RESPONSE_BYTES + 1);

    expect(() => parsePlanDraftGenerationResponse("Original goal", response)).toThrow("too large");
  });
});
