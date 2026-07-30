# Agent Project Manager Roadmap

## Goal

Evolve Beads Git Graph into a local-first project manager for agent teams: plan work as a
dependency graph, allocate isolated work to agents, surface progress and intervention needs from
explicit evidence, and keep completion under human control.

Agent tiers used below:

- **low-cost**: one bounded pure-logic, fixture, documentation, or deterministic-test change
- **capable**: a cross-file UI/CLI change or reconciliation of more than one source of state
- **human-decision**: product policy, destructive/state-changing behavior, or an external trust
  boundary

Status labels:

- **completed**: implemented and checked at the evidence level named by the task
- **in progress**: part of the current hardening pass, but not complete until its named test passes
- **pending**: not implemented or not tested at the named evidence level

## Delegation Contract

Each child task below is intended to be assignable independently. A low-cost agent should receive
exactly one child task, read only the listed input, edit only the listed target, run the named test,
and report the changed files plus the exact test result. It should stop and return an unknown if an
API, command, or accepted product decision is not present in the input; it should not invent one.

Every child task states:

- **Input**: evidence and files to inspect before editing
- **Edit target**: the single artifact or tightly bounded surface it may change
- **Done/test**: one observable decision and the test that proves it
- **Depends**: prerequisites that must already be complete
- **Tier**: the least expensive agent tier expected to complete it safely

## Confirmed Baseline

- [x] **BASE-001 — Dependency planning view:** table and graph views show task hierarchy,
      dependency edges, parallel-ready hints, and Critical Path.
- [x] **BASE-002 — Agent execution:** Start AI and Start Parallel select a provider/model, preserve
      model/SSOT metadata, create isolated worktrees for Copilot sessions, or retain direct-provider
      text responses as local artifacts.
- [x] **BASE-003 — Execution metadata:** task details can show agent, model, SSOT, worktree, branch,
      PR, check, progress, and sync-risk fields.
- [x] **BASE-004 — Merge safety:** derived parallel merge tasks check worktrees, branches, PRs, and
      checks before requesting merge.
- [x] **BASE-005 — Local-first boundary:** Beads and Git data remain local by default; no telemetry
      is declared.

Current limits: execution hints and batch results are recorded outcomes rather than verified live
session state; progress can come from issue fields or notes; there is no evidence freshness model
or structured allocation suggestion workflow. AI Plan Draft generation and explicit review/import
are implemented at source level, but their complete approval interaction and the full Manage
scenario still need packaged Extension Host verification in a trusted, compatible disposable
workspace.

## P0 — Agent Work Queue MVP

### PM-001 — Pure task-state projection — completed

- [x] **PM-001A — Define queue lanes and precedence**
  - **Input:** normalized Bead fields and the existing status, dependency, PR, check, and sync-risk
    metadata contracts.
  - **Edit target:** `src/beadsProjectState.ts`.
  - **Done/test:** one pure projection chooses exactly one of attention, review, running, queue, or
    done; `tests/beadsProjectState.test.ts` proves the precedence with a mixed fixture.
  - **Depends:** BASE-001, BASE-003.
  - **Tier:** low-cost.
- [x] **PM-001B — Preserve unknown evidence**
  - **Input:** tasks with missing readiness, missing progress, and incomplete execution metadata.
  - **Edit target:** `src/beadsProjectState.ts` and its dedicated test fixture only.
  - **Done/test:** absence remains unknown rather than failure or success;
    `tests/beadsProjectState.test.ts` asserts the displayed reason and count.
  - **Depends:** PM-001A.
  - **Tier:** low-cost.

### PM-002 — Manage overview and queue rendering — completed

- [x] **PM-002A — Render the five-lane overview**
  - **Input:** the PM-001 queue projection.
  - **Edit target:** the Manage-view renderer and styles in `src/beadsWebview.ts`.
  - **Done/test:** the view renders attention, review, running, queue, and done counts without
    removing Table or Graph; `tests/beadsMissionControlWebview.test.ts` checks the mixed fixture.
  - **Depends:** PM-001A.
  - **Tier:** capable.
- [x] **PM-002B — Render evidence without claiming live activity**
  - **Input:** owner, model, progress, readiness, PR, check, and recorded status metadata.
  - **Edit target:** Agent Work Queue card markup in `src/beadsWebview.ts`.
  - **Done/test:** the Running lane states that it is derived from recorded metadata and does not
    confirm a live agent; the static render test asserts that caveat and escaped content.
  - **Depends:** PM-002A.
  - **Tier:** low-cost.

### PM-003 — Manage interactions — completed at source-preview level

- [x] **PM-003A — Add Manage as a persisted view mode**
  - **Input:** the existing Table/Graph view-mode behavior.
  - **Edit target:** `web/beadsMain.ts` and the Manage button markup in `src/beadsWebview.ts`.
  - **Done/test:** Manage can be selected and the existing view modes remain available;
    `tests/beadsWebviewMetadata.test.ts` asserts the control and mode metadata.
  - **Depends:** PM-002A.
  - **Tier:** capable.
