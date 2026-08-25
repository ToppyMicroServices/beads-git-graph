# Changelog

## [Unreleased]

### Added

- Let direct providers create or replace one declared workspace artifact through a bounded
  generation, verifier, and explicit human-review flow.
- Add a dependency-linked Ollama smoke test for the nominal 0.5B `qwen2.5-coder:0.5b` model.

### Fixed

- Keep provider completion separate from acceptance, reject refusal, generic, copied, unsafe, or
  colliding outputs, and leave tasks in progress after an approved edit is applied.

## [0.6.2] - 2026-08-21

### Added

- Show a Graph minimap with the current viewport, and mark dependency cycles and missing or
  filtered dependencies without silently turning them into roots.
- Add focused regression coverage for filtered viewport recovery, cycle-aware graph projection,
  dependency relation labels, centered boundaries, and card-avoiding line routes.

### Fixed

- Keep a readable task in view when a status filter replaces an off-screen graph selection while
  preserving the user's zoom level and normal live-update viewport continuity.
- Center Start and End vertically, route dependency arrows outside task cards, and retain
  dependency lines after filtering and refresh.
- Replace the ambiguous Ready/root and Critical Path labels with visible-dependency and Longest
  Chain wording; suppress the chain when a dependency cycle makes it undefined.
- Debounce resize presentation work, reveal keyboard-focused cards, and keep Graph wheel gestures
  contained even at the zoom limits.

## [0.6.0] - 2026-07-30

### Added

- Add a locally validated Plan Draft preview with dependency graph, Critical Path, parallel groups,
  and exact Beads mutations.
- Gate approved Plan Import on observed Beads write capabilities and report partial results without
  claiming rollback.
- Ask for a model preference before starting single or parallel Copilot agent work.
- Show requested-model transitions for dependency-linked tasks and include upstream bead handoffs
  in dependent task prompts.
- Add a cross-model task-chain behavior test from Plan Draft through Beads import.
- Add a current Plan Draft screenshot to the README.
- Add provider/model selection for Copilot, local Ollama, Hugging Face Inference, OpenAI, and
  Anthropic Claude.
- Store cloud credentials in VS Code SecretStorage with environment fallbacks and require Workspace
  Trust before provider execution.
- Store direct API output as a local untrusted response artifact without applying it to a worktree.
- Preserve provider/model handoffs through Plan Draft, Beads metadata, single starts, and parallel
  starts, with a cross-provider workflow test.
- Add bounded local response-artifact retention and a confirmed command to clear stored responses.
- Add configurable fetch-on-Graph-refresh, last successful fetch time, and explicit local
  remote-tracking labels for `origin/*` refs.

### Fixed

- Open task Details from both Manage and warning-free Graph views, preserve the selected task when
  switching views, and give repeated task actions distinct accessible names.
- Prevent duplicate Start AI, Start Parallel, Plan Import, merge, and sync requests in both the
  webview and Extension Host; limit Start Parallel to currently visible ready tasks.
- Disable Create, Close, and Sync unless the relevant Beads capabilities are confirmed, and explain
  schema or missing-`bd sync` constraints instead of exposing actions that will fail.
- Let page scrolling continue when Graph wheel zoom is already at its limit, and expose the filter
  menu's expanded and menu-item state to assistive technology.
- Keep the visible Table or Graph viewport fixed during live updates, avoid re-running Graph layout
  for warning-only changes, and preserve runtime zoom, pan, node, and relationship geometry.
- Stop animating the Sync warning button and preserve existing controls during in-place task
  updates so buttons do not flash, move, or lose focus.
- Make normal Graph dragging pan the zoomed canvas, keep box zoom on Option/Alt-drag, and render
  both execution-dependency arrows and dashed parent-child lines after refresh.
- Stop reporting a successful Beads sync when the installed CLI does not provide `bd sync`.
- Disable Graph-view Start AI until `bd ready` confirms the task and its dependencies.
- Recheck `bd ready` before worktree preparation and again immediately before Beads mutation.
- Read handoff dependencies from a fresh `bd show` result instead of trusting webview metadata.
- Validate Plan Draft model preferences consistently and quote untrusted task metadata in prompts.
- Restrict Ollama endpoints to loopback hosts, fix cloud endpoints, redact provider failures, cap
  response size, and confirm paid parallel fan-out before sending prompts.
- Keep the Graph point under the pointer fixed during wheel, trackpad, button, and keyboard zoom;
  preserve manual zoom when switching views or resizing; and center Fit and box-selection zoom.
- Block AI requests when a non-mutating Beads probe reports an unsafe write/schema state, record
  agent assignment and response metadata in one update, and preserve generated output on failure.
- Enforce the provider response-size limit while streaming and distinguish invalid artifact
  references from missing or unreadable stored artifacts.
- Keep Restricted Mode read-only by blocking every `bd` process and Git/Beads mutation, machine-scope
  `bdPath`, reject option-shaped Git refs, and disable Dolt event flushing for extension-started
  Beads processes.
