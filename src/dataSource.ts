import * as cp from "node:child_process";

import { classifyCommitSubject } from "./commitTypes";
import { getConfig } from "./config";
import {
  GitCommandStatus,
  GitCommit,
  GitCommitDetails,
  GitCommitNode,
  GitFileChangeType,
  GitRefData,
  GitResetMode,
  GitUnsavedChanges
} from "./types";
import { getPathFromStr } from "./utils";

const eolRegex = /\r\n|\r|\n/g;
const headRegex = /^\(HEAD detached at [0-9A-Za-z]+\)/g;
const gitLogSeparator = "XX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPb";

export class DataSource {
  private gitPath!: string;
  private gitLogFormat!: string;
  private gitCommitDetailsFormat!: string;

  constructor() {
    this.registerGitPath();
    this.generateGitCommandFormats();
  }

  public registerGitPath() {
    this.gitPath = getConfig().gitPath();
  }

  public generateGitCommandFormats() {
    let dateType = getConfig().dateType() === "Author Date" ? "%at" : "%ct";
    this.gitLogFormat = ["%H", "%P", "%an", "%ae", dateType, "%s"].join(gitLogSeparator);
    this.gitCommitDetailsFormat =
      ["%H", "%P", "%an", "%ae", dateType, "%cn"].join(gitLogSeparator) + "%n%B";
  }

  public getBranches(repo: string, showRemoteBranches: boolean) {
    return new Promise<{ branches: string[]; head: string | null; error: boolean }>((resolve) => {
      this.execGit(["branch", ...(showRemoteBranches ? ["-a"] : [])], repo, (err, stdout) => {
        let branchData = {
          branches: <string[]>[],
          head: <string | null>null,
          error: false
        };
        const hiddenBranchPatterns = this.getHiddenBranchPatterns();

        if (err) {
          branchData.error = true;
        } else {
          let lines = stdout.split(eolRegex);
          for (let i = 0; i < lines.length - 1; i++) {
            let name = lines[i].substring(2).split(" -> ")[0];
            if (name.match(headRegex) !== null) continue;

            if (lines[i][0] === "*") {
              branchData.head = name;
              branchData.branches.unshift(name);
            } else if (!this.isHiddenBranch(name, hiddenBranchPatterns)) {
              branchData.branches.push(name);
            }
          }
        }
        resolve(branchData);
      });
    });
  }

  public getCommits(
    repo: string,
    branch: string,
    maxCommits: number,
    showRemoteBranches: boolean,
    commitTypeFilter: string
  ) {
    return new Promise<{
      commits: GitCommitNode[];
      head: string | null;
      moreCommitsAvailable: boolean;
    }>((resolve) => {
      const gitLogPromise =
        branch === ""
          ? this.getBranches(repo, showRemoteBranches).then((branchData) =>
              this.getGitLog(
                repo,
                branch,
                maxCommits + 1,
                showRemoteBranches,
                branchData.branches,
                commitTypeFilter
              )
            )
          : this.getGitLog(repo, branch, maxCommits + 1, showRemoteBranches, [], commitTypeFilter);

      Promise.all([gitLogPromise, this.getRefs(repo, showRemoteBranches)]).then(async (results) => {
        let commits = results[0],
          refData = results[1],
          i,
          unsavedChanges = null;
        let moreCommitsAvailable = commits.length === maxCommits + 1;
        if (moreCommitsAvailable) commits.pop();

        if (refData.head !== null) {
          for (i = 0; i < commits.length; i++) {
            if (refData.head === commits[i].hash) {
              unsavedChanges = getConfig().showUncommittedChanges()
                ? await this.getGitUnsavedChanges(repo)
                : null;
              if (unsavedChanges !== null) {
                commits.unshift({
                  hash: "*",
                  parentHashes: [refData.head],
                  author: "*",
                  email: "",
                  date: Math.round(new Date().getTime() / 1000),
                  message: "Uncommitted Changes (" + unsavedChanges.changes + ")"
                });
              }
              break;
            }
          }
        }

        let commitNodes: GitCommitNode[] = [];
        let commitLookup: { [hash: string]: number } = {};

        for (i = 0; i < commits.length; i++) {
          commitLookup[commits[i].hash] = i;
          commitNodes.push({
            hash: commits[i].hash,
            parentHashes: commits[i].parentHashes,
            author: commits[i].author,
            email: commits[i].email,
            date: commits[i].date,
            message: commits[i].message,
            refs: []
          });
        }
        for (i = 0; i < refData.refs.length; i++) {
          if (typeof commitLookup[refData.refs[i].hash] === "number") {
            commitNodes[commitLookup[refData.refs[i].hash]].refs.push(refData.refs[i]);
          }
        }

        resolve({
          commits: commitNodes,
          head: refData.head,
          moreCommitsAvailable: moreCommitsAvailable
        });
      });
    });
  }

