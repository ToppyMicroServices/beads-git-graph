import { describe, expect, it, vi } from "vitest";

import { runReadinessGuardedStart } from "../src/agentStartGuard";
import { buildAgentWorkPrompt } from "../src/agentWorkPrompt";

describe("readiness-guarded agent start", () => {
  it("performs no preparation or mutation when the task is already stale", async () => {
    const calls: string[] = [];
    const prepare = vi.fn(async () => {
      calls.push("worktree");
      return "prepared";
    });
    const mutateAndLaunch = vi.fn(async () => {
      calls.push("mutation");
      return "opened";
    });

    const result = await runReadinessGuardedStart({
      issueId: "implement",
      queryReadyItemIds: async () => {
        calls.push("ready");
        return new Set<string>();
      },
      queryDependencyIds: async () => {
        calls.push("show");
        return ["research"];
      },
      prepare,
      mutateAndLaunch
    });

    expect(result).toEqual({ status: "not-ready", phase: "before-preparation" });
    expect(calls).toEqual(["show", "ready"]);
    expect(prepare).not.toHaveBeenCalled();
    expect(mutateAndLaunch).not.toHaveBeenCalled();
  });

  it("performs no preparation or mutation when dependency inspection fails", async () => {
    const calls: string[] = [];
    const prepare = vi.fn(async () => "prepared");
    const mutateAndLaunch = vi.fn(async () => "opened");

    await expect(
      runReadinessGuardedStart({
        issueId: "implement",
        queryReadyItemIds: async () => {
          calls.push("ready");
          return new Set(["implement"]);
        },
        queryDependencyIds: async () => {
          calls.push("show");
          throw new Error("bd show failed");
        },
        prepare,
        mutateAndLaunch
      })
    ).rejects.toThrow("bd show failed");

    expect(calls).toEqual(["show"]);
    expect(prepare).not.toHaveBeenCalled();
    expect(mutateAndLaunch).not.toHaveBeenCalled();
  });

  it("stops before Beads mutation and launch when readiness changes during preparation", async () => {
    const calls: string[] = [];
    const readyResults = [new Set(["implement"]), new Set<string>()];
    const mutateAndLaunch = vi.fn(async () => {
      calls.push("mutation");
      return "opened";
    });

    const result = await runReadinessGuardedStart({
      issueId: "implement",
      queryReadyItemIds: async () => {
        calls.push("ready");
        return readyResults.shift() ?? new Set<string>();
      },
      queryDependencyIds: async () => {
        calls.push("show");
        return ["research"];
      },
      prepare: async () => {
        calls.push("worktree");
        return "prepared";
      },
      mutateAndLaunch
    });

    expect(result).toEqual({ status: "not-ready", phase: "before-mutation" });
    expect(calls).toEqual(["show", "ready", "worktree", "show", "ready"]);
    expect(mutateAndLaunch).not.toHaveBeenCalled();
  });

  it("stops before Beads mutation and launch when the final dependency inspection fails", async () => {
    const calls: string[] = [];
    let showCount = 0;
    const mutateAndLaunch = vi.fn(async () => "opened");

    await expect(
      runReadinessGuardedStart({
        issueId: "implement",
        queryReadyItemIds: async () => {
          calls.push("ready");
          return new Set(["implement"]);
        },
        queryDependencyIds: async () => {
          calls.push("show");
          showCount += 1;
          if (showCount === 2) {
            throw new Error("final bd show failed");
          }
          return ["research"];
        },
        prepare: async () => {
          calls.push("worktree");
          return "prepared";
        },
        mutateAndLaunch
      })
    ).rejects.toThrow("final bd show failed");

    expect(calls).toEqual(["show", "ready", "worktree", "show"]);
    expect(mutateAndLaunch).not.toHaveBeenCalled();
  });

  it("uses freshly inspected dependencies immediately before mutation and launch", async () => {
    const calls: string[] = [];
    const dependencyResults = [["old-research"], ["current-research"]];
    const receivedDependencies: string[][] = [];
    let prompt = "";

    const result = await runReadinessGuardedStart({
      issueId: "implement",
      queryReadyItemIds: async () => {
        calls.push("ready");
        return new Set(["implement"]);
      },
      queryDependencyIds: async () => {
        calls.push("show");
        return dependencyResults.shift() ?? [];
      },
      prepare: async () => {
        calls.push("worktree");
        return "prepared";
      },
      mutateAndLaunch: async (_prepared, dependencyIds) => {
        calls.push("mutation", "session");
        receivedDependencies.push([...dependencyIds]);
        prompt = buildAgentWorkPrompt({
          issueId: "implement",
          title: "Implement the decision",
          model: "coding-model",
          ssot: "docs/decision.md",
          workspacePath: "/tmp/project",
          worktree: "/tmp/project-implement",
          dependencyIds
        });
        return "opened";
      }
    });

    expect(result).toEqual({ status: "started", result: "opened" });
    expect(calls).toEqual(["show", "ready", "worktree", "show", "ready", "mutation", "session"]);
    expect(receivedDependencies).toEqual([["current-research"]]);
    expect(prompt).toContain('Upstream bead handoff IDs: "current-research".');
    expect(prompt).not.toContain("old-research");
  });
});
