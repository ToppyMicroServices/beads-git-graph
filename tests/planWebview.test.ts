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
});