  public commitDetails(repo: string, commitHash: string) {
    return new Promise<GitCommitDetails | null>((resolve) => {
      Promise.all([
        this.spawnGit(
          ["show", "--quiet", commitHash, `--format=${this.gitCommitDetailsFormat}`],
          repo,
          (stdout) => {
            let lines = stdout.split(eolRegex);
            let lastLine = lines.length - 1;
            while (lines.length > 0 && lines[lastLine] === "") lastLine--;
            let commitInfo = lines[0].split(gitLogSeparator);
            return {
              hash: commitInfo[0],
              parents: commitInfo[1].split(" "),
              author: commitInfo[2],
              email: commitInfo[3],
              date: parseInt(commitInfo[4]),
              committer: commitInfo[5],
              body: lines.slice(1, lastLine + 1).join("\n"),
              fileChanges: []
            };
          },
          null
        ),
        this.spawnGit(
          [
            "diff-tree",
            "--name-status",
            "-r",
            "-m",
            "--root",
            "--find-renames",
            "--diff-filter=AMDR",
            commitHash
          ],
          repo,
          (stdout) => stdout.split(eolRegex),
          null
        ),
        this.spawnGit(
          [
            "diff-tree",
            "--numstat",
            "-r",
            "-m",
            "--root",
            "--find-renames",
            "--diff-filter=AMDR",
            commitHash
          ],
          repo,
          (stdout) => stdout.split(eolRegex),
          null
        )
      ])
        .then((results) => {
          const details = results[0] as GitCommitDetails | null;
          const nameStatusLines = results[1] as string[] | null;
          const numStatLines = results[2] as string[] | null;
          let fileLookup: { [file: string]: number } = {};

          if (details === null || nameStatusLines === null || numStatLines === null) {
            resolve(null);
            return;
          }

          for (let i = 1; i < nameStatusLines.length - 1; i++) {
            let line = nameStatusLines[i].split("\t");
            if (line.length < 2) break;
            let oldFilePath = getPathFromStr(line[1]),
              newFilePath = getPathFromStr(line[line.length - 1]);
            fileLookup[newFilePath] = details.fileChanges.length;
            details.fileChanges.push({
              oldFilePath: oldFilePath,
              newFilePath: newFilePath,
              type: <GitFileChangeType>line[0][0],
              additions: null,
              deletions: null
            });
          }

          for (let i = 1; i < numStatLines.length - 1; i++) {
            let line = numStatLines[i].split("\t");
            if (line.length !== 3) break;
            let fileName = line[2].replace(/(.*){.* => (.*)}/, "$1$2").replace(/.* => (.*)/, "$1");
            if (typeof fileLookup[fileName] === "number") {
              details.fileChanges[fileLookup[fileName]].additions = parseInt(line[0]);
              details.fileChanges[fileLookup[fileName]].deletions = parseInt(line[1]);
            }
          }
          resolve(details);
        })
        .catch(() => resolve(null));
    });
  }

  public getCommitFile(repo: string, commitHash: string, filePath: string) {
    return this.spawnGit(["show", commitHash + ":" + filePath], repo, (stdout) => stdout, "");
  }

  public async resolveFilePathInWorkingTree(repo: string, commitHash: string, filePath: string) {
    let resolvedFilePath = getPathFromStr(filePath);
    const commits = await this.spawnGit(
      ["rev-list", "--ancestry-path", "--reverse", commitHash + "..HEAD"],
      repo,
      (stdout) => stdout.split(eolRegex).filter((line) => line !== ""),
      []
    );

    for (let i = 0; i < commits.length; i++) {
      const renamePairs = await this.spawnGit(
        ["diff-tree", "--name-status", "-r", "-m", "--find-renames", "--diff-filter=R", commits[i]],
        repo,
        (stdout) => {
          const pairs: { oldPath: string; newPath: string }[] = [];
          const lines = stdout.split(eolRegex);
          for (let j = 0; j < lines.length; j++) {
            const lineParts = lines[j].split("\t");
            if (lineParts.length < 3 || lineParts[0][0] !== "R") continue;
            pairs.push({
              oldPath: getPathFromStr(lineParts[1]),
              newPath: getPathFromStr(lineParts[2])
            });
          }
          return pairs;
        },
        []
      );

      for (let j = 0; j < renamePairs.length; j++) {
        if (renamePairs[j].oldPath === resolvedFilePath) {
          resolvedFilePath = renamePairs[j].newPath;
        }
      }
    }

    return resolvedFilePath;
  }

