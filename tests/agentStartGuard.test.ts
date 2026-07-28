import { describe, expect, it, vi } from "vitest";

import { requestAgentProviderResponse } from "../src/agentProviderClient";
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

  it("preserves a generated response when final readiness changes", async () => {
    const calls: string[] = [];
    const readyResults = [new Set(["research"]), new Set<string>()];
    const mutateAndLaunch = vi.fn(async () => "response-opened");

    const result = await runReadinessGuardedStart({
      issueId: "research",
      queryReadyItemIds: async () => {
        calls.push("ready");
        return readyResults.shift() ?? new Set<string>();
      },
      queryDependencyIds: async () => {
        calls.push("show");
        return [];
      },
      prepare: async () => {
        calls.push("provider", "artifact");
        return { response: "paid result", artifact: "beads-response:run" };
      },
      preservePreparedOnAbort: async () => {
        calls.push("open");
      },
      mutateAndLaunch
    });

    expect(result).toEqual({ status: "not-ready", phase: "before-mutation" });
    expect(calls).toEqual(["show", "ready", "provider", "artifact", "show", "ready", "open"]);
    expect(mutateAndLaunch).not.toHaveBeenCalled();
  });

  it("preserves a generated response when dependency handoffs change", async () => {
    const calls: string[] = [];
    const dependencyResults = [["research-a"], ["research-b"]];
    const mutateAndLaunch = vi.fn(async () => "response-opened");

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
      prepare: async (dependencyIds) => {
        calls.push("provider", "artifact");
        return { dependencyIds: [...dependencyIds], artifact: "beads-response:run" };
      },
      preservePreparedOnAbort: async () => {
        calls.push("open");
      },
      isPreparedStillValid: (prepared, dependencyIds) =>
        prepared.dependencyIds.join("\n") === dependencyIds.join("\n"),
      mutateAndLaunch
    });

    expect(result).toEqual({ status: "not-ready", phase: "dependencies-changed" });
    expect(calls).toEqual(["show", "ready", "provider", "artifact", "show", "ready", "open"]);
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
        preservePreparedOnAbort: async () => {
          calls.push("preserve");
        },
        mutateAndLaunch
      })
    ).rejects.toThrow("final bd show failed");

    expect(calls).toEqual(["show", "ready", "worktree", "show", "preserve"]);
    expect(mutateAndLaunch).not.toHaveBeenCalled();
  });

  it("performs no Beads mutation when provider preparation fails", async () => {
    const calls: string[] = [];
    const mutateAndLaunch = vi.fn(async () => "response-opened");
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      runReadinessGuardedStart({
        issueId: "research",
        queryReadyItemIds: async () => {
          calls.push("ready");
          return new Set(["research"]);
        },
        queryDependencyIds: async () => {
          calls.push("show");
          return [];
        },
        prepare: async () => {
          calls.push("provider");
          return requestAgentProviderResponse(
            {
              provider: "openai",
              model: "research-model",
              prompt: "Research",
              apiKey: undefined,
              maxOutputTokens: 128,
              timeoutMs: 1_000
            },
            fetchMock
          );
        },
        mutateAndLaunch
      })
    ).rejects.toThrow("No credential is available");

    expect(calls).toEqual(["show", "ready", "provider"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mutateAndLaunch).not.toHaveBeenCalled();
  });

  it("does not call a provider when the Beads write preflight fails", async () => {
    const calls: string[] = [];
    const prepare = vi.fn(async () => {
      calls.push("provider");
      return "response";
    });
    const mutateAndLaunch = vi.fn(async () => "response-opened");

    await expect(
      runReadinessGuardedStart({
        issueId: "research",
        queryReadyItemIds: async () => {
          calls.push("ready");
          return new Set(["research"]);
        },
        queryDependencyIds: async () => {
          calls.push("show");
          return [];
        },
        preflight: async () => {
          calls.push("write-capability");
          throw new Error("Beads schema v49 is incompatible with v53");
        },
        prepare,
        mutateAndLaunch
      })
    ).rejects.toThrow("schema v49");

    expect(calls).toEqual(["show", "ready", "write-capability"]);
    expect(prepare).not.toHaveBeenCalled();
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

  it("runs final readiness checks and mutation inside the finalization wrapper", async () => {
    const calls: string[] = [];
    let insideFinalization = false;
    let dependencyQueryCount = 0;
    let readyQueryCount = 0;

    const result = await runReadinessGuardedStart({
      issueId: "implement",
      queryReadyItemIds: async () => {
        readyQueryCount += 1;
        calls.push(`ready:${insideFinalization}`);
        expect(insideFinalization).toBe(readyQueryCount === 2);
        return new Set(["implement"]);
      },
      queryDependencyIds: async () => {
        dependencyQueryCount += 1;
        calls.push(`show:${insideFinalization}`);
        expect(insideFinalization).toBe(dependencyQueryCount === 2);
        return ["research"];
      },
      prepare: async () => {
        calls.push(`prepare:${insideFinalization}`);
        expect(insideFinalization).toBe(false);
        return "prepared";
      },
      mutateAndLaunch: async () => {
        calls.push(`mutation:${insideFinalization}`);
        expect(insideFinalization).toBe(true);
        return "opened";
      },
      runFinalization: async (operation) => {
        calls.push("finalization:start");
        insideFinalization = true;
        try {
          return await operation();
        } finally {
          insideFinalization = false;
          calls.push("finalization:end");
        }
      }
    });

    expect(result).toEqual({ status: "started", result: "opened" });
    expect(calls).toEqual([
      "show:false",
      "ready:false",
      "prepare:false",
      "finalization:start",
      "show:true",
      "ready:true",
      "mutation:true",
      "finalization:end"
    ]);
  });
});
