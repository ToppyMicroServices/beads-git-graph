# Changelog

## [Unreleased]

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

[Unreleased]: https://github.com/thinksyncs/beads-git-graph/compare/v0.1.7...HEAD
[0.1.7]: https://github.com/thinksyncs/beads-git-graph/compare/v0.1.6...v0.1.7
[0.1.1]: https://github.com/thinksyncs/beads-git-graph/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/thinksyncs/beads-git-graph/releases/tag/v0.1.0
