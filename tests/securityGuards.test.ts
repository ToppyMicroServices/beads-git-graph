import * as path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, defaultValue: unknown) => defaultValue
    })
  }
}));

import { DataSource } from "../src/dataSource";
import { isPathWithinRoot, resolvePathWithinRoot } from "../src/utils";

function repeatChar(char: string, count: number) {
  return Array.from({ length: count }, () => char).join("");
}

function makeHash(index: number, fill: string) {
  const suffix = index.toString(16).padStart(4, "0");
  return `${repeatChar(fill, 36)}${suffix}`.slice(0, 40);
}

describe("path safety helpers", () => {
  it("accepts files inside the repository root", () => {
    const root = path.resolve(path.sep, "repo");
    const target = path.resolve(root, "src", "index.ts");

    expect(isPathWithinRoot(root, target)).toBe(true);
    expect(resolvePathWithinRoot(root, "src/index.ts")).toBe(target);
  });

  it("rejects traversal outside the repository root", () => {
    const root = path.resolve(path.sep, "repo");

    expect(isPathWithinRoot(root, path.resolve(path.sep, "tmp", "file.txt"))).toBe(false);
    expect(resolvePathWithinRoot(root, "../tmp/file.txt")).toBeNull();
  });
});

describe("filtered git log pagination", () => {
  let dataSource: DataSource;

  beforeEach(() => {
    dataSource = new DataSource();
  });

  it("continues paging until it finds enough matching commits", async () => {
    const separator = (dataSource as unknown as { gitLogFormat: string }).gitLogFormat.slice(
      2,
      (dataSource as unknown as { gitLogFormat: string }).gitLogFormat.indexOf("%P")
    );
    const pageOne = Array.from({ length: 200 }, (_, index) =>
      [
        makeHash(index, "a"),
        "",
        "Author",
        "author@example.com",
        "1",
        index === 150 ? "feat: first match" : "chore: filler"
      ].join(separator)
    ).join("\n");
    const pageTwo = Array.from({ length: 50 }, (_, index) =>
      [
        makeHash(index, "b"),
        "",
        "Author",
        "author@example.com",
        "1",
        index === 20 ? "feat: second match" : "docs: filler"
      ].join(separator)
    ).join("\n");

    vi.spyOn(dataSource as never, "spawnGit" as never).mockImplementation(
      async (args: string[], _repo: string, successValue: (stdout: string) => unknown) => {
        const skipArg = args.find((arg) => arg.startsWith("--skip="));
        const skip = skipArg ? Number.parseInt(skipArg.slice("--skip=".length), 10) : 0;
        const stdout = skip === 0 ? `${pageOne}\n` : skip === 200 ? `${pageTwo}\n` : "";
        return successValue(stdout);
      }
    );

    const commits = await (
      dataSource as unknown as {
        getGitLog: (
          repo: string,
          branch: string,
          num: number,
          showRemoteBranches: boolean,
          visibleBranches: string[],
          commitTypeFilter: string
        ) => Promise<Array<{ hash: string }>>;
      }
    ).getGitLog("/repo", "main", 2, false, [], "feat");

    expect(commits.map((commit) => commit.hash)).toEqual([makeHash(150, "a"), makeHash(20, "b")]);
  });
});
