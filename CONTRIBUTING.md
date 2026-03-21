# Contributing

Thanks for contributing to Beads Git Graph.

## Before You Start

- Use `bd` for issue tracking.
- Prefer small, focused changes.
- For security issues, do not open a public issue. Use the process in [SECURITY.md](./SECURITY.md).

## Setup

```bash
pnpm install
pnpm run compile
```

## Daily Workflow

```bash
bd ready
bd show <id>
bd update <id> --status in_progress
```

Make your change, then run the checks that match the work:

```bash
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run compile
```

## Pull Requests

- Link the related `bd` issue when there is one.
- Keep PR descriptions short and explicit about user impact.
- Call out any follow-up work that is intentionally left out.
- Do not merge changes that bypass required review or required checks.

## Release Notes

- Update `CHANGELOG.md` for user-visible changes.
- Keep README and release metadata aligned when behavior or versioned copy changes.

## End Of Session

Before finishing work:

```bash
git pull --rebase
bd sync
git push
git status
```

`git status` should show that `main` is up to date with `origin/main`.
