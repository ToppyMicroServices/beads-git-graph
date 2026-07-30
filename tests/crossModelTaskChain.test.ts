import { describe, expect, it } from "vitest";

import { parsePlanDraft, type PlanDraft } from "../src/planDraft";
import { projectPlanDraftToGraph } from "../src/planGraph";
import {
  executePlanImport,
  formatPlanMutation,
  projectPlanDraftMutations
} from "../src/planImport";
import { renderPlanDraftPreview } from "../src/planPreview";

const linkedDraft: PlanDraft = {
  version: 1,
  goal: "Coordinate distinct requested models through linked tasks",
  tasks: [
    {
      id: "research",
      title: "Research the decision",
      priority: "P1",
      acceptanceCriteria: ["Record evidence in docs/decision.md"],
      dependencyIds: [],
      ssot: ["AGENTS.md", "docs/decision.md"],
      model: "reasoning-model"
    },
    {
      id: "implement",
      title: "Implement the decision",
      priority: "P1",
      acceptanceCriteria: ["Implementation follows docs/decision.md"],
      dependencyIds: ["research"],
      ssot: ["AGENTS.md", "docs/decision.md"],
      model: "coding-model"
    },
    {
      id: "review",
      title: "Review the result",
      priority: "P2",
      acceptanceCriteria: ["Review records pass/fail evidence"],
      dependencyIds: ["implement"],
      ssot: ["docs/decision.md", "README.md"],
      model: "review-model"
    }
  ]
};

const crossProviderDraft: PlanDraft = {
  version: 1,
  goal: "Coordinate distinct providers through linked tasks",
  tasks: [
    {
      id: "research",
      title: "Research with Hugging Face",
      priority: "P1",
      acceptanceCriteria: ["Record research evidence"],
      dependencyIds: [],
      ssot: ["docs/decision.md"],
      provider: "huggingface",
      model: "research-model"
    },
    {
      id: "implement",
      title: "Implement with Ollama",
      priority: "P1",
      acceptanceCriteria: ["Implement the recorded decision"],
      dependencyIds: ["research"],
      ssot: ["docs/decision.md"],
      provider: "ollama",
      model: "coding-model"
    },
    {
      id: "review",
      title: "Review with Anthropic",
      priority: "P2",
      acceptanceCriteria: ["Record review evidence"],
      dependencyIds: ["implement"],
      ssot: ["docs/decision.md"],
      provider: "anthropic",
      model: "review-model"
    }
  ]
};

describe("cross-model linked task workflow", () => {
  it("preserves requested models and handoffs from Plan Draft through Beads import", async () => {
    const parsed = parsePlanDraft(JSON.parse(JSON.stringify(linkedDraft)) as unknown);
    expect(parsed.errors).toEqual([]);
    expect(parsed.draft?.tasks.map((task) => task.model)).toEqual([
      "reasoning-model",
      "coding-model",
      "review-model"
    ]);

    const graph = projectPlanDraftToGraph(parsed.draft ?? linkedDraft);
    expect(graph.edges).toEqual([
      { fromId: "research", toId: "implement" },
      { fromId: "implement", toId: "review" }
    ]);
    expect(graph.criticalPathIds).toEqual(["research", "implement", "review"]);
    expect(graph.requestedModelTransitions).toEqual([
      {
        fromId: "research",
        toId: "implement",
        fromModel: "reasoning-model",
        toModel: "coding-model"
      },
      {
        fromId: "implement",
        toId: "review",
        fromModel: "coding-model",
        toModel: "review-model"
      }
    ]);

    const preview = renderPlanDraftPreview({
      draft: parsed.draft,
      errors: parsed.errors,
      capability: { supported: true, state: "supported", reason: "compatible" }
    });
    expect(preview).toContain("Requested model transitions");
    expect(preview).toContain(
      "research [reasoning-model] → implement [coding-model]; implement [coding-model] → review [review-model]"
    );
    expect(preview).toContain("Requested model: reasoning-model");
    expect(preview).toContain("docs/decision.md");

    const mutations = projectPlanDraftMutations(parsed.draft ?? linkedDraft);
    const formatted = mutations.map(formatPlanMutation);
    expect(formatted.filter((line) => line.includes("--set-metadata model="))).toEqual([
      expect.stringContaining("model=reasoning-model"),
      expect.stringContaining("model=coding-model"),
      expect.stringContaining("model=review-model")
    ]);
    expect(formatted.slice(-2)).toEqual([
      "bd dep add <created:implement> <created:research>",
      "bd dep add <created:review> <created:implement>"
    ]);

    const calls: string[][] = [];
    const createdIds = ["bg-research", "bg-implement", "bg-review"];
    const result = await executePlanImport(mutations, async (args) => {
      calls.push([...args]);
      return args[0] === "create" ? (createdIds.shift() ?? "") : "";
    });
    expect(result.failed).toBeNull();
    expect(calls.slice(-2)).toEqual([
      ["dep", "add", "bg-implement", "bg-research"],
      ["dep", "add", "bg-review", "bg-implement"]
    ]);
  });

  it("does not infer transitions for same-model or missing-model dependency edges", () => {
    const draft: PlanDraft = {
      ...linkedDraft,
      tasks: linkedDraft.tasks.map((task) => ({ ...task, dependencyIds: [...task.dependencyIds] }))
    };
    draft.tasks[1].model = "reasoning-model";
    delete draft.tasks[2].model;

    expect(projectPlanDraftToGraph(draft).requestedModelTransitions).toEqual([]);
  });
});

