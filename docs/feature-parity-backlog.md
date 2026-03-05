# Feature Parity Backlog

This document tracks post-MIT feature parity with upstream Git Graph release notes.

## Scope

- Source: `mhutchie/vscode-git-graph` releases
- Tracking unit: one feature = one issue/PR
- Priority: platform/web compatibility first, then UX improvements

## Implemented

- [x] Webview resource path foundation for remote/web compatibility
- [x] Diff title menu: `Open File`
- [x] Commit details file menu:
  - [x] `View Diff`
  - [x] `View File at this Revision`
  - [x] `View Diff with Working File`
  - [x] `Open File`
  - [x] `Copy Relative File Path`
  - [x] `Copy Absolute File Path`
- [x] Repository dropdown order option (`Workspace Full Path` / `Repository Name`)
- [x] Dialog reference input space substitution (`None` / `Hyphen` / `Underscore`)
- [x] Enhanced accessibility file change indicators (`A|M|D|R|U`)

## Next Candidates (Issue-first)

- [ ] Detect renames when opening working file from historical commits (upstream #480)
- [ ] Add `Reset File to this Revision...` action in commit details (upstream #516)
- [ ] Add context menu visibility controls for commit details file actions (upstream #517)
- [ ] Add "Mark as Reviewed / Not Reviewed" workflow for file-level review (upstream #482)

## Process

1. Create or update one issue from this backlog.
2. Implement with one PR per issue.
3. Reference upstream release item/issue in PR description.
4. Move status in this file after merge.
