import { normalizeAgentModelName } from "./agentModelSelection";
import { normalizeAgentOutputPath } from "./agentOutputPath";
import { type AgentProviderId, normalizeAgentProviderId } from "./agentProvider";

export const PLAN_DRAFT_VERSION = 1 as const;
export const PLAN_DRAFT_PRIORITIES = ["P0", "P1", "P2", "P3", "P4"] as const;

export type PlanDraftVersion = typeof PLAN_DRAFT_VERSION;
export type PlanDraftPriority = (typeof PLAN_DRAFT_PRIORITIES)[number];

export interface PlanDraftTask {
  id: string;
  title: string;
  priority: PlanDraftPriority;
  acceptanceCriteria: string[];
  dependencyIds: string[];
  ssot: string[];
  outputPath?: string;
  provider?: AgentProviderId;
  model?: string;
}

export interface PlanDraft {
  version: PlanDraftVersion;
  goal: string;
  tasks: PlanDraftTask[];
}

export type PlanDraftValidationCode =
  | "invalid-field"
  | "duplicate-task-id"
  | "duplicate-output-path"
  | "missing-dependency"
  | "self-dependency"
  | "cyclic-dependency";

export interface PlanDraftValidationError {
  code: PlanDraftValidationCode;
  path: string;
  message: string;
  taskId?: string;
}

export interface PlanDraftParseResult {
  draft: PlanDraft | null;
  errors: PlanDraftValidationError[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPriority(value: unknown): value is PlanDraftPriority {
  return typeof value === "string" && PLAN_DRAFT_PRIORITIES.includes(value as PlanDraftPriority);
}

function readString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: PlanDraftValidationError[],
  taskId?: string
): string | null {
  const value = record[key];
  if (typeof value === "string") {
    return value;
  }
  errors.push({
    code: "invalid-field",
    path,
    message: `${path} must be a string`,
    ...(taskId === undefined ? {} : { taskId })
  });
  return null;
}

function readStringArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: PlanDraftValidationError[],
  taskId?: string
): string[] | null {
  const value = record[key];
  if (!Array.isArray(value)) {
    errors.push({
      code: "invalid-field",
      path,
      message: `${path} must be an array of strings`,
      ...(taskId === undefined ? {} : { taskId })
    });
    return null;
  }

  const strings: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string") {
      const entryPath = `${path}[${index}]`;
      errors.push({
        code: "invalid-field",
        path: entryPath,
        message: `${entryPath} must be a string`,
        ...(taskId === undefined ? {} : { taskId })
      });
    } else {
      strings.push(entry);
    }
  }
  return strings.length === value.length ? strings : null;
}

function parseTask(
  value: unknown,
  index: number,
  errors: PlanDraftValidationError[]
): PlanDraftTask | null {
  const taskPath = `tasks[${index}]`;
  if (!isRecord(value)) {
    errors.push({
      code: "invalid-field",
      path: taskPath,
      message: `${taskPath} must be an object`
    });
    return null;
  }

  const id = readString(value, "id", `${taskPath}.id`, errors);
  const taskId = id ?? undefined;
  const title = readString(value, "title", `${taskPath}.title`, errors, taskId);
  const acceptanceCriteria = readStringArray(
    value,
    "acceptanceCriteria",
    `${taskPath}.acceptanceCriteria`,
    errors,
    taskId
  );
  const dependencyIds = readStringArray(
    value,
    "dependencyIds",
    `${taskPath}.dependencyIds`,
    errors,
    taskId
  );
  const ssot = readStringArray(value, "ssot", `${taskPath}.ssot`, errors, taskId);

  const priority = value.priority;
  if (!isPriority(priority)) {
    errors.push({
      code: "invalid-field",
      path: `${taskPath}.priority`,
      message: `${taskPath}.priority must be one of ${PLAN_DRAFT_PRIORITIES.join(", ")}`,
      ...(taskId === undefined ? {} : { taskId })
    });
  }

  const model = value.model;
  if (model !== undefined && typeof model !== "string") {
    errors.push({
      code: "invalid-field",
      path: `${taskPath}.model`,
      message: `${taskPath}.model must be a string when provided`,
      ...(taskId === undefined ? {} : { taskId })
    });
  }

  const outputPathValue = value.outputPath;
  const outputPath =
    outputPathValue === undefined ? undefined : normalizeAgentOutputPath(outputPathValue);
  if (outputPathValue !== undefined && outputPath === null) {
    errors.push({
      code: "invalid-field",
      path: `${taskPath}.outputPath`,
      message: `${taskPath}.outputPath must be a safe relative workspace file path when provided`,
      ...(taskId === undefined ? {} : { taskId })
    });
  }

  const providerValue = value.provider;
  const provider =
    providerValue === undefined ? undefined : normalizeAgentProviderId(providerValue);
  if (providerValue !== undefined && provider === null) {
    errors.push({
      code: "invalid-field",
      path: `${taskPath}.provider`,
      message: `${taskPath}.provider must be a known provider ID when provided`,
      ...(taskId === undefined ? {} : { taskId })
    });
  }

  if (
    id === null ||
    title === null ||
    !isPriority(priority) ||
    acceptanceCriteria === null ||
    dependencyIds === null ||
    ssot === null ||
    provider === null ||
    outputPath === null ||
    (model !== undefined && typeof model !== "string")
  ) {
    return null;
  }

  return {
    id,
    title,
    priority,
    acceptanceCriteria,
    dependencyIds,
    ssot,
    ...(outputPath === undefined ? {} : { outputPath }),
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model })
  };
}

