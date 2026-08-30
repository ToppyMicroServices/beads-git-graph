# Beads Agent Project Manager plugin

This repository also contains an Agent Plugins 1.0 package for GitHub Copilot in VS Code and
compatible clients. It is separate from the Beads Git Graph VSIX:

- the VSIX provides the Graph, Table, Manage, and Plan user interface;
- the agent plugin provides a Beads-aware project-manager skill and a Copilot custom agent;
- the plugin uses the installed `bd` CLI and does not call the VSIX Extension Host API.

The publishable plugin is isolated under `agent-plugin/`. Marketplace installation therefore does
not copy the repository's `.beads` database, VSIX files, `node_modules`, or development sources
into the Agent Plugin cache.

## Install from the repository marketplace

1. Enable `chat.plugins.enabled` in VS Code.
2. Add this repository to `chat.plugins.marketplaces`:

```json
{
  "chat.plugins.marketplaces": ["ToppyMicroServices/beads-git-graph"]
}
```

3. Open the Agent Plugins view or search Extensions for `@agentPlugins`.
4. Install **Beads Agent Project Manager**, review the repository trust prompt, and confirm the
   installed skill and agent in **Chat: Open Customizations**.

The marketplace is defined by `.github/plugin/marketplace.json` and points only to
`agent-plugin/`. Review changes before updating because plugins can instruct an agent to run local
tools.

With GitHub Copilot CLI:

```sh
copilot plugin marketplace add ToppyMicroServices/beads-git-graph
copilot plugin install beads-agent-project-manager@toppymicroservices-agent-plugins
```

For local development, Copilot CLI also accepts the repository subdirectory explicitly:

```sh
copilot plugin install ToppyMicroServices/beads-git-graph:agent-plugin
```

This self-hosted marketplace is public when these files are present on the repository's default
branch. Inclusion in a marketplace that VS Code configures by default is a separate review and
submission process.

## Safety boundary

The plugin does not bundle Beads, install software, initialize a project, or expose an MCP server.
It asks the agent to feature-detect the local `bd` command surface, use read-only queries first, and
verify artifacts before closing tasks. It must not automatically run `bd migrate`, `bd bootstrap`,
or `--ignore-schema-skew`.