  public async getRemoteUrl(repo: string) {
    return new Promise<string | null>((resolve) => {
      this.execGit(["config", "--get", "remote.origin.url"], repo, (err, stdout) => {
        resolve(!err ? stdout.split(eolRegex)[0] : null);
      });
    });
  }

  public isGitRepository(path: string) {
    return new Promise<boolean>((resolve) => {
      this.execGit(["rev-parse", "--git-dir"], path, (err) => {
        resolve(!err);
      });
    });
  }

  public addTag(
    repo: string,
    tagName: string,
    commitHash: string,
    lightweight: boolean,
    message: string
  ) {
    let args = ["tag"];
    if (lightweight) {
      args.push(tagName);
    } else {
      args.push("-a", tagName, "-m", message);
    }
    args.push(commitHash);
    return this.runGitCommandSpawn(args, repo);
  }

  public deleteTag(repo: string, tagName: string) {
    return this.runGitCommandSpawn(["tag", "-d", tagName], repo);
  }

  public pushTag(repo: string, tagName: string) {
    return this.runGitCommandSpawn(["push", "origin", tagName], repo);
  }

  public createBranch(repo: string, branchName: string, commitHash: string) {
    return this.runGitCommandSpawn(["branch", branchName, commitHash], repo);
  }

  public checkoutBranch(repo: string, branchName: string, remoteBranch: string | null) {
    return this.runGitCommandSpawn(
      remoteBranch === null
        ? ["checkout", branchName]
        : ["checkout", "-b", branchName, remoteBranch],
      repo
    );
  }

  public checkoutCommit(repo: string, commitHash: string) {
    return this.runGitCommandSpawn(["checkout", commitHash], repo);
  }

  public deleteBranch(repo: string, branchName: string, forceDelete: boolean) {
    return this.runGitCommandSpawn(
      ["branch", "--delete", ...(forceDelete ? ["--force"] : []), branchName],
      repo
    );
  }

  public renameBranch(repo: string, oldName: string, newName: string) {
    return this.runGitCommandSpawn(["branch", "-m", oldName, newName], repo);
  }

  public mergeBranch(repo: string, branchName: string, createNewCommit: boolean) {
    return this.runGitCommandSpawn(
      ["merge", branchName, ...(createNewCommit ? ["--no-ff"] : [])],
      repo
    );
  }

  public mergeCommit(repo: string, commitHash: string, createNewCommit: boolean) {
    return this.runGitCommandSpawn(
      ["merge", commitHash, ...(createNewCommit ? ["--no-ff"] : [])],
      repo
    );
  }

  public cherrypickCommit(repo: string, commitHash: string, parentIndex: number) {
    return this.runGitCommandSpawn(
      ["cherry-pick", commitHash, ...(parentIndex > 0 ? ["-m", String(parentIndex)] : [])],
      repo
    );
  }

  public revertCommit(repo: string, commitHash: string, parentIndex: number) {
    return this.runGitCommandSpawn(
      ["revert", "--no-edit", commitHash, ...(parentIndex > 0 ? ["-m", String(parentIndex)] : [])],
      repo
    );
  }

  public resetToCommit(repo: string, commitHash: string, resetMode: GitResetMode) {
    return this.runGitCommandSpawn(["reset", `--${resetMode}`, commitHash], repo);
  }

  public resetFileToRevision(repo: string, commitHash: string, filePath: string) {
    return this.runGitCommandSpawn(["checkout", commitHash, "--", filePath], repo);
  }

  private getRefs(repo: string, showRemoteBranches: boolean) {
    return new Promise<GitRefData>((resolve) => {
      const hiddenBranchPatterns = this.getHiddenBranchPatterns();
      this.execGit(
        ["show-ref", ...(showRemoteBranches ? [] : ["--heads", "--tags"]), "-d", "--head"],
        repo,
        (err, stdout) => {
          let refData: GitRefData = { head: null, refs: [] };
          if (!err) {
            let lines = stdout.split(eolRegex);
            for (let i = 0; i < lines.length - 1; i++) {
              let line = lines[i].split(" ");
              if (line.length < 2) continue;

              let hash = line.shift()!;
              let ref = line.join(" ");

              if (ref.startsWith("refs/heads/")) {
                const name = ref.substring(11);
                if (!this.isHiddenBranch(name, hiddenBranchPatterns)) {
                  refData.refs.push({ hash: hash, name: name, type: "head" });
                }
              } else if (ref.startsWith("refs/tags/")) {
                refData.refs.push({
                  hash: hash,
                  name: ref.endsWith("^{}") ? ref.substring(10, ref.length - 3) : ref.substring(10),
                  type: "tag"
                });
              } else if (ref.startsWith("refs/remotes/")) {
                const name = ref.substring(13);
                if (!this.isHiddenBranch(name, hiddenBranchPatterns)) {
                  refData.refs.push({ hash: hash, name: name, type: "remote" });
                }
              } else if (ref === "HEAD") {
                refData.head = hash;
              }
            }
          }
          resolve(refData);
        }
      );
    });
  }

