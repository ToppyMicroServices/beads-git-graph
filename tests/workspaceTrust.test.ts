import { describe, expect, it } from "vitest";

import { getGitMutationInputError, isSafeGitRefArgument } from "../src/gitInputSafety";
import { type RequestMessage } from "../src/types";
import { isGitMutationCommand } from "../src/workspaceTrust";

describe("workspace trust boundary", () => {
  it.each([
    "addTag",
    "checkoutBranch",
    "checkoutCommit",
    "cherrypickCommit",
    "createBranch",
    "deleteBranch",
    "deleteTag",
    "mergeBranch",
    "mergeCommit",
    "pushTag",
    "refreshGraph",
    "renameBranch",
    "resetFileToRevision",
    "resetToCommit",
    "revertCommit"
  ])("classifies %s as a Git mutation", (command) => {
    expect(isGitMutationCommand(command)).toBe(true);
  });

  it.each(["loadRepos", "loadBranches", "loadCommits", "commitDetails", "viewDiff", "openFile"])(
    "keeps %s available as a read-only action",
    (command) => {
      expect(isGitMutationCommand(command)).toBe(false);
    }
  );

  it("rejects ref arguments that Git could interpret as options", () => {
    expect(isSafeGitRefArgument("feature/secure-boundary")).toBe(true);
    expect(isSafeGitRefArgument("release-1.2.3")).toBe(true);
    expect(isSafeGitRefArgument("--upload-pack=sentinel")).toBe(false);
    expect(isSafeGitRefArgument("refs/../escape")).toBe(false);
    expect(isSafeGitRefArgument("topic@{upstream}")).toBe(false);
    expect(isSafeGitRefArgument("topic lock")).toBe(false);
  });

  it("validates mutable Git inputs before dispatch", () => {
    const valid = {
      command: "createBranch",
      repo: "/workspace",
      branchName: "feature/secure-boundary",
      commitHash: "0123456789abcdef"
    } satisfies RequestMessage;
    const unsafe = {
      ...valid,
      branchName: "--force"
    } satisfies RequestMessage;

    expect(getGitMutationInputError(valid)).toBeNull();
    expect(getGitMutationInputError(unsafe)).toBe("Invalid Git branch or commit identifier.");
  });
});
