export interface GraphFilterItem {
  issueId: string;
  status: string;
  workspacePath: string;
}

export function collectStatusVisibleGraphIds(
  items: readonly GraphFilterItem[],
  activeStatuses: ReadonlySet<string>
) {
  const idsByWorkspace = new Map<string, Set<string>>();
  for (const item of items) {
    if (item.issueId === "" || !activeStatuses.has(item.status)) {
      continue;
    }
    const ids = idsByWorkspace.get(item.workspacePath) ?? new Set<string>();
    ids.add(item.issueId);
    idsByWorkspace.set(item.workspacePath, ids);
  }
  return idsByWorkspace;
}
