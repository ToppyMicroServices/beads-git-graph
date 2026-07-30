import { type RequestMessage } from "./types";
import { isGitMutationCommand } from "./workspaceTrust";

const commitHashPattern = /^[0-9a-f]{4,64}$/i;

function hasProhibitedRefCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 32 || code === 127 || "~^:?*[\\".includes(character);
  });
}

export function isSafeGitRefArgument(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1024 &&
    !value.startsWith("-") &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.endsWith(".") &&
    !value.endsWith(".lock") &&
    !value.includes("..") &&
    !value.includes("@{") &&
    !value.includes("//") &&
    !value.includes("/.") &&
    !hasProhibitedRefCharacter(value)
  );
}

function hasSafeCommitHash(value: unknown) {
  return typeof value === "string" && commitHashPattern.test(value);
}

export function getGitMutationInputError(message: RequestMessage): string | null {
  if (!isGitMutationCommand(message.command)) {
    return null;
  }

  switch (message.command) {
    case "addTag":
      return isSafeGitRefArgument(message.tagName) && hasSafeCommitHash(message.commitHash)
        ? null
        : "Invalid Git tag or commit identifier.";
    case "checkoutBranch":
      return isSafeGitRefArgument(message.branchName) &&
        (message.remoteBranch === null || isSafeGitRefArgument(message.remoteBranch))
        ? null
        : "Invalid Git branch identifier.";
    case "checkoutCommit":
    case "cherrypickCommit":
    case "mergeCommit":
    case "resetFileToRevision":
    case "resetToCommit":
    case "revertCommit":
      return hasSafeCommitHash(message.commitHash) ? null : "Invalid Git commit identifier.";
    case "createBranch":
      return isSafeGitRefArgument(message.branchName) && hasSafeCommitHash(message.commitHash)
        ? null
        : "Invalid Git branch or commit identifier.";
    case "deleteBranch":
      return isSafeGitRefArgument(message.branchName) ? null : "Invalid Git branch identifier.";
    case "deleteTag":
      return isSafeGitRefArgument(message.tagName) ? null : "Invalid Git tag identifier.";
    case "mergeBranch":
      return isSafeGitRefArgument(message.branchName) ? null : "Invalid Git branch identifier.";
    case "pushTag":
      return isSafeGitRefArgument(message.tagName) &&
        (message.remoteName === null || isSafeGitRefArgument(message.remoteName))
        ? null
        : "Invalid Git tag or remote identifier.";
    case "renameBranch":
      return isSafeGitRefArgument(message.oldName) && isSafeGitRefArgument(message.newName)
        ? null
        : "Invalid Git branch identifier.";
  }
  return null;
}
