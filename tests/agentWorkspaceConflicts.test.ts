import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyAgentWorkspaceEdit,
  assertAgentTargetHasNoUnsavedChanges,
  readAgentWorkspaceTarget
} from "../src/agentWorkspaceEdit";

const directories: string[] = [];

async function fixture(initial: string | null = "before\n") {
  const workspace = await fs.promises.mkdtemp(path.join(os.tmpdir(), "beads-conflict-"));
  directories.push(workspace);
  const outputPath = "report.md";
  const filename = path.join(workspace, outputPath);
  if (initial !== null) await fs.promises.writeFile(filename, initial);
  const snapshot = await readAgentWorkspaceTarget(workspace, outputPath);
  return { workspace, outputPath, filename, snapshot };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true }))
  );
});

describe("workspace artifact conflict checks", () => {
  it("preserves a file changed while the candidate was generated or reviewed", async () => {
    const { workspace, outputPath, filename, snapshot } = await fixture();
    await fs.promises.writeFile(filename, "saved during review\n");

    await expect(
      applyAgentWorkspaceEdit(workspace, outputPath, "candidate\n", snapshot)
    ).rejects.toThrow("changed since it was read");

    expect(await fs.promises.readFile(filename, "utf8")).toBe("saved during review\n");
    expect(await fs.promises.readdir(workspace)).toEqual([outputPath]);
  });

  it("does not recreate an existing target deleted during review", async () => {
    const { workspace, outputPath, filename, snapshot } = await fixture();
    await fs.promises.unlink(filename);

    await expect(
      applyAgentWorkspaceEdit(workspace, outputPath, "candidate\n", snapshot)
    ).rejects.toThrow("changed since it was read");
    await expect(fs.promises.stat(filename)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not overwrite a new file created during review", async () => {
    const { workspace, outputPath, filename, snapshot } = await fixture(null);
    await fs.promises.writeFile(filename, "another task\n");

    await expect(
      applyAgentWorkspaceEdit(workspace, outputPath, "candidate\n", snapshot)
    ).rejects.toThrow("changed since it was read");
    expect(await fs.promises.readFile(filename, "utf8")).toBe("another task\n");
  });

  it("rechecks the target after writing the staged candidate", async () => {
    const { workspace, outputPath, filename, snapshot } = await fixture();
    const writeFile = fs.promises.writeFile.bind(fs.promises);
    vi.spyOn(fs.promises, "writeFile").mockImplementationOnce(async (...args) => {
      await writeFile(...args);
      await writeFile(filename, "saved while staging\n");
    });

    await expect(
      applyAgentWorkspaceEdit(workspace, outputPath, "candidate\n", snapshot)
    ).rejects.toThrow("changed since it was read");
    expect(await fs.promises.readFile(filename, "utf8")).toBe("saved while staging\n");
    expect(await fs.promises.readdir(workspace)).toEqual([outputPath]);
  });

  it("rejects a changed backup even if the file returns to its original content", async () => {
    const { workspace, outputPath, filename, snapshot } = await fixture();
    const readFile = fs.promises.readFile.bind(fs.promises);
    let reads = 0;
    vi.spyOn(fs.promises, "readFile").mockImplementation(async (...args) => {
      if (args[0] === snapshot.absolutePath && ++reads === 2) {
        return Buffer.from("intervening backup\n");
      }
      return readFile(...args);
    });

    await expect(
      applyAgentWorkspaceEdit(workspace, outputPath, "candidate\n", snapshot)
    ).rejects.toThrow("changed while preparing the edit backup");
    expect(await fs.promises.readFile(filename, "utf8")).toBe("before\n");
  });

  it("publishes a new file exclusively if another writer arrives at the last step", async () => {
    const { workspace, outputPath, filename, snapshot } = await fixture(null);
    const link = fs.promises.link.bind(fs.promises);
    vi.spyOn(fs.promises, "link").mockImplementationOnce(async (source, target) => {
      await fs.promises.writeFile(target, "racing writer\n", { flag: "wx" });
      await link(source, target);
    });

    await expect(
      applyAgentWorkspaceEdit(workspace, outputPath, "candidate\n", snapshot)
    ).rejects.toThrow("created by another writer");
    expect(await fs.promises.readFile(filename, "utf8")).toBe("racing writer\n");
    expect(await fs.promises.readdir(workspace)).toEqual([outputPath]);
  });

  it.each(["before\n", null])("does not roll back newer content (initial=%s)", async (initial) => {
    const { workspace, outputPath, filename, snapshot } = await fixture(initial);
    const applied = await applyAgentWorkspaceEdit(workspace, outputPath, "candidate\n", snapshot);
    await fs.promises.writeFile(filename, "saved after apply\n");

    await expect(applied.rollback()).rejects.toThrow("changed since it was read");
    expect(await fs.promises.readFile(filename, "utf8")).toBe("saved after apply\n");
    expect(await fs.promises.readdir(workspace)).toEqual([outputPath]);
  });

  it("keeps executable permissions when applying and rolling back an unchanged file", async () => {
    const { workspace, outputPath, filename, snapshot } = await fixture();
    await fs.promises.chmod(filename, 0o755);
    const applied = await applyAgentWorkspaceEdit(workspace, outputPath, "candidate\n", snapshot);
    if (process.platform !== "win32")
      expect((await fs.promises.stat(filename)).mode & 0o777).toBe(0o755);
    await applied.rollback();
    expect(await fs.promises.readFile(filename, "utf8")).toBe("before\n");
    if (process.platform !== "win32")
      expect((await fs.promises.stat(filename)).mode & 0o777).toBe(0o755);
  });

  it("blocks unsaved editor changes before generation without blocking other documents", async () => {
    const { filename, snapshot } = await fixture();
    expect(() =>
      assertAgentTargetHasNoUnsavedChanges(snapshot.absolutePath, [
        { fileName: filename, isDirty: true }
      ])
    ).toThrow("unsaved editor changes");
    expect(() =>
      assertAgentTargetHasNoUnsavedChanges(snapshot.absolutePath, [
        { fileName: filename, isDirty: false },
        { fileName: `${filename}.other`, isDirty: true }
      ])
    ).not.toThrow();
  });

  it("matches unsaved documents through canonical case aliases", async ({ skip }) => {
    const { workspace, filename } = await fixture();
    if (!fs.existsSync(path.join(workspace, "REPORT.MD"))) {
      skip(); // The current filesystem distinguishes case, so this alias cannot occur.
      return;
    }
    const target = await readAgentWorkspaceTarget(workspace, "REPORT.MD");
    expect(() =>
      assertAgentTargetHasNoUnsavedChanges(target.absolutePath, [
        { fileName: filename, isDirty: true }
      ])
    ).toThrow("unsaved editor changes");
  });

  it("rechecks dirty editors just before applying and before rollback", async () => {
    const { workspace, outputPath, filename, snapshot } = await fixture();
    const document = { fileName: filename, isDirty: false };
    const assertWritable = () =>
      assertAgentTargetHasNoUnsavedChanges(snapshot.absolutePath, [document]);
    const writeFile = fs.promises.writeFile.bind(fs.promises);
    vi.spyOn(fs.promises, "writeFile").mockImplementationOnce(async (...args) => {
      await writeFile(...args);
      document.isDirty = true;
    });

    await expect(
      applyAgentWorkspaceEdit(workspace, outputPath, "candidate\n", snapshot, assertWritable)
    ).rejects.toThrow("unsaved editor changes");
    expect(await fs.promises.readFile(filename, "utf8")).toBe("before\n");

    document.isDirty = false;
    const applied = await applyAgentWorkspaceEdit(
      workspace,
      outputPath,
      "candidate\n",
      snapshot,
      assertWritable
    );
    document.isDirty = true;
    await expect(applied.rollback()).rejects.toThrow("unsaved editor changes");
    expect(await fs.promises.readFile(filename, "utf8")).toBe("candidate\n");
    expect(await fs.promises.readdir(workspace)).toEqual([outputPath]);
  });
});
