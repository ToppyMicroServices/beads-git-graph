import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildAgentBeadUpdateArgs } from "../src/agentBeadUpdate";
import { LocalTaskStore } from "../src/localTaskStore";
import { type PlanDraft } from "../src/planDraft";
import { executePlanImport, projectPlanDraftMutations } from "../src/planImport";

const directories: string[] = [];

async function workspace() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-task-store-"));
  directories.push(directory);
  return directory;
}

async function create(store: LocalTaskStore, title: string) {
  return store.execute([
    "create",
    "--title",
    title,
    "--priority",
    "P2",
    "--type",
    "task",
    "--silent"
  ]);
}

async function ready(store: LocalTaskStore) {
  const rows = JSON.parse(await store.execute(["ready", "--json", "--limit", "0"])) as Array<{
    id: string;
  }>;
  return rows.map((task) => task.id);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe("local tasks without a Beads installation", () => {
  it("reads an empty workspace without creating files and rejects unsupported commands", async () => {
    const directory = await workspace();
    const store = new LocalTaskStore(directory);
    expect(await store.list()).toEqual([]);
    expect(await store.execute(["list", "--json", "--limit", "0", "--all"])).toBe("[]");
    expect(await ready(store)).toEqual([]);
    await expect(store.execute(["sync"])).rejects.toThrow("Unsupported");
    await expect(
      store.execute(["create", "--title", "Task", "--shell", "anything"])
    ).rejects.toThrow("Unsupported");
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it("persists create, updates, dependencies and close across store instances", async () => {
    const directory = await workspace();
    const store = new LocalTaskStore(directory);
    const first = await create(store, "First");
    const second = await create(store, "Second");
    await store.execute(["dep", "add", second, first]);
    expect(await ready(store)).toEqual([first]);
    await store.execute([
      "update",
      first,
      "--description",
      "Explain work",
      "--append-notes",
      "Started"
    ]);
    await store.execute(["update", first, "--append-notes", "Checked", "--assignee", "Owner"]);
    await store.execute(["close", first]);
    const reopened = new LocalTaskStore(directory);
    expect(await ready(reopened)).toEqual([second]);
    expect((await reopened.list()).find((task) => task.id === first)).toMatchObject({
      status: "closed",
      description: "Explain work",
      notes: "Started\nChecked",
      assignee: "Owner"
    });
    expect((await reopened.list()).find((task) => task.id === second)).toMatchObject({
      readyByBd: true,
      dependencyIds: [first]
    });
    await reopened.execute(["dep", "remove", second, first]);
    expect((await reopened.list()).find((task) => task.id === second)?.dependencyIds).toEqual([]);
    expect(await fs.readdir(path.join(directory, ".taskgraph"))).toEqual(["tasks.json"]);
  });

  it("roundtrips the existing plan import and execution metadata", async () => {
    const store = new LocalTaskStore(await workspace());
    const imported = await executePlanImport(
      projectPlanDraftMutations({
        version: 1,
        goal: "Write a report",
        tasks: [
          {
            id: "draft-one",
            title: "Report",
            priority: "P1",
            dependencyIds: [],
            acceptanceCriteria: ["Three sections exist"],
            instructions: "Use the supplied facts",
            outputPath: "outputs/report.md",
            ssot: ["README.md"],
            provider: "ollama",
            model: "local-model"
          }
        ]
      }),
      (args) => store.execute(args)
    );
    expect(imported.failed).toBeNull();
    const id = imported.createdIds[0].issueId;
    await store.execute(
      buildAgentBeadUpdateArgs({
        issueId: id,
        assignee: "local-model",
        notes: ["checked=one=two"],
        metadata: [
          "provider_status=edit_applied",
          "content_check_status=model_passed",
          "acceptance_status=pending_external_validation",
          "review_status=human_approved",
          "artifact=beads-response:11111111-1111-4111-8111-111111111111",
          "branch=task/report"
        ]
      })
    );
    expect((await store.list())[0]).toMatchObject({
      id,
      title: "Report",
      status: "in_progress",
      provider: "ollama",
      model: "local-model",
      acceptanceCriteria: "Three sections exist",
      taskInstructions: "Use the supplied facts",
      outputPath: "outputs/report.md",
      ssot: "README.md",
      providerStatus: "edit_applied",
      contentCheckStatus: "model_passed",
      acceptanceStatus: "pending_external_validation",
      reviewStatus: "human_approved",
      branch: "task/report",
      notes: "checked=one=two"
    });
    const [raw] = JSON.parse(await store.execute(["show", id, "--json"]));
    expect(raw.metadata.plan_goal).toBe("Write a report");
    expect(raw.metadata.plan_draft_version).toBe("1");
    expect(raw.metadata.artifact).toBe("beads-response:11111111-1111-4111-8111-111111111111");
    expect(await ready(store)).toEqual([]);
  });

  it("imports a whole plan with dependencies and metadata in one atomic commit", async () => {
    const directory = await workspace();
    const store = new LocalTaskStore(directory);
    const draft: PlanDraft = {
      version: 1,
      goal: "Prepare and review a report",
      tasks: [
        {
          id: "write",
          title: "Write",
          priority: "P1",
          acceptanceCriteria: ["Report exists", "Facts cited"],
          dependencyIds: [],
          ssot: ["README.md"],
          provider: "ollama",
          model: "local-model",
          outputPath: "outputs/report.md",
          instructions: "Use the provided facts"
        },
        {
          id: "review",
          title: "Review",
          priority: "P2",
          acceptanceCriteria: ["Review exists"],
          dependencyIds: ["write"],
          ssot: [],
          outputPath: "outputs/review.md"
        }
      ]
    };
    const snapshots: Array<{
      tasks: Array<{ id: string; dependencyIds: string[]; metadata: Record<string, string> }>;
    }> = [];
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      await rename(source, destination);
      snapshots.push(JSON.parse(await fs.readFile(destination, "utf8")));
    });
    const imported = await store.importPlan(draft);
    expect(imported.map((item) => item.taskId)).toEqual(["write", "review"]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].tasks).toHaveLength(2);
    expect(snapshots[0].tasks[1].dependencyIds).toEqual([imported[0].issueId]);
    expect(snapshots[0].tasks[0].metadata).toEqual({
      plan_goal: draft.goal,
      plan_draft_version: "1",
      task_instructions: "Use the provided facts",
      provider: "ollama",
      model: "local-model",
      ssot: "README.md",
      output_path: "outputs/report.md"
    });
    expect(
      (await store.list()).find((task) => task.id === imported[0].issueId)?.acceptanceCriteria
    ).toBe("Report exists\nFacts cited");
    expect(await ready(store)).toEqual([imported[0].issueId]);
    const file = path.join(directory, LocalTaskStore.relativePath);
    const before = await fs.readFile(file, "utf8");
    await expect(
      store.importPlan({ ...draft, tasks: [{ ...draft.tasks[1], dependencyIds: ["missing"] }] })
    ).rejects.toThrow("Invalid");
    await expect(store.importPlan({ ...draft, goal: "x".repeat(64_001) })).rejects.toThrow();
    expect(await fs.readFile(file, "utf8")).toBe(before);
    expect(snapshots).toHaveLength(1);
  });

  it("rejects self, missing and cyclic dependency changes without partial writes", async () => {
    const directory = await workspace();
    const store = new LocalTaskStore(directory);
    const first = await create(store, "First");
    const second = await create(store, "Second");
    await store.execute(["dep", "add", second, first]);
    const file = path.join(directory, LocalTaskStore.relativePath);
    const before = await fs.readFile(file, "utf8");
    await expect(store.execute(["dep", "add", first, second])).rejects.toThrow("cycle");
    await expect(store.execute(["dep", "add", first, first])).rejects.toThrow("itself");
    await expect(store.execute(["dep", "add", first, "missing"])).rejects.toThrow("does not exist");
    await expect(
      store.updateTask(first, { title: "Must not save", status: "closed", dependencyIds: [second] })
    ).rejects.toThrow("cycle");
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("does not treat missing or cyclic closed dependencies as ready", async () => {
    const directory = await workspace();
    const store = new LocalTaskStore(directory);
    const first = await create(store, "First");
    const second = await create(store, "Second");
    const waiting = await create(store, "Waiting");
    const missing = await create(store, "Missing dependency");
    const file = path.join(directory, LocalTaskStore.relativePath);
    const document = JSON.parse(await fs.readFile(file, "utf8"));
    document.tasks[0].status = "closed";
    document.tasks[0].dependencyIds = [second];
    document.tasks[1].status = "closed";
    document.tasks[1].dependencyIds = [first];
    document.tasks[2].dependencyIds = [first];
    document.tasks[3].dependencyIds = ["missing"];
    await fs.writeFile(file, JSON.stringify(document));
    expect(await ready(store)).toEqual([]);
    expect(
      (await store.list())
        .filter((task) => [waiting, missing].includes(task.id))
        .every((task) => !task.readyByBd)
    ).toBe(true);
  });

  it("serializes concurrent writers from separate instances without dropping tasks", async () => {
    const directory = await workspace();
    const ids = await Promise.all(
      Array.from({ length: 15 }, (_, index) =>
        create(new LocalTaskStore(directory), `Task ${index}`)
      )
    );
    const store = new LocalTaskStore(directory);
    expect(new Set(ids).size).toBe(15);
    expect((await store.list()).map((task) => task.id).sort()).toEqual(ids.sort());
    const id = ids[0];
    const before = (await store.list()).find((task) => task.id === id)!;
    const results = await Promise.allSettled(
      ["One", "Two"].map((title) =>
        new LocalTaskStore(directory).updateTask(
          id,
          { title, status: "open", dependencyIds: [] },
          before.updatedAt
        )
      )
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await store.list()).find((task) => task.id === id)?.updatedAt).not.toBe(
      before.updatedAt
    );
  });

  it("edits all native task fields atomically and rejects stale revisions", async () => {
    const store = new LocalTaskStore(await workspace());
    const first = await create(store, "First");
    const second = await create(store, "Second");
    const task = (await store.list()).find((item) => item.id === second)!;
    await store.updateTask(
      second,
      {
        title: "New title",
        status: "blocked",
        dependencyIds: [first],
        description: "New description",
        acceptanceCriteria: "Observable result",
        outputPath: "outputs/new.md",
        taskInstructions: "Do the work"
      },
      task.updatedAt
    );
    expect((await store.list()).find((item) => item.id === second)).toMatchObject({
      title: "New title",
      status: "blocked",
      dependencyIds: [first],
      description: "New description",
      acceptanceCriteria: "Observable result",
      outputPath: "outputs/new.md",
      taskInstructions: "Do the work"
    });
    await expect(
      store.updateTask(
        second,
        { title: "Old edit", status: "open", dependencyIds: [] },
        task.updatedAt
      )
    ).rejects.toThrow("changed");
  });

  it("preserves a valid out-of-band edit made while preparing an atomic write", async () => {
    const directory = await workspace();
    const store = new LocalTaskStore(directory);
    const id = await create(store, "Original");
    const file = path.join(directory, LocalTaskStore.relativePath);
    const external = JSON.parse(await fs.readFile(file, "utf8"));
    external.tasks[0].title = "Edited in another editor";
    const externalContents = `${JSON.stringify(external)}\n`;
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (String(args[0]).includes(".tasks-") && String(args[0]).endsWith(".tmp")) {
        await fs.writeFile(file, externalContents);
      }
      return handle;
    });
    await expect(store.execute(["update", id, "--title", "Extension edit"])).rejects.toThrow(
      "outside the extension"
    );
    expect(await fs.readFile(file, "utf8")).toBe(externalContents);
    expect(await fs.readdir(path.dirname(file))).toEqual(["tasks.json"]);
    expect((await store.list())[0].title).toBe("Edited in another editor");
  });

  it.each(["{broken", '{"version":2,"tasks":[]}', '{"version":1,"tasks":[{"id":"invalid"}]}'])(
    "preserves a corrupt or unsupported store: %s",
    async (contents) => {
      const directory = await workspace();
      const file = path.join(directory, LocalTaskStore.relativePath);
      await fs.mkdir(path.dirname(file));
      await fs.writeFile(file, contents);
      const store = new LocalTaskStore(directory);
      await expect(store.list()).rejects.toThrow();
      await expect(create(store, "Must not replace")).rejects.toThrow();
      expect(await fs.readFile(file, "utf8")).toBe(contents);
    }
  );

  it("rejects symlink directories, task files and write locks without touching the target", async () => {
    const outside = await workspace();
    const outsideFile = path.join(outside, "outside.json");
    await fs.writeFile(outsideFile, "untouched");
    const linkedDirectory = await workspace();
    await fs.symlink(outside, path.join(linkedDirectory, ".taskgraph"));
    await expect(new LocalTaskStore(linkedDirectory).list()).rejects.toThrow("symlink");
    await expect(create(new LocalTaskStore(linkedDirectory), "Task")).rejects.toThrow("symlink");
    const linkedFile = await workspace();
    await fs.mkdir(path.join(linkedFile, ".taskgraph"));
    await fs.symlink(outsideFile, path.join(linkedFile, LocalTaskStore.relativePath));
    await expect(create(new LocalTaskStore(linkedFile), "Task")).rejects.toThrow("symlink");
    const linkedLock = await workspace();
    await fs.mkdir(path.join(linkedLock, ".taskgraph"));
    await fs.symlink(outside, path.join(linkedLock, ".taskgraph", "tasks.lock"));
    await expect(create(new LocalTaskStore(linkedLock), "Task")).rejects.toThrow("lock");
    expect(await fs.readFile(outsideFile, "utf8")).toBe("untouched");
    expect(await fs.readdir(outside)).toEqual(["outside.json"]);
  });

  it("bounds task data and leaves the saved document unchanged on invalid updates", async () => {
    const directory = await workspace();
    const store = new LocalTaskStore(directory);
    const id = await create(store, "First");
    const file = path.join(directory, LocalTaskStore.relativePath);
    const original = await fs.readFile(file, "utf8");
    await expect(
      store.execute(["update", id, "--description", "a".repeat(64_001)])
    ).rejects.toThrow();
    await expect(
      store.updateTask(id, { title: "", status: "open", dependencyIds: [] })
    ).rejects.toThrow();
    expect(await fs.readFile(file, "utf8")).toBe(original);
    await fs.writeFile(file, " ".repeat(2 * 1024 * 1024 + 1));
    await expect(store.list()).rejects.toThrow("too large");
  });
});