  private getGitLog(
    repo: string,
    branch: string,
    num: number,
    showRemoteBranches: boolean,
    visibleBranches: string[] = [],
    commitTypeFilter: string = "all"
  ) {
    let isFiltered = commitTypeFilter !== "all" && commitTypeFilter !== "";
    let maxCount = isFiltered ? num * 8 : num;
    let args = ["log", "--max-count=" + maxCount, "--format=" + this.gitLogFormat, "--date-order"];
    if (branch !== "") {
      args.push(branch);
    } else if (visibleBranches.length > 0) {
      args.push(...visibleBranches);
    } else {
      args.push("--branches", "--tags");
      if (showRemoteBranches) args.push("--remotes");
    }

    return this.spawnGit(
      args,
      repo,
      (stdout) => {
        let lines = stdout.split(eolRegex);
        let gitCommits: GitCommit[] = [];
        for (let i = 0; i < lines.length - 1; i++) {
          let line = lines[i].split(gitLogSeparator);
          if (line.length !== 6) break;
          const commit: GitCommit = {
            hash: line[0],
            parentHashes: line[1].split(" "),
            author: line[2],
            email: line[3],
            date: parseInt(line[4]),
            message: line[5]
          };
          if (!isFiltered) {
            gitCommits.push(commit);
          } else {
            const commitType = classifyCommitSubject(commit.message);
            if (commitTypeFilter === "other") {
              if (commitType === null) gitCommits.push(commit);
            } else {
              if (commitType === commitTypeFilter) gitCommits.push(commit);
            }
          }
          if (gitCommits.length >= num) break;
        }
        return gitCommits;
      },
      []
    );
  }

  private getHiddenBranchPatterns() {
    const configuredPatterns = getConfig().hiddenBranchPatterns();
    if (!Array.isArray(configuredPatterns)) return <RegExp[]>[];

    const patterns: RegExp[] = [];
    for (let i = 0; i < configuredPatterns.length; i++) {
      if (typeof configuredPatterns[i] !== "string") continue;
      try {
        patterns.push(new RegExp(configuredPatterns[i]));
      } catch {
        continue;
      }
    }
    return patterns;
  }

  private isHiddenBranch(branchName: string, hiddenBranchPatterns: RegExp[]) {
    for (let i = 0; i < hiddenBranchPatterns.length; i++) {
      if (hiddenBranchPatterns[i].test(branchName)) return true;
    }
    return false;
  }

  private getGitUnsavedChanges(repo: string) {
    return new Promise<GitUnsavedChanges | null>((resolve) => {
      this.execGit(
        ["status", "-s", "--branch", "--untracked-files", "--porcelain"],
        repo,
        (err, stdout) => {
          if (!err) {
            let lines = stdout.split(eolRegex);
            resolve(
              lines.length > 2
                ? { branch: lines[0].substring(3).split("...")[0], changes: lines.length - 2 }
                : null
            );
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  private runGitCommandSpawn(args: string[], repo: string) {
    return new Promise<GitCommandStatus>((resolve) => {
      let stdout = "",
        stderr = "",
        err = false;
      const cmd = cp.spawn(this.gitPath, args, { cwd: repo });
      cmd.stdout.on("data", (d) => {
        stdout += d;
      });
      cmd.stderr.on("data", (d) => {
        stderr += d;
      });
      cmd.on("error", (e) => {
        resolve(e.message.split(eolRegex).join("\n"));
        err = true;
      });
      cmd.on("exit", (code) => {
        if (err) return;
        if (code === 0) {
          resolve(null);
        } else {
          let lines = (stdout !== "" ? stdout : stderr !== "" ? stderr : "").split(eolRegex);
          resolve(lines.slice(0, lines.length - 1).join("\n"));
        }
      });
    });
  }

  private execGit(
    args: string[],
    repo: string,
    callback: { (error: Error | null, stdout: string, stderr: string): void }
  ) {
    cp.execFile(this.gitPath, args, { cwd: repo }, callback);
  }

  private spawnGit<T>(
    args: string[],
    repo: string,
    successValue: { (stdout: string): T },
    errorValue: T
  ) {
    return new Promise<T>((resolve) => {
      let stdout = "",
        err = false;
      const cmd = cp.spawn(this.gitPath, args, { cwd: repo });
      cmd.stdout.on("data", (d) => {
        stdout += d;
      });
      cmd.on("error", () => {
        resolve(errorValue);
        err = true;
      });
      cmd.on("exit", (code) => {
        if (err) return;
        resolve(code === 0 ? successValue(stdout) : errorValue);
      });
    });
  }
}