- [x] **PM-003B — Reuse task Details navigation**
  - **Input:** an attention card and the existing task-details action contract.
  - **Edit target:** Agent Work Queue card actions in `src/beadsWebview.ts`.
  - **Done/test:** Details selects the matching task and returns to its existing details surface;
    the browser preview exercised the action with the mixed fixture.
  - **Depends:** PM-003A.
  - **Tier:** low-cost.
- [x] **PM-003C — Emit the existing Start AI message for eligible cards**
  - **Input:** a queue card whose readiness is explicitly confirmed.
  - **Edit target:** Agent Work Queue action markup in `src/beadsWebview.ts`.
  - **Done/test:** the source preview posts the existing `assignStartBead` payload for the correct
    task/workspace; the browser preview inspected the emitted message.
  - **Depends:** PM-003A and the eligibility hardening in PM-005A for release.
  - **Tier:** low-cost.

### PM-004 — User-perspective verification

- [x] **PM-004A — Add a deterministic state-model test**
  - **Input:** one mixed fixture containing attention, review, running, queue, done, and unknown
    evidence.
  - **Edit target:** `tests/beadsProjectState.test.ts`.
  - **Done/test:** the focused Vitest run proves stable lanes, counts, reasons, and unknown handling.
  - **Depends:** PM-001B.
  - **Tier:** low-cost.
- [x] **PM-004B — Add a static webview render test**
  - **Input:** the PM-004A fixture and rendered HTML.
  - **Edit target:** `tests/beadsMissionControlWebview.test.ts`.
  - **Done/test:** Vitest proves headings, counts, attention reasons, the non-live caveat, action
    payloads, and HTML escaping.
  - **Depends:** PM-002B, PM-003B.
  - **Tier:** low-cost.
- [x] **PM-004C — Exercise the compiled source preview in a browser**
  - **Input:** compiled current webview script and the synthetic mixed-status preview.
  - **Edit target:** test evidence only; no product source is changed by this task.
  - **Done/test:** Manage and warning-free Graph Details, task-specific accessible action names,
    filtered parallel targets, and single Start AI/Start Parallel/Plan Import messages under
    double-click were exercised in the browser preview and recorded separately from Extension Host
    evidence.
  - **Depends:** PM-003C, PM-004B.
  - **Tier:** low-cost.
- [ ] **PM-004D — Verify an installed packaged extension — partially verified**
  - **Input:** a freshly packaged VSIX, a disposable Git/Beads workspace, and the MAN-10 fixture in
    `docs/user-testing-agent-project-manager.md`.
  - **Edit target:** the MAN-10 result record and screenshots; product code only if a reproducible
    defect is found in a separate task.
  - **Done/test:** an Extension Development Host or installed VSIX passes Manage, Details, confirmed
    Start AI, disabled-action, refresh, keyboard, and 640 px checks. A source preview does not satisfy
    this task.
  - **Depends:** PM-005A through PM-005G and a packaged build.
  - **Tier:** capable.
  - **Observed:** the packaged extension activated in an isolated Extension Host; its webview loaded
    synthetic Beads data and a fake `bd` without a migration, bootstrap, sync, or write. The packaged
    Plan view was exercised by mouse and keyboard at 640 CSS px without horizontal overflow. The
    2026-07-30 final VSIX additionally passed a VS Code 1.127.0 Host smoke for activation, registered
    commands, machine-scoped `bdPath`, and the packaged Restricted Mode manifest.
  - **Remaining:** complete every MAN-10 Manage/Details/Start/refresh statement in a trusted,
    initialized disposable workspace. The source preview and partial packaged checks do not satisfy
    the full task.

### PM-005 — Queue safety hardening — completed

- [x] **PM-005A — Gate Start AI on confirmed readiness**
  - **Input:** the PM-001 readiness result and existing Start AI action contract.
  - **Edit target:** queue-card action eligibility in `src/beadsWebview.ts` plus its focused test.
  - **Done/test:** only `readiness: confirmed` renders an enabled Start AI action; attention, review,
    running, done, and synthetic lanes render no Start AI action, while queue tasks with unknown
    readiness render it disabled. The focused static render test covers each case.
  - **Depends:** PM-001B, PM-003C.
  - **Tier:** low-cost.
- [x] **PM-005B — Keep unrecognized statuses visible by default**
  - **Input:** a task with a non-empty status outside the supported status set and the default filter
    behavior.
  - **Edit target:** state projection/filter interaction in `src/beadsProjectState.ts`,
    `src/beadsWebview.ts`, and `web/beadsMain.ts`, with one focused fixture.
  - **Done/test:** the task is in attention with an explicit unrecognized-status reason; the default
    active filter includes `other`, and focused static/browser fixtures prove it remains visible.
  - **Depends:** PM-001A, PM-003A.
  - **Tier:** capable.
- [x] **PM-005C — Mark synthetic merge readiness as not applicable**
  - **Input:** a derived parallel-merge card and its merge preflight metadata.
  - **Edit target:** synthetic-card projection/rendering in `src/beadsProjectState.ts` and
    `src/beadsWebview.ts`, with one focused assertion.
  - **Done/test:** the derived merge card explicitly displays `Readiness N/A` and its preflight
    reason, never readiness unknown/confirmed; focused model/render tests preserve the existing
    preflight as the merge decision.
  - **Depends:** PM-001A, BASE-004.
  - **Tier:** low-cost.
