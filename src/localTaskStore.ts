import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import * as path from "node:path";

import { type BeadItem, extractBeadItems, inferReadyParallelizableItems } from "./beadsData";
import { parsePlanDraft, type PlanDraft } from "./planDraft";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TASKS = 10_000;
const MAX_TEXT = 64_000;
const STATUSES = new Set(["open", "in_progress", "blocked", "closed"]);
const TYPES = new Set(["task", "feature", "bug", "epic", "chore"]);

interface LocalTask {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  description: string;
  notes: string;
  assignee: string;
  acceptance_criteria: string;
  created_at: string;
  updated_at: string;
  dependencyIds: string[];
  metadata: Record<string, string>;
}

interface LocalTaskDocument {
  version: 1;
  tasks: LocalTask[];
}

function newTask(title: string, type: string, priority: string): LocalTask {
  const now = new Date().toISOString();
  return {
    id: `task-${randomUUID()}`,
    title,
    type,
    priority,
    status: "open",
    description: "",
    notes: "",
    assignee: "",
    acceptance_criteria: "",
    created_at: now,
    updated_at: now,
    dependencyIds: [],
    metadata: {}
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_TEXT && !value.includes("\0");
}

function validateDocument(value: unknown): LocalTaskDocument {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("Unsupported or corrupt local task store version; the file was not changed.");
  }
  if (!Array.isArray(value.tasks) || value.tasks.length > MAX_TASKS) {
    throw new Error("Invalid local task collection; the file was not changed.");
  }
  const ids = new Set<string>();
  const textFields = [
    "id",
    "title",
    "type",
    "status",
    "priority",
    "description",
    "notes",
    "assignee",
    "acceptance_criteria",
    "created_at",
    "updated_at"
  ];
  for (const task of value.tasks) {
    if (
      !isRecord(task) ||
      textFields.some((field) => !validText(task[field])) ||
      typeof task.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(task.id) ||
      ids.has(task.id) ||
      typeof task.title !== "string" ||
      task.title.trim() === "" ||
      !STATUSES.has(task.status as string) ||
      !TYPES.has(task.type as string) ||
      !/^P[0-4]$/.test(task.priority as string) ||
      !Array.isArray(task.dependencyIds) ||
      task.dependencyIds.length > MAX_TASKS ||
      task.dependencyIds.some(
        (id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id)
      ) ||
      new Set(task.dependencyIds).size !== task.dependencyIds.length ||
      !isRecord(task.metadata) ||
      Object.entries(task.metadata).some(
        ([key, entry]) => !/^[a-z][a-z0-9_]{0,99}$/i.test(key) || !validText(entry)
      )
    ) {
      throw new Error("Corrupt local task record; the file was not changed.");
    }
    ids.add(task.id);
  }
  return value as unknown as LocalTaskDocument;
}

function readyIds(tasks: readonly LocalTask[]) {
  // Resolve closed dependencies from the leaves. Missing references and cycles
  // never enter this set, even when somebody manually marks a cycle closed.
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const remaining = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const resolved = new Set<string>();
  const queue: string[] = [];
  for (const task of tasks) {
    if (task.status !== "closed") continue;
    remaining.set(task.id, task.dependencyIds.length);
    if (task.dependencyIds.length === 0) queue.push(task.id);
    for (const id of task.dependencyIds) {
      if (byId.get(id)?.status !== "closed") continue;
      dependents.set(id, [...(dependents.get(id) ?? []), task.id]);
    }
  }
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    resolved.add(id);
    for (const dependent of dependents.get(id) ?? []) {
      const count = (remaining.get(dependent) ?? 0) - 1;
      remaining.set(dependent, count);
      if (count === 0) queue.push(dependent);
    }
  }
  return new Set(
    tasks
      .filter(
        (task) =>
          task.status === "open" &&
          task.type !== "epic" &&
          task.dependencyIds.every((id) => resolved.has(id))
      )
      .map((task) => task.id)
  );
}

