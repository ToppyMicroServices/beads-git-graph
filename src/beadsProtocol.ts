export type BeadsRequestMessage =
  | { command: "refresh" }
  | { command: "openGitGraph" }
  | { command: "syncAllBeads" }
  | { command: "syncBeads"; workspacePath: string }
  | { command: "openGitGraphForCommit"; commitHash: string }
  | { command: "createBead"; workspacePath: string }
  | { command: "closeBead"; issueId: string; workspacePath: string; title?: string }
  | {
      command: "assignStartBead";
      issueId: string;
      workspacePath: string;
      title?: string;
      agent?: string;
    };

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
    case "openGitGraphForCommit":
      return typeof record.commitHash === "string";
    case "closeBead":
    case "assignStartBead":
      return (
        typeof record.issueId === "string" &&
        typeof record.workspacePath === "string" &&
        (typeof record.title === "string" || typeof record.title === "undefined") &&
        (record.command !== "assignStartBead" ||
          typeof record.agent === "string" ||
          typeof record.agent === "undefined")
      );
    default:
      return false;
  }
}
