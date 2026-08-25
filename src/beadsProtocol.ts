import { normalizeAgentModelName } from "./agentModelSelection";
import { type AgentProviderId, normalizeAgentProviderId } from "./agentProvider";

export type BeadsRequestMessage = (
  | { command: "refresh" }
  | { command: "openGitGraph" }
  | { command: "syncAllBeads" }
  | { command: "syncBeads"; workspacePath: string }
  | {
      command: "generatePlanDraft";
      requestId: string;
      workspacePath: string;
      goal: string;
    }
  | { command: "importPlanDraft"; workspacePath: string; draftText: string }
  | { command: "openGitGraphForCommit"; commitHash: string }
  | { command: "openAgentArtifact"; artifactUri: string }
  | { command: "createBead"; workspacePath: string }
  | { command: "closeBead"; issueId: string; workspacePath: string; title?: string }
  | {
      command: "assignStartBead";
      issueId: string;
      workspacePath: string;
      title?: string;
      agent?: string;
      provider?: AgentProviderId;
      model?: string;
      ssot?: string;
      worktree?: string;
    }
  | {
      command: "startParallelBeads";
      requestId?: string;
      workspacePath: string;
      items: BeadsExecutionTarget[];
      skipped?: BeadsExecutionSkip[];
    }
  | {
      command: "mergeParallelPrs";
      issueId: string;
      workspacePath: string;
      title?: string;
      dependencies: BeadsExecutionTarget[];
    }
) & { clientActionId?: string };

export interface BeadsExecutionTarget {
  issueId: string;
  title?: string;
  provider?: AgentProviderId;
  model?: string;
  ssot?: string;
  worktree?: string;
}

export interface BeadsExecutionSkip {
  issueId: string;
  title?: string;
  reason: string;
}

export type ParallelExecutionOutcomeStatus =
  | "edit-applied"
  | "response-ready"
  | "session-started"
  | "prompt-prepared"
  | "failed"
  | "skipped"
  | "cancelled";

export interface ParallelExecutionOutcome extends BeadsExecutionTarget {
  status: ParallelExecutionOutcomeStatus;
  message: string;
}

export type BeadsHostMessage =
  | {
      command: "actionSettled";
      clientActionId: string;
    }
  | {
      command: "beadsRenderUpdate";
      generation: number;
      html: string;
    }
  | {
      command: "planDraftGenerationResult";
      requestId: string;
      status: "generated";
      draftText: string;
      provider: AgentProviderId;
      requestedModel: string;
      confirmedModel: string;
      artifactUri: string;
      validationErrorCount: number;
    }
  | {
      command: "planDraftGenerationResult";
      requestId: string;
      status: "cancelled" | "error";
      message: string;
      artifactUri?: string;
    }
  | {
      command: "parallelExecutionResult";
      requestId?: string;
      workspacePath: string;
      completedAt: string;
      outcomes: ParallelExecutionOutcome[];
    };

const MAX_PLAN_GOAL_LENGTH = 4_000;
const MAX_PLAN_DRAFT_REPLY_LENGTH = 256 * 1024;
export const MAX_BEADS_RENDER_UPDATE_LENGTH = 5 * 1024 * 1024;

function isBoundedOneLine(value: unknown, maxLength: number) {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= maxLength &&
    !value.includes("\u0000") &&
    !/[\r\n]/.test(value)
  );
}

function isPlanGoal(value: unknown) {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= MAX_PLAN_GOAL_LENGTH &&
    !value.includes("\u0000")
  );
}

function isOptionalAgentModel(value: unknown) {
  return (
    typeof value === "undefined" ||
    (typeof value === "string" && (value.trim() === "" || normalizeAgentModelName(value) !== null))
  );
}

function isOptionalAgentProvider(value: unknown) {
  return (
    typeof value === "undefined" ||
    (typeof value === "string" && (value.trim() === "" || normalizeAgentProviderId(value) !== null))
  );
}

function isBoundedArtifactUri(value: unknown) {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= 2048 &&
    !value.includes("\u0000") &&
    !/[\r\n]/.test(value)
  );
}

function isBeadsExecutionTarget(value: unknown): value is BeadsExecutionTarget {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.issueId === "string" &&
    (typeof record.title === "string" || typeof record.title === "undefined") &&
    isOptionalAgentProvider(record.provider) &&
    isOptionalAgentModel(record.model) &&
    (typeof record.ssot === "string" || typeof record.ssot === "undefined") &&
    (typeof record.worktree === "string" || typeof record.worktree === "undefined")
  );
}

function isBeadsExecutionSkip(value: unknown): value is BeadsExecutionSkip {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.issueId === "string" &&
    typeof record.reason === "string" &&
    (typeof record.title === "string" || typeof record.title === "undefined")
  );
}

