# Changelog

## [Unreleased]

<!-- daily-generated:start -->

### Daily Snapshot

- [`d105766`](https://github.com/ToppyMicroServices/beads-git-graph/commit/d105766b5eb06d1e09da194e8cedc98059ed5f75) Fix daily automation workflows
- [`093826d`](https://github.com/ToppyMicroServices/beads-git-graph/commit/093826dae17a81cc690beb083f676e783ae96948) chore: adopt TypeScript 6 (#31)
- [`ae233f2`](https://github.com/ToppyMicroServices/beads-git-graph/commit/ae233f2cf33008fad93eb18b2344f858f394ab83) fix: grant actions read to OSV scan jobs
- [`901e50f`](https://github.com/ToppyMicroServices/beads-git-graph/commit/901e50f08a6d9404085f51145b2432d74a199958) fix: restore OSV reusable workflow permissions
- [`619f0f0`](https://github.com/ToppyMicroServices/beads-git-graph/commit/619f0f0729d163d260d674b7803090680d07cce3) chore: automate daily security triage
<!-- daily-generated:end -->

### Added

- Add a daily CodeQL workflow and a daily Dependabot triage script so PR and security backlog keeps moving without manual cleanup

### Changed

- Upgrade the development toolchain to TypeScript 6 and align project `tsconfig` files with the stricter compiler behavior
- Update `oxlint` and `eslint-plugin-simple-import-sort` so stale safe Dependabot PRs can be superseded on `main`

### Fixed

- Reduce top-level workflow token permissions and harden GitHub API pagination URL handling to clear repo-addressable security alerts
- Grant the daily changelog workflow permission to dispatch CI and make Dependabot auto-merge use explicit repository context so daily automation stops failing on GitHub Actions

## [0.1.31] - 2026-03-31

### Added

- Add a daily GitHub maintenance workflow that summarizes open pull requests and security alerts into a single issue
- Add `CONTRIBUTING.md` and link repository docs for contributors and security reporting

### Changed

- Add a daily prerelease workflow that refreshes the unreleased changelog, packages a VSIX, and updates a rolling prerelease GitHub release
- Widen Dependabot auto-merge to safe patch and minor updates, and run CI on a daily schedule so queued security and dependency updates keep moving
- Update Scorecard and OSV-Scanner workflow dependencies, plus `oxfmt`, `oxlint`, and `vitest`, to clear current safe Dependabot backlog
- Schedule Dependabot and add a daily safe-update sweep so CI/CD and security updates continue to merge and roll forward without manual babysitting

## [0.1.30] - 2026-03-18

### Changed

- Add repo-specific Git remote selection for multi-remote repositories and use the selected remote for graph filtering and tag pushes

## [0.1.29] - 2026-03-16

### Fixed

- Publish a single Universal VSIX to both registries and align local packaging with pnpm by disabling vsce dependency detection

## [0.1.28] - 2026-03-14

### Fixed

- Detect Git branch switches and auto-sync Beads so local bd state does not stay stale after changing branches

## [0.1.27] - 2026-03-14

### Changed

- Raise the minimum supported VS Code engine to 1.110.0 so extension packaging matches the current VS Code type definitions

## [0.1.26] - 2026-03-14

### Changed

- Rewrite Marketplace metadata and README copy to focus on what the extension does in VS Code
- Replace the repository security policy with the coordinated disclosure policy for ToppyMicroServices OÜ

## [0.1.25] - 2026-03-12

### Fixed

- Flush `.beads/issues.jsonl` after Beads sync actions so Sync warnings clear immediately after `Sync` and `Sync Now`

### Changed

- Add a manual macOS / Windows smoke path in CI without making cross-platform checks run on every push

## [0.1.24] - 2026-03-11

### Fixed

- Restore Beads hierarchy guide lines when parent metadata is missing from `bd list --json` and only available via per-issue lookup

## [0.1.23] - 2026-03-11

### Fixed

- Harden Git / Beads webview message handling so actions only run against known repositories and initialized Beads workspaces
- Keep commit-type filtering complete even when matching commits are sparse in history
- Prevent dropdown HTML injection in the selected repo / branch label
- Adjust Beads table spacing and remove hierarchy node dots for clearer rendering

### Changed

- Extract Beads hierarchy flattening into a shared module and add automated coverage for subtree ordering, guide metadata, and cycle handling

## [0.1.22] - 2026-03-10

### Changed

- Make the Beads toolbar `Sync` button pulse and highlight when local `bd` state differs from `.beads/issues.jsonl`

## [0.1.21] - 2026-03-10

### Changed

- Add a persistent `Sync` toolbar button in the Beads view so `bd sync` is available even when no sync warning is currently shown

## [0.1.20] - 2026-03-10

### Changed

- Compare local `bd` state with `.beads/issues.jsonl`, show sync warnings in the Beads view, and provide a `Sync Now` action to reconcile differences
- Merge JSONL parent metadata into `bd list --json` results so hierarchy lines continue to render when parent EPICs are added after child tasks

## [0.1.19] - 2026-03-08

### Added

- Added a right-click Create action in the Beads list that prompts for type, title, status, and priority before creating an issue

### Changed

- Detect missing `git` and missing `bd` executables explicitly so Git Graph and Beads can distinguish tool setup problems from missing repositories or uninitialized `.beads` data
- Added a configurable `beads-git-graph.bdPath` setting for locating the Beads CLI

## [0.1.18] - 2026-03-08

### Changed

- Added a right-click Close action in the Beads list and refreshed bead data after closing issues

## [0.1.17] - 2026-03-08

### Changed

- Switched Beads hierarchy rendering to a table overlay so parent-child guides align more clearly with the list layout

## [0.1.16] - 2026-03-08

### Changed

- Polished the Beads hierarchy guide styling and toolbar labeling for clearer visual alignment with Git Graph

## [0.1.15] - 2026-03-08

### Changed

- Refined the Beads list layout and hierarchy guide rendering for easier visual verification

## [0.1.14] - 2026-03-08

### Changed

- Hide the Git Graph branch selector UI so the toolbar only shows the remaining active controls

## [0.1.13] - 2026-03-08

### Fixed

- Keep the Beads table header visible while scrolling long issue lists
- Show EPIC-based parent-child hierarchy in the Beads list with nested task rendering

## [0.1.12] - 2026-03-07

### Changed

- Reissue release tag so the corrected publish workflow can deploy to VS Marketplace with token-gated targets

## [0.1.11] - 2026-03-07

### Changed

- Make VS Marketplace and Open VSX publishing independent so each target is skipped when its token is not configured

## [0.1.10] - 2026-03-07

### Fixed

- Narrow Beads/db sync branch filtering so ordinary branches such as `beads-ui` are not hidden or muted
- Apply hidden branch patterns consistently to remote sync branches such as `origin/beads-sync`

### Changed

- Align release metadata, publisher identity, and publish scripts with `ToppyMicroServices/beads-git-graph`
- Clarify security review scope, language neutrality, and provenance details in project documentation

## [0.1.9] - 2026-03-07

### Fixed

- Remove remaining shell-based Git execution paths by standardizing on `spawn` / `execFile`
- Add repository-root validation before opening working-tree files from diff documents
- Refresh README details for the current Beads integration and local testing flow

## [0.1.8] - 2026-03-07

### Fixed

- Align Beads / Git Graph toolbar button positions across both views
- Unify switch and refresh button icon treatment across Beads / Git Graph
- Add a packaged Activity Bar icon asset for reliable local installation

## [0.1.7] - 2026-03-07

### Added

- Add `Beads Graph` Explorer view with `.beads` auto-detection and `bd list` style rendering
- Add lightweight Git link from Beads items via commit hash actions
- Add main-panel Beads / Git Graph toggle
- Add visible progress percentages for in-progress Beads items

### Changed

- Rename extension identity to `beads-git-graph` / `Beads Git Graph` (UI-facing)
- Keep `beads-git-graph.*` command IDs and configuration keys for compatibility during transition
- Remove avatar fetching to strengthen privacy and security posture
- Expand tests for Beads parsing, commit typing, and privacy policy expectations

## [0.1.1] - 2026-02-23

### Maintenance

- Migrate build system to esbuild and upgrade dependencies
- Add oxlint linter and oxfmt formatter
- Update readme, badges, and extension metadata

## [0.1.0] - 2026-02-18

Initial release

[Unreleased]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.31...HEAD
[0.1.31]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.30...v0.1.31
[0.1.30]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.29...v0.1.30
[0.1.28]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.27...v0.1.28
[0.1.27]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.26...v0.1.27
[0.1.26]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.25...v0.1.26
[0.1.25]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.24...v0.1.25
[0.1.24]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.23...v0.1.24
[0.1.23]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.22...v0.1.23
[0.1.22]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.21...v0.1.22
[0.1.21]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.20...v0.1.21
[0.1.20]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.19...v0.1.20
[0.1.19]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.18...v0.1.19
[0.1.18]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.17...v0.1.18
[0.1.17]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.15...v0.1.16
[0.1.15]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.14...v0.1.15
[0.1.14]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.13...v0.1.14
[0.1.13]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.6...v0.1.7
[0.1.1]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ToppyMicroServices/beads-git-graph/releases/tag/v0.1.0
