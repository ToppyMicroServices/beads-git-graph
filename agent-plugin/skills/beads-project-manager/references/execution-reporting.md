# Subagent plans and execution reports

Use chat as the visible report surface. This plugin has no API to stream live progress into the
VSIX GUI. Existing Beads fields may carry concise handoff metadata when the installed CLI supports
them and the task's write authorization covers the update; a GUI refresh shows recorded state,
not a live worker feed. Do not invent metadata fields or a GUI transport.

## Before dispatch

Show the parent task and its leaf tasks with their IDs, outcomes, acceptance checks, and permitted
edit scopes. Use a compact tree or table when it makes the grouping clearer. Parent-child grouping
is not a dependency: show real dependency direction separately, plus the tasks ready now and the
later parallel waves. Label proposed waves as a plan; dispatch still requires a fresh successful
readiness query and the atomic claim described in `SKILL.md`.

For each proposed assignment, show the requested provider/model, or state that it is unspecified.
Keep this separate from the provider/model the host actually confirms. Do not silently substitute
the user's choice or infer availability from a label. A planned assignment does not start a worker
or authorize a provider call. Keep user-specified cost and concurrency limits visible where they
affect the plan.

## After dispatch

Report the affected task when a meaningful host event arrives: dispatch acknowledgement, worker
start, a new blocker, result delivery, check completion, or a required operator decision. Use the
host's event or bounded wait mechanism when available. Do not spin on status queries or repeat
unchanged progress. If the host cannot observe execution, say that live status is unavailable;
do not invent heartbeat updates or percentages.

A short update can contain:

| Item           | Evidence to show                                                       |
| -------------- | ---------------------------------------------------------------------- |
| Task           | Parent and leaf IDs; requested provider/model                          |
| Worker         | Host-returned worker/task identity, if available; never a guessed ID   |
| Recorded state | Beads status and when it was read; `in_progress` is not a heartbeat    |
| Observed phase | Latest host event and when it was observed; unavailable if not exposed |
| Next step      | Remaining check, blocker, required human review, or next ready task    |

Use only phases supported by observed events. A queued request or acknowledged handoff is not
proof of worker execution. Response completion means output arrived; verification means the
actual artifact and acceptance checks were inspected. Keep human review pending when required by
the task or repository. Accepted work requires the specified acceptance evidence and any required
approval; neither model output nor a status label is acceptance. A stopped, cancelled, or failed
worker does not imply rollback or justify reopening its claimed task automatically.

Keep the report focused on changed tasks. At handoff, summarize the latest known state, evidence,
and unresolved decision without claiming that an unobserved worker is still running.

## Shared metadata and privacy

Record only fields supported by the installed Beads version and only within the authorized task
scope. Do not expose credentials, full prompts, raw provider responses, or private host paths in
shared task metadata. Prefer a concise result and an approved artifact reference. Chat reporting
does not authorize new Beads writes, extra provider requests, automatic task closure, or database
migration. Preserve the skill's claim and operator-approval gates.