function validateNonEmptyString(
  value: string,
  path: string,
  errors: PlanDraftValidationError[],
  taskId?: string
) {
  if (value.trim() !== "") {
    return;
  }
  errors.push({
    code: "invalid-field",
    path,
    message: `${path} must not be empty`,
    ...(taskId === undefined ? {} : { taskId })
  });
}

function validateStringList(
  values: string[],
  path: string,
  errors: PlanDraftValidationError[],
  taskId: string
) {
  for (const [index, value] of values.entries()) {
    validateNonEmptyString(value, `${path}[${index}]`, errors, taskId);
  }
}

function findCycleError(
  draft: PlanDraft,
  taskById: ReadonlyMap<string, PlanDraftTask>,
  indexById: ReadonlyMap<string, number>
): PlanDraftValidationError | null {
  const state = new Map<string, "visiting" | "visited">();

  const visit = (task: PlanDraftTask): PlanDraftValidationError | null => {
    state.set(task.id, "visiting");
    for (const [dependencyIndex, dependencyId] of task.dependencyIds.entries()) {
      const dependency = taskById.get(dependencyId);
      if (dependency === undefined) {
        continue;
      }
      if (state.get(dependencyId) === "visiting") {
        const taskIndex = indexById.get(task.id);
        if (taskIndex === undefined) {
          return null;
        }
        const path = `tasks[${taskIndex}].dependencyIds[${dependencyIndex}]`;
        return {
          code: "cyclic-dependency",
          path,
          taskId: task.id,
          message: `${path} creates a dependency cycle through "${dependencyId}"`
        };
      }
      if (state.get(dependencyId) !== "visited") {
        const error = visit(dependency);
        if (error !== null) {
          return error;
        }
      }
    }
    state.set(task.id, "visited");
    return null;
  };

  for (const task of draft.tasks) {
    if (state.has(task.id)) {
      continue;
    }
    const error = visit(task);
    if (error !== null) {
      return error;
    }
  }
  return null;
}