- [x] **PM-005D — Disable actions when `bd` is unavailable**
  - **Input:** missing-executable state from `src/beadsViewTypes.ts` and the existing
    unavailable-workspace rendering path. Schema compatibility is not covered by this task.
  - **Edit target:** action availability rendering in `src/beadsWebview.ts` and the existing
    availability guards in `web/beadsMain.ts`, plus one unavailable-workspace fixture.
  - **Done/test:** Manage/Graph Start AI, Manage/Graph Merge PRs, Start Parallel, and Sync render
    disabled with a clear unavailable reason when `bd` is unavailable; focused render tests cover
    every control, and the webview message handlers retain their `bdAvailable` guards.
  - **Depends:** BASE-002 and observed command availability; no database migration is permitted.
  - **Tier:** capable.
- [x] **PM-005E — Separate readiness from parallel preference**
  - **Input:** `bd ready` issue IDs plus explicit parallel/no-parallel metadata.
  - **Edit target:** `BeadItem.readyByBd` and `inferReadyParallelizableItems` in
    `src/beadsData.ts`, with its focused fixtures.
  - **Done/test:** a single ready task and a ready task marked serial both retain confirmed
    readiness, while an explicit-parallel task outside `bd ready` does not; `beadsData.test.ts` and
    `beadsProjectState.test.ts` assert all three decisions.
  - **Depends:** PM-001A.
  - **Tier:** low-cost.
- [x] **PM-005F — Restrict Start Parallel to a ready cohort**
  - **Input:** confirmed readiness, explicit parallel preference, serial suppression, and task
    status.
  - **Edit target:** parallel-start target projection in `src/beadsWebview.ts` and its render
    fixture.
  - **Done/test:** the action appears only for at least two open `bd ready` tasks, excludes serial
    tasks, and never includes an explicit-parallel task outside `bd ready`; the render test decodes
    and compares the exact target IDs.
  - **Depends:** PM-005E, BASE-002.
  - **Tier:** low-cost.
- [x] **PM-005G — Load the complete ready set**
  - **Input:** the local `bd ready --help` contract: default limit 100 and `--limit 0` for unlimited
    results.
  - **Edit target:** the read-only ready command in `src/beadsView.ts` and focused assertions.
  - **Done/test:** the command explicitly requests `--limit 0`; a 101-task fixture retains readiness
    for task 101, and a source assertion locks the command arguments.
  - **Depends:** PM-005E and a CLI version that supports the observed flag.
  - **Tier:** low-cost.

### PM-006 — Refresh continuity — completed at source-browser level

- [x] **PM-006A — Replace normal full-page reloads with incremental data updates**
  - **Input:** the existing render signature, Beads file watchers, and compiled webview.
  - **Edit target:** `src/beadsView.ts`, `src/beadsProtocol.ts`, and `web/beadsMain.ts`.
  - **Done/test:** an initial render still loads the complete document; later data changes
    reconcile generated workspace/warning content while preserving unchanged controls, and
    oversized or undeliverable updates use a safe full-render fallback.
  - **Depends:** BASE-001.
  - **Tier:** capable.
- [x] **PM-006B — Make concurrent refreshes latest-wins**
  - **Input:** overlapping asynchronous `loadBeads` operations and ordered render generations.
  - **Edit target:** refresh coordination in `src/beadsView.ts` and the webview host-message guard.
  - **Done/test:** a superseded host load cannot publish over a newer load, and the webview ignores
    a render generation it has already applied.
  - **Depends:** PM-006A.
  - **Tier:** low-cost.
- [x] **PM-006C — Preserve user interaction state across refresh**
  - **Input:** Graph/Table/Manage/Plan mode, selected details, filters, sort, collapse, scroll, and
    per-workspace graph transforms.
  - **Edit target:** persisted state and dynamic rebinding in `web/beadsMain.ts`.
  - **Done/test:** a compiled-source browser check keeps Graph, a WIP filter, `120%` zoom, and an
    open task drawer while updating the drawer to the refreshed task title; no new browser error is
    recorded.
  - **Depends:** PM-006A.
  - **Tier:** capable.
- [x] **PM-006E — Stabilize controls and Graph relationships during refresh**
  - **Input:** a warning state, dependency and parent-child task relationships, and a changed task
    title while Graph is open.
  - **Edit target:** keyed webview reconciliation, dynamic listener binding, Graph gestures, and
    SVG relationship overlays.
  - **Done/test:** a compiled-source browser check keeps the Fit button as the same focused DOM
    node with `0 px` position drift while updating the task title; normal drag pans at `142%`,
    two dependency arrows and one parent-child line remain visible, and no browser error is
    recorded.
  - **Depends:** PM-006A through PM-006C.
  - **Tier:** capable.
