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

## Safety boundary

The plugin does not bundle Beads, install software, initialize a project, or expose an MCP server.
It asks the agent to feature-detect the local `bd` command surface, use read-only queries first, and
verify artifacts before closing tasks. It must not automatically run `bd migrate`, `bd bootstrap`,
or `--ignore-schema-skew`.