function options(
  args: readonly string[],
  allowed: ReadonlySet<string>,
  switches: readonly string[] = []
) {
  const result: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!allowed.has(key) || (seen.has(key) && key !== "--set-metadata")) {
      throw new Error(`Unsupported or repeated local task option: ${key}`);
    }
    seen.add(key);
    if (switches.includes(key)) {
      result.push([key, ""]);
      continue;
    }
    const value = args[++index];
    if (!validText(value)) throw new Error(`Invalid value for local task option: ${key}`);
    result.push([key, value]);
  }
  return result;
}

function requireTask(tasks: LocalTask[], id: string | undefined) {
  const task = tasks.find((candidate) => candidate.id === id);
  if (!task) throw new Error("The requested local task does not exist.");
  return task;
}

function touchTask(task: LocalTask) {
  const previous = Date.parse(task.updated_at);
  task.updated_at = new Date(
    Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0)
  ).toISOString();
}

function assertDependencies(tasks: readonly LocalTask[], task: LocalTask) {
  const byId = new Map(tasks.map((item) => [item.id, item]));
  const visited = new Set<string>();
  const active = new Set<string>();
  const pending: Array<{ id: string; exit: boolean }> = [{ id: task.id, exit: false }];
  while (pending.length > 0) {
    const entry = pending.pop()!;
    if (entry.exit) {
      active.delete(entry.id);
      visited.add(entry.id);
      continue;
    }
    if (active.has(entry.id)) throw new Error("This local task dependency would create a cycle.");
    if (visited.has(entry.id)) continue;
    const current = byId.get(entry.id);
    if (!current) throw new Error("A dependency refers to a missing local task.");
    active.add(entry.id);
    pending.push({ id: entry.id, exit: true });
    for (const id of current.dependencyIds) pending.push({ id, exit: false });
  }
}

function isMissing(error: unknown) {
  return isRecord(error) && error.code === "ENOENT";
}

/** A local backend for the extension's bounded, internal task operations. */
export class LocalTaskStore {
  public static readonly relativePath = ".taskgraph/tasks.json";

  constructor(private readonly workspacePath: string) {}

  private async location(create: boolean) {
    const root = await fs.realpath(this.workspacePath);
    const directory = path.join(root, ".taskgraph");
    if (create) {
      try {
        await fs.mkdir(directory, { mode: 0o700 });
      } catch (error) {
        if (!isRecord(error) || error.code !== "EEXIST") throw error;
      }
    }
    try {
      const stat = await fs.lstat(directory);
      if (
        stat.isSymbolicLink() ||
        !stat.isDirectory() ||
        (await fs.realpath(directory)) !== directory
      ) {
        throw new Error("Refusing a symlink or non-directory local task store.");
      }
      return { directory, file: path.join(directory, "tasks.json"), dev: stat.dev, ino: stat.ino };
    } catch (error) {
      if (!create && isMissing(error)) return null;
      throw error;
    }
  }