- [x] **PM-006F — Keep the visible viewport fixed throughout a live update**
  - **Input:** warning-only and task-content updates while Graph is zoomed, panned, and showing
    task Details.
  - **Edit target:** update reconciliation, viewport anchoring, and client-owned Graph geometry in
    `web/beadsMain.ts`.
  - **Done/test:** a compiled-source browser check records identical page position, Graph top,
    `173%` zoom, pan, open Details state, and control identity before the update, synchronously
    after it, and after each of the next two animation frames. Warning-only updates skip workspace
    reconciliation, and task-content updates run the Graph presentation pass once.
  - **Depends:** PM-006A through PM-006E.
  - **Tier:** capable.
- [x] **PM-006G — Keep task actions and details stable across view changes**
  - **Input:** selected task Details, warning-free Graph data, rapid action clicks, a status filter,
    and unavailable write/sync capabilities.
  - **Edit target:** generated action metadata, webview interaction state, and Host action guards.
  - **Done/test:** Manage and Graph show the selected Details in their own visible host; duplicate
    action events emit one request; filtered-out tasks leave the parallel batch; and Create, Close,
    and Sync stay disabled until the relevant capability is confirmed.
  - **Depends:** PM-006A through PM-006F.
  - **Tier:** capable.
- [ ] **PM-006D — Repeat refresh continuity in an installed VSIX**
  - **Input:** a freshly packaged VSIX and a disposable workspace whose issue fixture changes while
    Graph/Table details are open.
  - **Edit target:** MAN-14 evidence only unless a reproducible packaged-only defect is found.
  - **Done/test:** repeated watcher and manual refreshes do not flash Table, rewind the selected
    view, close details, reset filters, or reset the graph transform.
  - **Depends:** PM-006A through PM-006C.
  - **Tier:** capable.

## P1 — Plan

### PM-101 — Define and validate a Plan Draft

- [x] **PM-101A — Define the versioned draft shape**
  - **Input:** goal, task, dependency, acceptance, priority, optional model, and SSOT requirements.
  - **Edit target:** one new pure Plan Draft model under `src/`.
  - **Done/test:** a minimal valid draft parses and round-trips without adding values; one fixture
    test proves the round-trip.
  - **Depends:** PM-001A.
  - **Tier:** low-cost.
- [x] **PM-101B — Return local validation errors**
  - **Input:** valid, duplicate-ID, missing-dependency, self-dependency, and cyclic fixtures.
  - **Edit target:** the PM-101A pure validator and its one table-driven test file.
  - **Done/test:** each invalid fixture returns a specific task/path error and performs no Beads
    write; the table-driven test covers all five decisions.
  - **Depends:** PM-101A.
  - **Tier:** low-cost.

### PM-102 — Preview a proposed plan

- [x] **PM-102A — Render a read-only draft summary**
  - **Input:** a validated PM-101 draft.
  - **Edit target:** one Plan Preview webview section.
  - **Done/test:** goal, tasks, dependencies, acceptance criteria, and validation errors are visible;
    one static render test checks escaped content.
  - **Depends:** PM-101B.
  - **Tier:** capable.
- [x] **PM-102B — Project the draft into the existing graph**
  - **Input:** the PM-101 graph plus current graph-model contracts.
  - **Edit target:** one pure draft-to-graph adapter and its fixture test.
  - **Done/test:** Critical Path and parallel candidates update when one dependency changes; the
    fixture test asserts the resulting nodes/edges/path.
  - **Depends:** PM-101B, BASE-001.
  - **Tier:** low-cost.
- [x] **PM-102C — Prove Cancel is read-only**
  - **Input:** a modified preview and a fake mutation recorder.
  - **Edit target:** the preview Cancel handler and one interaction test.
  - **Done/test:** Cancel closes/discards the draft and records zero Beads mutation calls.
  - **Depends:** PM-102A.
  - **Tier:** low-cost.

### PM-103 — Detect Beads write capabilities

- [x] **PM-103A — Classify observed command capability**
  - **Input:** compatible output, missing executable, unknown command, and schema mismatch results.
  - **Edit target:** one non-mutating capability probe/model under `src/`.
  - **Done/test:** the model returns supported or disabled plus the observed reason; a fake-executable
    test covers all four cases without initialization or migration.
  - **Depends:** PM-101A.
  - **Tier:** capable.
- [x] **PM-103B — Bind capability to Plan Import controls**
  - **Input:** PM-103A result and Plan Preview actions.
  - **Edit target:** Plan Preview action rendering only.
  - **Done/test:** Import is enabled only for observed compatible capability; a static test asserts
    disabled labels for all unsupported cases.
  - **Depends:** PM-102A, PM-103A.
  - **Tier:** low-cost.

### PM-104 — Import an approved plan

- [x] **PM-104A — Show the exact pending mutation list**
  - **Input:** an approved, validated draft and supported PM-103 capability.
  - **Edit target:** one pure draft-to-mutations projector plus preview rendering.
  - **Done/test:** ordered create/update/dependency operations and arguments are visible before
    confirmation; one snapshot test proves the order.
  - **Depends:** PM-102B, PM-103B.
  - **Tier:** capable.
