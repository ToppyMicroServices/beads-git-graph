export const DEFAULT_ACTIVE_STATUSES = ["open", "in_progress", "blocked", "other"] as const;

export function getDetailsReadinessLabel(item: {
  normalizedStatus: string;
  readyByBd: boolean;
  synthetic: boolean;
}) {
  if (item.synthetic || item.normalizedStatus !== "open") {
    return "N/A";
  }
  return item.readyByBd ? "Confirmed by bd ready" : "Not confirmed";
}

export function getScopedBeadKey(workspacePath: string, issueId: string) {
  return `${workspacePath}\u0000${issueId}`;
}

export function normalizeScopedBeadKeys(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (candidate): candidate is string =>
          typeof candidate === "string" &&
          candidate.indexOf("\u0000") > 0 &&
          candidate.indexOf("\u0000") < candidate.length - 1
      )
    : [];
}

export interface BeadRowVisibilityState<Status extends string = string> {
  workspacePath: string;
  id: string;
  epicId: string;
  status: Status;
}

export function isCollapsedByEpic(
  row: BeadRowVisibilityState,
  collapsedEpicIds: ReadonlySet<string>
) {
  return (
    row.epicId !== "" &&
    row.id !== row.epicId &&
    collapsedEpicIds.has(getScopedBeadKey(row.workspacePath, row.epicId))
  );
}

export function shouldShowBeadRow<Status extends string>(
  row: BeadRowVisibilityState<Status>,
  activeStatuses: ReadonlySet<Status>,
  collapsedEpicIds: ReadonlySet<string>
) {
  return activeStatuses.has(row.status) && !isCollapsedByEpic(row, collapsedEpicIds);
}
