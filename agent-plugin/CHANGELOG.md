# Changelog

## [0.1.3] - 2026-09-13

### Added

- Show parent-to-leaf subagent plans, dependency waves, and requested provider/model in chat.
- Report meaningful host execution events with worker identity when available, keeping recorded
  Beads status separate from observed progress and accepted work.
- Clarify that plugin chat reports do not stream into the VSIX GUI, and avoid polling loops or
  storing sensitive execution content in shared task metadata.

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
