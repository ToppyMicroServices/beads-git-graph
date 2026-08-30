import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  Uri: {
    joinPath: (base: { path: string }, ...segments: string[]) => ({
      path: [base.path, ...segments].join("/"),
      toString() {
        return this.path;
      }
    })
  }
}));

import { type BeadLoadResult } from "../src/beadsViewTypes";
import { renderBeadsWebviewHtml } from "../src/beadsWebview";

describe("Plan Draft webview shell", () => {
  it("renders the Plan workspace and an escaped schema capability gate", () => {
    const result: BeadLoadResult = {
      groups: [],
      emptyWorkspaces: [{ workspace: "Demo <workspace>", workspacePath: "/tmp/demo&plan" }],
      unavailableWorkspaces: [],
      bdExecutableStatus: { available: true, command: "bd", message: null },
      errors: [],
      warnings: [],
      planImportCapabilities: [
        {
          workspace: "Demo <workspace>",
          workspacePath: "/tmp/demo&plan",
          capability: {
            supported: false,
            state: "schema-mismatch",
            reason: "Schema v49 < v53 requires coordination"
          }
        }
      ]
    };

    const html = renderBeadsWebviewHtml(
      {
        cspSource: "vscode-webview:",
        asWebviewUri: () => ({ toString: () => "vscode-webview:/out/beadsWebview.min.js" })
      } as never,
      { path: "/extension" } as never,
      result
    );

    expect(html).toContain('<button id="planView" type="button">Plan</button>');
    expect(html).toContain('id="planDraftView"');
    expect(html).toContain('id="planDraftText"');
    expect(html).toContain('id="previewPlanDraft"');
    expect(html).toContain("Demo &lt;workspace&gt;");
    expect(html).not.toContain("Demo <workspace>");
    expect(html).toContain('value="/tmp/demo&amp;plan"');
    expect(decodeURIComponent(html.match(/data-plan-capability="([^"]+)"/)?.[1] ?? "")).toContain(
      "schema-mismatch"
    );
  });

  it("keeps Lite Plan available before Beads is installed or initialized", () => {
    const result: BeadLoadResult = {
      groups: [],
      emptyWorkspaces: [],
      unavailableWorkspaces: [],
      uninitializedWorkspaces: [{ workspace: "Lite Project", workspacePath: "/tmp/lite&project" }],
      workspaces: [{ workspace: "Lite Project", workspacePath: "/tmp/lite&project" }],
      bdExecutableStatus: { available: false, command: "bd", message: "not found" },
      errors: [],
      warnings: []
    };

    const html = renderBeadsWebviewHtml(
      {
        cspSource: "vscode-webview:",
        asWebviewUri: () => ({ toString: () => "vscode-webview:/out/beadsWebview.min.js" })
      } as never,
      { path: "/extension" } as never,
      result
    );

    expect(html).toContain("Lite Project · draft only");
    expect(html).toContain('value="/tmp/lite&amp;project"');
    expect(html).toContain('id="generatePlanDraftWithAi" type="button"');
    expect(html).not.toContain(
      'id="generatePlanDraftWithAi" type="button" title="Open a workspace folder first." disabled'
    );
    expect(html).toContain("Locate bd…");
    expect(html).toContain("Lite mode works without Beads");
    expect(html).toContain(
      "It never initializes Beads, imports tasks, or starts an agent automatically."
    );
  });

  it("offers confirmed local initialization when bd is available", () => {
    const result: BeadLoadResult = {
      groups: [],
      emptyWorkspaces: [],
      unavailableWorkspaces: [],
      uninitializedWorkspaces: [
        { workspace: "Local Project", workspacePath: "/tmp/local&project" }
      ],
      workspaces: [{ workspace: "Local Project", workspacePath: "/tmp/local&project" }],
      bdExecutableStatus: { available: true, command: "/opt/homebrew/bin/bd", message: null },
      errors: [],
      warnings: []
    };

    const html = renderBeadsWebviewHtml(
      {
        cspSource: "vscode-webview:",
        asWebviewUri: () => ({ toString: () => "vscode-webview:/out/beadsWebview.min.js" })
      } as never,
      { path: "/extension" } as never,
      result
    );

    expect(html).toContain('class="initializeBeads workspaceAction"');
    expect(html).toContain('data-initialize-workspace="/tmp/local&amp;project"');
    expect(html).toContain(">Initialize Beads</button>");
    expect(html).not.toContain("Locate bd…");
  });
});