- [x] **PM-104B — Report partial import results**
  - **Input:** the PM-104A mutation list and a fake executor that fails operation three.
  - **Edit target:** the Plan Import executor/result model.
  - **Done/test:** created IDs, the failure, and unexecuted operations are returned without claiming
    rollback; the fake-executor test asserts call order and result groups.
  - **Depends:** PM-104A.
  - **Tier:** capable.
- [ ] **PM-104C — Approve import in a disposable workspace — partially verified**
  - **Input:** a packaged extension, a compatible disposable Beads workspace, and a small draft.
  - **Edit target:** test evidence only.
  - **Done/test:** explicit approval preserves task/dependency fidelity and the simulated failure is
    reported as specified; record final Beads state and command log.
  - **Depends:** PM-104B.
  - **Tier:** human-decision.
  - **Observed:** the production import executor created two tasks and their dependency in a
    compatible disposable Beads database with title, priority, acceptance criteria, model, SSOT,
    goal, and draft-version metadata preserved. The packaged Plan view also completed local
    preview, Cancel, keyboard, and 640 px checks.
  - **Remaining:** exercise the packaged approval dialog and its final/partial result UI in a
    trusted, initialized disposable workspace. No accepted database was migrated or bootstrapped.

### PM-105 — Decompose one goal with a selected AI

- [x] **PM-105A — Build and validate a bounded planning request**
  - **Input:** one user goal, a workspace display name, existing relative SSOT candidates, and the
    configured task provider/model catalog.
  - **Edit target:** one pure prompt/response boundary in `src/planDraftGeneration.ts`.
  - **Done/test:** the prompt treats the goal as untrusted data, requests 1–20 atomic tasks and a
    DAG, excludes file contents and absolute paths, accepts only one JSON object, restores the
    original goal, and returns the existing Plan Draft validation errors; the focused generation
    tests cover valid, malformed, fenced, injected, and oversized responses.
  - **Depends:** PM-101B, PM-200C.
  - **Tier:** low-cost.
- [x] **PM-105B — Connect direct-response generation to Plan**
  - **Input:** PM-105A plus Ollama, Hugging Face, OpenAI, and Anthropic response providers.
  - **Edit target:** the Plan webview protocol and Extension Host request boundary.
  - **Done/test:** a user enters one goal, explicitly selects and approves one direct-response
    provider request, receives an editable draft, and can open the retained raw response artifact.
    Copilot is not offered because this path requires a synchronous text response.
  - **Depends:** PM-105A, PM-203D.
  - **Tier:** capable.
- [x] **PM-105C — Keep generation, review, and import as separate decisions**
  - **Input:** a generated or pasted Plan Draft plus the existing capability-gated import.
  - **Edit target:** Plan workflow copy, editor, preview, and import action boundaries.
  - **Done/test:** generation writes no Beads state; the user can review or edit the draft and see
    exact validation/mutation output; import still requires compatible Beads capability and a
    separate explicit approval.
  - **Depends:** PM-103B, PM-104A, PM-105A.
  - **Tier:** human-decision.
- [ ] **PM-105D — Package-test goal decomposition**
  - **Input:** a packaged VSIX, trusted disposable workspace, fake local/cloud response fixtures,
    and incompatible Beads fixtures.
  - **Edit target:** acceptance evidence only.
  - **Done/test:** provider selection, Cancel, valid/invalid response, artifact access, draft edit,
    schema-mismatch read-only generation, and explicit import separation pass in an Extension Host.
  - **Depends:** PM-105B, PM-104C.
  - **Tier:** capable.

## P2 — Allocate

### PM-200 — Choose a model preference — completed

- [x] **PM-200A — Choose before starting one task**
  - **Input:** task-declared model, configured model choices, and a custom one-line value.
  - **Edit target:** the Extension Host launch boundary and one pure option-normalization helper.
  - **Done/test:** the native picker runs before worktree or Beads mutation; Cancel returns without
    mutation; focused source and pure tests cover order, validation, and deduplication.
  - **Depends:** BASE-002.
  - **Tier:** capable.
- [x] **PM-200B — Preserve or override parallel task models**
  - **Input:** ready tasks with mixed declared and missing model preferences.
  - **Edit target:** parallel launch selection plus its pure override helper.
  - **Done/test:** per-task choice preserves declared values and an explicit override applies to
    every selected task; a pure test covers both results.
  - **Depends:** PM-005F, PM-200A.
  - **Tier:** low-cost.
- [x] **PM-200C — Enforce a provider/model choice**
  - **Input:** task provider/model metadata, provider-scoped configured choices, and a custom model
    ID.
  - **Edit target:** single and parallel provider/model pickers plus provider result artifacts.
  - **Done/test:** the UI distinguishes a Copilot coding session from a direct API text response;
    requested and provider-confirmed model IDs are recorded separately in the local artifact.
  - **Depends:** PM-203A.
  - **Tier:** human-decision.
