# Beads Git Graph

[![MIT License](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](./LICENSE)
[![Version 0.4.20260710](https://img.shields.io/badge/version-0.4.20260710-0366d6?style=flat-square)](./CHANGELOG.md)

A local-first project manager for agent work, with Git graph and Beads issue tools in one VS Code extension.

No telemetry. Privacy-first. Security-first.

![Plan Draft preview showing dependency validation and the Critical Path](./docs/assets/plan-draft-preview.png)

Validate dependencies and review the Critical Path before approving an import.

## What It Does

- Shows branches, tags, merges, and uncommitted changes in a Git graph
- Opens commit details, changed files, and diffs
- Adds a Beads view in the Activity Bar
- Lets you switch between Git Graph and Beads from the toolbar
- Lets you refresh, create, close, and sync Beads items inside VS Code
- Shows optional parallel, AI model, SSOT/context, worktree, branch, PR, check, and sync-risk hints on Beads items
- Shows a Beads execution map with Critical Path, dependency edges, parent context, merge/worktree risk, Start AI, Start Parallel, and merge actions
- Adds a Manage view that groups recorded work into Needs attention, Review, Running, Queue, and Done
- Adds a Plan Draft workflow that validates and previews tasks, dependencies, Critical Path, parallel groups, and exact Beads mutations before import

## Use It

1. Open **Beads Git Graph: View Git Graph (git log)** from the Command Palette.
2. Open the Beads view from the Activity Bar.
3. Use the toolbar to refresh, sync, or switch views.

If your workspace has a `.beads` directory, the extension detects it automatically. Set `beads-git-graph.bdPath` if `bd` is not on `PATH`.

## Manage Agent Work

Open **Manage** in the Beads view to see the Agent Work Queue. It derives each lane from Beads status and recorded worktree, PR, check, and sync-risk metadata:

- **Needs attention**: explicitly blocked work, known failing checks, dangerous sync risk, or an unrecognized status
- **Review**: a pull request is recorded and no supported failure signal is present
- **Running**: Beads reports the task as in progress
- **Queue**: open work, with confirmed readiness distinguished from readiness not yet confirmed by `bd ready`
- **Done**: Beads reports the task as closed

The Manage view does not claim live agent monitoring. “Running” reflects recorded Beads status, and unavailable evidence remains unconfirmed. In Manage, **Start AI** is enabled only when `bd ready` confirms readiness. Use **Details**, **Start AI**, and **Merge PRs** to continue through the existing workflow.

## Plan Agent Work

Open **Plan** in the Beads view, paste a version 1 Plan Draft or select **Load example**, and then
select **Preview**. The preview is local and read-only. It shows the goal, tasks, dependencies,
acceptance criteria, SSOT/model hints, Critical Path, parallel groups, and the exact ordered Beads
mutations that an import would request.

**Import Plan** is enabled only when the active workspace has a Beads database and the installed
`bd` executable demonstrates the required create, update, and dependency commands. The Extension
Host parses and validates the draft again, repeats the capability check, shows the mutation list,
and asks for explicit approval before executing it. **Cancel** discards the draft without a Beads
write.

A missing executable, unsupported command, or schema mismatch keeps import disabled and shows the
observed reason. The extension does not initialize, bootstrap, or migrate a Beads database. If an
approved import fails partway through, it stops, reports created IDs plus failed and unexecuted
operations, and does not claim rollback.

## Multi-Agent Hints

The Beads view surfaces optional execution hints from issue fields, metadata, or labels:

- `parallelizable: true` or label `parallel-ok`
- `model: "gpt-5-codex"` or label `model:gpt-5-codex`
- `ssot: "AGENTS.md, .beads/issues.jsonl"` or label `ssot:AGENTS.md`
- `worktree: "../repo-agent-a"` or label `worktree:../repo-agent-a`
- `branch: "agent/task-a"` or label `branch:agent/task-a`
- `pr: 123`, `check_status: "success"`, or labels such as `pr:#123`, `checks:success`
- `sync_risk: "stale"` or label `sync-risk:stale`

When you use **Start AI**, the extension asks for a model preference before changing anything. The
picker offers the task's declared model, choices from `beads-git-graph.agentModelOptions`, and a
custom entry. It then infers SSOT/context from workspace files such as `AGENTS.md`,
`.beads/issues.jsonl`, `README.md`, and `docs`, creates or reuses a git worktree, records
model/SSOT/worktree/branch metadata, marks the bead in progress, and opens a GitHub Copilot
Background Agent chat session with the bead prompt prefilled. Canceling the picker performs no
Beads or worktree mutation.

The selected value is a requested model recorded in Beads and included in the prompt; the current
launch provider remains GitHub Copilot, and actual model availability depends on that provider.
Choosing a different provider such as a local CLI requires the future provider adapter.

When multiple ready tasks can run in parallel, **Start Parallel** asks whether to preserve each
task's model preference or override every selected task. Each task receives its own worktree so the
Beads table and graph can show which worktree is expected to carry that agent's changes. Active
tasks that are skipped are reported with the reason.

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

For derived parallel merge tasks, **Merge PRs** checks the registered agent worktrees and branch PR checks before asking GitHub CLI to auto-merge their branch PRs. It blocks if a worktree is not registered, does not contain `origin/main`, has uncommitted changes, has no open PR, or has missing, pending, or failing checks.

You can run the same guard manually:

```bash
pnpm run worktree-sync:guard -- --base origin/main
```

The PR CI also runs the guard against the PR head so stale branches fail before merge.

## Docs

- [Contributing](./CONTRIBUTING.md)
- [Security Policy](./SECURITY.md)
