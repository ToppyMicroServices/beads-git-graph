# Beads Git Graph

[![MIT License](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](./LICENSE)
[![Version 0.9.1](https://img.shields.io/badge/version-0.9.1-0366d6?style=flat-square)](./CHANGELOG.md)

A local project workspace for coordinating tasks across AI providers in VS Code.
Create tasks, follow dependencies, and review results without installing Beads or another task CLI.
Git history and existing Beads workspaces are supported too.

![Graph view with dependency arrows connecting work in progress, a ready task, and a review task](./docs/assets/graph-overview.png)

_Graph view with sample tasks. **Now** marks recorded work in progress; **Next** marks ready work._

## Find your way around

| View       | Use it to                                                                 |
| ---------- | ------------------------------------------------------------------------- |
| **Graph**  | Follow dependencies, see Now/Next, and inspect the longest chain.         |
| **Table**  | Filter, sort, and inspect task details.                                   |
| **Manage** | Inspect task plans, follow local execution stages, and start ready tasks. |
| **Plan**   | Turn a goal into editable tasks and preview dependencies before import.   |

![Manage view grouping sample tasks into Needs attention, Review, Recorded in progress, Queue, and Done](./docs/assets/manage-overview.png)

_Manage view with sample tasks. Lanes reflect recorded task and Git/PR metadata, not live agent monitoring._

## Get started

1. Install from [VS Marketplace](https://marketplace.visualstudio.com/items?itemName=ToppyMicroServices.beads-git-graph)
   or [Open VSX](https://open-vsx.org/extension/ToppyMicroServices/beads-git-graph).
2. Open a folder, then open **Tasks** from the Beads Git Graph Activity Bar entry.
3. Create a task, update its status, and add dependencies. Use **Graph**, **Table**, and **Manage**
   to follow work, or **Plan** to draft and import a larger plan.

Folders without `.beads` use built-in local tasks. Tasks are saved to `.taskgraph/tasks.json`
on the first write; opening the folder does not create a task file. Basic task management needs no
account, AI provider, or Git repository. Writes require a trusted workspace.

An existing `.beads` folder keeps using Beads. Its task actions still require the `bd` CLI;
if it is unavailable, the extension reports the problem rather than switching task stores.
Set `beads-git-graph.bdPath` in machine settings if needed. The extension does not initialize or
migrate your Beads database, or copy its tasks into the local store.

For a Git repository, run **Beads Git Graph: View Git Graph (git log)** from the Command Palette.

**Graph controls:** wheel to zoom at the pointer, drag to pan, Option/Alt-drag to box-zoom,
and double-click to fit all. Your selection and viewport stay in place during normal refreshes.

## Choose how work runs

**Start AI** asks for a provider and model. It becomes available when the active task store confirms
the task is ready and the workspace supports the required writes. Provider setup and explicit AI
approval still apply; local task management itself does not make AI requests.

| Provider                            | Execution                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| **GitHub Copilot**                  | Opens a coding-agent session in an isolated worktree.                                 |
| **Ollama**                          | Generates or edits one declared local artifact, including upstream artifact context.  |
| **Hugging Face, OpenAI, Anthropic** | Generates one new artifact from task metadata; existing workspace files are not sent. |

Direct-provider output is verified and shown for your approval before a file is written.
A generated response or applied edit does not automatically close a task.
See the [provider setup and execution guide](./docs/user-guide.md#multi-agent-hints) for credentials,
model choices, parallel runs, and limits.

Copilot sessions require Git for an isolated worktree. The optional
[Beads Agent Project Manager plugin](./docs/agent-plugin.md) supports Beads workflows and still
requires `bd`; it is not needed for the extension's built-in local tasks.

## Privacy and safety

Privacy-first, security-first: the extension emits no telemetry. AI execution requires a trusted
workspace and approval. Cloud providers have their own data policies. Task records and AI audit
files may contain plain text. Local task files and Beads files may be Git-tracked—keep secrets out
of them and review changes before committing.
Read the [security boundaries](./docs/user-guide.md#security-and-privacy-boundaries) before running agents.

## More

[User guide](./docs/user-guide.md) · [Testing](./docs/user-testing-agent-project-manager.md) ·
[Contributing](./CONTRIBUTING.md) · [Security policy](./SECURITY.md) · [Changelog](./CHANGELOG.md)
