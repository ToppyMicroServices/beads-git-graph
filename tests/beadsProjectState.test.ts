import { describe, expect, it } from "vitest";

import { type BeadItem } from "../src/beadsData";
import {
  AGENT_WORK_LANES,
  buildAgentWorkQueue,
  compareGraphWorkFocusOrder,
  deriveAgentWorkItem,
  deriveGraphWorkFocus
} from "../src/beadsProjectState";

function makeBead(overrides: Partial<BeadItem> = {}): BeadItem {
  return {
    id: "neo-1",
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

describe("deriveAgentWorkItem", () => {
  it("puts closed work in done before considering risk metadata", () => {
    const derived = deriveAgentWorkItem(
      makeBead({ status: "closed", checkStatus: "failed", syncRisk: "dirty" })
    );

    expect(derived).toMatchObject({
      lane: "done",
      readiness: "not-applicable",
      reason: "Status is closed"
    });
    expect(derived.reasons.map((reason) => reason.code)).toEqual(["closed"]);
  });

  it("collects confirmed attention evidence without duplicating the item", () => {
    const item = makeBead({
      status: "blocked",
      checkStatus: "timed-out",
      syncRisk: "dirty"
    });
    const derived = deriveAgentWorkItem(item);

    expect(derived.item).toBe(item);
    expect(derived.lane).toBe("attention");
    expect(derived.reasons.map((reason) => reason.code)).toEqual([
      "blocked",
      "sync-risk",
      "checks-failing"
    ]);
    expect(derived.reason).toContain('Sync risk is reported as "dirty"');
    expect(derived.reason).toContain('Checks are reported as "timed-out"');
  });

  it("routes unrecognized bead statuses to attention", () => {
    expect(deriveAgentWorkItem(makeBead({ status: "waiting" }))).toMatchObject({
      lane: "attention",
      reason: 'Status "waiting" is not recognized'
    });
  });

  it("puts recorded pull requests in review before in-progress work", () => {
    expect(
      deriveAgentWorkItem(
        makeBead({ status: "in_progress", pullRequest: "#42", checkStatus: "success" })
      )
    ).toMatchObject({
      lane: "review",
      readiness: "not-applicable",
      reason: 'Pull request "#42" is recorded'
    });
  });

  it("describes in-progress state without claiming live agent activity", () => {
    expect(deriveAgentWorkItem(makeBead({ status: "in_progress" }))).toMatchObject({
      lane: "running",
      reason: "Status is in progress; live agent activity is not confirmed"
    });
  });

  it("routes applied edits to external validation instead of unopened-response review", () => {
    expect(
      deriveAgentWorkItem(
        makeBead({
          status: "in_progress",
          provider: "openai",
          providerStatus: "edit_applied",
          contentCheckStatus: "model_passed",
          acceptanceStatus: "pending_external_validation",
          reviewStatus: "human_approved",
          artifact: "file:///tmp/response.txt"
        })
      )
    ).toMatchObject({
      lane: "review",
      reason:
        "The workspace edit was applied after human review; external validation is still pending"
    });
  });

  it("routes completed direct-provider response artifacts to review", () => {
    expect(
      deriveAgentWorkItem(
        makeBead({
          status: "in_progress",
          provider: "openai",
          artifact: "file:///tmp/response.txt"
        })
      )
    ).toMatchObject({
      lane: "review",
      reason: "A direct-provider response artifact is ready for review; no live agent is implied"
    });
  });

  it("distinguishes bd readiness from parallel preference", () => {
    const confirmed = deriveAgentWorkItem(makeBead({ readyByBd: true }));
    const confirmedSerial = deriveAgentWorkItem(
      makeBead({ id: "neo-serial", readyByBd: true, parallelizableSuppressed: true })
    );
    const explicit = deriveAgentWorkItem(
      makeBead({ id: "neo-2", parallelizable: true, parallelizableSource: "explicit" })
    );
    const openOnly = deriveAgentWorkItem(makeBead({ id: "neo-3" }));

    expect(confirmed).toMatchObject({
      lane: "queue",
      readiness: "confirmed",
      reason: "Readiness is reported by bd ready"
    });
    expect(confirmedSerial).toMatchObject({
      lane: "queue",
      readiness: "confirmed",
      reason: "Readiness is reported by bd ready"
    });
    expect(explicit).toMatchObject({
      lane: "queue",
      readiness: "not-confirmed",
      reason: "Marked parallelizable, but readiness is not confirmed by bd ready"
    });
    expect(openOnly).toMatchObject({
      lane: "queue",
      readiness: "not-confirmed",
      reason: "Status is open; readiness is not confirmed by bd ready"
    });
  });

  it("describes a derived merge gate without claiming bd readiness", () => {
    expect(
      deriveAgentWorkItem(
        makeBead({
          id: "merge:epic-1",
          synthetic: true,
          syntheticKind: "parallel-pr-merge",
          checkStatus: "ready",
          dependencyIds: ["task-1", "task-2"]
        })
      )
    ).toMatchObject({
      lane: "queue",
      readiness: "not-applicable",
      reason: "Parallel tasks are closed; merge preflight is required",
      reasons: [{ code: "merge-preflight" }]
    });
  });

  it("does not treat unknown check or sync values as confirmed failures", () => {
    expect(
      deriveAgentWorkItem(makeBead({ checkStatus: "pending", syncRisk: "medium" }))
    ).toMatchObject({ lane: "queue" });
  });
});

describe("deriveGraphWorkFocus", () => {
  it("marks only ordinary recorded in-progress work as running", () => {
    expect(deriveGraphWorkFocus(makeBead({ status: "in_progress" }))).toBe("running");
    expect(deriveGraphWorkFocus(makeBead({ status: "in_progress", pullRequest: "#42" }))).toBe(
      "none"
    );
    expect(
      deriveGraphWorkFocus(
        makeBead({
          status: "in_progress",
          provider: "openai",
          artifact: "beads-response:00000000-0000-4000-8000-000000000000"
        })
      )
    ).toBe("none");
    expect(deriveGraphWorkFocus(makeBead({ status: "in_progress", checkStatus: "failed" }))).toBe(
      "none"
    );
  });

  it("marks only bd-confirmed open work as next ready", () => {
    expect(deriveGraphWorkFocus(makeBead({ status: "open", readyByBd: true }))).toBe("next-ready");
    expect(
      deriveGraphWorkFocus(makeBead({ status: "open", parallelizable: true, readyByBd: false }))
    ).toBe("none");
  });

  it("orders Now and Next before other tasks after visible levels are projected", () => {
    const projected = [
      { id: "unready", level: 0, focus: "none" },
      { id: "ready-after-hidden-dependency", level: 0, focus: "next-ready" },
      { id: "working", level: 0, focus: "running" }
    ].sort(
      (left, right) =>
        left.level - right.level ||
        compareGraphWorkFocusOrder(left.focus, left.id, right.focus, right.id)
    );

    expect(projected.map((item) => item.id)).toEqual([
      "working",
      "ready-after-hidden-dependency",
      "unready"
    ]);
  });
});

describe("buildAgentWorkQueue", () => {
  it("groups every item in stable lane order and reports counts", () => {
    const queue = buildAgentWorkQueue([
      makeBead({ id: "attention", status: "blocked" }),
      makeBead({ id: "review", pullRequest: "17" }),
      makeBead({ id: "running", status: "in progress" }),
      makeBead({ id: "queued" }),
      makeBead({ id: "done", status: "resolved" }),
      makeBead({ id: "queued-second" })
    ]);

    expect(AGENT_WORK_LANES).toEqual(["attention", "review", "running", "queue", "done"]);
    expect(queue.counts).toEqual({
      attention: 1,
      review: 1,
      running: 1,
      queue: 2,
      done: 1
    });
    expect(queue.total).toBe(6);
    expect(queue.lanes.queue.map((entry) => entry.item.id)).toEqual(["queued", "queued-second"]);
  });

  it("orders queued work by confirmed readiness, priority, and original order", () => {
    const queue = buildAgentWorkQueue([
      makeBead({ id: "unconfirmed-p0", priority: "P0" }),
      makeBead({ id: "confirmed-p4", priority: "P4", readyByBd: true }),
      makeBead({ id: "confirmed-p1-first", priority: "P1", readyByBd: true }),
      makeBead({ id: "unconfirmed-p1", priority: "P1" }),
      makeBead({ id: "confirmed-p1-second", priority: "P1", readyByBd: true })
    ]);

    expect(queue.lanes.queue.map((entry) => entry.item.id)).toEqual([
      "confirmed-p1-first",
      "confirmed-p1-second",
      "confirmed-p4",
      "unconfirmed-p0",
      "unconfirmed-p1"
    ]);
  });

  it("orders attention work by priority while preserving stable ties", () => {
    const queue = buildAgentWorkQueue([
      makeBead({ id: "p4", status: "blocked", priority: "P4" }),
      makeBead({ id: "p2-first", status: "blocked", priority: "P2" }),
      makeBead({ id: "p0", status: "blocked", priority: "P0" }),
      makeBead({ id: "p2-second", status: "blocked", priority: "P2" })
    ]);

    expect(queue.lanes.attention.map((entry) => entry.item.id)).toEqual([
      "p0",
      "p2-first",
      "p2-second",
      "p4"
    ]);
  });
});
