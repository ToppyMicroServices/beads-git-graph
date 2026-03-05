<div align="center">
  <img src="./resources/icon.png" height="128"/>
  <samp>
    <h1>Beads Git Graph for Visual Studio Code</h1>
    <h3>Independent Git Graph extension with Beads-friendly workflow</h3>
  </samp>
</div>

[![](https://img.shields.io/github/license/asispts/neo-git-graph)](https://github.com/asispts/neo-git-graph?tab=MIT-1-ov-file)
[![GitHub release](https://img.shields.io/github/v/release/asispts/neo-git-graph)](https://github.com/asispts/neo-git-graph/releases)

![demo](resources/demo.gif)

<p>&nbsp;</p>

## Project Identity (Required for Marketplace)

- This project is **Beads Git Graph** (independent project identity).
- It is **not** an upstream-following mirror of `mhutchie/vscode-git-graph`.
- It keeps full repository history while operating under its own roadmap and release policy.

## Provenance

The original [Git Graph](https://github.com/mhutchie/vscode-git-graph) by mhutchie changed its license in May 2019.
Everything after [commit 4af8583](https://github.com/mhutchie/vscode-git-graph/commit/4af8583a42082b2c230d2c0187d4eaff4b69c665) is no longer MIT.

This project is based on the last MIT commit and:

- Keeps MIT license
- Adds devcontainer support
- Improves codebase, tooling, and maintainability

## Features

- **Graph view**: See branches, tags, and uncommitted changes in one graph
- **Commit details**: Click a commit to see message, files, and diffs
- **Branch actions**: Create, checkout, rename, delete, and merge
- **Tag actions**: Create, delete, and push tags
- **Commit actions**: Checkout, cherry-pick, revert, and reset
- **Avatar support**: Optional avatars from GitHub, GitLab, or Gravatar
- **Multi-repo**: Work with multiple repositories in one workspace
- **Devcontainer ready**: Works in remote and container environments

## Configuration

All settings use the `neo-git-graph` prefix.

| Setting                       | Default         | Description                                      |
| ----------------------------- | --------------- | ------------------------------------------------ |
| `autoCenterCommitDetailsView` | `true`          | Center commit details when opened                |
| `dateFormat`                  | `"Date & Time"` | `"Date & Time"`, `"Date Only"`, or `"Relative"`  |
| `dateType`                    | `"Author Date"` | `"Author Date"` or `"Commit Date"`               |
| `fetchAvatars`                | `false`         | Fetch avatars (sends email to external services) |
| `graphColours`                | 12 defaults     | Colors for graph lines                           |
| `graphStyle`                  | `"rounded"`     | `"rounded"` or `"angular"`                       |
| `initialLoadCommits`          | `300`           | Commits to load on open                          |
| `loadMoreCommits`             | `100`           | Commits to load on demand                        |
| `maxDepthOfRepoSearch`        | `0`             | Folder depth for repo search                     |
| `showCurrentBranchByDefault`  | `false`         | Show only current branch on open                 |
| `showStatusBarItem`           | `true`          | Show status bar button                           |
| `showUncommittedChanges`      | `true`          | Show uncommitted changes node                    |
| `tabIconColourTheme`          | `"colour"`      | `"colour"` or `"grey"`                           |

## Installation

Search for `beads-git-graph` in Extensions.

- Marketplace identity (`publisher.name`) must be unique before publish.

## License

MIT — see [LICENSE](LICENSE).

> Based on MIT-licensed historical source from Git Graph, but maintained as an independent project and not an upstream-tracking distribution.