- [x] **PM-200D — Connect requested models through task dependencies**
  - **Input:** a valid Plan Draft whose dependency-linked tasks declare different requested models
    and shared SSOT references.
  - **Edit target:** Plan graph projection, Plan preview, and the dependent-task launch prompt.
  - **Done/test:** preview labels only explicit cross-model transitions; downstream prompts carry
    upstream bead IDs from a fresh Host-side `bd show` and require recorded output/worktree/PR
    verification; the Host checks `bd ready` before worktree preparation and again before mutation;
    behavior tests cover guard ordering, stale readiness, dependency-query failure, parse, graph,
    preview, mutation projection, and resolved Beads dependency creation.
  - **Depends:** PM-101B, PM-104A, PM-200A.
  - **Tier:** capable.

### PM-201 — Model allocation constraints

- [ ] **PM-201A — Parse optional allocation fields**
  - **Input:** legacy tasks plus tasks declaring role, model, SSOT, work scope, risk, and concurrency.
  - **Edit target:** one backward-compatible allocation metadata parser.
  - **Done/test:** declared fields parse and missing fields remain absent; a table test compares legacy
    and enriched fixtures.
  - **Depends:** PM-101A.
  - **Tier:** low-cost.
- [ ] **PM-201B — Render declared allocation evidence**
  - **Input:** PM-201A output.
  - **Edit target:** task details and Agent Work Queue allocation labels only.
  - **Done/test:** only declared values are rendered; a static HTML test proves legacy tasks gain no
    invented owner/model/scope.
  - **Depends:** PM-201A, PM-002B.
  - **Tier:** low-cost.

### PM-202 — Suggest assignments and conflicts

- [ ] **PM-202A — Produce evidence-labelled assignment suggestions**
  - **Input:** ready tasks and declared allocation metadata.
  - **Edit target:** one pure suggestion function and one fixture test.
  - **Done/test:** every suggestion includes the fields that supported it; unknown evidence produces
    no confident suggestion.
  - **Depends:** PM-201A.
  - **Tier:** low-cost.
- [ ] **PM-202B — Detect declared-scope conflicts**
  - **Input:** non-overlapping, overlapping, unknown-scope, and concurrency-limit fixtures.
  - **Edit target:** one pure conflict detector and its table-driven test.
  - **Done/test:** overlap and limit breaches become warnings; unknown scope remains unknown and no
    task is reassigned automatically.
  - **Depends:** PM-201A.
  - **Tier:** low-cost.
- [ ] **PM-202C — Show suggestions separately from decisions**
  - **Input:** PM-202A suggestions and PM-202B warnings.
  - **Edit target:** one allocation suggestion UI section.
  - **Done/test:** suggestion, warning, and confirmed assignment have distinct wording; a static test
    asserts all three labels.
  - **Depends:** PM-202A, PM-202B.
  - **Tier:** capable.

### PM-203 — Execute provider-specific AI work — direct-response milestone completed

- [x] **PM-203A — Define provider-neutral execution outcomes**
  - **Input:** current Copilot launch success/failure/fallback behavior.
  - **Edit target:** provider definitions plus the launch-boundary result status.
  - **Done/test:** session opened, prompt prepared, response opened/stored, and failure are distinct;
    a pure contract test covers every status.
  - **Depends:** PM-201A, BASE-002.
  - **Tier:** capable.
- [x] **PM-203B — Route current Copilot launch through provider selection**
  - **Input:** existing Copilot command discovery and prompt preparation.
  - **Edit target:** the current launch integration only.
  - **Done/test:** current command discovery and clipboard fallback remain under the Copilot branch
    of the provider selection/start boundary; focused source tests pass.
  - **Depends:** PM-203A.
  - **Tier:** capable.
- [x] **PM-203C — Preserve the prompt fallback**
  - **Input:** unavailable provider, launch failure, and clipboard availability fixtures.
  - **Edit target:** provider fallback handler and one interaction test.
  - **Done/test:** a complete prepared prompt is offered without claiming launch; the test records
    notification and clipboard calls.
  - **Depends:** PM-203B.
  - **Tier:** human-decision.
- [x] **PM-203D — Add secure direct-response providers**
  - **Input:** loopback Ollama plus official Hugging Face, OpenAI, and Anthropic HTTP contracts.
  - **Edit target:** provider client, SecretStorage wrapper, Workspace Trust gate, and credential
    command.
  - **Done/test:** fixed cloud endpoints, loopback-only Ollama, redacted failures, timeouts, response
    limits, provider request fixtures, and a credential canary test pass without SDK dependencies.
  - **Depends:** PM-203A.
  - **Tier:** capable.
- [x] **PM-203E — Preserve provider handoffs and response artifacts**
  - **Input:** dependency-linked tasks with distinct explicit providers and models.
  - **Edit target:** Plan Draft, Beads metadata/protocol, provider badges, and local artifact store.
  - **Done/test:** Hugging Face → Ollama → Anthropic survives parse, preview, mutation projection,
    and dependency creation; direct output is stored as untrusted text and never applied.
  - **Depends:** PM-200D, PM-203D.
  - **Tier:** capable.
- [ ] **PM-203F — Add autonomous tool-loop adapters for non-Copilot providers**
  - **Input:** an explicit tool protocol, workspace write policy, patch review UX, and cancellation
    contract.
  - **Edit target:** a future sandboxed coding-agent adapter; do not extend direct-response clients
    implicitly.
  - **Done/test:** tool calls remain scoped and reviewable, cancellation stops the loop, and UI
    distinguishes live activity from completed text responses.
  - **Depends:** PM-203D, a human-approved execution policy.
  - **Tier:** human-decision.
