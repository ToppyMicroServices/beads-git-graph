import { resolveAgentProviderId } from "./agentProvider";
import { type BeadItem, normalizeBeadPriority, normalizeBeadStatus } from "./beadsData";

export const AGENT_WORK_LANES = [
  "attention",
  "live",
  "review",
  "running",
  "queue",
  "done"
] as const;

export type AgentWorkLane = (typeof AGENT_WORK_LANES)[number];
export type AgentWorkReadiness = "confirmed" | "not-confirmed" | "not-applicable";
export type GraphWorkFocus = "live" | "running" | "next-ready" | "none";

export function getGraphWorkFocusRank(focus: string | undefined) {
  return focus === "live" ? 0 : focus === "running" ? 1 : focus === "next-ready" ? 2 : 3;
}

export function compareGraphWorkFocusOrder(
  leftFocus: string | undefined,
  leftId: string,
  rightFocus: string | undefined,
  rightId: string
) {
  return (
    getGraphWorkFocusRank(leftFocus) - getGraphWorkFocusRank(rightFocus) ||
    leftId.localeCompare(rightId)
  );
}

export type AgentWorkReasonCode =
  | "blocked"
  | "checks-failing"
  | "closed"
  | "edit-applied"
  | "in-progress"
  | "live-activity"
  | "merge-preflight"
  | "pull-request"
  | "ready-confirmed"
  | "ready-not-confirmed"
  | "response-artifact"
  | "sync-risk"
  | "unknown-status";

export interface AgentWorkReason {
  code: AgentWorkReasonCode;
  message: string;
}

export interface AgentWorkItem {
  item: BeadItem;
  lane: AgentWorkLane;
  reason: string;
  reasons: AgentWorkReason[];
  readiness: AgentWorkReadiness;
}

export type AgentWorkLaneGroups = Record<AgentWorkLane, AgentWorkItem[]>;
export type AgentWorkLaneCounts = Record<AgentWorkLane, number>;

export interface AgentWorkQueue {
  lanes: AgentWorkLaneGroups;
  counts: AgentWorkLaneCounts;
  total: number;
}

const RISKY_SYNC_STATES = new Set(["blocked", "detached", "dirty", "high", "stale"]);
const FAILING_CHECK_STATES = new Set([
  "canceled",
  "cancelled",
  "error",
  "errored",
  "failed",
  "failing",
  "failure",
  "red",
  "timed_out",
  "timedout",
  "timeout"
]);

