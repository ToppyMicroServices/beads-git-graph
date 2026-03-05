# Publish Gate (Mandatory)

This gate must be green before Marketplace publication.

## 1) Compatibility Decision (Fixed)

- Keep existing command IDs and settings keys under `neo-git-graph.*` for now.
- Keep Beads identity in UI and marketplace metadata.
- Prefix migration plan:
  - Add `beads-git-graph.*` aliases first.
  - Keep old IDs as compatibility aliases.
  - Migrate in a later release (suggested: `0.2.0`) with deprecation notes.

## 2) Identity Final Check

Validate all of the following point to the active project repository:

- `publisher`
- `name` (extension ID)
- `displayName`
- `repository`
- `homepage`
- `bugs.url`
- icon and branding are not confusable with upstream

## 3) CI Security Gate (Stop-the-line)

Required checks:

- `pnpm run format`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run package`
- CodeQL: no High
- OSV / Dependabot: High fixed; Medium either fixed or explicitly triaged with rationale

## 4) Release Ops Lock-in

- Initial Marketplace release target: `0.1.0` (new identity track)
- Maintain and review:
  - `CHANGELOG.md`
  - `SECURITY.md`
  - publish README copy
- Publish workflow must keep least privilege:
  - minimal `permissions`
  - no broad secret exposure in job env

## 5) Beads Value Proof

At least one clear Beads-first capability must be visible in release notes and screenshots:

- Beads Graph view (`.beads` auto-detect + list)
- or Beads↔Git linkage workflow