- [ ] **PM-203G — Package-test every provider path**
  - **Input:** packaged VSIX, trusted disposable workspace, fake loopback/provider fixtures, and
    secret canaries.
  - **Edit target:** Extension Host acceptance harness and result record.
  - **Done/test:** picker, Cancel, missing credential, successful response, failure, artifact,
    parallel confirmation, and no-secret-leak checks pass in the packaged extension.
  - **Depends:** PM-203E.
  - **Tier:** capable.

### PM-204 — Execute ready work with bounded parallelism

- [x] **PM-204A — Add a bounded all-settled response scheduler**
  - **Input:** an ordered direct-response task list, concurrency limit, progress callback, and
    cancellation signal.
  - **Edit target:** `src/agentExecutionCoordinator.ts`.
  - **Done/test:** at most the configured number of workers run at once; one failure does not stop
    unrelated tasks; input order is preserved; cancellation prevents unstarted requests; the
    focused coordinator tests prove each case.
  - **Depends:** PM-203D.
  - **Tier:** low-cost.
- [x] **PM-204B — Serialize Beads and Git mutation boundaries per workspace**
  - **Input:** concurrent direct-provider responses plus final readiness checks, Beads assignment,
    and worktree preparation.
  - **Edit target:** one per-workspace serial queue and the guarded launch finalization boundary.
  - **Done/test:** provider network waits may overlap, but final `bd show`/`bd ready`, Beads updates,
    and Git/worktree mutations do not overlap within one workspace; Copilot worktree/session
    launches remain sequential; queue and readiness-guard tests prove ordering and rejection
    recovery.
  - **Depends:** PM-005F, PM-204A.
  - **Tier:** capable.
- [x] **PM-204C — Show persistent per-task batch outcomes**
  - **Input:** fulfilled, failed, skipped, and cancelled task outcomes from one Start Parallel
    request.
  - **Edit target:** the provider-neutral host message plus one Manage result panel.
  - **Done/test:** response ready, session started, prompt prepared, failed, skipped, and cancelled
    remain distinct; successful tasks are not rerun when failed/cancelled tasks are retried; wording
    describes recorded outcomes rather than live monitoring.
  - **Depends:** PM-203A, PM-204B.
  - **Tier:** capable.
- [ ] **PM-204D — Package-test mixed-provider parallel execution**
  - **Input:** a packaged VSIX, fake direct providers, sequential Copilot fixture, fake Beads/Git
    logs, cancellation, and one partial failure.
  - **Edit target:** acceptance evidence only.
  - **Done/test:** the bound, per-workspace serialization, cancellation, outcome list, retry subset,
    and absence of duplicate successful calls are verified in a disposable Extension Host.
  - **Depends:** PM-203G, PM-204C.
  - **Tier:** capable.

## P3 — Monitor

### PM-301 — Collect read-only execution evidence

- [ ] **PM-301A — Collect local Git evidence on refresh**
  - **Input:** clean, dirty, detached, missing-upstream, ahead, and behind disposable repositories.
  - **Edit target:** one read-only Git evidence collector and table-driven test.
  - **Done/test:** HEAD, branch, dirty state, and ahead/behind return with source/time; command failure
    returns unknown and performs no mutation.
  - **Depends:** PM-001A.
  - **Tier:** capable.
- [ ] **PM-301B — Collect linked PR/check evidence on refresh**
  - **Input:** fake authenticated, missing-PR, pending, failing, passing, and unauthenticated outputs.
  - **Edit target:** one read-only PR/check collector and fixture test.
  - **Done/test:** explicit provider results are normalized with source/time; missing access and
    parse failure become unknown.
  - **Depends:** PM-301A.
  - **Tier:** capable.
- [ ] **PM-301C — Merge evidence without overwriting recorded state**
  - **Input:** recorded Beads metadata plus PM-301A/B snapshots.
  - **Edit target:** one pure evidence reconciliation function and fixture test.
  - **Done/test:** observed, recorded, and conflicting values remain distinguishable; the test proves
    no source silently replaces another.
  - **Depends:** PM-301A, PM-301B.
  - **Tier:** low-cost.

### PM-302 — Show evidence freshness

- [ ] **PM-302A — Classify fresh, stale, and unavailable evidence**
  - **Input:** configurable threshold and timestamped PM-301 snapshots.
  - **Edit target:** one pure freshness classifier and boundary-value test.
  - **Done/test:** fresh, stale, and unavailable are distinct at the exact threshold boundary.
  - **Depends:** PM-301C.
  - **Tier:** low-cost.
- [ ] **PM-302B — Render source and checked-at time**
  - **Input:** PM-302A output.
  - **Edit target:** execution evidence labels in Manage/details.
  - **Done/test:** every derived claim names source and time; a static test proves stale/unknown do not
    use failure wording.
  - **Depends:** PM-302A.
  - **Tier:** low-cost.

### PM-303 — Add opt-in monitoring

