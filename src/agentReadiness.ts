export interface ReadyExecutionTarget {
  issueId: string;
  title?: string;
}

export interface RevalidatedExecutionTargets<T extends ReadyExecutionTarget> {
  ready: T[];
  noLongerReady: Array<{ issueId: string; title?: string; reason: string }>;
}

export function revalidateExecutionTargets<T extends ReadyExecutionTarget>(
  items: readonly T[],
  readyItemIds: ReadonlySet<string>
): RevalidatedExecutionTargets<T> {
  const uniqueItems = [
    ...new Map(
      items
        .map((item) => ({ item, issueId: item.issueId.trim() }))
        .filter(({ issueId }) => issueId !== "")
        .map(({ item, issueId }) => [issueId, { ...item, issueId }] as const)
    ).values()
  ];

  return {
    ready: uniqueItems.filter((item) => readyItemIds.has(item.issueId)),
    noLongerReady: uniqueItems
      .filter((item) => !readyItemIds.has(item.issueId))
      .map((item) => ({
        issueId: item.issueId,
        title: item.title,
        reason: "no longer reported ready by bd"
      }))
  };
}
