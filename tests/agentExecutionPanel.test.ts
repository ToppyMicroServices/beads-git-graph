import { describe, expect, it } from "vitest";

import { createAgentExecutionPanelController } from "../web/agentExecutionPanel";

function emptyDocument() {
  return {
    querySelector: () => null,
    querySelectorAll: () => []
  } as unknown as Document;
}

function snapshot(sessionId: string) {
  return { sessionId, revision: 1, entries: [] };
}

describe("execution panel sessions", () => {
  it("bounds retired sessions while rejecting recent delayed updates", () => {
    const controller = createAgentExecutionPanelController(emptyDocument());
    for (let index = 0; index < 34; index++) {
      expect(controller.update(snapshot(`session-${index}`))).toBe(true);
    }

    expect(controller.update(snapshot("session-1"))).toBe(false);
    expect(controller.update(snapshot("session-0"))).toBe(true);
  });
});
