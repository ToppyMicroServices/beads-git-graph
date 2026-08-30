---
name: beads-project-manager
description: Plan, decompose, assign, and track dependency-linked agent work with the bd CLI. Use when a user asks to create a Beads plan, coordinate parallel agents, select ready work, or report verified progress.
---

# Beads project manager

Use Beads as the local source of truth for task identity, status, dependencies, acceptance criteria,
and handoffs. Treat Git branches, worktrees, pull requests, tests, and produced files as evidence;
do not infer completion from an agent response alone.

## Establish the local contract

1. Read repository instructions such as `AGENTS.md`, `CONTRIBUTING.md`, and relevant nested files.
2. Inspect `git status --short --branch` before proposing mutations.
3. Check `bd --version` and the help for each command before relying on an option. Beads command
   surfaces vary by version. Do not assume that `bd sync` exists.
4. If `.beads` exists, begin with read-only queries such as `bd --readonly status --json`,
   `bd --readonly ready --json`, and `bd --readonly list --json` when supported.
5. If `bd` is unavailable, produce a reviewable task plan and report the missing prerequisite. Do
   not install software without the user's approval.
6. If `.beads` is absent, keep planning read-only. Before initialization, show the exact command
   and warn that some Beads versions can modify or commit `.beads` and `.gitignore`. Initialize only
   after explicit approval and only with options confirmed by `bd init --help`.

Never automatically run `bd migrate`, `bd bootstrap`, or `--ignore-schema-skew`. A remote-backed
schema mismatch needs an operator decision about the single designated migrator or adoption of an
already-migrated remote. Preserve the error and explain the choices without printing raw errors into
task titles, descriptions, or other user content.

## Build a reviewable plan

Decompose the goal until each leaf task has:

- one concrete outcome and observable acceptance criteria;
- a small, explicit edit or investigation scope;
- the files, references, or upstream task artifacts it may read;
- dependency edges only where downstream work truly needs upstream output;
- a proposed owner/provider/model only when the user requested allocation.

Prefer independent leaf tasks that can run in parallel. Keep integration, acceptance testing, and
release decisions as separate downstream tasks. Do not create a grid of unrelated tasks merely to
increase parallelism.

Before writing to Beads, show:

1. the tasks and acceptance criteria;
2. dependency direction in plain language (`B depends on A`);
3. the tasks ready at the start and the later parallel waves;
4. the exact `bd` mutations or a supported `bd create --graph` input.

Use `bd create --dry-run` when the installed version supports it. Ask for approval before creating
or rewiring tasks unless the user already explicitly requested those writes.

## Dispatch ready work

Use `bd ready --json` as the readiness authority when it is supported. Do not dispatch an open task
merely because it looks unblocked in a manually reconstructed graph. Claim a selected task
atomically with `bd update <id> --claim` when supported.

For parallel work:

- give each agent one leaf task with its Beads ID, acceptance criteria, allowed scope, and required
  upstream artifacts;
- use separate worktrees or otherwise isolated edit scopes when agents can change overlapping
  repositories;
- record branch, worktree, provider/model request, and output path as metadata only when the local
  Beads version supports the chosen fields;
- keep integration serialized after all required upstream evidence exists.

An assigned task is not necessarily running. An `in_progress` status is recorded state, not a live
heartbeat. Say which evidence is observed and which state is only recorded.

## Verify and update progress

For every result:

1. inspect the actual diff or artifact;
2. run the acceptance checks appropriate to the task;
3. record the exact checks and their outcomes;
4. update or close the Beads task only after its acceptance criteria are satisfied;
5. unblock downstream work by re-running `bd ready --json` rather than guessing.

`response_completed`, generated text, a pushed branch, or an open pull request does not by itself
mean that the task was accepted. If verification is unavailable, leave the task open and record the
missing evidence.

End with a short status report containing completed task IDs, currently ready task IDs, blocked
task IDs with reasons, observed test results, and the next operator decision. Never claim a push,
publication, deployment, migration, or user review that did not occur.
