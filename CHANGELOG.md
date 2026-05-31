# Changelog

## [Unreleased]

<!-- daily-generated:start -->

### Daily Snapshot

- [`b059b1a`](https://github.com/ToppyMicroServices/beads-git-graph/commit/b059b1afd987234e66311875b0ef848b16a3cf88) build(deps-dev): bump dompurify from 3.4.6 to 3.4.7 (#115)
- [`e1584f3`](https://github.com/ToppyMicroServices/beads-git-graph/commit/e1584f391bbca4707f37f4468d1542c8589b6801) build(deps-dev): bump dompurify from 3.4.5 to 3.4.6 (#113)
- [`8b2f678`](https://github.com/ToppyMicroServices/beads-git-graph/commit/8b2f678b95e67e2ae521bc121fa9bebed52fa66b) build(deps-dev): bump oxlint from 1.66.0 to 1.67.0 (#114)
- [`821c482`](https://github.com/ToppyMicroServices/beads-git-graph/commit/821c48292cbbed6f95786836da47f17f827416d0) build(deps-dev): bump oxfmt from 0.51.0 to 0.52.0 (#112)
- [`b4b85d8`](https://github.com/ToppyMicroServices/beads-git-graph/commit/b4b85d87aa4e4c10e6b7cae43c0d44ab57d30aea) build(deps): bump github/codeql-action from 4.35.5 to 4.36.0 (#111)
- [`0564f67`](https://github.com/ToppyMicroServices/beads-git-graph/commit/0564f675faf5987e3868d855d6549b6bbf6ad03a) build(deps-dev): bump vitest from 4.1.6 to 4.1.7 (#109)
- [`fcdd1fa`](https://github.com/ToppyMicroServices/beads-git-graph/commit/fcdd1fa2d5f1ac4f37447074b562a52775078a35) build(deps-dev): bump @types/node from 25.9.0 to 25.9.1 (#108)
- [`0a7f7cc`](https://github.com/ToppyMicroServices/beads-git-graph/commit/0a7f7ccb5b9adf0d410382de6afe29d3d692c51d) build(deps-dev): bump oxfmt from 0.50.0 to 0.51.0 (#106)
- [`412af42`](https://github.com/ToppyMicroServices/beads-git-graph/commit/412af42ad4b260fb33e2427beaf84d43189f43fb) build(deps-dev): bump dompurify from 3.4.4 to 3.4.5 (#105)
- [`99d3d20`](https://github.com/ToppyMicroServices/beads-git-graph/commit/99d3d207ac5700631d1db923d71daff96de03f10) build(deps-dev): bump @types/node from 25.8.0 to 25.9.0 (#107)
- [`36c1d13`](https://github.com/ToppyMicroServices/beads-git-graph/commit/36c1d13f5190f31e854edd282f16e24be5124db2) build(deps-dev): bump oxlint from 1.65.0 to 1.66.0 (#104)
- [`45b1578`](https://github.com/ToppyMicroServices/beads-git-graph/commit/45b15784ba4b18ad5a4230d3f32e3190507af59e) build(deps): bump github/codeql-action from 4.35.4 to 4.35.5 (#103)
- [`44b7baf`](https://github.com/ToppyMicroServices/beads-git-graph/commit/44b7baf63a699cdac8420c4f6d4c3c10770f0c71) build(deps-dev): bump oxlint from 1.64.0 to 1.65.0 (#101)
- [`66eafa4`](https://github.com/ToppyMicroServices/beads-git-graph/commit/66eafa4f8520cec7f9b72a1642e317286b6e8a9a) build(deps-dev): bump dompurify from 3.4.3 to 3.4.4 (#102)
- [`526b84d`](https://github.com/ToppyMicroServices/beads-git-graph/commit/526b84d64a130dcc312a91624c3d1a1cf7cdedd0) build(deps-dev): bump oxfmt from 0.49.0 to 0.50.0 (#100)
- [`d4a8629`](https://github.com/ToppyMicroServices/beads-git-graph/commit/d4a8629fe0be40649704732269cd23fd1c19ea8a) build(deps-dev): bump @types/node from 25.7.0 to 25.8.0 (#99)
- [`a1dedf2`](https://github.com/ToppyMicroServices/beads-git-graph/commit/a1dedf2a276901e987996219d109d0e5fde6c580) build(deps-dev): bump dompurify from 3.4.2 to 3.4.3 (#97)
- [`f06ade0`](https://github.com/ToppyMicroServices/beads-git-graph/commit/f06ade025a26525e0c32b09f5d5d4416bd4d88e8) chore: close beads issue neo-git-graph-n1n (#95)
- [`00545f3`](https://github.com/ToppyMicroServices/beads-git-graph/commit/00545f3527f0e6c08feb7470f370e3b5d6489380) ci: reduce recurring actions cost (#94)
- [`f70f68a`](https://github.com/ToppyMicroServices/beads-git-graph/commit/f70f68a79e02d805d581d41740df7e7a3872f8a5) build(deps): bump google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml (#92)
- ...and 26 more unreleased commits.
<!-- daily-generated:end -->

### Changed

- Move the daily automation order so prerelease packaging runs before safe-update merging and backlog reporting
- Make workflow-dispatched CI skip cross-platform smoke unless explicitly requested, so daily automation PR checks stay lightweight
- Cut recurring GitHub Actions cost by making cross-platform smoke manual-only, moving CodeQL to a weekly cadence, and skipping daily prerelease packaging when nothing changed since the latest stable tag

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
