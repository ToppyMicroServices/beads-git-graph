# Changelog

## [Unreleased]

<!-- daily-generated:start -->

### Daily Snapshot

- [`87ef601`](https://github.com/ToppyMicroServices/beads-git-graph/commit/87ef601aaeef8a81416a8e43473573d774dcf4e4) build(deps-dev): bump dompurify from 3.4.10 to 3.4.11 (#152)
- [`f332c94`](https://github.com/ToppyMicroServices/beads-git-graph/commit/f332c949f2170767e98e4005796cc3ab4687f3d8) Merge pull request #117 from ToppyMicroServices/automation/daily-changelog
- [`27caf08`](https://github.com/ToppyMicroServices/beads-git-graph/commit/27caf08946daf7293fa9120fe765c9ffe683a9a6) Merge branch 'main' into automation/daily-changelog
- [`d8083a7`](https://github.com/ToppyMicroServices/beads-git-graph/commit/d8083a7a5e15d1ff9b2b74d188ca40fe609d82ec) Merge pull request #148 from ToppyMicroServices/dependabot/npm_and_yarn/vitest-4.1.9
- [`a8b119e`](https://github.com/ToppyMicroServices/beads-git-graph/commit/a8b119e5c7d42e38bee3bfe6e3a40c9f27abbc81) Merge branch 'main' into dependabot/npm_and_yarn/vitest-4.1.9
- [`147a9ff`](https://github.com/ToppyMicroServices/beads-git-graph/commit/147a9fff44e8adfeb57659bc8ae66afe4f8b3182) Merge pull request #151 from ToppyMicroServices/fix/pr-145-followup
- [`b1fd4ca`](https://github.com/ToppyMicroServices/beads-git-graph/commit/b1fd4cace9aff69bbb4d66e4df9dcfe55e1d70a7) style: sort imports
- [`934237b`](https://github.com/ToppyMicroServices/beads-git-graph/commit/934237badb61a2b832d5bac433d402962253c56e) style: apply oxfmt
- [`5e33a21`](https://github.com/ToppyMicroServices/beads-git-graph/commit/5e33a2159acbbcfce15f1f297be9a95a63949791) fix: beads-git-graph across the codebase
- [`43b8677`](https://github.com/ToppyMicroServices/beads-git-graph/commit/43b86775e07c06138313cebe3bc32abf92ae8cfb) Merge pull request #150 from ToppyMicroServices/chore/update-beads-task-status
- [`4548c57`](https://github.com/ToppyMicroServices/beads-git-graph/commit/4548c57ffb18d706beec105b5f7053e54b1b1a83) chore: update beads task status
- [`26eb25f`](https://github.com/ToppyMicroServices/beads-git-graph/commit/26eb25fb1b8f221d22dc11c2d0503e5c97c5114e) Merge pull request #149 from ToppyMicroServices/chore/typescript-vscode-baseline
- [`f946181`](https://github.com/ToppyMicroServices/beads-git-graph/commit/f946181358d54e9a2f14b821c06cfcac8a07d434) style: sort web import groups
- [`bc9f994`](https://github.com/ToppyMicroServices/beads-git-graph/commit/bc9f994eb2c5cf5f34ade16140f28f8f6833c821) chore: record beads progress updates
- [`3619b67`](https://github.com/ToppyMicroServices/beads-git-graph/commit/3619b67e98c3eff6eefeebe7c45179474dc029f5) chore: modernize TypeScript and VS Code baseline
- [`8fa76dc`](https://github.com/ToppyMicroServices/beads-git-graph/commit/8fa76dcf967b4b2e3562cd7d340fd5dc0b442a7e) Merge pull request #130 from ToppyMicroServices/fix/epic-double-click-subprojects
- [`f772435`](https://github.com/ToppyMicroServices/beads-git-graph/commit/f7724352b911a16297b342262bcb30e83c3fe86b) fix: wire epic visibility helper into webview
- [`b595816`](https://github.com/ToppyMicroServices/beads-git-graph/commit/b595816255e0c4ecba8cec54e9ceddc7ea9f26ef) style: format beads main merge resolution
- [`f2ef266`](https://github.com/ToppyMicroServices/beads-git-graph/commit/f2ef2668099c5227a2770d13362e996613d3a08a) Merge remote-tracking branch 'origin/main' into fix/epic-double-click-subprojects
- [`65f361e`](https://github.com/ToppyMicroServices/beads-git-graph/commit/65f361eef54ed98b893a8fabcf28ef1f683b04df) Merge main into fix/epic-double-click-subprojects
- ...and 15 more unreleased commits.
<!-- daily-generated:end -->

## [0.3.0] - 2026-06-14

### Changed

- Promote the stable release version above the daily prerelease series so VS Marketplace shows the critical path graph release as current.

## [0.1.36] - 2026-06-14

### Added

- Add a Beads critical path graph view with dependency edges and Assign + Start task actions.

## [0.1.35] - 2026-06-14

### Changed

- Add a dedicated Beads table column for parallel-ready and explicit parallel task markers.

## [0.1.34] - 2026-06-14

### Fixed

- Show ready, unblocked Beads tasks as parallel-ready candidates even when no explicit parallel metadata is set.

## [0.1.33] - 2026-06-13

### Added

- Show optional parallel, agent, and worktree hints directly in Beads task rows and details.
- Add a worktree sync guard for checking stale multi-agent PR or agent worktrees before merge.

### Changed

- Polish the Beads task screen with workspace summary pills, clearer row styling, responsive compact rows, and richer inline details.
- Move the daily automation order so prerelease packaging runs before safe-update merging and backlog reporting
- Make workflow-dispatched CI skip cross-platform smoke unless explicitly requested, so daily automation PR checks stay lightweight
- Cut recurring GitHub Actions cost by making cross-platform smoke manual-only, moving CodeQL to a weekly cadence, and skipping daily prerelease packaging when nothing changed since the latest stable tag

### Fixed

- Make EPIC double-click toggle subprojects instead of opening a stale details row.
- Smooth Beads hierarchy guide lines so parent-child guides do not appear broken between rows.
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

[Unreleased]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.36...v0.3.0
[0.1.36]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.35...v0.1.36
[0.1.35]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.34...v0.1.35
[0.1.34]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.33...v0.1.34
[0.1.33]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.1.32...v0.1.33
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
