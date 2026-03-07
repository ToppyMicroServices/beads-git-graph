# Publish Gate (Mandatory)

This gate must be green before Marketplace publication.

## 1) Compatibility Decision (Fixed)

- Keep existing command IDs and settings keys under `beads-git-graph.*` for now.
- Keep Beads identity in UI and marketplace metadata.
- No additional prefix migration is currently planned.

## 2) Identity Final Check

Validate all of the following point to the active project repository:

- `publisher` (`ToppyMicroServices`)
- `name` (extension ID)
- `displayName`
- `repository`
- `homepage`
- `bugs.url`
- README badges and release links
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

- Marketplace publication should use the current package version and changelog line, without resetting the version track.
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

## 6) Language Note

- Japanese-language examples or supplemental notes are acceptable when they reflect the maintainer's native language.
- They must not imply Japan-specific support, preferential treatment, or a narrower intended audience.
