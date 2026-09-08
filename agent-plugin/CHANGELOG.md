# Changelog

## [0.1.2] - 2026-09-08

### Fixed

- Explain task-start blockers and keep provider/model labels separate from runner availability.
- Distinguish unknown readiness from confirmed not-ready tasks, and treat missing sibling
  dependency edges as advisory rather than a start blocker.
- Require fresh open leaf-task evidence before dispatch and use a unique actor for atomic claims
  when the installed Beads CLI supports it. Failed or unavailable claims do not start workers.

## [0.1.1] - 2026-08-30

### Fixed

- Explain the difference between the active plugin payload and the full-repository marketplace
  source cache.
- Include the required VS Code plugin enablement setting and recommend the supported marketplace
  install path.
- Clarify that starting parallel agents depends on tools provided by the host client.

## [0.1.0] - 2026-08-30

### Added

- Add a Beads project-manager skill and GitHub Copilot custom agent.
- Publish self-hosted marketplace metadata for VS Code and GitHub Copilot CLI.
