import * as path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { stat } = vi.hoisted(() => ({
  stat: vi.fn(async () => ({ mtimeMs: 0 }))
}));

vi.mock("node:fs/promises", () => ({ stat }));
vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, defaultValue: unknown) => defaultValue
    })
  }
}));

import { DataSource } from "../src/dataSource";

describe("Git Graph fetch metadata", () => {
  let dataSource: DataSource;

  beforeEach(() => {
    dataSource = new DataSource();
    stat.mockReset();
    stat.mockResolvedValue({ mtimeMs: 0 });
  });

  it("fetches every configured remote without pruning or prompting", async () => {
    const runner = vi
      .spyOn(dataSource as never, "runGitCommandSpawn" as never)
      .mockResolvedValue(null as never);

    await expect(dataSource.fetchAll("/repo")).resolves.toBeNull();
    expect(runner).toHaveBeenCalledWith(
      ["fetch", "--all"],
      "/repo",
      expect.objectContaining({ GIT_TERMINAL_PROMPT: "0" })
    );
    expect(runner).not.toHaveBeenCalledWith(
      expect.arrayContaining(["--prune"]),
      expect.anything(),
      expect.anything()
    );
  });

  it("reads the last fetch time from the repository FETCH_HEAD metadata", async () => {
    vi.spyOn(dataSource as never, "spawnGit" as never).mockImplementation(
      async (_args: string[], _repo: string, successValue: (stdout: string) => unknown) =>
        successValue(".git/FETCH_HEAD\n")
    );
    stat.mockResolvedValue({ mtimeMs: 1_786_000_000_000 });

    await expect(dataSource.getLastFetchAt("/repo")).resolves.toBe(1_786_000_000_000);
    expect(stat).toHaveBeenCalledWith(path.resolve("/repo", ".git/FETCH_HEAD"));
  });

  it("reports an unknown fetch time when FETCH_HEAD is unavailable", async () => {
    vi.spyOn(dataSource as never, "spawnGit" as never).mockResolvedValue("" as never);

    await expect(dataSource.getLastFetchAt("/repo")).resolves.toBeNull();
    expect(stat).not.toHaveBeenCalled();
  });
});
