export interface BeadRowVisibilityState<Status extends string = string> {
  id: string;
  epicId: string;
  status: Status;
}

export function isCollapsedByEpic(
  row: BeadRowVisibilityState,
  collapsedEpicIds: ReadonlySet<string>
) {
  return row.epicId !== "" && row.id !== row.epicId && collapsedEpicIds.has(row.epicId);
}

export function shouldShowBeadRow<Status extends string>(
  row: BeadRowVisibilityState<Status>,
  activeStatuses: ReadonlySet<Status>,
  collapsedEpicIds: ReadonlySet<string>
) {
  return activeStatuses.has(row.status) && !isCollapsedByEpic(row, collapsedEpicIds);
}
