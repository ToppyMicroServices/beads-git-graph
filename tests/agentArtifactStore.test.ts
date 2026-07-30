import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createDirectory,
  deleteFile,
  openTextDocument,
  readDirectory,
  showTextDocument,
  stat,
  writeFile
} = vi.hoisted(() => ({
  createDirectory: vi.fn(async () => undefined),
  deleteFile: vi.fn(async () => undefined),
  openTextDocument: vi.fn(async (uri: unknown) => ({ uri })),
  readDirectory: vi.fn(async () => [] as [string, number][]),
  showTextDocument: vi.fn(async () => undefined),
  stat: vi.fn(async () => ({ mtime: 0 })),
  writeFile: vi.fn(async () => undefined)
}));

vi.mock("vscode", () => ({
  Uri: {
    joinPath: (
      base: { scheme: string; authority: string; path: string },
      ...segments: string[]
    ) => ({
      scheme: base.scheme,
      authority: base.authority,
      path: [base.path.replace(/\/$/, ""), ...segments].join("/"),
      toString() {
        return `${this.scheme}://${this.authority}${this.path}`;
      }
    })
  },
  workspace: {
    openTextDocument,
    fs: {
      createDirectory,
      delete: deleteFile,
      readDirectory,
      stat,
      writeFile
    }
  },
  window: { showTextDocument }
}));

import { AgentArtifactStore } from "../src/agentArtifactStore";

describe("agent artifact ownership", () => {
  const storageUri = {
    scheme: "file",
    authority: "",
    path: "/extension-storage"
  };

  beforeEach(() => {
    createDirectory.mockReset();
    createDirectory.mockResolvedValue(undefined);
    deleteFile.mockReset();
    deleteFile.mockResolvedValue(undefined);
    openTextDocument.mockClear();
    readDirectory.mockReset();
    readDirectory.mockResolvedValue([]);
    showTextDocument.mockClear();
    stat.mockReset();
    stat.mockResolvedValue({ mtime: 0 });
    writeFile.mockReset();
    writeFile.mockResolvedValue(undefined);
  });

  it("opens an unsaved response when extension storage rejects the write", async () => {
    const store = new AgentArtifactStore(storageUri as never);
    writeFile.mockRejectedValueOnce(new Error("disk full"));

    await expect(
      store.writeOrOpenFallback({
        issueId: "research-1",
        title: "Preserve paid response",
        response: {
          provider: "openai",
          requestedModel: "gpt-test",
          confirmedModel: "gpt-test-2026",
          text: "Generated result that must not be discarded."
        }
      })
    ).resolves.toEqual({
      status: "opened-unsaved",
      storageError: "disk full"
    });

    expect(openTextDocument).toHaveBeenCalledWith({
      content: expect.stringContaining("Generated result that must not be discarded."),
      language: "plaintext"
    });
    expect(showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: expect.objectContaining({
          content: expect.stringContaining("Generated result that must not be discarded.")
        })
      }),
      { preview: false }
    );
  });

  it("opens a valid opaque reference from the extension response directory", async () => {
    const store = new AgentArtifactStore(storageUri as never);

    await expect(
      store.openRecordedUri(" BEADS-RESPONSE:12345678-1234-4234-8234-123456789ABC ")
    ).resolves.toEqual({ status: "opened" });
    expect(openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        scheme: "file",
        authority: "",
        path: "/extension-storage/agent-responses/12345678-1234-4234-8234-123456789abc.txt"
      })
    );
    expect(showTextDocument).toHaveBeenCalledOnce();
  });

  it("rejects invalid references without attempting to open a document", async () => {
    const store = new AgentArtifactStore(storageUri as never);

    await expect(store.openRecordedUri("file:///workspace/secret.txt")).resolves.toEqual({
      status: "invalid-reference"
    });
    await expect(
      store.openRecordedUri("beads-response:../../workspace/secret.txt")
    ).resolves.toEqual({ status: "invalid-reference" });
    await expect(
      store.openRecordedUri("beads-response:12345678-1234-1234-1234-123456789abc")
    ).resolves.toEqual({ status: "invalid-reference" });
    expect(openTextDocument).not.toHaveBeenCalled();
    expect(showTextDocument).not.toHaveBeenCalled();
  });

  it("reports a valid reference whose stored artifact cannot be opened", async () => {
    const store = new AgentArtifactStore(storageUri as never);
    openTextDocument.mockRejectedValueOnce(new Error("missing"));

    await expect(
      store.openRecordedUri("beads-response:12345678-1234-4234-8234-123456789abc")
    ).resolves.toEqual({ status: "could-not-open" });
    expect(openTextDocument).toHaveBeenCalledOnce();
    expect(showTextDocument).not.toHaveBeenCalled();
  });

  it("keeps only the configured number of newest response artifacts", async () => {
    const stored = new Map<string, number>();
    let modified = 0;
    writeFile.mockImplementation(async (uri: { path: string }) => {
      stored.set(uri.path, ++modified);
    });
    readDirectory.mockImplementation(async () =>
      [...stored.keys()].map((artifactPath) => [artifactPath.split("/").at(-1) ?? "", 1])
    );
    stat.mockImplementation(async (uri: { path: string }) => ({
      mtime: stored.get(uri.path) ?? 0
    }));
    deleteFile.mockImplementation(async (uri: { path: string }) => {
      stored.delete(uri.path);
    });
    const store = new AgentArtifactStore(storageUri as never, () => 2);
    const values = {
      issueId: "retention-1",
      title: "Bound local response retention",
      response: {
        provider: "openai" as const,
        requestedModel: "gpt-test",
        confirmedModel: "gpt-test",
        text: "Generated response"
      }
    };

    await store.write(values);
    await store.write(values);
    await store.write(values);

    expect(stored.size).toBe(2);
    expect(deleteFile).toHaveBeenCalledTimes(1);
  });

  it("deletes only response artifacts from the fixed extension storage directory", async () => {
    readDirectory.mockResolvedValue([
      ["12345678-1234-4234-8234-123456789abc.txt", 1],
      ["unrelated.txt", 1]
    ]);
    const store = new AgentArtifactStore(storageUri as never);

    await expect(store.clearAll()).resolves.toBe(1);
    expect(deleteFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/extension-storage/agent-responses/12345678-1234-4234-8234-123456789abc.txt"
      }),
      { recursive: false, useTrash: false }
    );
    expect(deleteFile).toHaveBeenCalledTimes(1);
  });
});