function normalizeSignal(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function getReadiness(item: BeadItem, normalizedStatus: string): AgentWorkReadiness {
  if (normalizedStatus !== "open" || item.synthetic) {
    return "not-applicable";
  }
  return item.readyByBd ? "confirmed" : "not-confirmed";
}

function makeDerivedItem(
  item: BeadItem,
  lane: AgentWorkLane,
  reasons: AgentWorkReason[],
  readiness: AgentWorkReadiness
): AgentWorkItem {
  return {
    item,
    lane,
    reason: reasons.map((entry) => entry.message).join("; "),
    reasons,
    readiness
  };
}

function getAgentWorkPriorityRank(entry: AgentWorkItem) {
  return Number.parseInt(normalizeBeadPriority(entry.item.priority).slice(1), 10);
}

function stableSortAgentWorkItems(
  entries: AgentWorkItem[],
  compare: (left: AgentWorkItem, right: AgentWorkItem) => number
) {
  return entries
    .map((entry, originalIndex) => ({ entry, originalIndex }))
    .sort(
      (left, right) => compare(left.entry, right.entry) || left.originalIndex - right.originalIndex
    )
    .map(({ entry }) => entry);
}

export function deriveAgentWorkItem(item: BeadItem): AgentWorkItem {
  const normalizedStatus = normalizeBeadStatus(item.status);
  const readiness = getReadiness(item, normalizedStatus);

  if (normalizedStatus === "closed") {
    return makeDerivedItem(
      item,
      "done",
      [{ code: "closed", message: "Status is closed" }],
      readiness
    );
  }

  const attentionReasons: AgentWorkReason[] = [];
  if (normalizedStatus === "blocked") {
    attentionReasons.push({ code: "blocked", message: "Status is blocked" });
  }

  const syncRisk = item.syncRisk.trim();
  if (RISKY_SYNC_STATES.has(normalizeSignal(syncRisk))) {
    attentionReasons.push({
      code: "sync-risk",
      message: `Sync risk is reported as "${syncRisk}"`
    });
  }

  const checkStatus = item.checkStatus.trim();
  if (FAILING_CHECK_STATES.has(normalizeSignal(checkStatus))) {
    attentionReasons.push({
      code: "checks-failing",
      message: `Checks are reported as "${checkStatus}"`
    });
  }

  if (normalizedStatus === "other") {
    attentionReasons.push({
      code: "unknown-status",
      message: `Status "${item.status.trim() || "(empty)"}" is not recognized`
    });
  }

  if (attentionReasons.length > 0) {
    return makeDerivedItem(item, "attention", attentionReasons, readiness);
  }

  if (item.liveExecution !== undefined) {
    return makeDerivedItem(
      item,
      "live",
      [
        {
          code: "live-activity",
          message: `The extension is awaiting provider responses from ${item.liveExecution.provider} / ${item.liveExecution.model}`
        }
      ],
      readiness
    );
  }

  if (normalizedStatus === "open" && item.syntheticKind === "parallel-pr-merge") {
    return makeDerivedItem(
      item,
      "queue",
      [
        {
          code: "merge-preflight",
          message: "Parallel tasks are closed; merge preflight is required"
        }
      ],
      readiness
    );
  }

  const pullRequest = item.pullRequest.trim();
  if (pullRequest !== "") {
    return makeDerivedItem(
      item,
      "review",
      [{ code: "pull-request", message: `Pull request "${pullRequest}" is recorded` }],
      readiness
    );
  }

  if (
    normalizedStatus === "in_progress" &&
    resolveAgentProviderId(item.provider) !== "copilot" &&
    normalizeSignal(item.providerStatus ?? "") === "edit_applied"
  ) {
    return makeDerivedItem(
      item,
      "review",
      [
        {
          code: "edit-applied",
          message:
            "The workspace edit was applied after human review; external validation is still pending"
        }
      ],
      readiness
    );
  }

  if (
    normalizedStatus === "in_progress" &&
    resolveAgentProviderId(item.provider) !== "copilot" &&
    item.artifact.trim() !== ""
  ) {
    return makeDerivedItem(
      item,
      "review",
      [
        {
          code: "response-artifact",
          message:
            "A direct-provider response artifact is ready for review; no live agent is implied"
        }
      ],
      readiness
    );
  }

  if (normalizedStatus === "in_progress") {
    return makeDerivedItem(
      item,
      "running",
      [
        {
          code: "in-progress",
          message: "Status is in progress; live agent activity is not confirmed"
        }
      ],
      readiness
    );
  }

  const queueReason: AgentWorkReason = item.readyByBd
    ? {
        code: "ready-confirmed",
        message: "Readiness is reported by bd ready"
      }
    : item.parallelizable
      ? {
          code: "ready-not-confirmed",
          message: "Marked parallelizable, but readiness is not confirmed by bd ready"
        }
      : {
          code: "ready-not-confirmed",
          message: "Status is open; readiness is not confirmed by bd ready"
        };

  return makeDerivedItem(item, "queue", [queueReason], readiness);
}

export function deriveGraphWorkFocus(item: BeadItem): GraphWorkFocus {
  if (item.liveExecution !== undefined) {
    return "live";
  }
  const workItem = deriveAgentWorkItem(item);
  if (workItem.lane === "running") {
    return "running";
  }
  if (workItem.lane === "queue" && workItem.readiness === "confirmed") {
    return "next-ready";
  }
  return "none";
}

export function buildAgentWorkQueue(items: BeadItem[]): AgentWorkQueue {
  const lanes: AgentWorkLaneGroups = {
    attention: [],
    live: [],
    review: [],
    running: [],
    queue: [],
    done: []
  };

  for (const item of items) {
    const derived = deriveAgentWorkItem(item);
    lanes[derived.lane].push(derived);
  }

  lanes.attention = stableSortAgentWorkItems(
    lanes.attention,
    (left, right) => getAgentWorkPriorityRank(left) - getAgentWorkPriorityRank(right)
  );
  lanes.queue = stableSortAgentWorkItems(
    lanes.queue,
    (left, right) =>
      Number(right.readiness === "confirmed") - Number(left.readiness === "confirmed") ||
      getAgentWorkPriorityRank(left) - getAgentWorkPriorityRank(right)
  );

  const counts: AgentWorkLaneCounts = {
    attention: lanes.attention.length,
    live: lanes.live.length,
    review: lanes.review.length,
    running: lanes.running.length,
    queue: lanes.queue.length,
    done: lanes.done.length
  };

  return { lanes, counts, total: items.length };
}
