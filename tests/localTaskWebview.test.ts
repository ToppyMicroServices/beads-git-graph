import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  Uri: {
    joinPath: (_base: unknown, ...parts: string[]) => ({ toString: () => parts.join("/") })
  }
}));

import { extractBeadItems } from "../src/beadsData";
import { type BeadLoadResult } from "../src/beadsViewTypes";
import { renderBeadsWebviewHtml } from "../src/beadsWebview";

const capability = {
  supported: true,
  state: "supported" as const,
  reason: "Local task storage is writable."
};
const localWorkspace = {
  workspace: "Local",
  workspacePath: "/tmp/local",
  storageKind: "local" as const
};
const beadsWorkspace = {
  workspace: "Beads",
  workspacePath: "/tmp/beads",
  storageKind: "beads" as const
};
function render(overrides: Partial<BeadLoadResult> = {}) {
  return renderBeadsWebviewHtml(
    { cspSource: "fixture:", asWebviewUri: (uri: unknown) => uri } as never,
    {} as never,
    {
      groups: [],
      emptyWorkspaces: [localWorkspace],
      unavailableWorkspaces: [],
      bdExecutableStatus: { available: false, command: "bd", message: "bd missing" },
      planImportCapabilities: [{ ...localWorkspace, capability }],
      agentWriteCapabilities: [{ ...localWorkspace, capability }],
      errors: [],
      warnings: [],
      ...overrides
    }
  );
}
function tag(html: string, needle: string) {
  const found = html
    .match(/<(?:button|option|section)\b[^>]*>/g)
    ?.find((value) => value.includes(needle));
  expect(found).toBeDefined();
  return found ?? "";
}

describe("Local task onboarding", () => {
  it("enables creation and planning in an empty folder without bd", () => {
    const html = render();
    expect(tag(html, 'data-create-workspace="/tmp/local"')).not.toContain(" disabled");
    expect(tag(html, 'id="generatePlanDraftWithAi"')).not.toContain(" disabled");
    expect(tag(html, 'value="/tmp/local"')).toContain('data-storage-kind="local"');
    expect(html).toContain(".taskgraph/tasks.json");
    expect(html).toContain("when you first create or import tasks");
    expect(html).not.toContain("Run <code>bd init</code>");
    expect(html).toContain('<div class="workspaceName">Tasks</div>');
    expect(html).toContain('data-has-beads-workspaces="0"');
    expect(html).toContain('body[data-has-beads-workspaces="0"] #syncBeads{display:none;}');
  });

  it("keeps local creation enabled while an existing Beads workspace is unavailable", () => {
    const html = render({ unavailableWorkspaces: [beadsWorkspace] });
    expect(tag(html, 'data-create-workspace="/tmp/local"')).not.toContain(" disabled");
    expect(tag(html, 'data-workspace-path="/tmp/beads"')).toContain('data-write-available="0"');
    expect(html).toContain('data-has-beads-workspaces="1"');
    expect(html).toContain("Beads is initialized, but the configured");
  });

  it("enables local AI work independently of missing bd and keeps Beads work blocked", () => {
    const items = extractBeadItems([
      { id: "task-1", title: "Local work", status: "open", issue_type: "task" }
    ]);
    items[0].readyByBd = true;
    const html = render({
      groups: [
        { ...localWorkspace, readinessKnown: true, items },
        { ...beadsWorkspace, readinessKnown: true, items }
      ],
      emptyWorkspaces: [],
      planImportCapabilities: [
        { ...localWorkspace, capability },
        { ...beadsWorkspace, capability }
      ],
      agentWriteCapabilities: [
        { ...localWorkspace, capability },
        { ...beadsWorkspace, capability }
      ]
    });
    expect(tag(html, 'data-assign-start-workspace="/tmp/local"')).not.toContain(
      'aria-disabled="true"'
    );
    expect(tag(html, 'data-assign-start-workspace="/tmp/beads"')).toContain('aria-disabled="true"');
    expect(tag(html, 'data-assign-start-workspace="/tmp/beads"')).toContain(
      "Beads CLI is unavailable"
    );
    expect(html).toContain("All task dependencies are complete.");
    expect(html).toContain("Derived from task status");
    const rowData = html.match(/data-item="([^"]+)"/)?.[1];
    const localItem = JSON.parse(decodeURIComponent(rowData ?? ""));
    expect(localItem).toMatchObject({
      storageKind: "local",
      workspacePath: "/tmp/local",
      editable: true
    });
  });

  it("respects trust and write-capability failures for local creation", () => {
    const blocked = {
      supported: false,
      state: "probe-failed" as const,
      reason: "Workspace Trust is required."
    };
    const html = render({ planImportCapabilities: [{ ...localWorkspace, capability: blocked }] });
    expect(tag(html, 'data-create-workspace="/tmp/local"')).toContain(" disabled");
    expect(tag(html, 'data-create-workspace="/tmp/local"')).toContain(
      "Workspace Trust is required"
    );
    expect(tag(html, 'data-create-workspace="/tmp/local"')).not.toContain("Beads CLI");
  });

  it("offers edit only for native non-synthetic task details and uses the action lifecycle", () => {
    const source = readFileSync(new URL("../web/beadsMain.ts", import.meta.url), "utf8");
    expect(source).toContain('item.storageKind === "local" && !item.synthetic');
    expect(source).toContain('command: "editLocalTask", workspacePath, issueId, clientActionId');
    expect(source).toContain("`edit-local-task:$" + "{workspacePath}:$" + "{issueId}`");
    expect(source).toContain(
      "editLocalTaskAction.disabled = !writeAvailable || item?.editable !== true"
    );
  });
});