  private async readDocument(): Promise<LocalTaskDocument> {
    const location = await this.location(false);
    if (location === null) return { version: 1, tasks: [] };
    let handle;
    try {
      const stat = await fs.lstat(location.file);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
        throw new Error("Refusing a symlink or non-regular local task file.");
      }
      handle = await fs.open(location.file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size > MAX_BYTES)
        throw new Error("Local task store is too large or invalid.");
      // Keep the read bounded even if another process grows the file after stat.
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > MAX_BYTES) throw new Error("Local task store is too large.");
      const contents = buffer.subarray(0, length);
      let parsed: unknown;
      try {
        parsed = JSON.parse(contents.toString("utf8"));
      } catch {
        throw new Error("Corrupt local task JSON; the file was not changed.");
      }
      return validateDocument(parsed);
    } catch (error) {
      if (isMissing(error)) return { version: 1, tasks: [] };
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private async mutate<TResult>(operation: (document: LocalTaskDocument) => TResult) {
    const location = await this.location(true);
    if (location === null) throw new Error("Local task storage is unavailable.");
    const lock = path.join(location.directory, "tasks.lock");
    let acquired = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        await fs.mkdir(lock, { mode: 0o700 });
        acquired = true;
        break;
      } catch (error) {
        if (!isRecord(error) || error.code !== "EEXIST") throw error;
        try {
          const stat = await fs.lstat(lock);
          if (stat.isSymbolicLink() || !stat.isDirectory())
            throw new Error("Invalid local task write lock.");
        } catch (lockError) {
          if (!isMissing(lockError)) throw lockError;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    if (!acquired)
      throw new Error("Local tasks are locked by another writer. Retry after it finishes.");
    const temporary = path.join(location.directory, `.tasks-${randomUUID()}.tmp`);
    try {
      const document = await this.readDocument();
      const baseline = JSON.stringify(document);
      const result = operation(document);
      validateDocument(document);
      const content = `${JSON.stringify(document, null, 2)}\n`;
      if (Buffer.byteLength(content) > MAX_BYTES)
        throw new Error("Local task store is too large; the file was not changed.");
      const current = await this.location(false);
      if (current?.dev !== location.dev || current.ino !== location.ino) {
        throw new Error("Local task directory changed during the write.");
      }
      const handle = await fs.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      // Recheck the destination after writing the temporary file. Renaming never
      // follows a destination symlink, but an unexpected one is still an error.
      if (JSON.stringify(await this.readDocument()) !== baseline) {
        throw new Error(
          "Local tasks changed outside the extension during this write. Refresh and retry."
        );
      }
      const destination = await this.location(false);
      if (destination?.dev !== location.dev || destination.ino !== location.ino) {
        throw new Error("Local task directory changed during the write.");
      }
      await fs.rename(temporary, location.file);
      return result;
    } finally {
      try {
        await fs.rm(temporary, { force: true });
      } finally {
        await fs.rmdir(lock);
      }
    }
  }

  public async list(): Promise<BeadItem[]> {
    const document = await this.readDocument();
    return inferReadyParallelizableItems(
      extractBeadItems(document.tasks),
      readyIds(document.tasks)
    );
  }

  public async importPlan(draft: PlanDraft): Promise<Array<{ taskId: string; issueId: string }>> {
    if (Buffer.byteLength(JSON.stringify(draft)) > MAX_BYTES) {
      throw new Error("The local task plan is too large.");
    }
    const parsed = parsePlanDraft(draft);
    if (parsed.draft === null || parsed.errors.length > 0) {
      throw new Error(
        `Invalid local task plan: ${parsed.errors.map((error) => error.message).join("; ")}`
      );
    }
    const plan = parsed.draft;
    return this.mutate((document) => {
      const created = plan.tasks.map((task) => ({
        source: task,
        task: newTask(task.title, "task", task.priority)
      }));
      const idMap = new Map(created.map(({ source, task }) => [source.id, task.id]));
      for (const { source, task } of created) {
        task.acceptance_criteria = source.acceptanceCriteria.join("\n");
        task.metadata = { plan_goal: plan.goal, plan_draft_version: String(plan.version) };
        if (source.instructions !== undefined)
          task.metadata.task_instructions = source.instructions;
        if (source.provider !== undefined) task.metadata.provider = source.provider;
        if (source.model !== undefined) task.metadata.model = source.model;
        if (source.ssot.length > 0) task.metadata.ssot = source.ssot.join(", ");
        if (source.outputPath !== undefined) task.metadata.output_path = source.outputPath;
        task.dependencyIds = source.dependencyIds.map((id) => {
          const mapped = idMap.get(id);
          if (mapped === undefined) throw new Error("The plan contains an unknown dependency.");
          return mapped;
        });
      }
      document.tasks.push(...created.map(({ task }) => task));
      return created.map(({ source, task }) => ({ taskId: source.id, issueId: task.id }));
    });
  }

  public async updateTask(
    issueId: string,
    values: {
      title: string;
      status: string;
      dependencyIds: string[];
      description?: string;
      acceptanceCriteria?: string;
      outputPath?: string;
      taskInstructions?: string;
    },
    expectedUpdatedAt?: string
  ): Promise<void> {
    await this.mutate((document) => {
      const task = requireTask(document.tasks, issueId);
      if (expectedUpdatedAt !== undefined && task.updated_at !== expectedUpdatedAt) {
        throw new Error("This local task changed while it was being edited. Refresh and retry.");
      }
      task.title = values.title.trim();
      task.status = values.status;
      task.dependencyIds = [...new Set(values.dependencyIds)];
      if (values.description !== undefined) task.description = values.description;
      if (values.acceptanceCriteria !== undefined)
        task.acceptance_criteria = values.acceptanceCriteria;
      if (values.outputPath !== undefined) task.metadata.output_path = values.outputPath;
      if (values.taskInstructions !== undefined)
        task.metadata.task_instructions = values.taskInstructions;
      assertDependencies(document.tasks, task);
      touchTask(task);
      return "";
    });
  }

  public async execute(args: readonly string[]): Promise<string> {
    const [command, ...rest] = args;
    if (command === "list" || command === "ready" || command === "show") {
      const flags = options(
        command === "show" ? rest.slice(1) : rest,
        new Set(command === "show" ? ["--json"] : ["--json", "--limit", "--all"]),
        ["--json", "--all"]
      );
      if (flags.some(([key, value]) => key === "--limit" && value !== "0")) {
        throw new Error("Only unlimited internal task queries are supported.");
      }
      const document = await this.readDocument();
      if (command === "show") return JSON.stringify([requireTask(document.tasks, rest[0])]);
      if (command === "ready") {
        const ready = readyIds(document.tasks);
        return JSON.stringify(document.tasks.filter((task) => ready.has(task.id)));
      }
      return JSON.stringify(document.tasks);
    }
    if (command === "create") {
      const flags = new Map(
        options(rest, new Set(["--title", "--priority", "--type", "--silent", "--json"]), [
          "--silent",
          "--json"
        ])
      );
      const title = flags.get("--title")?.trim();
      const type = flags.get("--type") ?? "task";
      const priority = flags.get("--priority") ?? "P3";
      if (!title || !TYPES.has(type) || !/^P[0-4]$/.test(priority))
        throw new Error("Invalid local task title, type, or priority.");
      return this.mutate((document) => {
        const task = newTask(title, type, priority);
        document.tasks.push(task);
        return flags.has("--silent") ? task.id : JSON.stringify(task);
      });
    }
    if (command === "update") {
      const flags = options(
        rest.slice(1),
        new Set([
          "--status",
          "--assignee",
          "--append-notes",
          "--acceptance",
          "--set-metadata",
          "--title",
          "--description"
        ])
      );
      if (flags.length === 0) throw new Error("A local task update must contain fields.");
      return this.mutate((document) => {
        const task = requireTask(document.tasks, rest[0]);
        for (const [key, value] of flags) {
          if (key === "--status") {
            if (!STATUSES.has(value)) throw new Error("Invalid local task status.");
            task.status = value;
          } else if (key === "--title") {
            if (!value.trim()) throw new Error("Local task title cannot be empty.");
            task.title = value.trim();
          } else if (key === "--assignee") task.assignee = value;
          else if (key === "--description") task.description = value;
          else if (key === "--acceptance") task.acceptance_criteria = value;
          else if (key === "--append-notes")
            task.notes = [task.notes, value].filter(Boolean).join("\n");
          else if (key === "--set-metadata") {
            const separator = value.indexOf("=");
            const name = value.slice(0, separator);
            if (separator < 1 || !/^[a-z][a-z0-9_]{0,99}$/i.test(name))
              throw new Error("Invalid local task metadata key.");
            task.metadata = { ...task.metadata, [name]: value.slice(separator + 1) };
          }
        }
        touchTask(task);
        return JSON.stringify(task);
      });
    }
    if (command === "close" && rest.length === 1) {
      return this.mutate((document) => {
        const task = requireTask(document.tasks, rest[0]);
        task.status = "closed";
        touchTask(task);
        return JSON.stringify(task);
      });
    }
    if (command === "dep" && rest.length === 3 && ["add", "remove"].includes(rest[0])) {
      return this.mutate((document) => {
        const task = requireTask(document.tasks, rest[1]);
        const dependency = requireTask(document.tasks, rest[2]);
        if (task.id === dependency.id) throw new Error("A local task cannot depend on itself.");
        if (rest[0] === "add") {
          task.dependencyIds = [...new Set([...task.dependencyIds, dependency.id])];
          assertDependencies(document.tasks, task);
        } else task.dependencyIds = task.dependencyIds.filter((id) => id !== dependency.id);
        touchTask(task);
        return JSON.stringify(task);
      });
    }
    throw new Error(`Unsupported local task command: ${command ?? "(empty)"}`);
  }
}
