# Beads Agent Project Manager plugin

This repository also contains an Agent Plugins 1.0 package for GitHub Copilot in VS Code and
compatible clients. It is separate from the Beads Git Graph VSIX:

- the VSIX provides the Graph, Table, Manage, and Plan user interface;
- the agent plugin provides a Beads-aware project-manager skill and a Copilot custom agent;
- the plugin uses the installed `bd` CLI and does not call the VSIX Extension Host API.

The active plugin payload is sourced only from `agent-plugin/`. It excludes the repository's
`.beads` database, VSIX files, `node_modules`, and extension sources. Self-hosted marketplace
clients can clone the full public repository into a separate marketplace source cache, so that
source cache can contain tracked files outside the active plugin payload.

## Install from the repository marketplace

1. Enable `chat.plugins.enabled` in VS Code.
2. Add this repository to `chat.plugins.marketplaces`:

```json
{
  "chat.plugins.enabled": true,
  "chat.plugins.marketplaces": ["ToppyMicroServices/beads-git-graph"]
}
```

3. Open the Agent Plugins view or search Extensions for `@agentPlugins`.
4. Install **Beads Agent Project Manager**, review the marketplace trust prompt, and confirm the
   installed skill and agent in **Chat: Open Customizations**.

The marketplace is defined by `.github/plugin/marketplace.json` and points only to
`agent-plugin/`. Review changes before updating because plugins can instruct an agent to run local
tools.

With GitHub Copilot CLI, use the marketplace form:

```sh
copilot plugin marketplace add ToppyMicroServices/beads-git-graph
copilot plugin install beads-agent-project-manager@toppymicroservices-agent-plugins
```

Copilot CLI 1.0.82 still accepts the direct repository form
`ToppyMicroServices/beads-git-graph:agent-plugin` and lists it in `plugin install --help`, but the
runtime emits a deprecation warning for direct installs. Use the marketplace form above as the
recommended forward-compatible path.

## Start safely

1. Confirm that Beads is already available with `bd --version`.
2. Select **Beads Project Manager** in Chat.
3. Start with a read-only request such as:

```text
Inspect this repository read-only. Show the ready tasks, dependency waves, and proposed owners.
Do not mutate Beads or start agents.
```

The plugin can coordinate assignments and readiness with the local `bd` CLI. Starting parallel
agents requires a client that exposes compatible agent or task tools. Without those tools, it
returns a reviewable allocation plan instead of claiming that workers were started.

This self-hosted marketplace is public when these files are present on the repository's default
branch. Inclusion in a marketplace that VS Code configures by default is a separate review and
submission process.

## Subagent plans and execution reports

The plugin reports plans and progress in chat. A plan shows the parent and its leaf tasks, real
dependencies, ready tasks, later parallel waves, and the requested provider/model. Parent-child
grouping is not itself a dependency. Current readiness still comes from the local `bd` CLI.

After dispatch, updates identify the affected task and host worker when available, the observed
phase, and any blocker or next decision. A queued request is not evidence that a worker started;
recorded `in_progress` is not a heartbeat. Response completion is separate from artifact checks,
required human review, and acceptance. The agent uses meaningful host events or a bounded host
wait, without a polling loop or repeated unchanged reports.

The plugin does not call the VSIX Extension Host API and cannot stream live progress into the GUI.
When the installed Beads version supports the fields and task writes are authorized, it can record
concise handoff metadata that the GUI may show on refresh. That remains recorded state, not a live
execution feed. Worker identifiers are included only if returned by the host; secrets, full
prompts, and raw provider responses do not belong in shared task metadata.

For example:

```text
Show the parent-to-leaf plan and dependency waves for these tasks. After I approve execution,
report meaningful host events with requested provider/model, worker identity if available, and
observed progress. Keep recorded Beads status and human acceptance separate.
```

## Safety boundary

The plugin does not bundle Beads, install software, initialize a project, or expose an MCP server.
It asks the agent to feature-detect the local `bd` command surface, use read-only queries first, and
verify artifacts before closing tasks. It must not automatically run `bd migrate`, `bd bootstrap`,
or `--ignore-schema-skew`.