export function isBeadsRequestMessage(message: unknown): message is BeadsRequestMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const record = message as Record<string, unknown>;
  if (record.clientActionId !== undefined && !isBoundedOneLine(record.clientActionId, 100)) {
    return false;
  }
  switch (record.command) {
    case "refresh":
    case "openGitGraph":
    case "syncAllBeads":
      return true;
    case "syncBeads":
    case "createBead":
      return typeof record.workspacePath === "string";
    case "generatePlanDraft":
      return (
        isBoundedOneLine(record.requestId, 100) &&
        typeof record.workspacePath === "string" &&
        isPlanGoal(record.goal)
      );
    case "importPlanDraft":
      return typeof record.workspacePath === "string" && typeof record.draftText === "string";
    case "startParallelBeads":
      return (
        typeof record.workspacePath === "string" &&
        (typeof record.requestId === "undefined" || isBoundedOneLine(record.requestId, 100)) &&
        Array.isArray(record.items) &&
        record.items.every(isBeadsExecutionTarget) &&
        (typeof record.skipped === "undefined" ||
          (Array.isArray(record.skipped) && record.skipped.every(isBeadsExecutionSkip)))
      );
    case "openGitGraphForCommit":
      return typeof record.commitHash === "string";
    case "openAgentArtifact":
      return isBoundedArtifactUri(record.artifactUri);
    case "mergeParallelPrs":
      return (
        typeof record.issueId === "string" &&
        typeof record.workspacePath === "string" &&
        (typeof record.title === "string" || typeof record.title === "undefined") &&
        Array.isArray(record.dependencies) &&
        record.dependencies.every(isBeadsExecutionTarget)
      );
    case "closeBead":
    case "assignStartBead":
      return (
        typeof record.issueId === "string" &&
        typeof record.workspacePath === "string" &&
        (typeof record.title === "string" || typeof record.title === "undefined") &&
        (record.command !== "assignStartBead" ||
          ((typeof record.agent === "string" || typeof record.agent === "undefined") &&
            isOptionalAgentProvider(record.provider) &&
            isOptionalAgentModel(record.model) &&
            (typeof record.ssot === "string" || typeof record.ssot === "undefined") &&
            (typeof record.worktree === "string" || typeof record.worktree === "undefined")))
      );
    default:
      return false;
  }
}

function isParallelExecutionOutcome(value: unknown): value is ParallelExecutionOutcome {
  if (!isBeadsExecutionTarget(value)) {
    return false;
  }
  const record = value as unknown as Record<string, unknown>;
  return (
    typeof record.message === "string" &&
    record.message.length <= 2_000 &&
    [
      "edit-applied",
      "response-ready",
      "session-started",
      "prompt-prepared",
      "failed",
      "skipped",
      "cancelled"
    ].includes(String(record.status))
  );
}

export function isBeadsHostMessage(message: unknown): message is BeadsHostMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const record = message as Record<string, unknown>;
  if (record.command === "actionSettled") {
    return isBoundedOneLine(record.clientActionId, 100);
  }
  if (record.command === "beadsRenderUpdate") {
    return (
      Number.isInteger(record.generation) &&
      Number(record.generation) > 0 &&
      typeof record.html === "string" &&
      record.html.length <= MAX_BEADS_RENDER_UPDATE_LENGTH
    );
  }
  if (record.command === "planDraftGenerationResult") {
    if (!isBoundedOneLine(record.requestId, 100)) {
      return false;
    }
    if (record.status === "generated") {
      return (
        typeof record.draftText === "string" &&
        record.draftText.length <= MAX_PLAN_DRAFT_REPLY_LENGTH &&
        normalizeAgentProviderId(record.provider) !== null &&
        normalizeAgentModelName(record.requestedModel) !== null &&
        isBoundedOneLine(record.confirmedModel, 200) &&
        isBoundedArtifactUri(record.artifactUri) &&
        Number.isInteger(record.validationErrorCount) &&
        Number(record.validationErrorCount) >= 0 &&
        Number(record.validationErrorCount) <= 100
      );
    }
    return (
      (record.status === "cancelled" || record.status === "error") &&
      typeof record.message === "string" &&
      record.message.length <= 2_000 &&
      (record.artifactUri === undefined || isBoundedArtifactUri(record.artifactUri))
    );
  }
  if (record.command === "parallelExecutionResult") {
    return (
      (record.requestId === undefined || isBoundedOneLine(record.requestId, 100)) &&
      typeof record.workspacePath === "string" &&
      typeof record.completedAt === "string" &&
      Array.isArray(record.outcomes) &&
      record.outcomes.every(isParallelExecutionOutcome)
    );
  }
  return false;
}
