const GIT_MUTATION_COMMANDS = new Set([
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
  "renameBranch",
  "resetFileToRevision",
  "resetToCommit",
  "revertCommit"
]);

export function isGitMutationCommand(command: string) {
  return GIT_MUTATION_COMMANDS.has(command);
}