describe("cross-provider linked task workflow", () => {
  it("preserves Hugging Face to Ollama to Anthropic handoffs through Beads import", async () => {
    const parsed = parsePlanDraft(JSON.parse(JSON.stringify(crossProviderDraft)) as unknown);
    expect(parsed.errors).toEqual([]);
    expect(parsed.draft?.tasks.map((task) => task.provider)).toEqual([
      "huggingface",
      "ollama",
      "anthropic"
    ]);

    const graph = projectPlanDraftToGraph(parsed.draft ?? crossProviderDraft);
    expect(graph.requestedProviderModelTransitions).toEqual([
      {
        fromId: "research",
        toId: "implement",
        fromProvider: "huggingface",
        toProvider: "ollama",
        fromModel: "research-model",
        toModel: "coding-model"
      },
      {
        fromId: "implement",
        toId: "review",
        fromProvider: "ollama",
        toProvider: "anthropic",
        fromModel: "coding-model",
        toModel: "review-model"
      }
    ]);

    const preview = renderPlanDraftPreview({
      draft: parsed.draft,
      errors: parsed.errors,
      capability: { supported: true, state: "supported", reason: "compatible" }
    });
    expect(preview).toContain("Requested provider/model transitions");
    expect(preview).toContain(
      "research [huggingface / research-model] → implement [ollama / coding-model]; implement [ollama / coding-model] → review [anthropic / review-model]"
    );
    expect(preview).toContain("Requested provider: huggingface");

    const mutations = projectPlanDraftMutations(parsed.draft ?? crossProviderDraft);
    const formatted = mutations.map(formatPlanMutation);
    expect(formatted.filter((line) => line.includes("--set-metadata provider="))).toEqual([
      expect.stringContaining("provider=huggingface"),
      expect.stringContaining("provider=ollama"),
      expect.stringContaining("provider=anthropic")
    ]);

    const calls: string[][] = [];
    const createdIds = ["bg-research", "bg-implement", "bg-review"];
    const result = await executePlanImport(mutations, async (args) => {
      calls.push([...args]);
      return args[0] === "create" ? (createdIds.shift() ?? "") : "";
    });

    expect(result.failed).toBeNull();
    expect(calls.filter((args) => args.includes("provider=huggingface"))).toHaveLength(1);
    expect(calls.filter((args) => args.includes("provider=ollama"))).toHaveLength(1);
    expect(calls.filter((args) => args.includes("provider=anthropic"))).toHaveLength(1);
    expect(calls.slice(-2)).toEqual([
      ["dep", "add", "bg-implement", "bg-research"],
      ["dep", "add", "bg-review", "bg-implement"]
    ]);
  });
});
