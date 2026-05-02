# Changelog

## [Unreleased]

<!-- daily-generated:start -->

### Daily Snapshot

- [`36fe0f4`](https://github.com/ToppyMicroServices/beads-git-graph/commit/36fe0f4f2ef5e281e32ca99e7b3f1bcca9de0612) build(deps-dev): bump dompurify from 3.4.1 to 3.4.2 (#79)
- [`1bf256b`](https://github.com/ToppyMicroServices/beads-git-graph/commit/1bf256ba75cb33b4dd7000c9dce6356e1b12b5d2) build(deps-dev): bump oxlint from 1.61.0 to 1.62.0 (#77)
- [`2ab56b7`](https://github.com/ToppyMicroServices/beads-git-graph/commit/2ab56b70727f3fb066f682d940e723d9ad3b025c) build(deps-dev): bump oxfmt from 0.46.0 to 0.47.0 (#76)
- [`75a4f61`](https://github.com/ToppyMicroServices/beads-git-graph/commit/75a4f613b1756baaf715718c75f5fd6a7934f7ed) build(deps-dev): bump dompurify from 3.4.0 to 3.4.1 (#74)
- [`bb2d792`](https://github.com/ToppyMicroServices/beads-git-graph/commit/bb2d792a00bdbe508d78aa567c1ac906621d374d) build(deps-dev): bump vitest from 4.1.4 to 4.1.5 (#73)
- [`8286b26`](https://github.com/ToppyMicroServices/beads-git-graph/commit/8286b26706cb8d5cd1ef5ef56bc5f96761dba16f) build(deps): bump dependabot/fetch-metadata from 3.0.0 to 3.1.0 (#72)
- [`ee06024`](https://github.com/ToppyMicroServices/beads-git-graph/commit/ee0602425878049136e7a0f4d3984504bd64d023) build(deps): bump actions/setup-node from 6.3.0 to 6.4.0 (#71)
- [`6d68f86`](https://github.com/ToppyMicroServices/beads-git-graph/commit/6d68f86f74f4170100f9f0eb530dc7594f36fb6c) build(deps-dev): bump oxlint from 1.60.0 to 1.61.0 (#69)
- [`0ee2a2b`](https://github.com/ToppyMicroServices/beads-git-graph/commit/0ee2a2bbac3115643c76e026f72251b551d1f699) build(deps-dev): bump oxfmt from 0.45.0 to 0.46.0 (#68)
- [`60252e9`](https://github.com/ToppyMicroServices/beads-git-graph/commit/60252e9d38ab9bbb02068e41650e98ac00ae2f8c) build(deps-dev): bump fast-check from 4.6.0 to 4.7.0 (#67)
- [`41de4de`](https://github.com/ToppyMicroServices/beads-git-graph/commit/41de4dee7885c1db9ade7adf394930f9f2146f1d) chore: close beads issue neo-git-graph-1ov (#66)
- [`5b760dc`](https://github.com/ToppyMicroServices/beads-git-graph/commit/5b760dce9640c84009702146013998d40259fdc1) build(deps): bump github/codeql-action from 4.35.1 to 4.35.2 (#60)
- [`aacdd74`](https://github.com/ToppyMicroServices/beads-git-graph/commit/aacdd742fdb4995af7b112d4d9487fb22f7cdf32) fix: automate daily marketplace releases (#65)
- [`5456c61`](https://github.com/ToppyMicroServices/beads-git-graph/commit/5456c6149a7e247f0f1d7124f23c63456d374e67) fix: pin scorecard sarif source root (#64)
- [`0adbcf2`](https://github.com/ToppyMicroServices/beads-git-graph/commit/0adbcf2c071feab9079c44bca67aa0e436ac97d7) chore: close beads issue neo-git-graph-lf0 (#63)
<!-- daily-generated:end -->

### Changed

- Move the daily automation order so prerelease packaging runs before safe-update merging and backlog reporting
- Make workflow-dispatched CI skip cross-platform smoke unless explicitly requested, so daily automation PR checks stay lightweight

### Fixed

- Format the generated changelog before the daily changelog PR is committed, preventing the daily CI dispatch from failing on `CHANGELOG.md`
- Publish the daily prerelease VSIX directly to Open VSX and VS Marketplace, and keep the stable `publish` workflow from re-running on `daily-*` tags

## [0.1.32] - 2026-04-18

### Added

- Add a daily CodeQL workflow and a daily Dependabot triage script so PR and security backlog keeps moving without manual cleanup

### Changed

- Upgrade the development toolchain to TypeScript 6 and align project `tsconfig` files with the stricter compiler behavior
- Update `oxlint` and `eslint-plugin-simple-import-sort` so stale safe Dependabot PRs can be superseded on `main`

### Fixed

- Reduce top-level workflow token permissions and harden GitHub API pagination URL handling to clear repo-addressable security alerts
- Grant the daily changelog workflow permission to dispatch CI and make Dependabot auto-merge use explicit repository context so daily automation stops failing on GitHub Actions
- Override transitive `vite` resolution onto a patched release so current Dependabot security alerts no longer stay open on `main`
- Restore the Git Graph branch selector so remote branches can be chosen directly from the graph controls again

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

[Unreleased]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.32...HEAD
[0.1.32]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.31...v0.1.32
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
