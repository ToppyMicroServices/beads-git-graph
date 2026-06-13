import { describe, expect, it } from "vitest";

import {
  parseRevListCounts,
  parseWorktreePorcelain,
  summarizeFindings
} from "../scripts/worktree-sync-guard.mjs";

describe("worktree sync guard helpers", () => {
  it("parses git worktree porcelain output", () => {
    expect(
      parseWorktreePorcelain(`worktree /repo
HEAD abc123
branch refs/heads/main

worktree /repo-agent-a
HEAD def456
branch refs/heads/feature/a

`)
    ).toEqual([
      {
        path: "/repo",
        branch: "main",
        head: "abc123",
        bare: false,
        detached: false
      },
      {
        path: "/repo-agent-a",
        branch: "feature/a",
        head: "def456",
        bare: false,
        detached: false
      }
    ]);
  });

  it("parses ahead and behind counts", () => {
    expect(parseRevListCounts("2\t3\n")).toEqual({ ahead: 2, behind: 3 });
  });

  it("summarizes errors as blocking", () => {
    expect(
      summarizeFindings([
        { level: "warning", path: "/repo", message: "No upstream branch is configured." },
        { level: "error", path: "/repo-agent-a", message: "HEAD does not contain origin/main." }
      ])
    ).toMatchObject({
      ok: false,
      failures: [{ path: "/repo-agent-a" }],
      warnings: [{ path: "/repo" }]
    });
  });
});
