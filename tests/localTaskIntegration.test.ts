import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  folders: [] as Array<{ name: string; uri: { fsPath: string; scheme: string } }>,
  trusted: true,
  input: vi.fn(),
  pick: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  check: vi.fn(),
  spawn: vi.fn()
}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("../src/commandAvailability", () => ({ checkExecutable: mocks.check }));
vi.mock("../src/beadsWebview", () => ({ renderBeadsWebviewHtml: vi.fn() }));
vi.mock("vscode", () => ({
  RelativePattern: class {
    constructor() {}
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath, scheme: "file" }),
    joinPath: (uri: { fsPath: string }, ...parts: string[]) => ({
      fsPath: path.join(uri.fsPath, ...parts),
      scheme: "file"
    })
  },
  workspace: {
    get workspaceFolders() {
      return mocks.folders;
    },
    get isTrusted() {
      return mocks.trusted;
    },
    fs: { stat: (uri: { fsPath: string }) => fs.stat(uri.fsPath) },
    findFiles: async () => [],
    asRelativePath: (uri: { fsPath: string }) => uri.fsPath,
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
    createFileSystemWatcher: () => ({
      dispose() {},
      onDidCreate: () => ({ dispose() {} }),
      onDidChange: () => ({ dispose() {} }),
      onDidDelete: () => ({ dispose() {} })
    }),
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
    onDidGrantWorkspaceTrust: () => ({ dispose() {} })
  },
  window: {
    showInputBox: mocks.input,
    showQuickPick: mocks.pick,
    showWarningMessage: mocks.warning,
    showInformationMessage: mocks.info,
    showErrorMessage: mocks.error
  }
}));

import { type AgentTaskExecutionSpec } from "../src/agentWorkspaceEdit";
import { BeadsViewProvider } from "../src/beadsView";
import { type BeadLoadResult } from "../src/beadsViewTypes";
import { LocalTaskStore } from "../src/localTaskStore";

type Host = BeadsViewProvider & {
  loadBeads(): Promise<BeadLoadResult>;
  queryReadyItemIds(cwd: string): Promise<Set<string>>;
  assertAgentWriteCapability(cwd: string): Promise<void>;
  queryAgentTaskExecutionSpec(id: string, cwd: string): Promise<AgentTaskExecutionSpec>;
  runTaskCommand(args: string[], cwd: string): Promise<string>;
  inferAssignSsot(cwd: string, id: string): string;
};
let directory: string;
let provider: BeadsViewProvider;
let host: Host;
beforeEach(async () => {
  vi.clearAllMocks();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "standalone-task-host-"));
  mocks.folders.splice(0, mocks.folders.length, {
    name: "Project",
    uri: { fsPath: directory, scheme: "file" }
  });
  mocks.trusted = true;
  mocks.check.mockResolvedValue({ available: false, command: "bd", message: "Not installed" });
  mocks.spawn.mockImplementation(() => {
    throw new Error("No external commands allowed in native task fixture");
  });
  provider = new BeadsViewProvider({} as never, {} as never, {} as never);
  host = provider as unknown as Host;
  vi.spyOn(provider, "refresh").mockResolvedValue();
});
afterEach(async () => {
  provider.dispose();
  await fs.rm(directory, { recursive: true, force: true });
});

async function create(title: string) {
  mocks.input.mockResolvedValueOnce(title);
  await provider.handleMessage({ command: "createBead", workspacePath: directory });
  return (await new LocalTaskStore(directory).list()).find((task) => task.title === title)!;
}

