import { type PlanDraft } from "./planDraft";

export interface CreatedTaskReference {
  createdTaskId: string;
}

export type PlanMutationArgument = string | CreatedTaskReference;
export type PlanMutationKind = "create" | "update" | "dependency";

export interface PlanMutation {
  kind: PlanMutationKind;
  taskId: string;
  args: PlanMutationArgument[];
}

export interface CompletedPlanMutation {
  mutation: PlanMutation;
  resolvedArgs: string[];
}

export interface FailedPlanMutation {
  mutation: PlanMutation;
  resolvedArgs: string[];
  error: string;
}

export interface PlanImportResult {
  createdIds: Array<{ taskId: string; issueId: string }>;
  completed: CompletedPlanMutation[];
  failed: FailedPlanMutation | null;
  unexecuted: PlanMutation[];
}

export type PlanMutationRunner = (args: readonly string[]) => Promise<string>;

function createdTaskId(taskId: string): CreatedTaskReference {
  return { createdTaskId: taskId };
}

export function projectPlanDraftMutations(draft: PlanDraft): PlanMutation[] {
  const creates: PlanMutation[] = draft.tasks.map((task) => ({
    kind: "create",
    taskId: task.id,
    args: [
      "create",
      "--title",
      task.title,
      "--priority",
      task.priority,
      "--type",
      "task",
      "--silent"
    ]
  }));
  const updates: PlanMutation[] = draft.tasks.map((task) => {
    const args: PlanMutationArgument[] = [
      "update",
      createdTaskId(task.id),
      "--acceptance",
      task.acceptanceCriteria.join("\n"),
      "--set-metadata",
      `plan_goal=${draft.goal}`,
      "--set-metadata",
      `plan_draft_version=${draft.version}`
    ];
    if (task.provider !== undefined) {
      args.push("--set-metadata", `provider=${task.provider}`);
    }
    if (task.model !== undefined) {
      args.push("--set-metadata", `model=${task.model}`);
    }
    if (task.ssot.length > 0) {
      args.push("--set-metadata", `ssot=${task.ssot.join(", ")}`);
    }
    return { kind: "update", taskId: task.id, args };
  });
  const dependencies: PlanMutation[] = draft.tasks.flatMap((task) =>
    task.dependencyIds.map((dependencyId) => ({
      kind: "dependency",
      taskId: task.id,
      args: ["dep", "add", createdTaskId(task.id), createdTaskId(dependencyId)]
    }))
  );

  return [...creates, ...updates, ...dependencies];
}

export function formatPlanMutationArgument(argument: PlanMutationArgument) {
  if (typeof argument !== "string") {
    return `<created:${argument.createdTaskId}>`;
  }
  return /^[A-Za-z0-9_./:=@+-]+$/.test(argument) ? argument : JSON.stringify(argument);
}

export function formatPlanMutation(mutation: PlanMutation) {
  return `bd ${mutation.args.map(formatPlanMutationArgument).join(" ")}`;
}

function parseCreatedIssueId(stdout: string) {
  const trimmed = stdout.trim();
  if (trimmed === "") {
    throw new Error("Beads create returned no issue ID.");
  }
  try {
    const parsed = JSON.parse(trimmed) as { id?: unknown };
    if (typeof parsed.id === "string" && parsed.id.trim() !== "") {
      return parsed.id.trim();
    }
  } catch {}
  const lines = trimmed.split(/\r?\n/);
  let issueId: string | undefined;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = lines[index].trim();
    if (candidate !== "") {
      issueId = candidate;
      break;
    }
  }
  if (issueId === undefined || /\s/.test(issueId)) {
    throw new Error("Beads create returned an invalid issue ID.");
  }
  return issueId;
}

function resolveMutationArguments(mutation: PlanMutation, createdIds: ReadonlyMap<string, string>) {
  return mutation.args.map((argument) => {
    if (typeof argument === "string") {
      return argument;
    }
    const issueId = createdIds.get(argument.createdTaskId);
    if (issueId === undefined) {
      throw new Error(`No created Beads ID exists for Plan task "${argument.createdTaskId}".`);
    }
    return issueId;
  });
}

export async function executePlanImport(
  mutations: readonly PlanMutation[],
  run: PlanMutationRunner
): Promise<PlanImportResult> {
  const createdIdByTask = new Map<string, string>();
  const createdIds: Array<{ taskId: string; issueId: string }> = [];
  const completed: CompletedPlanMutation[] = [];

  for (let index = 0; index < mutations.length; index += 1) {
    const mutation = mutations[index];
    let resolvedArgs: string[] = [];
    try {
      resolvedArgs = resolveMutationArguments(mutation, createdIdByTask);
      const stdout = await run(resolvedArgs);
      if (mutation.kind === "create") {
        const issueId = parseCreatedIssueId(stdout);
        createdIdByTask.set(mutation.taskId, issueId);
        createdIds.push({ taskId: mutation.taskId, issueId });
      }
      completed.push({ mutation, resolvedArgs });
    } catch (error) {
      return {
        createdIds,
        completed,
        failed: {
          mutation,
          resolvedArgs,
          error: error instanceof Error ? error.message : "The Beads mutation failed."
        },
        unexecuted: mutations.slice(index + 1)
      };
    }
  }

  return { createdIds, completed, failed: null, unexecuted: [] };
}
