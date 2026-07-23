import { describe, expect, it } from "vitest";

import { createPlanDraftController } from "../web/planDraftController";

const validText = JSON.stringify({
  version: 1,
  goal: "Plan safely",
  tasks: [
    {
      id: "task-a",
      title: "Task A",
      priority: "P1",
      acceptanceCriteria: ["Done"],
      dependencyIds: [],
      ssot: ["AGENTS.md"]
    }
  ]
});

describe("Plan Draft controller", () => {
  it("previews and cancels without recording a Beads mutation", () => {
    const messages: unknown[] = [];
    const controller = createPlanDraftController((message) => messages.push(message));
    controller.setText(validText);

    expect(controller.preview().errors).toEqual([]);
    controller.cancel();

    expect(controller.getText()).toBe("");
    expect(messages).toEqual([]);
  });

  it("posts only a current, valid, compatible, explicitly imported preview", () => {
    const messages: unknown[] = [];
    const controller = createPlanDraftController((message) => messages.push(message));
    controller.setText(validText);
    controller.preview();

    expect(controller.importPlan("/tmp/project", false)).toBe(false);
    controller.setText(`${validText} `);
    expect(controller.importPlan("/tmp/project", true)).toBe(false);
    controller.preview();
    expect(controller.importPlan("/tmp/project", true)).toBe(true);

    expect(messages).toEqual([
      {
        command: "importPlanDraft",
        workspacePath: "/tmp/project",
        draftText: `${validText} `
      }
    ]);
  });
});
