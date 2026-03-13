# Beads Git Graph

[![MIT License](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](./LICENSE)
[![Version 0.1.25](https://img.shields.io/badge/version-0.1.25-0366d6?style=flat-square)](./CHANGELOG.md)

Beads Git Graph helps you work with Git history and Beads issues without leaving VS Code.

## What It Does

- Visualize branches, tags, merges, and uncommitted changes in a Git graph
- Open commit details, changed files, and diffs from the graph view
- Switch between Git Graph and a Beads issue view from the editor toolbar
- Show Beads issues in a dedicated Activity Bar view
- Create, close, refresh, and sync Beads items from inside VS Code
- Highlight Beads sync warnings and show progress for in-progress items

## How To Use

1. Open **Beads Git Graph: View Git Graph (git log)** from the Command Palette.
2. Use the Activity Bar entry to open the Beads view.
3. In the Beads view, refresh data, sync Beads, or jump back to Git Graph with the toolbar buttons.

If your workspace has a `.beads` directory, the extension will detect it automatically. Set `beads-git-graph.bdPath` if your `bd` executable is not on `PATH`.

## Key Settings

| Setting                                      | Default | Description                                               |
| -------------------------------------------- | ------- | --------------------------------------------------------- |
| `beads-git-graph.bdPath`                     | `"bd"`  | Path or command name for the Beads CLI                    |
| `beads-git-graph.preferMainBranchByDefault`  | `true`  | Focus `main` / `origin/main` first when opening the graph |
| `beads-git-graph.showCurrentBranchByDefault` | `false` | Open the graph filtered to the current branch             |
| `beads-git-graph.showStatusBarItem`          | `true`  | Show a status bar button for opening Git Graph            |
| `beads-git-graph.showUncommittedChanges`     | `true`  | Show uncommitted changes in the graph                     |

## Privacy

- No telemetry
- No avatar fetching
- No external profile lookups

## License

MIT
