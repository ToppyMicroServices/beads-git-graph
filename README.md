<div align="center">
  <samp>
    <h3>Independent Git Graph extension with Beads-friendly workflow</h3>
  </samp>
</div>

[![MIT License](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](./LICENSE)
[![Version 0.1.9](https://img.shields.io/badge/version-0.1.9-0366d6?style=flat-square)](./CHANGELOG.md)

<sub>Acknowledgement: This project builds on prior work from [Git Graph](https://github.com/mhutchie/vscode-git-graph) and [neo-git-graph](https://github.com/asispts/neo-git-graph), and it remains grateful for the work of their maintainers, including security improvements.</sub>

<sub>This project continues independently from [neo-git-graph](https://github.com/asispts/neo-git-graph), because that fork was no longer updated regularly, with an emphasis on timely maintenance, dependency review, and security-focused fixes.</sub>

## Core Principles

- **No Telemetry**
- **Privacy First**
- **Security First**

## Project Identity (Required for Marketplace)

- This project is **Beads Git Graph**, with its own independent identity.
- It is **not** an upstream-tracking mirror of `mhutchie/vscode-git-graph`.
- It preserves the full repository history while following its own roadmap and release policy.
- It uses the MIT-licensed history of Git Graph up to the last MIT-licensed commit.
- This repository continues from [neo-git-graph](https://github.com/asispts/neo-git-graph) and is now maintained independently as Beads Git Graph.

## Compatibility Policy (Before Full Prefix Migration)

- Command IDs and setting keys use the `beads-git-graph.*` prefix and will remain stable to avoid breaking existing user keybindings and settings.
- UI-facing naming uses the Beads brand (`Beads Git Graph`) to avoid marketplace identity collisions.
- No additional prefix migration is currently planned.

## Provenance

The original [Git Graph](https://github.com/mhutchie/vscode-git-graph) by mhutchie changed its license in May 2019.
Everything after [commit 4af8583](https://github.com/mhutchie/vscode-git-graph/commit/4af8583a42082b2c230d2c0187d4eaff4b69c665) is no longer MIT.
This repository continues the line that later passed through [neo-git-graph](https://github.com/asispts/neo-git-graph).

This project is based on the last MIT-licensed commit and:

- Keeps the MIT license
- Adds devcontainer support
- Improves the codebase, tooling, and maintainability
- Continues active maintenance where the prior fork had slowed, with stronger emphasis on security review and corrective updates
- **Adds Beads integration**: `.beads/` data auto-detection, a `bd list`-style issue table, an Activity Bar entry, a status bar shortcut, a main-panel Git Graph ↔ Beads toggle, and visible progress percentages for in-progress items. See [Beads (bd)](https://github.com/steveyegge/beads) for more on the issue tracker.

## Features

- **Graph view**: See branches, tags, and uncommitted changes in a single graph
- **Commit details**: Click a commit to inspect its message, files, and diffs
- **Branch actions**: Create, checkout, rename, delete, and merge
- **Tag actions**: Create, delete, and push tags
- **Commit actions**: Checkout, cherry-pick, revert, and reset
- **Multi-repo**: Work with multiple repositories in one workspace
- **Devcontainer ready**: Works in remote and container environments
- **Beads Graph view**: Detects `.beads` data automatically, opens from the Activity Bar, and shows a `bd list`-style table
- **Main-panel toggle**: Switch between Git Graph and Beads from matching toolbar buttons without leaving the editor area
- **Progress visibility**: Shows numeric progress percentages for `in_progress` Beads items when progress is written in notes such as `進捗: 35%` or `progress: 35%`
- **Conventional Commit assist**: Normalizes and classifies commit types (with alias handling), colors recognized types, and supports `Feat Only` filtering

## Security & Privacy

- No telemetry is included.
- No avatar fetching or other external profile lookups are performed.
- Privacy-first by default, with no telemetry and no profile-enrichment lookups.
- Security-first maintenance, including active review and corrective updates.
- Security review is performed with enterprise use cases in mind, but adopters remain responsible for their own validation, deployment decisions, and incident handling.

## Language Note

Some examples, notes, or supplemental text may appear in Japanese because it is the maintainer's native language.
This does not imply Japan-specific support, preferential treatment, or a narrower target audience.

## Configuration

All settings use the `beads-git-graph` prefix.

| Setting                       | Default                                                            | Description                                                                                |
| ----------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `autoCenterCommitDetailsView` | `true`                                                             | Center commit details when opened                                                          |
| `dateFormat`                  | `"Date & Time"`                                                    | `"Date & Time"`, `"Date Only"`, or `"Relative"`                                            |
| `dateType`                    | `"Author Date"`                                                    | `"Author Date"` or `"Commit Date"`                                                         |
| `graphColours`                | 5 defaults (`#4C9AFF`, `#2EC4B6`, `#FFB703`, `#A78BFA`, `#FF5DA2`) | Colors for graph lines                                                                     |
| `graphStyle`                  | `"rounded"`                                                        | `"rounded"` or `"angular"`                                                                 |
| `initialLoadCommits`          | `300`                                                              | Commits to load on open                                                                    |
| `loadMoreCommits`             | `100`                                                              | Commits to load on demand                                                                  |
| `maxDepthOfRepoSearch`        | `0`                                                                | Folder depth for repo search                                                               |
| `hiddenBranchPatterns`        | `['^beads', '^beads-sync$', '^db/', '^beads-sync/']`               | Regex patterns for branches hidden by default (current checked-out branch remains visible) |
| `mutedGraphOpacity`           | `0.45`                                                             | Opacity for de-emphasized db/beads graph lines and nodes                                   |
| `mutedGraphLineWidth`         | `1.2`                                                              | Line width for de-emphasized db/beads graph lines                                          |
| `mutedGraphNodeRadius`        | `2.8`                                                              | Node radius for de-emphasized db/beads graph commits                                       |
| `preferMainBranchByDefault`   | `true`                                                             | Prefer `main` / `origin/main` as initial branch focus when opening the graph               |
| `showCurrentBranchByDefault`  | `false`                                                            | Show only current branch on open                                                           |
| `showStatusBarItem`           | `true`                                                             | Show status bar button                                                                     |
| `showUncommittedChanges`      | `true`                                                             | Show uncommitted changes node                                                              |
| `tabIconColourTheme`          | `"colour"`                                                         | `"colour"` or `"grey"`                                                                     |

## Installation

Search for `beads-git-graph` in Extensions.

- Marketplace publisher target: `ToppyMicroServices`
- Active release repository: `ToppyMicroServices/beads-git-graph`

## Local Testing

- Package a local VSIX with `pnpm dlx @vscode/vsce package`
- Install it in VS Code with `code --install-extension beads-git-graph-<version>.vsix --force`
- Reload VS Code and confirm the Activity Bar icon, Git Graph ↔ Beads toolbar toggle, and Beads progress display

## License

MIT — see [LICENSE](LICENSE).

> Based on MIT-licensed historical source from Git Graph, and maintained as an independent project rather than an upstream-tracking distribution.
