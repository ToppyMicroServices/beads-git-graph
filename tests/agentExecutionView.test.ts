import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));

import { type AgentExecutionSnapshot, EXECUTION_PHASE_LABELS } from "../src/agentExecutionTrace";
import { renderAgentExecutionPanel, renderAgentPlan } from "../src/agentExecutionView";
import type { BeadItem } from "../src/beadsData";

function task(id: string, overrides: Partial<BeadItem> = {}): BeadItem {
  return {
    id,
    title: id,
    type: "task",
    status: "open",
    progress: null,
    priority: "P2",
    updatedAt: "",
    commitHash: "",
    description: "",
    notes: "",
    assignee: "-",
    labels: "",
    createdAt: "",
    parentId: "",
    dependencyIds: [],
    readyByBd: true,
    parallelizable: false,
    parallelizableSource: "",
    parallelizableSuppressed: false,
    agent: "",
    provider: "copilot",
    model: "",
    ssot: "",
    artifact: "",
    worktree: "",
    branch: "",
    pullRequest: "",
    checkStatus: "",
    syncRisk: "",
    synthetic: false,
    syntheticKind: "",
    ...overrides
  };
}

describe("execution Manage rendering", () => {
  it("orders explicit parents before leaves and keeps dependencies separate", () => {
    const html = renderAgentPlan(
      [
        task("leaf", { parentId: "parent", dependencyIds: ["prerequisite", "unloaded"] }),
        task("parent", { type: "epic" }),
        task("prerequisite"),
        task("parent.1")
      ],
      "/workspace",
      new Map()
    );
    expect(html.indexOf('data-plan-issue-id="parent"')).toBeLessThan(
      html.indexOf('data-plan-issue-id="leaf"')
    );
    expect(html).toContain(
      'data-plan-issue-id="leaf" data-plan-parent-id="parent" data-plan-depth="1"'
    );
    expect(html).toContain("Parent: parent · Depends on: prerequisite, unloaded (not loaded)");
    expect(html).toContain(
      'data-plan-issue-id="parent.1" data-plan-parent-id="" data-plan-depth="0"'
    );
  });

  it("shows requested assignment, escaped text, and recorded status without inferring execution", () => {
    const html = renderAgentPlan(
      [
        task("one", {
          title: "<script>unsafe</script>",
          status: "in_progress",
          agent: "worker",
          provider: "openai",
          model: "small-model"
        })
      ],
      "/workspace",
      new Map()
    );
    expect(html).toContain("Requested: OpenAI API / small-model · Owner: worker");
    expect(html).toContain("Recorded: In Progress");
    expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("data-execution-active");
    expect(renderAgentExecutionPanel("/workspace")).toContain(
      "No execution observed in this session"
    );
  });

  it("does not substitute an owner for an unspecified requested model", () => {
    const html = renderAgentPlan([task("one", { agent: "worker" })], "/workspace", new Map());
    expect(html).toContain("Requested: Unassigned / Unassigned · Owner: worker");
  });

  it("keeps missing parents and parent cycles visible once", () => {
    const html = renderAgentPlan(
      [
        task("one", { parentId: "two" }),
        task("two", { parentId: "one" }),
        task("orphan", { parentId: "absent" })
      ],
      "/workspace",
      new Map()
    );
    expect(html.match(/class="agentPlanRow"/g)).toHaveLength(3);
    expect(html).toContain("Parent: absent (not loaded)");
  });

  it("renders every host phase with bounded labels and scopes observations to a workspace", () => {
    const snapshot: AgentExecutionSnapshot = {
      sessionId: "session",
      revision: 15,
      entries: Object.keys(EXECUTION_PHASE_LABELS).map((phase, index) => ({
        runId: `run-${index}`,
        workspacePath: "/workspace",
        issueId: "one",
        title: "One",
        provider: "openai",
        model: "small-model",
        phase: phase as keyof typeof EXECUTION_PHASE_LABELS,
        startedAt: "2026-09-13T00:00:00Z",
        updatedAt: "2026-09-13T00:00:00Z"
      }))
    };
    const html = renderAgentExecutionPanel("/workspace", snapshot);
    for (const label of Object.values(EXECUTION_PHASE_LABELS)) expect(html).toContain(label);
    expect(html).toContain('data-execution-phase="awaiting-review" data-execution-active="1"');
    expect(html).toContain('data-execution-phase="edit-applied" data-execution-active="0"');
    expect(html).toContain("Edit applied · acceptance pending");
    expect(renderAgentExecutionPanel("/other", snapshot)).not.toContain("data-execution-run-id");
  });
  it("handles a deeply nested recorded plan without recursive traversal", () => {
    const items = Array.from({ length: 6000 }, (_, index) =>
      task(`deep-${index}`, {
        parentId: index === 0 ? "" : `deep-${index - 1}`
      })
    );
    const html = renderAgentPlan(items, "/workspace", new Map());
    expect(html.match(/class="agentPlanRow"/g)).toHaveLength(6000);
    expect(html).toContain(
      'data-plan-issue-id="deep-5999" data-plan-parent-id="deep-5998" data-plan-depth="5999"'
    );
  });

  it("shows the observation timestamp and masks email-like model identities", () => {
    const html = renderAgentExecutionPanel("/workspace", {
      sessionId: "session",
      revision: 1,
      entries: [
        {
          runId: "one",
          workspacePath: "/workspace",
          issueId: "one",
          title: "One",
          provider: "openai",
          model: "person@example.com",
          phase: "generating",
          startedAt: "2026-09-13T00:00:00Z",
          updatedAt: "2026-09-13T00:00:01Z"
        }
      ]
    });
    expect(html).toContain("Model identity hidden");
    expect(html).not.toContain("person@example.com");
    expect(html).toContain(
      '<time class="agentExecutionTime" datetime="2026-09-13T00:00:01Z">Observed 2026-09-13T00:00:01Z</time>'
    );
  });
});
