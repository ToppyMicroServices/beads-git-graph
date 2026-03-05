# Marketplace Identity Checklist (Mandatory)

This checklist is mandatory before publishing this extension to VS Code Marketplace or Open VSX.

## 1) Identity Uniqueness

- Project name is set to `beads-git-graph`.
- Display name does not imply official upstream ownership.
- `publisher.name` pair is unique in target marketplace.
- Repository naming is aligned (`beads-git-graph`) while preserving git history.

## 2) Provenance Clarity

- README clearly states:
  - based on MIT historical source from `mhutchie/vscode-git-graph`
  - this project is independent and not upstream-tracking
- Any marketplace description avoids ambiguity or endorsement implication.

## 3) License and Attribution

- MIT license text is included in full.
- Copyright notices for original and fork/modification are preserved.
- Contributor attribution is retained where applicable.

## 4) Review-Risk Reduction

- No conflicting extension identity with existing item under same publisher.
- No branding that can be mistaken for upstream official release.
- Changelog/release notes mention independent maintenance policy.

## 5) Operational Note

Repository rename should be done by repository administrators, e.g.:

```bash
gh repo rename beads-git-graph --yes
```

Run this only after confirming downstream links, badges, and automation references.