- [ ] **PM-303A — Implement a stoppable polling controller**
  - **Input:** manual PM-301 refresh operation and an explicit disabled-by-default setting.
  - **Edit target:** one polling lifecycle controller and fake-clock test.
  - **Done/test:** disabled, enabled, paused, resumed, stopped, and backoff states have deterministic
    scheduling and never mutate Beads status.
  - **Depends:** PM-301C, PM-302A.
  - **Tier:** capable.
- [ ] **PM-303B — Expose monitoring state and controls**
  - **Input:** PM-303A lifecycle state.
  - **Edit target:** one Manage monitoring control/status section.
  - **Done/test:** the user can enable, pause, resume, and disable it and see the next/last refresh;
    one interaction test verifies emitted commands.
  - **Depends:** PM-303A.
  - **Tier:** capable.
- [ ] **PM-303C — Verify request rate in a packaged extension**
  - **Input:** packaged extension, fake provider, and short test interval.
  - **Edit target:** test evidence only.
  - **Done/test:** timestamps and request log prove configured frequency, pause, resume, stop, and
    failure backoff without task-state mutation.
  - **Depends:** PM-303B.
  - **Tier:** human-decision.

## P4 — Verify and Close

### PM-401 — Build a completion evidence view

- [ ] **PM-401A — Normalize completion evidence**
  - **Input:** acceptance criteria, commits, changed files, tests/checks, and missing-evidence fixtures.
  - **Edit target:** one pure completion evidence model and table-driven test.
  - **Done/test:** passed, failed, and unknown remain distinct for each evidence kind.
  - **Depends:** PM-101A, PM-301C.
  - **Tier:** low-cost.
- [ ] **PM-401B — Render completion evidence together**
  - **Input:** PM-401A output.
  - **Edit target:** one completion-evidence details section.
  - **Done/test:** criteria, commits, files, tests/checks, and unknowns are visible together; a static
    test compares complete, partial, and failing fixtures.
  - **Depends:** PM-401A.
  - **Tier:** capable.

### PM-402 — Require explicit completion approval

- [ ] **PM-402A — Build the confirmation summary**
  - **Input:** PM-401A evidence and unresolved unknowns.
  - **Edit target:** one pure close-confirmation view model and fixture test.
  - **Done/test:** the summary lists supporting evidence and unresolved failures/unknowns without
    implying eligibility; the fixture test asserts the wording.
  - **Depends:** PM-401A.
  - **Tier:** low-cost.
- [ ] **PM-402B — Keep close behind explicit approval**
  - **Input:** PM-402A summary and the existing close command contract.
  - **Edit target:** close confirmation/handler only.
  - **Done/test:** Cancel records zero mutations and Approve issues exactly one expected close call;
    an interaction test uses a fake `bd` recorder.
  - **Depends:** PM-402A, PM-103A.
  - **Tier:** human-decision.
- [ ] **PM-402C — Verify cancellation and approval in a disposable workspace**
  - **Input:** packaged extension and disposable compatible Beads workspace.
  - **Edit target:** test evidence only.
  - **Done/test:** screenshots, command log, and final status prove Cancel is inert and Approve closes
    only the selected task.
  - **Depends:** PM-402B.
  - **Tier:** human-decision.

### PM-403 — Record a local audit trail

- [ ] **PM-403A — Define minimal local audit events**
  - **Input:** plan approval, assignment, launch result, intervention, and closure requirements.
  - **Edit target:** one versioned local audit-event schema and round-trip test.
  - **Done/test:** time, actor, event kind, task, and outcome round-trip; prompts, tokens, and secrets
    are absent by default.
  - **Depends:** PM-104B, PM-203A, PM-402B.
  - **Tier:** human-decision.
- [ ] **PM-403B — Redact sensitive event fields**
  - **Input:** fixtures containing tokens, credentials, prompt text, and local paths.
  - **Edit target:** one audit redaction function and table-driven test.
  - **Done/test:** declared sensitive fields are removed/redacted while task/outcome evidence remains.
  - **Depends:** PM-403A.
  - **Tier:** capable.
- [ ] **PM-403C — Verify one local end-to-end record**
  - **Input:** packaged extension and a disposable Plan → Allocate → Verify → Close workflow.
  - **Edit target:** test evidence only.
  - **Done/test:** the local record is complete for the five event kinds and inspection finds no
    secrets or full prompts.
  - **Depends:** PM-403B.
  - **Tier:** human-decision.

## Release Gates

- Do not describe the product as live agent monitoring until PM-301 and PM-302 are complete.
- Do not enable Plan import until PM-103 confirms the active Beads environment.
- Source-level tests and a browser preview are valid only for the tasks that name those evidence
  levels. They do not count as Extension Host or installed-VSIX evidence.
- The Agent Work Queue milestone is not packaged-extension verified until PM-004D passes.
- Plan Import is not fully packaged-extension verified until PM-104C passes.
- AI Plan Draft generation is not packaged-extension verified until PM-105D passes.
- Mixed-provider parallel execution is not packaged-extension verified until PM-204D passes.
- A future milestone is complete only after its named source tests and packaged-extension user test
  both pass.
