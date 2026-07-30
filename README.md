# Beads Git Graph

[![MIT License](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](./LICENSE)
[![Version 0.4.20260710](https://img.shields.io/badge/version-0.4.20260710-0366d6?style=flat-square)](./CHANGELOG.md)

A local-first project manager for coordinating dependency-linked work across different AI providers
and requested models, with Git graph and Beads issue tools in one VS Code extension.

The extension itself emits no telemetry. Privacy-first. Security-first.

![Plan Draft preview showing dependency-linked requested AI model transitions](./docs/assets/plan-draft-preview.png)

Describe a goal, generate dependency-linked tasks with a selected AI, and review every handoff
before approving an import or starting work.

## What It Does

- Shows branches, tags, merges, and uncommitted changes in a Git graph
- Opens commit details, changed files, and diffs
- Adds a Beads view in the Activity Bar
- Lets you switch between Git Graph and Beads from the toolbar
- Lets you refresh, create, close, and sync Beads items inside VS Code
- Shows optional parallel, AI provider/model, response artifact, SSOT/context, worktree, branch, PR, check, and sync-risk hints on Beads items
- Shows a Beads execution map with Critical Path, dependency arrows, dashed parent-child lines, merge/worktree risk, Start AI, Start Parallel, and merge actions
- Zooms the execution map around the location under the pointer, pans with normal drag, box-zooms
  with Option/Alt-drag, and preserves the transform when switching views, resizing, or refreshing
- Refreshes task data in place without moving the visible area while preserving the selected view,
  open details, filters, sorting, collapsed groups, scroll position, and graph transform
- Adds a Manage view that groups recorded work into Needs attention, Review, Recorded in progress, Queue, and Done
- Adds an AI Plan Draft workflow that turns a goal into editable tasks, then validates and previews dependencies, Critical Path, parallel groups, requested provider/model transitions, and exact Beads mutations before import

## Use It

1. Open **Beads Git Graph: View Git Graph (git log)** from the Command Palette.
2. Open the Beads view from the Activity Bar.
3. Use the toolbar to refresh, sync, or switch views.

If your workspace has a `.beads` directory, the extension detects it automatically. Set the
machine-scoped `beads-git-graph.bdPath` setting if `bd` is not on `PATH`.

## Manage Agent Work

Open **Manage** in the Beads view to see the Agent Work Queue. It derives each lane from Beads status and recorded worktree, PR, check, and sync-risk metadata:

- **Needs attention**: explicitly blocked work, known failing checks, dangerous sync risk, or an unrecognized status
- **Review**: a pull request is recorded and no supported failure signal is present
- **Recorded in progress**: Beads reports the task as in progress
- **Queue**: open work, with confirmed readiness distinguished from readiness not yet confirmed by `bd ready`
- **Done**: Beads reports the task as closed

The Manage view does not claim live agent monitoring. “Recorded in progress” reflects Beads status,
and unavailable evidence remains unconfirmed. In Manage, **Start AI** is enabled only when
`bd ready` confirms readiness. Use **Details**, **Start AI**, and **Merge PRs** to continue through
the existing workflow.

## Plan Agent Work

Open **Plan** in the Beads view and follow the explicit four-step flow:

1. Describe the project goal and select **Generate task plan with AI**.
2. Choose an Ollama, Hugging Face, OpenAI, or Anthropic direct-response provider and model, review
   the one-request confirmation, and approve it.
3. Review and edit the returned Plan Draft. The local preview shows tasks, dependencies, acceptance
   criteria, SSOT/provider/model hints, Critical Path, parallel groups, requested provider/model
   transitions, validation errors, and the exact ordered Beads mutations.
4. Select **Import Plan** only after the draft is correct, then move to **Manage** to run work that
   Beads currently reports as ready.

AI generation creates an editable draft only. It does not import tasks, mutate Beads, execute the
response, or start an agent. The planning request contains the goal, workspace display name,
available relative SSOT references, and configured provider/model choices; it does not include file
contents, an absolute workspace path, or credentials. The raw provider response is retained as a
local, plain-text, untrusted artifact for review. Do not put credentials or other secrets in the
goal or draft. GitHub Copilot is not used for draft generation because its integration opens a
coding session rather than returning a synchronous text response.

You can also open **Advanced: view or edit Plan Draft JSON** to paste a version 1 draft, load the
example, or edit the generated JSON directly. Preview remains local and read-only. When
dependency-linked tasks declare different providers or models, it shows the planned requested
provider/model transitions between them.

**Import Plan** is enabled only when the active workspace has a Beads database and the installed
`bd` executable demonstrates the required create, update, and dependency commands. The Extension
Host parses and validates the draft again, repeats the capability check, shows the mutation list,
and asks for explicit approval before executing it. Discarding the draft performs no Beads write.

A missing executable, unsupported command, or schema mismatch keeps import disabled and shows the
observed reason. The extension does not initialize, bootstrap, or migrate a Beads database. If an
approved import fails partway through, it stops, reports created IDs plus failed and unexecuted
operations, and does not claim rollback.

## Multi-Agent Hints

The Beads view surfaces optional execution hints from issue fields, metadata, or labels:

- `parallelizable: true` or label `parallel-ok`
- `provider: "ollama"` or label `provider:ollama`
- `model: "gpt-5-codex"` or label `model:gpt-5-codex`
- `ssot: "AGENTS.md, .beads/issues.jsonl"` or label `ssot:AGENTS.md`
- `worktree: "../repo-agent-a"` or label `worktree:../repo-agent-a`
- `branch: "agent/task-a"` or label `branch:agent/task-a`
- `pr: 123`, `check_status: "success"`, or labels such as `pr:#123`, `checks:success`
- `sync_risk: "stale"` or label `sync-risk:stale`

When you use **Start AI**, the extension asks for a provider and then a provider-scoped model before
changing anything:

| Provider               | Result                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| GitHub Copilot         | Creates or reuses a git worktree and opens a coding-agent session, with clipboard/chat fallback |
| Ollama                 | Calls a loopback-only local Ollama runtime and stores its text response as a local artifact     |
| Hugging Face Inference | Calls the Hugging Face Inference Providers chat endpoint and stores its text response           |
| OpenAI API             | Calls the OpenAI Responses API with `store: false` and stores the returned text locally         |
| Anthropic API (Claude) | Calls the Anthropic Messages API and stores the returned text locally                           |

Direct Ollama, Hugging Face, OpenAI, and Anthropic calls are text-response runs, not coding-agent
sessions. Their output is marked untrusted, is not executed or applied to the worktree, and must be
reviewed. The extension records `provider`, requested `model`, response status, and a local artifact
reference in Beads; it does not record the API key, full prompt, or raw response there.

Canceling a picker or the request confirmation performs no provider call, Beads write, or worktree
mutation. Before a cloud request, the confirmation shows the request count and each provider/model.
The prompt contains the task ID/title, workspace name, SSOT references, and dependency IDs, but no
file contents are read into it automatically. Cloud providers may charge for each request.

Before preparing a worktree or contacting any provider, the extension runs a non-mutating Beads
dry-run and checks that one atomic task update can record the assignment, status, notes, and
metadata. A missing command or schema mismatch disables AI actions before any paid request. If a
write still fails after a response is generated, the local response artifact is preserved and
opened for review with the partial state reported explicitly.

Use **Beads Git Graph: Manage AI Provider Credentials** to store or delete Hugging Face, OpenAI, and
Anthropic credentials in VS Code SecretStorage. `HF_TOKEN`, `OPENAI_API_KEY`, and
`ANTHROPIC_API_KEY` are supported as environment fallbacks. API keys are not accepted in workspace
settings. Cloud endpoints are fixed, Ollama is restricted to loopback URLs, and all AI execution and
credential management require a trusted workspace.

Configure provider/model choices and the direct-response request bound with:

- `beads-git-graph.agentModelOptions` for Copilot
- `beads-git-graph.agentOllamaModelOptions`
- `beads-git-graph.agentHuggingFaceModelOptions`
- `beads-git-graph.agentOpenAIModelOptions`
- `beads-git-graph.agentAnthropicModelOptions`
- `beads-git-graph.agentParallelConcurrency` for the direct-response request bound (default `4`,
  range `1`–`8`)
- `beads-git-graph.agentArtifactRetentionCount` for the maximum number of plain-text responses kept
  in this workspace's VS Code extension storage (default `50`, range `1`–`500`)

Exact model availability remains provider/account-specific, so every picker also accepts a custom
model ID. A Hugging Face repository model run by Ollama should be represented as
`provider=ollama` plus its exact `hf.co/...` model name. Hugging Face Inference Providers may route
through another inference provider, so the extension does not infer an unconfirmed backend.

Use task dependencies to plan work across different requested AI models. Acceptance criteria and
shared SSOT references record the intended handoff, while Beads readiness controls when dependent
work becomes eligible. When dependent work starts, its prompt lists upstream bead handoffs and asks
the agent to inspect their recorded output, worktree, and PR state instead of assuming integration.
The Extension Host rechecks readiness and current `bd show` dependencies before worktree
preparation and again before the Beads update. SSOT remains a shared reference, not an enforced
artifact-production contract.

When multiple ready tasks can run in parallel, **Start Parallel** asks whether to preserve each
task's provider/model handoff or override every selected task. It preflights every required
credential before execution, confirms the number of text-response calls, and keeps one batch to at
most 20 direct-provider requests. Direct Ollama, Hugging Face, OpenAI, and Anthropic requests use a
bounded concurrency limit. Beads readiness checks, Beads updates, and Git/worktree mutations remain
serialized per workspace, so concurrent responses cannot race those state changes. Copilot coding
sessions are launched sequentially into isolated worktrees; they are not counted as concurrent
direct-response calls.

The batch result records a per-task outcome such as response ready, session started, prompt
prepared, failed, skipped, or cancelled. These are completed or recorded outcomes, not live process
monitoring. Failed or cancelled tasks can be retried without rerunning successful tasks. Direct API
tasks receive local response artifacts and are not presented as worktree-editing agents.

These hints are visual metadata. Beads ready/blocking behavior still comes from issue status and dependencies.

## Security and Privacy Boundaries

In VS Code Restricted Mode, the extension keeps Git history and tracked Beads JSON/JSONL viewing
available, but it does not start `bd`, contact an AI provider, manage provider credentials, create a
worktree, or change Git or Beads state. Trust the workspace before using those actions. The
Extension Host enforces this boundary even if a webview sends a forged action message.

Every `bd` process started by this extension, including executable and capability checks, receives
`DOLT_DISABLE_EVENT_FLUSH=true`. This suppresses Dolt event flushing for those child processes. It
does not change the behavior of `bd` run manually outside the extension, and selected cloud AI
providers have their own network and privacy policies.

AI response artifacts are unencrypted plain-text files in VS Code's workspace extension storage.
They are never executed automatically, the oldest files are removed after the configured retention
count is exceeded, and **Beads Git Graph: Clear Stored AI Response Artifacts** deletes the retained
set after confirmation. Avoid sending or storing credentials, private keys, personal data, or other
secrets in prompts, generated responses, task titles, descriptions, notes, or labels.

Beads data is also local plain text and can be tracked by Git. This repository's default Beads setup
tracks selected JSONL/configuration records, so data committed to a public repository becomes
public. Review `.beads` changes before committing. The extension does not initialize, bootstrap, or
migrate a Beads database, and it preserves schema-mismatch failures instead of bypassing them.

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
