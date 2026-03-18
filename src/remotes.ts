export function getRemoteNameFromBranchOption(branchName: string) {
  if (!branchName.startsWith("remotes/")) return null;

  const normalized = branchName.substring(8);
  const separatorIndex = normalized.indexOf("/");
  return separatorIndex === -1 ? null : normalized.substring(0, separatorIndex);
}

export function filterBranchesForRemote(branches: string[], selectedRemote: string | null) {
  return branches.filter((branchName) => {
    const remoteName = getRemoteNameFromBranchOption(branchName);
    return remoteName === null || selectedRemote === null || remoteName === selectedRemote;
  });
}

export function getPreferredRemote(
  remotes: string[],
  ...candidates: Array<string | null | undefined>
) {
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (typeof candidate === "string" && remotes.indexOf(candidate) > -1) {
      return candidate;
    }
  }

  if (remotes.indexOf("origin") > -1) {
    return "origin";
  }

  return remotes.length > 0 ? remotes[0] : null;
}

export function getPreferredMainBranch(branches: string[], selectedRemote: string | null) {
  const localCandidates = ["main", "master"];
  for (let i = 0; i < localCandidates.length; i++) {
    if (branches.indexOf(localCandidates[i]) > -1) return localCandidates[i];
  }

  const remoteCandidates =
    selectedRemote === null
      ? []
      : [
          `remotes/${selectedRemote}/main`,
          `${selectedRemote}/main`,
          `remotes/${selectedRemote}/master`,
          `${selectedRemote}/master`
        ];
  for (let i = 0; i < remoteCandidates.length; i++) {
    if (branches.indexOf(remoteCandidates[i]) > -1) return remoteCandidates[i];
  }

  for (let i = 0; i < branches.length; i++) {
    if (branches[i].startsWith("remotes/") && branches[i].endsWith("/main")) {
      return branches[i];
    }
  }
  for (let i = 0; i < branches.length; i++) {
    if (branches[i].startsWith("remotes/") && branches[i].endsWith("/master")) {
      return branches[i];
    }
  }

  return null;
}
