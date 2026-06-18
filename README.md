# Beads Git Graph

[![MIT License](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](./LICENSE)
[![Version 0.3.1](https://img.shields.io/badge/version-0.3.1-0366d6?style=flat-square)](./CHANGELOG.md)

Git graph and Beads issue tools in one VS Code extension.

No telemetry. Privacy-first. Security-first.

## What It Does

- Shows branches, tags, merges, and uncommitted changes in a Git graph
- Opens commit details, changed files, and diffs
- Adds a Beads view in the Activity Bar
- Lets you switch between Git Graph and Beads from the toolbar
- Lets you refresh, create, close, and sync Beads items inside VS Code
- Shows optional parallel, AI model, SSOT/context, and worktree hints on Beads items
- Shows a Beads critical path graph with dependency edges, Start AI, Start Parallel, and merge actions

## Use It

1. Open **Beads Git Graph: View Git Graph (git log)** from the Command Palette.
2. Open the Beads view from the Activity Bar.
3. Use the toolbar to refresh, sync, or switch views.

If your workspace has a `.beads` directory, the extension detects it automatically. Set `beads-git-graph.bdPath` if `bd` is not on `PATH`.

## Multi-Agent Hints

The Beads view surfaces optional execution hints from issue fields, metadata, or labels:

- `parallelizable: true` or label `parallel-ok`
- `model: "gpt-5-codex"` or label `model:gpt-5-codex`
- `ssot: "AGENTS.md, .beads/issues.jsonl"` or label `ssot:AGENTS.md`
- `worktree: "../repo-agent-a"` or label `worktree:../repo-agent-a`

When you use **Start AI**, the extension automatically picks the configured or default model, infers SSOT/context from workspace files such as `AGENTS.md`, `.beads/issues.jsonl`, `README.md`, and `docs`, creates or reuses a git worktree for the task, records model/SSOT/worktree metadata, marks the bead in progress, then opens a GitHub Copilot Background Agent chat session with the bead prompt prefilled.

When multiple ready tasks can run in parallel, **Start Parallel** assigns and starts them in one action. Each task receives its own worktree so the Beads table and graph can show which worktree is expected to carry that agent's changes.

These hints are visual metadata. Beads ready/blocking behavior still comes from issue status and dependencies.

## SSOT Usage

The extension reads SSOT/context from `ssot-usage.json`, `.beads/ssot-usage.json`, or `.codex/ssot-usage.json` before falling back to built-in workspace defaults. The manifest can list default refs and richer context records:

```json
{
  "version": 1,
  "default": ["bd:${issueId}", "AGENTS.md", ".beads/issues.jsonl", "README.md"],
  "contexts": [
    {
      "id": "agent-rules",
      "path": "AGENTS.md",
      "use": "Repository-local instructions and workflow rules."
    }
  ]
}
```

Only existing local paths are added; refs such as `bd:${issueId}` and URLs are kept as-is.

For derived parallel merge tasks, **Merge PRs** checks the registered agent worktrees before asking GitHub CLI to auto-merge their branch PRs. It blocks if a worktree is not registered, does not contain `origin/main`, or has uncommitted changes.

You can run the same guard manually:

```bash
pnpm run worktree-sync:guard -- --base origin/main
```

The PR CI also runs the guard against the PR head so stale branches fail before merge.

## Docs

- [Contributing](./CONTRIBUTING.md)
- [Security Policy](./SECURITY.md)
