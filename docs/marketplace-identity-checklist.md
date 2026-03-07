# Marketplace Identity Checklist (Mandatory)

This checklist is mandatory before publishing this extension to VS Code Marketplace or Open VSX.

## 1) Identity Uniqueness

- Project name is set to `beads-git-graph`.
- Display name does not imply official upstream ownership.
- `publisher.name` pair (`ToppyMicroServices.beads-git-graph`) is unique in target marketplace.
- Active repository is `ToppyMicroServices/beads-git-graph`.
- Repository naming is aligned (`beads-git-graph`) while preserving git history.

## 2) Provenance Clarity

- README clearly states:
  - based on the MIT-licensed history of `mhutchie/vscode-git-graph` up to the last MIT-licensed commit
  - continued from [neo-git-graph](https://github.com/asispts/neo-git-graph)
  - this project is independent and not an upstream-tracking distribution
- Any marketplace description avoids ambiguity or endorsement implication.

## 3) License and Attribution

- MIT license text is included in full.
- Copyright notices for original and fork/modification are preserved.
- Contributor attribution is retained where applicable.

## 4) Review-Risk Reduction

- No conflicting extension identity with existing item under same publisher.
- No branding that can be mistaken for upstream official release.
- Changelog/release notes mention independent maintenance policy.

## 5) Language Neutrality

- Any Japanese-language examples or supplemental notes exist because Japanese is the maintainer's native language.
- They do not imply Japan-specific support, preferential treatment, or a different target audience.

## 6) Operational Note

If a further repository rename is ever needed, it should be done by repository administrators, e.g.:

```bash
gh repo rename beads-git-graph --yes
```

Run this only after confirming downstream links, badges, and automation references.