export function validatePlanDraft(draft: PlanDraft): PlanDraftValidationError[] {
  const errors: PlanDraftValidationError[] = [];
  validateNonEmptyString(draft.goal, "goal", errors);

  const taskById = new Map<string, PlanDraftTask>();
  const taskIdByOutputPath = new Map<string, string>();
  const indexById = new Map<string, number>();
  let canCheckCycles = true;

  for (const [index, task] of draft.tasks.entries()) {
    const taskPath = `tasks[${index}]`;
    validateNonEmptyString(task.id, `${taskPath}.id`, errors, task.id);
    validateNonEmptyString(task.title, `${taskPath}.title`, errors, task.id);
    validateStringList(task.acceptanceCriteria, `${taskPath}.acceptanceCriteria`, errors, task.id);
    validateStringList(task.ssot, `${taskPath}.ssot`, errors, task.id);
    if (task.outputPath !== undefined) {
      const outputPath = normalizeAgentOutputPath(task.outputPath);
      if (outputPath === null) {
        errors.push({
          code: "invalid-field",
          path: `${taskPath}.outputPath`,
          taskId: task.id,
          message: `${taskPath}.outputPath must be a safe relative workspace file path`
        });
      } else {
        const outputPathKey = outputPath.toLowerCase();
        const existingTaskId = taskIdByOutputPath.get(outputPathKey);
        if (existingTaskId !== undefined) {
          errors.push({
            code: "duplicate-output-path",
            path: `${taskPath}.outputPath`,
            taskId: task.id,
            message: `${taskPath}.outputPath duplicates output from task "${existingTaskId}"`
          });
        } else {
          taskIdByOutputPath.set(outputPathKey, task.id);
        }
      }
    }
    if (task.provider !== undefined && normalizeAgentProviderId(task.provider) === null) {
      errors.push({
        code: "invalid-field",
        path: `${taskPath}.provider`,
        taskId: task.id,
        message: `${taskPath}.provider must be a known provider ID`
      });
    }
    if (task.model !== undefined && normalizeAgentModelName(task.model) === null) {
      errors.push({
        code: "invalid-field",
        path: `${taskPath}.model`,
        taskId: task.id,
        message: `${taskPath}.model must be a one-line model name between 1 and 100 characters`
      });
    }

    if (taskById.has(task.id)) {
      errors.push({
        code: "duplicate-task-id",
        path: `${taskPath}.id`,
        taskId: task.id,
        message: `${taskPath}.id duplicates task ID "${task.id}"`
      });
      canCheckCycles = false;
    } else {
      taskById.set(task.id, task);
      indexById.set(task.id, index);
    }
  }

  for (const [taskIndex, task] of draft.tasks.entries()) {
    for (const [dependencyIndex, dependencyId] of task.dependencyIds.entries()) {
      const path = `tasks[${taskIndex}].dependencyIds[${dependencyIndex}]`;
      validateNonEmptyString(dependencyId, path, errors, task.id);
      if (dependencyId === task.id) {
        errors.push({
          code: "self-dependency",
          path,
          taskId: task.id,
          message: `${path} cannot reference its own task "${task.id}"`
        });
        canCheckCycles = false;
      } else if (!taskById.has(dependencyId)) {
        errors.push({
          code: "missing-dependency",
          path,
          taskId: task.id,
          message: `${path} references missing task "${dependencyId}"`
        });
        canCheckCycles = false;
      }
    }
  }

  if (canCheckCycles) {
    const cycleError = findCycleError(draft, taskById, indexById);
    if (cycleError !== null) {
      errors.push(cycleError);
    }
  }

  return errors;
}

export function parsePlanDraft(value: unknown): PlanDraftParseResult {
  const errors: PlanDraftValidationError[] = [];
  if (!isRecord(value)) {
    return {
      draft: null,
      errors: [
        {
          code: "invalid-field",
          path: "",
          message: "Plan Draft must be an object"
        }
      ]
    };
  }

  if (value.version !== PLAN_DRAFT_VERSION) {
    errors.push({
      code: "invalid-field",
      path: "version",
      message: `version must be ${PLAN_DRAFT_VERSION}`
    });
  }

  const goal = readString(value, "goal", "goal", errors);
  const tasksValue = value.tasks;
  if (!Array.isArray(tasksValue)) {
    errors.push({
      code: "invalid-field",
      path: "tasks",
      message: "tasks must be an array"
    });
  }

  const tasks = Array.isArray(tasksValue)
    ? tasksValue.map((task, index) => parseTask(task, index, errors))
    : [];

  if (
    value.version !== PLAN_DRAFT_VERSION ||
    goal === null ||
    !Array.isArray(tasksValue) ||
    tasks.some((task) => task === null)
  ) {
    return { draft: null, errors };
  }

  const draft: PlanDraft = {
    version: PLAN_DRAFT_VERSION,
    goal,
    tasks: tasks.filter((task): task is PlanDraftTask => task !== null)
  };
  errors.push(...validatePlanDraft(draft));
  return { draft, errors };
}
