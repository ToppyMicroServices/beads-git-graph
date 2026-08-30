# Beads Agent Project Manager

Plan dependency-linked work, dispatch ready tasks across agents, and track verified progress with
Beads.

The plugin provides:

- the portable `beads-project-manager` skill;
- a **Beads Project Manager** custom agent for GitHub Copilot clients.

It uses the `bd` executable installed in the active environment. It does not bundle Beads, install
software, initialize a project, or expose the Beads Git Graph VSIX as an MCP server.

The workflow reads repository instructions first, feature-detects the installed Beads command
surface, and uses read-only queries before proposing mutations. It never automatically runs
`bd migrate`, `bd bootstrap`, or `--ignore-schema-skew`. Agent output is not treated as accepted
work until the actual artifact and its acceptance checks have been verified.

See the repository's [installation and safety notes](https://github.com/ToppyMicroServices/beads-git-graph/blob/main/docs/agent-plugin.md)
before installing.