describe("standalone task host", () => {
  it("opens an empty folder and creates a persistent task without probing or spawning bd", async () => {
    const initial = await host.loadBeads();
    expect(initial.emptyWorkspaces[0].storageKind).toBe("local");
    expect(initial.planImportCapabilities?.[0].capability.supported).toBe(true);
    expect(await fs.readdir(directory)).toEqual([]);
    const task = await create("First task");
    expect(task.status).toBe("open");
    expect(task.readyByBd).toBe(true);
    expect(host.inferAssignSsot(directory, task.id)).toContain(".taskgraph/tasks.json#");
    expect(host.inferAssignSsot(directory, task.id)).not.toContain("bd:");
    const loaded = await host.loadBeads();
    expect(loaded.groups[0].storageKind).toBe("local");
    expect(loaded.groups[0].items[0].title).toBe("First task");
    expect(mocks.pick).not.toHaveBeenCalled();
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("imports a reviewed plan with dependencies and AI metadata into the native store", async () => {
    mocks.warning.mockResolvedValueOnce("Import Plan");
    const draft = {
      version: 1,
      goal: "Write and review",
      tasks: [
        {
          id: "write",
          title: "Write",
          priority: "P2",
          acceptanceCriteria: ["Includes summary"],
          dependencyIds: [],
          ssot: [],
          outputPath: "summary.md",
          instructions: "Write a short summary.",
          provider: "ollama",
          model: "local-model"
        },
        {
          id: "review",
          title: "Review",
          priority: "P2",
          acceptanceCriteria: ["Review recorded"],
          dependencyIds: ["write"],
          ssot: [],
          outputPath: "review.md"
        }
      ]
    };
    await provider.handleMessage({
      command: "importPlanDraft",
      workspacePath: directory,
      draftText: JSON.stringify(draft)
    });
    const tasks = await new LocalTaskStore(directory).list();
    const write = tasks.find((task) => task.title === "Write")!;
    const review = tasks.find((task) => task.title === "Review")!;
    expect(review.dependencyIds).toEqual([write.id]);
    expect([...(await host.queryReadyItemIds(directory))]).toEqual([write.id]);
    await expect(host.assertAgentWriteCapability(directory)).resolves.toBeUndefined();
    expect(await host.queryAgentTaskExecutionSpec(write.id, directory)).toMatchObject({
      outputPath: "summary.md"
    });
    mocks.warning.mockResolvedValueOnce("Close");
    await provider.handleMessage({
      command: "closeBead",
      workspacePath: directory,
      issueId: write.id
    });
    expect([...(await host.queryReadyItemIds(directory))]).toEqual([review.id]);
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("edits native dependencies and status from task messages", async () => {
    const first = await create("First");
    const second = await create("Second");
    mocks.pick
      .mockResolvedValueOnce({ field: "dependencyIds" })
      .mockResolvedValueOnce([{ id: first.id }]);
    await provider.handleMessage({
      command: "editLocalTask",
      workspacePath: directory,
      issueId: second.id
    });
    expect([...(await host.queryReadyItemIds(directory))]).toEqual([first.id]);
    mocks.pick
      .mockResolvedValueOnce({ field: "status" })
      .mockResolvedValueOnce({ value: "closed" });
    await provider.handleMessage({
      command: "editLocalTask",
      workspacePath: directory,
      issueId: first.id
    });
    expect([...(await host.queryReadyItemIds(directory))]).toEqual([second.id]);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("preserves an existing Beads workspace when its CLI is missing", async () => {
    await fs.mkdir(path.join(directory, ".beads"));
    const result = await host.loadBeads();
    expect(result.emptyWorkspaces).toEqual([]);
    expect(result.unavailableWorkspaces).toHaveLength(1);
    expect(result.planImportCapabilities?.[0].capability.supported).toBe(false);
    expect(await fs.readdir(directory)).toEqual([".beads"]);
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("reads native tasks in Restricted Mode but refuses task writes and external paths", async () => {
    await create("Saved");
    mocks.trusted = false;
    const result = await host.loadBeads();
    expect(result.groups[0].items).toHaveLength(1);
    expect(result.agentWriteCapabilities?.[0].capability.supported).toBe(false);
    await expect(host.runTaskCommand(["create", "--title", "Denied"], directory)).rejects.toThrow(
      "Trust"
    );
    mocks.trusted = true;
    await expect(
      host.runTaskCommand(["create", "--title", "Denied"], path.dirname(directory))
    ).rejects.toThrow("open workspace");
    expect(await new LocalTaskStore(directory).list()).toHaveLength(1);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
