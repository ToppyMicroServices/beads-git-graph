export function buildAgentBeadUpdateArgs(values: {
  issueId: string;
  assignee: string;
  notes: readonly string[];
  metadata: readonly string[];
}) {
  return [
    "update",
    values.issueId,
    "--assignee",
    values.assignee,
    "--status",
    "in_progress",
    "--append-notes",
    values.notes.join("\n"),
    ...values.metadata.flatMap((entry) => ["--set-metadata", entry])
  ];
}