- Pin packaging tools and patched DOMPurify, PostCSS, and brace-expansion versions; require frozen
  CI installs and a High-severity dependency audit.

## [0.4.20260710] - 2026-07-08

### Fixed

- Make the Beads Graph view readable when many tasks share one dependency level.
- Allow wheel and trackpad zoom directly on the Beads Graph view.

## [0.4.20260709] - 2026-07-08

### Fixed

- Stabilize the Beads table default order across task updates.
- Fit the Beads Graph view without scrollbar-driven resize flicker.

## [0.4.20260708] - 2026-07-08

### Fixed

- Keep Beads table rows in a stable order instead of reordering them by updated timestamps during refresh.
- Fit the Beads Graph view to the visible task graph by default.
- Replace Graph zoom buttons with wheel and trackpad zoom handling.
- Stop the Graph canvas scrollbar from flickering during rendering and scrolling.

## [0.4.20260706] - 2026-07-06

### Fixed

- Keep the Beads Graph view from reloading when the underlying Beads data has not changed.
- Reduce noisy Beads database file refresh triggers that reset Graph scroll state.
- Compact the Graph layout so task nodes and dependency arrows fit better on screen.
- Reduce critical path arrow and stroke size.

## [0.4.20260703] - 2026-07-03

### Fixed

- Prevent closed or inactive Beads tasks from flashing during webview refresh before the default active filter is applied.
- Apply the initial Beads filter before restoring the saved Graph view so filtered Graph nodes do not flash.

## [0.4.20260702] - 2026-07-02

### Changed

- Promote the stable Marketplace release above the daily pre-release version so the normal download path resolves to the fixed Beads view build.
- Stop publishing daily pre-releases to VS Marketplace to keep stable releases as the default Marketplace download.

## [0.3.4] - 2026-07-02

### Fixed

- Stop the Beads sidebar from opening a separate Beads panel and restoring stale Graph state.
- Prevent the Clear filter button from flashing during Beads view hydration.
- Make the Graph pane vertically scrollable when nodes are taller than the estimated graph layout.

## [0.3.3] - 2026-07-01

### Added

- Add AI multi-agent cockpit metadata for branch, PR, checks, and sync risk in Beads table, details, and graph views.
- Report skipped active tasks with reasons when Start Parallel runs.
- Add a Graph execution map banner and legend for Critical Path, dependency, parent, and merge/worktree risk signals.
- Copy the agent prompt to the clipboard and open Chat as a fallback when Copilot agent session commands are unavailable.

### Changed

- Record branch metadata when Start AI creates or reuses an agent worktree.
- Block multi-agent PR merges when the branch PR is missing status checks or has pending/failing checks.

<!-- daily-generated:start -->

<!-- daily-generated:end -->

## [0.3.2] - 2026-06-20

### Added

- Add Beads Table and Graph execution badges for state, owner, model, worktree, SSOT, and dependency warnings.
- Add dependency lint warnings for ready or sibling tasks that likely need blocked-by edges.
- Show aggregated multi-agent worktree preflight results before PR merge actions.

### Fixed

- Keep Graph dependency edges aligned while scrolling in Graph mode.
- Block multi-agent PR merge when any agent worktree is stale, dirty, or detached, with all reasons shown together.

### Changed

- Update GitHub Actions checkout usage to actions/checkout 7.0.0.

## [0.3.1] - 2026-06-19

### Added

- Add multi-agent Beads automation with Start Parallel, agent worktree context, and PR merge actions.
- Add SSOT usage manifest support for automatically suggesting task context.

### Fixed

- Open assigned Copilot sessions from the agent worktree when available.
- Wait for GitHub PR auto-merge to complete before pulling and syncing Beads.
- Surface invalid SSOT usage manifests instead of silently falling back.
- Limit Start Parallel to open parallel-ready tasks.
- Preserve Graph mode selection and render dependency nodes in a scrollable graph space.

### Daily Snapshot

- [`981e7b4`](https://github.com/ToppyMicroServices/beads-git-graph/commit/981e7b47262852cf5a77cf43de8badfe3465c9fd) build(deps-dev): bump oxlint from 1.69.0 to 1.70.0 (#146)
- [`dce7c99`](https://github.com/ToppyMicroServices/beads-git-graph/commit/dce7c99783aaca7d2cf869b8c8a7671423c94be7) build(deps-dev): bump dompurify from 3.4.9 to 3.4.10 (#144)

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

[Unreleased]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.4.20260710...v0.6.0
[0.4.20260710]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.4.20260709...v0.4.20260710
[0.4.20260709]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.4.20260708...v0.4.20260709
[0.4.20260708]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.4.20260706...v0.4.20260708
[0.4.20260706]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.4.20260703...v0.4.20260706
[0.4.20260703]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.4.20260702...v0.4.20260703
[0.4.20260702]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.3.4...v0.4.20260702
[0.3.4]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/ToppyMicroServices/beads-git-graph/compare/v0.3.0...v0.3.1
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
