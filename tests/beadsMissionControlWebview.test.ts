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

import { type BeadItem } from "../src/beadsData";
import { type BeadLoadResult } from "../src/beadsViewTypes";
import { renderBeadsWebviewHtml } from "../src/beadsWebview";

function makeBead(overrides: Partial<BeadItem>): BeadItem {
  return {
    id: "task-1",
    title: "Example task",
    type: "task",
    status: "open",
    progress: null,
    priority: "P2",
    updatedAt: "2026-07-15T00:00:00Z",
    commitHash: "",
    description: "-",
    notes: "-",
    assignee: "-",
    labels: "-",
    createdAt: "2026-07-15T00:00:00Z",
    parentId: "",
    dependencyIds: [],
    readyByBd: false,
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

function getTagContaining(html: string, tagName: "article" | "button" | "tr", needle: string) {
  const pattern =
    tagName === "article"
      ? /<article\b[^>]*>[\s\S]*?<\/article>/g
      : tagName === "button"
        ? /<button\b[^>]*>/g
        : /<tr\b[^>]*>/g;
  const tag = html.match(pattern)?.find((candidate) => candidate.includes(needle));
  expect(tag, `Expected a ${tagName} containing ${needle}`).toBeDefined();
  return tag ?? "";
}

function getAgentCard(html: string, issueId: string) {
  return getTagContaining(html, "article", `data-work-item-id="${issueId}"`);
}

describe("Agent Project Manager webview", () => {
  it("renders a truthful, actionable mixed-work queue", () => {
    const workspacePath = "/tmp/mission&control";
    const result: BeadLoadResult = {
      groups: [
        {
          workspace: "Mission Control",
          workspacePath,
          items: [
            makeBead({
              id: "attention-1",
              title: "Fix blocked delivery",
              status: "blocked",
              checkStatus: "failed",
              syncRisk: "dirty"
            }),
            makeBead({
              id: "review-1",
              title: "Review implementation",
              status: "in_progress",
              pullRequest: "#42",
              checkStatus: "success"
            }),
            makeBead({
              id: "running-1",
              title: "Implement feature",
              status: "in_progress",
              progress: 40
            }),
            makeBead({
              id: "queue-1",
              title: 'Start <unsafe> & "quoted" work',
              status: "open",
              readyByBd: true,
              parallelizable: true,
              parallelizableSource: "ready",
              provider: "openai",
              model: "small-model",
              ssot: "AGENTS.md",
              artifact: "beads-response:12345678-1234-4234-8234-123456789abc",
              worktree: "../mission-queue-1"
            }),
            makeBead({
              id: "done-1",
              title: "Shipped task",
              status: "closed"
            })
          ]
        }
      ],
      emptyWorkspaces: [],
      unavailableWorkspaces: [],
      bdExecutableStatus: { available: true, command: "bd", message: null },
      errors: [],
      warnings: []
    };
    const webview = {
      cspSource: "vscode-webview:",
      asWebviewUri: () => ({ toString: () => "vscode-webview:/out/beadsWebview.min.js" })
    };
    const extensionUri = { path: "/extension" };

    const html = renderBeadsWebviewHtml(webview as never, extensionUri as never, result);

    expect(html).toContain('<button id="controlView" type="button">Manage</button>');
    expect(html).toContain("Agent Work Queue");

    for (const lane of ["attention", "review", "running", "queue", "done"]) {
      expect(html).toContain(`data-work-lane="${lane}"`);
      expect(html).toContain(`data-work-summary="${lane}">1</strong>`);
    }

    expect(html).toContain("Status is blocked");
    expect(html).toContain("Sync risk is reported as &quot;dirty&quot;");
    expect(html).toContain("Checks are reported as &quot;failed&quot;");
    expect(html).toContain(
      "Derived from Beads status and recorded Git/PR metadata. “Recorded in progress” is not live-agent monitoring."
    );
    expect(html).toContain("Status is in progress; live agent activity is not confirmed");

    expect(html).toContain('data-graph-details-id="attention-1"');
    expect(html).toContain('data-graph-details-workspace="/tmp/mission&amp;control"');
    expect(html).toContain('data-assign-start-id="queue-1"');
    expect(html).toContain('data-assign-start-workspace="/tmp/mission&amp;control"');
    expect(html).toContain(
      'data-assign-start-title="Start &lt;unsafe&gt; &amp; &quot;quoted&quot; work"'
    );
    expect(html).toContain('data-assign-start-provider="openai"');
    expect(
      getTagContaining(getAgentCard(html, "queue-1"), "button", 'data-assign-start-id="queue-1"')
    ).toContain('data-assign-start-worktree=""');
    expect(getAgentCard(html, "queue-1")).toContain("Provider OpenAI API");
    const artifactButton = getTagContaining(
      getAgentCard(html, "queue-1"),
      "button",
      'data-artifact-uri="beads-response:12345678-1234-4234-8234-123456789abc"'
    );
    expect(artifactButton).toContain('class="openAgentArtifact executionBadge artifactBadge"');
    expect(getAgentCard(html, "queue-1")).toContain(">Open response</button>");
    expect(
      html.match(/data-artifact-uri="beads-response:12345678-1234-4234-8234-123456789abc"/g)
    ).toHaveLength(3);
    for (const issueId of ["attention-1", "review-1", "running-1", "done-1"]) {
      expect(getAgentCard(html, issueId)).not.toContain('class="assignStartBead"');
    }

    expect(html).toContain("Start &lt;unsafe&gt; &amp; &quot;quoted&quot; work");
    expect(html).not.toContain("<unsafe>");
  });

  it("enables Start AI only when bd ready confirms the task", () => {
    const result: BeadLoadResult = {
      groups: [
        {
          workspace: "Mission Control",
          workspacePath: "/tmp/mission-control",
          items: [
            makeBead({ id: "ready-1", readyByBd: true }),
            makeBead({
              id: "ready-explicit",
              readyByBd: true,
              parallelizable: true,
              parallelizableSource: "explicit"
            }),
            makeBead({ id: "unknown-1" }),
            makeBead({
              id: "ready-serial",
              readyByBd: true,
              parallelizableSuppressed: true
            }),
            makeBead({
              id: "explicit-unready",
              parallelizable: true,
              parallelizableSource: "explicit"
            }),
            makeBead({ id: "waiting-1", status: "waiting" })
          ]
        }
      ],
      emptyWorkspaces: [],
      unavailableWorkspaces: [],
      bdExecutableStatus: { available: true, command: "bd", message: null },
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

    const readyCard = getAgentCard(html, "ready-1");
    expect(getTagContaining(readyCard, "button", 'data-assign-start-id="ready-1"')).not.toContain(
      " disabled"
    );
    expect(
      getTagContaining(
        getAgentCard(html, "ready-explicit"),
        "button",
        'data-assign-start-id="ready-explicit"'
      )
    ).not.toContain(" disabled");
    expect(
      getTagContaining(
        getAgentCard(html, "ready-serial"),
        "button",
        'data-assign-start-id="ready-serial"'
      )
    ).not.toContain(" disabled");
    const unknownCard = getAgentCard(html, "unknown-1");
    const unknownButton = getTagContaining(
      unknownCard,
      "button",
      'data-assign-start-id="unknown-1"'
    );
    expect(unknownButton).toContain(" disabled");
    expect(unknownButton).toContain("Start is unavailable until bd ready confirms this task.");
    expect(
      getTagContaining(
        getAgentCard(html, "explicit-unready"),
        "button",
        'data-assign-start-id="explicit-unready"'
      )
    ).toContain(" disabled");

    const parallelButton = getTagContaining(html, "button", 'class="startParallelBeads');
    const encodedTargets = parallelButton.match(/data-start-parallel-items="([^"]+)"/)?.[1];
    expect(encodedTargets).toBeDefined();
    const targets = JSON.parse(decodeURIComponent(encodedTargets ?? "[]")) as Array<{
      issueId: string;
      provider: string;
    }>;
    expect(targets).toMatchObject([
      { issueId: "ready-1", provider: "copilot" },
      { issueId: "ready-explicit", provider: "copilot" }
    ]);

    const waitingCard = getAgentCard(html, "waiting-1");
    expect(waitingCard).toContain("Status &quot;waiting&quot; is not recognized");
    expect(getTagContaining(html, "tr", 'data-id="waiting-1"')).not.toContain("display:none");
  });

  it("disables provider calls when the Beads schema cannot be updated safely", () => {
    const workspacePath = "/tmp/schema-mismatch";
    const result: BeadLoadResult = {
      groups: [
        {
          workspace: "Schema mismatch",
          workspacePath,
          items: [
            makeBead({ id: "ready-1", readyByBd: true }),
            makeBead({ id: "ready-2", readyByBd: true })
          ]
        }
      ],
      emptyWorkspaces: [],
      unavailableWorkspaces: [],
      bdExecutableStatus: { available: true, command: "bd", message: null },
      agentWriteCapabilities: [
        {
          workspace: "Schema mismatch",
          workspacePath,
          capability: {
            supported: false,
            state: "schema-mismatch",
            reason: "Beads schema v49 is incompatible with v53."
          }
        }
      ],
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

    expect(html).toContain("<strong>AI actions disabled</strong>");
    expect(html).toContain("Beads schema v49 is incompatible with v53.");
    const startButton = getTagContaining(
      getAgentCard(html, "ready-1"),
      "button",
      'data-assign-start-id="ready-1"'
    );
    expect(startButton).toContain(" disabled");
    expect(startButton).toContain("AI actions are disabled because Beads cannot be updated safely");
    expect(getTagContaining(html, "button", 'class="startParallelBeads')).toContain(" disabled");
  });

  it("shows a completed direct-provider artifact as review, not live running work", () => {
    const result: BeadLoadResult = {
      groups: [
        {
          workspace: "Mission Control",
          workspacePath: "/tmp/mission-control",
          items: [
            makeBead({
              id: "response-1",
              status: "in_progress",
              provider: "anthropic",
              model: "review-model",
              artifact: "beads-response:87654321-4321-4321-8321-cba987654321"
            })
          ]
        }
      ],
      emptyWorkspaces: [],
      unavailableWorkspaces: [],
      bdExecutableStatus: { available: true, command: "bd", message: null },
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

    expect(html).toContain('data-work-summary="review">1</strong>');
    expect(html).toContain('data-work-summary="running">0</strong>');
    expect(html).toContain("Response ready");
    expect(html).toContain(
      "A direct-provider response artifact is ready for review; no live agent is implied"
    );
  });

  it("does not offer Start Parallel for a single ready task", () => {
    const result: BeadLoadResult = {
      groups: [
        {
          workspace: "Mission Control",
          workspacePath: "/tmp/mission-control",
          items: [
            makeBead({ id: "single-ready", readyByBd: true }),
            makeBead({
              id: "explicit-unready",
              parallelizable: true,
              parallelizableSource: "explicit"
            })
          ]
        }
      ],
      emptyWorkspaces: [],
      unavailableWorkspaces: [],
      bdExecutableStatus: { available: true, command: "bd", message: null },
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

    expect(html).not.toContain('class="startParallelBeads');
    expect(
      getTagContaining(
        getAgentCard(html, "single-ready"),
        "button",
        'data-assign-start-id="single-ready"'
      )
    ).not.toContain(" disabled");
  });

  it("moves a linked cross-model handoff from upstream work to the downstream queue", () => {
    const render = (items: BeadItem[]) =>
      renderBeadsWebviewHtml(
        {
          cspSource: "vscode-webview:",
          asWebviewUri: () => ({ toString: () => "vscode-webview:/out/beadsWebview.min.js" })
        } as never,
        { path: "/extension" } as never,
        {
          groups: [
            {
              workspace: "Mission Control",
              workspacePath: "/tmp/mission-control",
              items
            }
          ],
          emptyWorkspaces: [],
          unavailableWorkspaces: [],
          bdExecutableStatus: { available: true, command: "bd", message: null },
          errors: [],
          warnings: []
        }
      );
    const research = makeBead({
      id: "research",
      title: "Research the decision",
      readyByBd: true,
      provider: "huggingface",
      model: "reasoning-model",
      ssot: "docs/decision.md"
    });
    const implement = makeBead({
      id: "implement",
      title: "Implement the decision",
      dependencyIds: ["research"],
      provider: "ollama",
      model: "coding-model",
      ssot: "docs/decision.md"
    });

    const before = render([research, implement]);
    expect(
      getTagContaining(
        getAgentCard(before, "research"),
        "button",
        'data-assign-start-id="research"'
      )
    ).not.toContain(" disabled");
    const blockedHandoff = getTagContaining(
      getAgentCard(before, "implement"),
      "button",
      'data-assign-start-id="implement"'
    );
    expect(blockedHandoff).toContain(" disabled");
    expect(blockedHandoff).toContain('data-assign-start-provider="ollama"');
    expect(blockedHandoff).toContain('data-assign-start-model="coding-model"');
    expect(blockedHandoff).toContain('data-assign-start-ssot="docs/decision.md"');
    const blockedGraphHandoff = getTagContaining(
      before,
      "button",
      'data-assign-start-id="implement"'
    );
    expect(blockedGraphHandoff).toContain(" disabled");
    expect(blockedGraphHandoff).toContain(
      "Start is unavailable until bd ready confirms this task and its dependencies."
    );
    expect(getAgentCard(before, "research")).toContain("Provider Hugging Face Inference");
    expect(getAgentCard(before, "implement")).toContain("Provider Ollama");
    expect(before).not.toContain('class="startParallelBeads');

    const after = render([
      { ...research, status: "closed", readyByBd: false },
      { ...implement, readyByBd: true }
    ]);
    const readyHandoff = getTagContaining(
      getAgentCard(after, "implement"),
      "button",
      'data-assign-start-id="implement"'
    );
    expect(readyHandoff).not.toContain(" disabled");
    expect(getTagContaining(after, "button", 'data-assign-start-id="implement"')).not.toContain(
      " disabled"
    );
    expect(after).toContain("<span>Depends</span><strong");
    expect(after).toContain(">research</strong>");
  });

  it("disables state-changing actions without bd and explains derived merge work", () => {
    const result: BeadLoadResult = {
      groups: [
        {
          workspace: "Mission Control",
          workspacePath: "/tmp/mission-control",
          items: [
            makeBead({
              id: "ready-1",
              readyByBd: true,
              parallelizableSource: "ready",
              parallelizable: true
            }),
            makeBead({ id: "ready-2", readyByBd: true }),
            makeBead({
              id: "merge:epic-1",
              title: "Merge parallel PRs (2)",
              synthetic: true,
              syntheticKind: "parallel-pr-merge",
              dependencyIds: ["task-1", "task-2"],
              checkStatus: "ready",
              syncRisk: "pending preflight"
            })
          ]
        }
      ],
      emptyWorkspaces: [],
      unavailableWorkspaces: [],
      bdExecutableStatus: { available: false, command: "bd", message: "not found" },
      errors: [],
      warnings: [
        {
          source: "sync",
          message: "fixture mismatch",
          workspacePath: "/tmp/mission-control"
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

    const readyButton = getTagContaining(
      getAgentCard(html, "ready-1"),
      "button",
      'data-assign-start-id="ready-1"'
    );
    expect(readyButton).toContain("The Beads CLI is unavailable");
    expect(readyButton).toContain(" disabled");

    const mergeCard = getAgentCard(html, "merge:epic-1");
    const mergeButton = getTagContaining(mergeCard, "button", 'data-merge-id="merge:epic-1"');
    expect(mergeButton).toContain("The Beads CLI is unavailable");
    expect(mergeButton).toContain(" disabled");

    expect(getTagContaining(html, "button", 'id="syncBeads"')).toContain(" disabled");
    expect(getTagContaining(html, "button", 'class="warningAction')).toContain(" disabled");
    expect(getTagContaining(html, "button", 'class="startParallelBeads')).toContain(" disabled");
    expect(getTagContaining(html, "button", 'data-assign-start-id="ready-1"')).toContain(
      " disabled"
    );
    expect(getTagContaining(html, "button", 'data-merge-id="merge:epic-1"')).toContain(" disabled");

    expect(mergeCard).toContain("Parallel tasks are closed; merge preflight is required");
    expect(mergeCard).toContain("Readiness N/A");
    expect(mergeCard).not.toContain("Readiness unknown");
    expect(html).toContain("Default (Active + Unknown)");
    expect(html).toContain(".actionBtn:disabled,.workspaceAction:disabled,.warningAction:disabled");
  });
});
