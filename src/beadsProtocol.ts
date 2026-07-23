import { normalizeAgentModelName } from "./agentModelSelection";

export type BeadsRequestMessage =
  | { command: "refresh" }
  | { command: "openGitGraph" }
  | { command: "syncAllBeads" }
  | { command: "syncBeads"; workspacePath: string }
  | { command: "importPlanDraft"; workspacePath: string; draftText: string }
  | { command: "openGitGraphForCommit"; commitHash: string }
  | { command: "createBead"; workspacePath: string }
  | { command: "closeBead"; issueId: string; workspacePath: string; title?: string }
  | {
      command: "assignStartBead";
      issueId: string;
      workspacePath: string;
      title?: string;
      agent?: string;
      model?: string;
      ssot?: string;
      worktree?: string;
    }
  | {
      command: "startParallelBeads";
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
    };

export interface BeadsExecutionTarget {
  issueId: string;
  title?: string;
  model?: string;
  ssot?: string;
  worktree?: string;
}

export interface BeadsExecutionSkip {
  issueId: string;
  title?: string;
  reason: string;
}

function isOptionalAgentModel(value: unknown) {
  return (
    typeof value === "undefined" ||
    (typeof value === "string" && (value.trim() === "" || normalizeAgentModelName(value) !== null))
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
  switch (record.command) {
    case "refresh":
    case "openGitGraph":
    case "syncAllBeads":
      return true;
    case "syncBeads":
    case "createBead":
      return typeof record.workspacePath === "string";
    case "importPlanDraft":
      return typeof record.workspacePath === "string" && typeof record.draftText === "string";
    case "startParallelBeads":
      return (
        typeof record.workspacePath === "string" &&
        Array.isArray(record.items) &&
        record.items.every(isBeadsExecutionTarget) &&
        (typeof record.skipped === "undefined" ||
          (Array.isArray(record.skipped) && record.skipped.every(isBeadsExecutionSkip)))
      );
    case "openGitGraphForCommit":
      return typeof record.commitHash === "string";
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
            isOptionalAgentModel(record.model) &&
            (typeof record.ssot === "string" || typeof record.ssot === "undefined") &&
            (typeof record.worktree === "string" || typeof record.worktree === "undefined")))
      );
    default:
      return false;
  }
}
