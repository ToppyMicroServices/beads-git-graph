# Beads Agent Project Manager

Plan dependency-linked work, coordinate ready tasks across agents, and track verified progress with
Beads.

The plugin provides:

- the portable `beads-project-manager` skill;
- a **Beads Project Manager** custom agent for GitHub Copilot clients.

It uses the `bd` executable installed in the active environment. It does not bundle Beads, install
software, initialize a project, or expose the Beads Git Graph VSIX as an MCP server.

## Start safely

1. Confirm that Beads is already available with `bd --version`.
2. Select **Beads Project Manager** in Chat.
3. Start with a read-only prompt:

```text
Inspect this repository read-only. Show the ready tasks, dependency waves, and proposed owners.
Do not mutate Beads or start agents.
```

Starting parallel agents requires compatible agent or task tools from the host client. When those
tools are unavailable, the plugin produces a reviewable allocation plan instead of claiming that
workers were started.

The skill instructs the agent to read repository instructions first, feature-detect the installed
Beads command surface, and use read-only queries before proposing mutations. It also instructs the
agent never to automatically run `bd migrate`, `bd bootstrap`, or `--ignore-schema-skew`. Agent
output is not treated as accepted work until the actual artifact and its acceptance checks have
been verified.

See the repository's [installation and safety notes](https://github.com/ToppyMicroServices/beads-git-graph/blob/main/docs/agent-plugin.md)
before installing. Release history is recorded in [CHANGELOG.md](./CHANGELOG.md).
