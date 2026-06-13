# Beads Git Graph

[![MIT License](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](./LICENSE)
[![Version 0.1.33](https://img.shields.io/badge/version-0.1.33-0366d6?style=flat-square)](./CHANGELOG.md)

Git graph and Beads issue tools in one VS Code extension.

No telemetry. Privacy-first. Security-first.

## What It Does

- Shows branches, tags, merges, and uncommitted changes in a Git graph
- Opens commit details, changed files, and diffs
- Adds a Beads view in the Activity Bar
- Lets you switch between Git Graph and Beads from the toolbar
- Lets you refresh, create, close, and sync Beads items inside VS Code
- Shows optional parallel, agent, and worktree hints on Beads items

## Use It

1. Open **Beads Git Graph: View Git Graph (git log)** from the Command Palette.
2. Open the Beads view from the Activity Bar.
3. Use the toolbar to refresh, sync, or switch views.

If your workspace has a `.beads` directory, the extension detects it automatically. Set `beads-git-graph.bdPath` if `bd` is not on `PATH`.

## Multi-Agent Hints

The Beads view surfaces optional execution hints from issue fields or labels:

- `parallelizable: true` or label `parallel-ok`
- `agent: "agent-a"` or label `agent:agent-a`
- `worktree: "../repo-agent-a"` or label `worktree:../repo-agent-a`

These hints are visual metadata. Beads ready/blocking behavior still comes from issue status and dependencies.

Before merging a multi-agent PR, make sure every agent worktree contains the latest base branch:

```bash
pnpm run worktree-sync:guard -- --base origin/main
```

The PR CI also runs the guard against the PR head so stale branches fail before merge.

## Docs

- [Contributing](./CONTRIBUTING.md)
- [Security Policy](./SECURITY.md)
