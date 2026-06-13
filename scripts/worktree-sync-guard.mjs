#!/usr/bin/env node
/* eslint-disable no-console */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function parseWorktreePorcelain(output) {
  const worktrees = [];
  let current = null;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") {
      if (current !== null) {
        worktrees.push(current);
        current = null;
      }
      continue;
    }

    const [key, ...valueParts] = line.split(" ");
    const value = valueParts.join(" ");
    if (key === "worktree") {
      if (current !== null) {
        worktrees.push(current);
      }
      current = {
        path: value,
        branch: "",
        head: "",
        bare: false,
        detached: false
      };
      continue;
    }

    if (current === null) {
      continue;
    }

    if (key === "HEAD") {
      current.head = value;
    } else if (key === "branch") {
      current.branch = value.replace(/^refs\/heads\//, "");
    } else if (key === "bare") {
      current.bare = true;
    } else if (key === "detached") {
      current.detached = true;
    }
  }

  if (current !== null) {
    worktrees.push(current);
  }

  return worktrees;
}

export function parseRevListCounts(output) {
  const [aheadRaw, behindRaw] = output.trim().split(/\s+/);
  return {
    ahead: Number.parseInt(aheadRaw || "0", 10) || 0,
    behind: Number.parseInt(behindRaw || "0", 10) || 0
  };
}

export function summarizeFindings(findings) {
  const failures = findings.filter((finding) => finding.level === "error");
  const warnings = findings.filter((finding) => finding.level === "warning");
  return {
    ok: failures.length === 0,
    failures,
    warnings
  };
}

function parseArgs(argv) {
  const options = {
    all: false,
    base: "origin/main",
    cwd: process.cwd(),
    requireClean: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--all") {
      options.all = true;
    } else if (arg === "--require-clean") {
      options.requireClean = true;
    } else if (arg === "--base") {
      options.base = argv[i + 1] ?? options.base;
      i += 1;
    } else if (arg === "--cwd") {
      options.cwd = argv[i + 1] ?? options.cwd;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/worktree-sync-guard.mjs [options]

Checks that PR or agent worktrees are synced before merge.

Options:
  --base <ref>        Base ref that every checked HEAD must contain (default: origin/main)
  --all               Check every linked git worktree instead of only the current worktree
  --cwd <path>        Repository path to inspect (default: current directory)
  --require-clean     Also fail when a checked worktree has uncommitted changes
`);
}

function runGit(args, cwd) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function commandText(args) {
  return `git ${args.join(" ")}`;
}

function currentWorktree(cwd) {
  const topLevel = runGit(["rev-parse", "--show-toplevel"], cwd);
  if (topLevel.status !== 0) {
    throw new Error(topLevel.stderr.trim() || "Unable to resolve git worktree root.");
  }

  const branch = runGit(["branch", "--show-current"], cwd);
  const head = runGit(["rev-parse", "HEAD"], cwd);
  return [
    {
      path: topLevel.stdout.trim(),
      branch: branch.status === 0 ? branch.stdout.trim() : "",
      head: head.status === 0 ? head.stdout.trim() : "",
      bare: false,
      detached: branch.status !== 0 || branch.stdout.trim() === ""
    }
  ];
}

function listWorktrees(cwd) {
  const result = runGit(["worktree", "list", "--porcelain"], cwd);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Unable to list git worktrees.");
  }
  return parseWorktreePorcelain(result.stdout).filter((worktree) => !worktree.bare);
}

function checkWorktree(worktree, options) {
  const findings = [];

  const baseContains = runGit(["merge-base", "--is-ancestor", options.base, "HEAD"], worktree.path);
  if (baseContains.status === 1) {
    findings.push({
      level: "error",
      path: worktree.path,
      message: `HEAD does not contain ${options.base}; rebase or merge the latest base before PR merge.`
    });
  } else if (baseContains.status !== 0) {
    findings.push({
      level: "error",
      path: worktree.path,
      message: `${commandText(["merge-base", "--is-ancestor", options.base, "HEAD"])} failed: ${baseContains.stderr.trim()}`
    });
  }

  const upstream = runGit(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    worktree.path
  );
  if (upstream.status === 0 && upstream.stdout.trim() !== "") {
    const counts = runGit(
      ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
      worktree.path
    );
    if (counts.status === 0) {
      const { behind } = parseRevListCounts(counts.stdout);
      if (behind > 0) {
        findings.push({
          level: "error",
          path: worktree.path,
          message: `Local branch is ${behind} commit(s) behind ${upstream.stdout.trim()}; pull/rebase before merge.`
        });
      }
    } else {
      findings.push({
        level: "warning",
        path: worktree.path,
        message: `${commandText(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])} failed: ${counts.stderr.trim()}`
      });
    }
  } else {
    findings.push({
      level: "warning",
      path: worktree.path,
      message: "No upstream branch is configured; only the base ancestry check was applied."
    });
  }

  if (options.requireClean) {
    const status = runGit(["status", "--porcelain"], worktree.path);
    if (status.status !== 0) {
      findings.push({
        level: "error",
        path: worktree.path,
        message: `${commandText(["status", "--porcelain"])} failed: ${status.stderr.trim()}`
      });
    } else if (status.stdout.trim() !== "") {
      findings.push({
        level: "error",
        path: worktree.path,
        message: "Worktree has uncommitted changes; commit, stash, or discard them before merge."
      });
    }
  }

  return findings;
}

function printFindings(worktrees, findings, options) {
  console.log(
    `Worktree sync guard checked ${worktrees.length} worktree(s) against ${options.base}.`
  );

  if (findings.length === 0) {
    console.log("All checked worktrees contain the base ref.");
    return;
  }

  for (const finding of findings) {
    const prefix = finding.level === "error" ? "ERROR" : "WARNING";
    console.log(`${prefix}: ${finding.path}: ${finding.message}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  options.cwd = realpathSync(resolve(options.cwd));

  const worktrees = options.all ? listWorktrees(options.cwd) : currentWorktree(options.cwd);
  const findings = worktrees.flatMap((worktree) => checkWorktree(worktree, options));
  const summary = summarizeFindings(findings);

  printFindings(worktrees, findings, options);
  process.exit(summary.ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
