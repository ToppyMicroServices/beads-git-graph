# Agent Project Manager User Testing

This checklist tests the extension from the perspective of a user planning, assigning, and
supervising local agent work. It separates current behavior from roadmap-only behavior so a future
acceptance target is not reported as an implemented feature.

## Test labels

- **Current**: expected from the current implementation.
- **Source-preview completed**: exercised with compiled webview source and synthetic fixtures; this
  is not evidence from an Extension Host or installed VSIX.
- **Packaged partially verified**: exercised in an installed VSIX, but not every named scenario or
  state-changing approval path has passed.
- **Pending packaged verification**: implemented behavior whose Extension Host/VSIX user test has
  not been run.
- **Future-only**: acceptance target for a roadmap item; failure is expected until that item lands.

## Safe setup

1. Use disposable Git repositories. Do not use a production workspace or real agent worktree.
2. For read-only display tests, create `.beads/issues.jsonl` fixtures with synthetic task data.
3. For actions that invoke `bd`, use a compatible disposable Beads workspace or a fake `bd`
   executable that records its arguments. Do not migrate an accepted database only to run a test.
4. For merge tests, use fake `gh` output or a disposable remote. Never target a real pull request.
5. Build the extension before Extension Host testing:

   ```bash
   pnpm run compile
   ```

For every manual scenario, record the extension version and commit, fixture name, pass/fail result,
and any unexpected behavior. Capture screenshots for visible state and command logs for mutations.

## Cheap automated checks

Run the focused current-behavior suite:

```bash
pnpm exec vitest run tests/beadsData.test.ts tests/beadsGraphModel.test.ts tests/beadsProjectState.test.ts tests/beadsWebviewMetadata.test.ts tests/beadsMissionControlWebview.test.ts tests/beadsProtocol.test.ts tests/beadsRowVisibility.test.ts tests/worktreeSyncGuard.test.ts tests/agentReadiness.test.ts tests/agentStartGuard.test.ts tests/agentWorkPrompt.test.ts tests/agentProviderClient.test.ts tests/agentExecutionCoordinator.test.ts tests/crossModelTaskChain.test.ts tests/planDraft.test.ts tests/planDraftGeneration.test.ts tests/planGraph.test.ts tests/planPreview.test.ts tests/planDraftController.test.ts tests/planImport.test.ts tests/beadsWriteCapability.test.ts
```

Then run the complete quality gate:

```bash
pnpm run typecheck
pnpm run lint
pnpm run format
pnpm test
pnpm run compile
```

### AUTO-01 — Plan dependencies and Critical Path — Current

- **Given:** Tasks `A -> B -> C` and `A -> D`.
- **When:** The Beads dependency graph is built.
- **Then:** The Critical Path is `A -> B -> C`; `B` and `D` share a dependency level; every task
  appears once.
- **Evidence:** Vitest result and, on failure, the received node, edge, and path values.

### AUTO-02 — Filtered plan stays truthful — Current

- **Given:** A dependency path containing a closed task plus another visible ready task.
- **When:** Closed tasks are filtered out.
- **Then:** Edges, dependency count, levels, and Critical Path use visible tasks only.
- **Evidence:** `beadsGraphModel.test.ts` result with the received visible graph state.

### AUTO-03 — Readiness and safe parallel candidates — Current

- **Given:** Two ready open tasks, one single ready task, one ready task marked `no-parallel`, and one
  explicit-parallel task outside `bd ready`.
- **When:** Parallel candidates are inferred.
- **Then:** Positive `bd ready` evidence is retained independently of parallel preference. Start
  Parallel contains only a cohort of at least two ready, non-serial tasks; explicit-parallel alone
  is not readiness evidence.
- **Evidence:** `beadsData.test.ts` and `beadsMissionControlWebview.test.ts` results plus decoded
  target IDs. A 101-task fixture and command assertion cover the CLI's default 100-item limit.

### AUTO-04 — Progress is not invented — Current

- **Given:** Numeric progress, percentage text, progress in notes, an invalid value, and no value.
- **When:** Beads data is normalized.
- **Then:** Valid values from 0 through 100 are retained; invalid or absent values remain unknown.
- **Evidence:** Table-driven test output containing input and normalized value.

### AUTO-05 — Untrusted webview messages are rejected — Current

- **Given:** Missing workspace paths, non-string task IDs, malformed parallel targets, and unknown
  commands.
- **When:** The request validator receives each message.
- **Then:** It rejects the message before any state-changing handler can run.
- **Evidence:** `beadsProtocol.test.ts` result and the rejected payload name, without secrets.

### AUTO-06 — Merge blockers stop the operation — Current

- **Given:** A detached, dirty, or stale worktree, or a PR with missing, pending, or failing checks.
- **When:** Merge preflight evaluates the fixture.
- **Then:** The result is blocking and includes the observed reason. No merge command is planned.
- **Evidence:** Worktree/PR preflight result and recorded fake `gh` calls.

### AUTO-07 — Multi-workspace rendering isolation — Current contract, test TODO

- **Given:** Two workspaces containing the same task ID but different titles and states.
- **When:** `renderBeadsWebviewHtml` renders both groups.
- **Then:** Workspace labels, detail IDs, action payloads, and graph state keys remain distinct.
- **Evidence:** Render-test result and relevant sanitized HTML attributes.

### AUTO-08 — Agent Work Queue state projection — Current

- **Given:** Attention, review, recorded-in-progress, confirmed-ready, readiness-unknown, done, and
  synthetic merge tasks.
- **When:** `buildAgentWorkQueue` projects the fixture.
- **Then:** Every task appears in one lane; precedence and counts are stable; missing evidence is not
  reported as success or failure.
- **Evidence:** `beadsProjectState.test.ts` output with the received lane, readiness, and reason.

### AUTO-09 — Agent Work Queue static rendering — Current

- **Given:** The AUTO-08 mixed fixture, including untrusted text and per-workspace action metadata.
- **When:** `renderBeadsWebviewHtml` renders the fixture.
- **Then:** Manage, lane counts, explicit attention reasons, the recorded-state caveat, escaped text,
  and correct action payloads are present.
- **Evidence:** `beadsMissionControlWebview.test.ts` and `beadsWebviewMetadata.test.ts` results.

### AUTO-10 — Queue action hardening — Current, completed focused result

- **Given:** Single confirmed-ready, serial confirmed-ready, explicit-parallel but unready,
  readiness-unknown, unrecognized-status, synthetic merge, and missing-`bd` fixtures.
- **When:** The state model and webview render each fixture under the default filter.
- **Then:** Start AI is enabled only for confirmed readiness; other lanes render no Start AI action
  and unknown readiness renders it disabled; unrecognized status remains visible in attention under
  the default `other` filter; synthetic merge says `Readiness N/A` with its preflight reason; and
  Manage/Graph Start AI, Manage/Graph Merge PRs, Start Parallel, and Sync are disabled when `bd` is
  unavailable. Details reports readiness only for open non-synthetic work and shows `N/A` otherwise.
  The webview handlers retain their `bdAvailable` guards.
- **Evidence:** Passing focused assertions in `beadsProjectState.test.ts`,
  `beadsRowVisibility.test.ts`, and `beadsMissionControlWebview.test.ts`, naming each fixture and
  received control state.

### AUTO-11 — Preserve partial parallel-start outcomes — Current

- **Given:** Direct-response, Copilot, failed, skipped, and cancelled task results in one batch.
- **When:** Start Parallel runs.
- **Then:** Response ready, session started, prompt prepared, failed, skipped, and cancelled remain
  distinct per task; the result does not report complete success or claim live activity.
- **Evidence:** `agentExecutionCoordinator.test.ts`, `agentProviderClient.test.ts`,
  `agentStartGuard.test.ts`, and the source typecheck. Exercise the visible result/retry interaction
  in MAN-05 and MAN-13.

### AUTO-12 — Validate and preview a Plan Draft — Current

- **Given:** Valid, duplicate-ID, missing-dependency, self-dependent, cyclic, and HTML-containing
  drafts.
- **When:** The draft is parsed, validated, projected, and rendered.
- **Then:** Specific path/task errors are returned; valid dependencies, Critical Path, parallel
  groups, acceptance criteria, and escaped text are shown without a Beads write.
- **Evidence:** `planDraft.test.ts`, `planGraph.test.ts`, and `planPreview.test.ts`.

### AUTO-13 — Keep Preview and Cancel read-only — Current

- **Given:** A locally edited valid draft and a message recorder.
- **When:** Preview is selected and then Cancel is selected.
- **Then:** Preview updates local output; Cancel clears it; no import message or mutation is
  recorded.
- **Evidence:** `planDraftController.test.ts` and the packaged interaction result below.

### AUTO-14 — Gate and report Plan Import — Current

- **Given:** Compatible, missing-executable, unsupported-command, schema-mismatch, and
  operation-three-failure fixtures.
- **When:** Capability is probed or an approved mutation list is executed.
- **Then:** Only compatible capability enables import. Partial execution lists completed, failed,
  and unexecuted operations without claiming rollback.
- **Evidence:** `beadsWriteCapability.test.ts`, `planImport.test.ts`, and
  `planIntegrationMetadata.test.ts`.

### AUTO-15 — Report unsupported sync truthfully — Current

- **Given:** An installed `bd` that returns unknown command for `sync`.
- **When:** workspace sync is requested.
- **Then:** The result is unsupported and the UI does not report successful synchronization.
- **Evidence:** `beadsSync.test.ts`.

### AUTO-16 — Normalize and apply model preferences — Current

- **Given:** a task model, configured duplicates, empty/multiline/overlong values, mixed parallel
  models, and one explicit override.
- **When:** model choices are built or the parallel override is applied.
- **Then:** task preference appears first, choices are valid and unique, invalid custom values are
  rejected, per-task models remain intact by default, and an explicit override reaches every task.
- **Evidence:** `agentModelSelection.test.ts` and the source-order regression check.

### AUTO-17 — Preserve a cross-model linked task chain — Current

- **Given:** research, implementation, and review tasks with three distinct requested models,
  shared SSOT references, and a serial dependency chain.
- **When:** the draft is parsed, graphed, previewed, projected into mutations, and executed with a
  fake successful Beads runner.
- **Then:** all requested models remain task-scoped; exactly two requested-model transitions appear;
  shared references remain visible; and resolved Beads dependency commands preserve handoff order.
  The Extension Host checks `bd ready` and `bd show` before worktree preparation, then checks both
  again before mutation. Stale readiness or failed dependency inspection prevents Beads mutation
  and agent launch. The downstream prompt treats task metadata as data and requires recorded
  integration evidence.
- **Evidence:** `crossModelTaskChain.test.ts`, `agentReadiness.test.ts`,
  `agentStartGuard.test.ts`, `agentWorkPrompt.test.ts`, and
  `beadsMissionControlWebview.test.ts`.

### AUTO-18 — Generate a safe editable Plan Draft — Current

- **Given:** A bounded user goal, workspace display name, relative SSOT candidates, configured
  task provider/model choices, malformed responses, and prompt-injection-shaped input.
- **When:** The planning prompt is built and the provider response is parsed.
- **Then:** The goal is treated as untrusted data; the prompt requests 1–20 atomic DAG tasks with
  observable acceptance criteria; absolute paths and unlisted SSOT are rejected; only one raw JSON
  object or one complete JSON fence is accepted; the original goal is restored; existing Plan Draft
  validation errors remain visible.
- **Evidence:** `planDraftGeneration.test.ts`, `planDraft.test.ts`, and the source typecheck. The
  provider picker, artifact, and editable webview handoff remain part of PLAN-04.

### AUTO-19 — Bound provider concurrency and serialize workspace mutation — Current

- **Given:** More direct-response tasks than the configured concurrency limit, one provider failure,
  one cancellation, two operations in the same workspace, and one operation in another workspace.
- **When:** The execution coordinator runs the batch and the guarded start reaches final readiness
  and mutation.
- **Then:** Direct-provider waits overlap only up to the bound; one failure does not stop unrelated
  work; unstarted work is cancelled; result order stays task order; final Beads/Git operations do not
  overlap within a workspace; a rejected operation does not block the queue permanently.
- **Evidence:** `agentExecutionCoordinator.test.ts`, `agentProviderClient.test.ts`, and
  `agentStartGuard.test.ts`.

### AUTO-20 — Keep refreshes incremental and latest-wins — Current

- **Given:** an already initialized webview, a changed Beads render, overlapping load generations,
  persisted Table/Graph interaction state, and unrelated `.beads` JSON/JSONL files.
- **When:** a watched issue source or manual refresh changes the rendered data.
- **Then:** normal updates use a bounded `beadsRenderUpdate` message instead of replacing the full
  document; superseded loads and stale client generations are ignored; only config, metadata, and
  issue sources are watched; view, selection/details, filters, sort, collapse, scroll, and graph
  transforms remain restorable.
- **Evidence:** `beadsProtocol.test.ts`, `beadsWebviewMetadata.test.ts`, source typecheck, and the
  refresh-continuity browser result below.

### AUTO-21 — Enforce process and workspace trust boundaries — Current

- **Given:** Trusted and untrusted workspace states, a sentinel `bdPath`, forged Git mutation
  messages, and safe tracked JSON/JSONL Beads fixtures.
- **When:** The Beads view loads, capability checks run, or a Git/Beads mutation is requested.
- **Then:** Restricted Mode never calls the sentinel, starts `bd`, or changes Git/Beads state;
  tracked data remains readable; trusted `bd` child processes receive
  `DOLT_DISABLE_EVENT_FLUSH=true`; malformed ref-like arguments are rejected.
- **Evidence:** `beadsProcess.test.ts`, `workspaceTrust.test.ts`, `privacyPolicy.test.ts`, and the
  packaged Extension Host check in MAN-15.

## Completed source-preview check

The following check used the compiled current webview script, synthetic fixture data, and a local
browser page. It verifies user-visible source behavior, but it does not exercise VS Code APIs, a real
`bd` process, worktree creation, Extension Host lifecycle, or VSIX packaging.

### PREVIEW-01 — Manage, Details, Start AI, and narrow layout — Source-preview completed

- **Given:** A mixed fixture with blocked attention, unrecognized status, PR review, recorded
  in-progress work, two confirmed-ready tasks, explicit-parallel but unready work, synthetic merge,
  and done tasks.
- **When:** Open the preview, select **Manage**, inspect the lanes, open blocked-task **Details**,
  return to **Manage**, inspect both Start AI states and synthetic merge, invoke **Start Parallel**,
  select the **All** filter, invoke **Start AI** on a confirmed-ready task, and resize to 640 px.
- **Then observed:** Manage and its expected lanes rendered; Details selected the matching task; the
  unrecognized-status task remained visible under the default filter; confirmed-ready Start AI
  emitted the expected task/workspace message while explicit-parallel unready Start AI stayed
  disabled; Start Parallel contained only the two confirmed-ready task IDs and reported the unready
  explicit task as skipped; the synthetic merge card showed `Readiness N/A` and its dedicated
  preflight reason; **All** restored the Done task; and the 640 px view remained usable with no
  horizontal `scrollWidth` overflow.
- **Evidence level:** compiled-source browser preview only. PM-004D/MAN-10 remains pending.

## Packaged VSIX result — 2026-07-24; rebuilt and Host-smoked 2026-07-30

- **Artifact:** `beads-git-graph-0.4.20260710.vsix`, SHA-256
  `29fe0f386e444e565871ff56e1a470fa553e9bfb4f30cca9e76fb629e63dcdfb`.
- **Package inspection:** the current artifact contains provider/model selection, Host-side
  readiness/schema/dependency checks, response-artifact preservation, bounded parallel requests,
  pointer-centered Graph zoom, normal-drag pan, dependency and parent-child line rendering, static
  Sync warning styling, keyed incremental refresh handling, view-specific Details hosts, visible
  parallel-target filtering, relevant capability gating, client/Host duplicate-action guards,
  fetch-on-Graph-refresh, last-fetch metadata, and explicit local remote-tracking labels. VSCE
  rewrote the README screenshot to the repository asset URL.
- **Install/activation boundary:** a package built immediately before the final Host safety changes
  installed as `ToppyMicroServices.beads-git-graph@0.4.20260710` in an isolated extension directory
  and opened the Beads webview in an isolated VS Code profile. The final artifact above was rebuilt
  and installed into new isolated extension/profile directories; the latest
  `code --list-extensions --show-versions` check confirmed
  `toppymicroservices.beads-git-graph@0.4.20260710`. The final artifact then passed an isolated VS
  Code 1.127.0 Extension Host smoke: activation, the View/Refresh/Clear Artifacts commands, the
  machine-scoped `bdPath`, the default-enabled Graph fetch setting, and the packaged Restricted Mode
  manifest were asserted before the Host exited with code 0. Restricted Mode interaction and the
  complete MAN-10 UI sequence remain separate manual checks.
- **Plan observation:** in an empty workspace, **Load example** rendered three tasks, two
  dependencies, two requested-model transitions, `research -> implement -> review` as Critical
  Path, and eight ordered mutations. Import remained disabled because no initialized Beads
  workspace existed.
- **Interaction observation:** **Cancel** cleared the draft and preview. Four Tab presses from
  **Plan** reached the draft editor. The earlier 640 CSS px check and current 852 CSS px check showed
  no horizontal overflow.
- **Mutation evidence:** separately, the production import executor created two tasks and their
  dependency in a compatible disposable Beads database. The current repository database was not
  migrated, initialized, bootstrapped, synchronized, or written.
- **Boundary:** this passes packaged activation and the named Plan preview/Cancel/keyboard/narrow
  checks for the earlier installed artifact, plus final-package inspection and isolated
  install/list verification. It does not pass PM-006D/MAN-14, the complete MAN-10 Manage workflow,
  or the packaged Plan approval, success-result, and partial-failure UI.

## Graph zoom source-browser result — 2026-07-27

- **Observed:** wheel zoom around a node preserved the selected graph coordinate with `0 px`
  measured drift in both axes. A fine-grained wheel input changed the full-precision zoom value
  instead of being discarded.
- **Observed:** the zoom-in button reused the last graph pointer location with `0 px` measured drift.
  Returning from Table to Graph preserved the manually selected `166%` zoom instead of fitting the
  graph again.
- **Additional checks:** Fit and rectangle-selection zoom now center their result, line/page wheel
  deltas are normalized and bounded, and continuous wheel persistence is debounced.
- **Evidence level:** compiled-source browser preview plus pure transform tests. The freshly
  packaged VSIX was inspected, but this graph scenario was not rerun in an installed Extension Host.

## Graph fetch source-browser result — 2026-07-30

- **Observed:** the Graph status identified `origin/*` as local remote-tracking refs rather than a
  live remote view, showed the last successful fetch time, and changed from fetch-in-progress to
  fetch-completed after one manual refresh.
- **Observed:** the `origin/main` commit label exposed the same local-tracking boundary in its
  tooltip, and the preview recorded no browser warning or error.
- **Additional checks:** Vitest covers `git fetch --all` without prune or terminal prompting,
  `FETCH_HEAD` timestamp handling, Restricted Mode gating, duplicate fetch suppression, and
  cross-repository response isolation. The installed VSIX smoke covers the packaged default setting
  and Restricted Mode configuration.
- **Evidence level:** compiled-source browser interaction, Vitest, package inspection, and
  Extension Host manifest smoke. A real remote update in the installed Graph remains a separate
  manual acceptance step.

## Refresh continuity source-browser result — 2026-07-28

- **Observed:** after selecting Graph, the WIP filter, `120%` zoom, and task `smoke-2` details, a
  host render update preserved all four states.
- **Observed:** the open drawer changed from `Implement update` to
  `Implement update (refreshed)`, and the new sync warning appeared without switching to Table or
  closing details.
- **Additional checks:** the compiled page recorded no new browser warning/error after the valid
  fixture loaded; source tests cover generation ordering, bounded messages, watcher narrowing,
  persisted interaction fields, and the full-render fallback.
- **Evidence level:** compiled-source browser preview plus Vitest/source assertions. PM-006D remains
  pending because this scenario was not rerun in an installed Extension Host.

## Graph pan, relationship line, and stable-control result — 2026-07-28

- **Observed:** after zooming from Fit to `142%`, normal drag changed the Graph transform by
  `-200 px` horizontally and `-140 px` vertically without opening the box-zoom selection.
- **Observed:** the fixture rendered two execution-dependency arrows and one dashed parent-child
  line. All three remained present after a host render update.
- **Observed:** the focused Fit button remained the same DOM node with `0 px` position drift while
  the task title changed to the refreshed value. The Sync warning stayed visually static with
  `animation-name: none`.
- **Additional checks:** normal left drag maps to pan, Option/Alt-left drag maps to box zoom, middle
  drag remains pan, and interactive controls do not start a graph gesture.
- **Evidence level:** compiled-source browser interaction plus pure gesture/transform tests and
  source assertions. Installed-VSIX repetition remains part of PM-006D/MAN-14.

## Stable viewport during live update result — 2026-07-28

- **Observed:** with Graph at `173%`, manually panned, task Details open, and the page scrolled to
  `40 px`, a warning-only update kept the page position, Graph top, zoom, horizontal/vertical pan,
  open Details state, and Fit-button identity identical before the update, synchronously after it,
  and after each of the next two animation frames.
- **Observed:** an update that changed the selected task title produced the same frame-by-frame
  invariants while the refreshed title appeared.
- **Additional checks:** warning-only updates bypass workspace reconciliation; task-content updates
  restore details without `scrollIntoView`, preserve client-owned Graph geometry, and execute one
  final Graph presentation pass without re-clamping the saved pan.
- **Evidence level:** compiled-source browser interaction plus Vitest/source assertions.
  Installed-VSIX repetition remains part of PM-006D/MAN-14.

## Details, action, and capability source-browser result — 2026-07-28

- **Observed:** Manage opened the matching blocked-task Details in the Manage pane. A Graph fixture
  with no warning/risk drawer opened the matching Details without hiding it.
- **Observed:** the Graph rendered one recorded dependency edge; wheel zoom around an off-center
  pointer changed `100%` to `162%`, and a following normal drag changed both pan coordinates while
  preserving the zoom.
- **Observed:** double-clicking Start AI, Start Parallel, and Plan Import emitted one request for
  each action. Both visible Start AI controls for the same task immediately showed the same disabled
  busy state.
- **Observed:** selecting the Blocked preset hid Start Parallel and reduced its eligible targets to
  none. The filter menu exposed `aria-expanded=true` and unchecked menu-item state when opened.
- **Observed:** a present CLI without `bd sync` rendered Sync disabled with the observed unsupported
  reason. The browser recorded no warning or error for the final fixture.
- **Boundary:** this is a compiled-source browser result with synthetic data. It does not exercise
  an Extension Host, provider picker, real `bd` mutation, watcher lifecycle, or packaged VSIX.
  PM-004D, PM-006D, MAN-10, and MAN-14 remain pending where already stated.

## Extension Host and manual checks

Use a freshly built extension in an Extension Development Host with disposable fixtures. Reset the
fixture between state-changing scenarios.

### MAN-01 — Understand the current plan — Current

- **Setup:** Load an epic with a three-step dependency chain, one side task, one blocked task, and
  two parallel-ready tasks.
- **Steps:** Open the Beads view, compare Table and Execution Map, and toggle the closed filter.
- **Expected:** Hierarchy, status, blocked/parallel summaries, dependencies, and Critical Path agree.
  Filtering removes hidden tasks from graph-derived counts and paths.
- **Evidence:** Before/after screenshots and the fixture task list.

### MAN-02 — Inspect and navigate without a mouse — Current

- **Setup:** Use the MAN-01 fixture at normal width and a narrow panel width.
- **Steps:** Navigate with Tab and Enter; open a row menu with Shift+F10; operate the graph with
  arrows, `+`, `-`, and `0`.
- **Expected:** Details and actions are reachable, focus remains visible, the context menu stays in
  the viewport, and graph gestures do not trap page scrolling.
- **Evidence:** Screen recording or screenshots showing focus and the narrow layout.

### MAN-03 — Start one agent with a safe fallback — Current

- **Setup:** Use one open task whose readiness is explicitly confirmed in a disposable Git
  repository. Add a second open task whose readiness is unavailable. Make Copilot launch commands
  unavailable, but leave clipboard access available.
- **Steps:** Select **Start AI**.
- **Expected:** Start AI is enabled only on the confirmed-ready task. Starting it creates or reuses a
  task worktree; Beads records `in_progress`, model, SSOT, worktree, and branch metadata; a complete
  task prompt is copied; the UI does not claim that a live session opened. The readiness-unknown task
  exposes no enabled Start AI action.
- **Evidence:** Screenshot of the notification, fake `bd` argument log, `git worktree list`, and
  clipboard text with sensitive paths redacted, plus the disabled/absent unknown-readiness control.

### MAN-04 — Reject an unsafe worktree collision — Current

- **Setup:** Place an existing unregistered directory at the proposed task worktree path.
- **Steps:** Select **Start AI**.
- **Expected:** The extension reports that the path is not a registered worktree and stops before
  assigning or updating the Bead.
- **Evidence:** Error screenshot, fake `bd` log showing no assign/update call, and unchanged Git
  status.

### MAN-05 — Start ready work in parallel — Current, pending packaged verification

- **Setup:** Provide ready Ollama, Hugging Face, OpenAI, Anthropic, and Copilot tasks plus one blocked
  task, one in-progress task, and one explicitly serial task. Use fake providers and a fake
  Beads/Git recorder.
- **Steps:** Select **Start Parallel**.
- **Expected:** Only ready, non-serial tasks are attempted. Direct-provider requests overlap only up
  to the configured bound; final Beads readiness checks and Beads/Git mutations are serialized per
  workspace; Copilot worktree/session launches are sequential. The result lists a recorded outcome
  for every task and does not describe the batch as live monitoring.
- **Evidence:** Progress/result screenshots, timestamped provider calls, worktree list, per-task fake
  `bd`/Git log, and the observed maximum concurrency.

### MAN-06 — Refresh progress and blocked state — Current

- **Setup:** Display one open task and one task with explicit progress metadata.
- **Steps:** Change the fixture through `open -> in_progress 40% -> blocked -> closed`, refreshing
  after each change.
- **Expected:** Table, summaries, details, and graph show the same current state. The extension does
  not infer progress that is absent from Beads data.
- **Evidence:** One screenshot per state and the corresponding fixture revision.

### MAN-07 — Keep workspaces isolated — Current

- **Setup:** Open a multi-root workspace with repo A and repo B. Give both a task with the same ID.
- **Steps:** Open details in A, change A's graph zoom, and invoke an A action using a fake `bd`.
- **Expected:** The action path and task data come from A; B remains unchanged; each graph preserves
  its own transform.
- **Evidence:** Side-by-side screenshot, fake command log with working directory, and fixture diffs.

### MAN-08 — Block unsafe PR merge — Current

- **Setup:** Test dirty worktree, missing `origin/main`, detached HEAD, missing PR, draft PR, and
  pending/failing check fixtures separately.
- **Steps:** Select **Merge PRs** for each fixture.
- **Expected:** Each failing preflight stops before the confirmation dialog and before `gh pr merge`.
  A fully passing fixture shows the observed preflight details and still requires explicit approval.
- **Evidence:** Error or confirmation screenshot and fake `gh` call log.

### MAN-09 — Handle a missing Beads CLI safely — Current

- **Setup:** Remove `bd` from the disposable Extension Host's configured path while retaining a
  legacy read-only fixture that the view can render.
- **Steps:** Open and refresh the Beads view; attempt only the action exposed by the UI.
- **Expected:** The missing-executable state is shown. Every `bd`-dependent action is absent or
  disabled with the unavailable reason and emits no action message. Refresh and Git Graph remain
  usable.
- **Evidence:** UI screenshot, executable call log, and captured webview messages showing no action
  payload.

### MAN-10 — Use Agent Work Queue in an Extension Host — Current, pending packaged verification

- **Setup:** Package the current extension and install/open it in an Extension Development Host with
  a disposable mixed-status fixture: blocked attention, failing check, unrecognized status, PR
  review, recorded in-progress work, confirmed-ready, readiness-unknown, synthetic merge, and done.
- **Steps:** Select **Manage**; compare counts with the fixture; open every attention **Details** item
  by mouse and keyboard; start the confirmed-ready task; confirm the readiness-unknown task cannot be
  started; inspect synthetic merge; make `bd` unavailable and refresh; repeat at 640 px width.
- **Expected:** Counts match visible cards; blocked/failing/unrecognized reasons are explicit;
  unknown status stays visible under the default filter; Details selects the correct workspace/task;
  only confirmed readiness enables Start AI; synthetic merge says `Readiness N/A`; all
  `bd`-dependent actions disable when `bd` is unavailable; keyboard focus and cards remain usable at
  640 px. Recorded in progress is described as recorded state, not verified live activity.
- **Evidence:** Packaged version/commit, fixture, before/after screenshots, keyboard recording,
  captured webview messages, fake `bd` log, and pass/fail per expected statement.
- **Status:** Partially verified. Packaged activation and Plan interactions passed, but the complete
  Manage fixture and state-changing path remain pending.

### MAN-11 — Choose a provider and model before agent work — Pending packaged verification

- **Setup:** Use a packaged extension, a confirmed-ready synthetic task, and a fake `bd` recorder in
  a disposable workspace.
- **Steps:** Select **Start AI**, inspect the model picker, cancel once, then repeat and choose a
  model. Repeat **Start Parallel** with per-task models and an override.
- **Expected:** the picker distinguishes Copilot coding sessions from direct text responses and
  offers only models scoped to the selected provider; Cancel records no provider call, worktree, or
  Beads mutation; single selection is recorded as requested; parallel preserves each task choice or
  overrides all only when explicitly selected.
- **Evidence:** picker screenshot, fake `bd` log, worktree list, and pass/fail for each branch.

### MAN-12 — Follow a cross-model task handoff — Partially verified

- **Setup:** Import a disposable three-task chain with distinct requested models and a shared SSOT
  path. Use a fake `bd` recorder and synthetic readiness transitions.
- **Steps:** Preview the Plan; confirm two requested-model transitions; start only the first ready
  task; record its output reference; close it; refresh readiness; start the dependent task and
  inspect its prompt.
- **Expected:** dependency direction and task-specific model preferences remain unchanged; blocked
  downstream work cannot start early; the Host checks current readiness and dependencies before
  worktree preparation and again before mutation; the downstream prompt lists its upstream bead and
  requires output/worktree/PR verification. The UI does not claim the provider ran the requested
  models.
- **Evidence:** Plan and prompt screenshots, ordered fake `bd` log, and pass/fail for each handoff.
- **Observed:** the installed VSIX rendered the three requested models, two transitions, Critical
  Path, and eight ordered mutations without horizontal overflow. The packaged readiness transition
  and downstream prompt inspection still require a trusted disposable workspace.

### MAN-13 — Cancel and retry a mixed-provider batch — Pending packaged verification

- **Setup:** Use a packaged extension with four ready direct-response tasks, two sequential Copilot
  tasks, a concurrency limit below four, one delayed response, and one provider failure. Use fake
  providers and fake Beads/Git logs.
- **Steps:** Start the batch, cancel while direct requests are active, inspect every recorded
  outcome, then retry only failed or cancelled tasks.
- **Expected:** unstarted direct requests are cancelled, an in-flight request receives the abort
  signal, successful tasks remain successful and are not rerun, failed/cancelled tasks alone are
  retried, Copilot launches remain sequential, and no Beads/Git mutation overlaps within the
  workspace. The UI does not claim a still-running process.
- **Evidence:** Before/after result screenshots, timestamped provider and mutation logs, retry
  payload, and per-task call counts.

### MAN-14 — Preserve interaction state during live refresh — Pending packaged verification

- **Setup:** Install a freshly packaged VSIX in a disposable workspace with at least one
  in-progress task, dependencies, and a controllable issue-source writer.
- **Steps:** Select Graph, WIP, a non-default zoom/pan, and task Details; update the issue title
  through the fixture writer; repeat with Table details, sorting, collapsed hierarchy, and manual
  Refresh.
- **Expected:** data updates without a Table flash or full-page flicker; the active mode, filter,
  details, graph transform, sorting, collapse, and scroll remain stable; the open details show the
  updated title; focused controls do not move or flash; dependency and parent-child lines remain
  visible; a superseded refresh cannot restore older task data.
- **Evidence:** before/after screenshots or recording, fixture revisions with timestamps, and the
  Extension Host console log.

### MAN-15 — Restricted Mode and artifact retention — Pending packaged verification

- **Setup:** Install a freshly packaged VSIX in a disposable untrusted workspace whose
  machine-scoped `bdPath` is a sentinel logger. Prepare tracked `.beads/issues.jsonl`, then trust a
  second disposable workspace with three fake provider responses and retention set to two.
- **Steps:** Open Table/Graph/Manage in Restricted Mode; attempt Sync, import, and a Git mutation;
  inspect the sentinel log. In the trusted workspace, store three responses, inspect extension
  storage, run **Clear Stored AI Response Artifacts**, cancel once, then approve.
- **Expected:** Restricted viewing works and the sentinel log remains empty; mutations show a trust
  warning. Only two newest plain-text response artifacts remain; Cancel deletes nothing; approval
  deletes only recognized response artifacts from the fixed storage directory and reports the
  count.
- **Evidence:** VSIX identifier/version, trust-state screenshot, empty sentinel log, artifact file
  count, confirmation screenshot, and Extension Host log.

### MAN-16 — Refresh local remote-tracking refs — Partially verified

- **Setup:** Install the packaged VSIX in a trusted disposable repository with a local branch,
  `origin/main`, and a second clone that can push one new commit to the remote.
- **Steps:** Record the displayed fetch time and `origin/main` tip; push from the second clone; click
  Graph **Refresh** once; repeat with `beads-git-graph.fetchOnGraphRefresh` disabled and once in
  Restricted Mode.
- **Expected:** the enabled trusted refresh shows fetch-in-progress, runs one `git fetch --all`,
  advances the local `origin/main`, updates the successful-fetch time, and finishes without merge,
  rebase, or prune. The disabled and Restricted Mode runs refresh existing local refs without
  contacting the remote. Every `origin/*` label remains identified as a local remote-tracking ref,
  not a live remote view.
- **Evidence:** before/after remote and local commit IDs, fetch timestamp screenshots, a sanitized Git
  trace or fake executable log, and the Extension Host log.
- **Observed:** the compiled browser preview passed the status transition and labeling checks; the
  packaged manifest passed its default-setting and Restricted Mode assertions. The disposable
  two-clone remote update remains pending.

## Plan user acceptance

AI Plan Draft generation, local review/edit, and capability-gated import are implemented at source
level. Source tests and the packaged observations below do not replace the remaining packaged
provider, artifact, and approval-path checks.

### PLAN-01 — Draft, preview, and cancel a plan — Packaged partially verified

- **Setup:** Prepare valid, incomplete, missing-dependency, self-dependent, and cyclic plan drafts.
- **Steps:** Validate and preview each draft; edit one dependency; cancel without approving.
- **Expected:** Specific validation errors appear, the preview graph updates, and Cancel performs no
  Beads write.
- **Evidence:** Preview/error screenshots and an empty fake `bd` mutation log.
- **Observed:** the current installed VSIX loaded a three-task, three-model example and rendered two
  dependency-linked requested-model transitions, the `research -> implement -> review` Critical
  Path, and eight ordered mutations. The current 852 CSS px view had no horizontal overflow.
  Earlier packaged checks also confirmed Cancel cleared the draft, keyboard focus reached the
  editor, and the 640 CSS px view had no horizontal overflow.

### PLAN-02 — Import an approved plan with partial failure — Current, packaged approval pending

- **Setup:** Use a compatible disposable Beads workspace and fail the third planned mutation.
- **Steps:** Review the exact mutation preview and approve it.
- **Expected:** Created IDs, failed mutation, and unexecuted work are listed without claiming rollback
  or success. Unsupported Beads environments keep import disabled.
- **Evidence:** Approval screenshot, ordered command log, and final Beads state.
- **Observed:** the production executor created two tasks and one dependency in a compatible
  disposable database with Plan metadata preserved. The simulated third-operation failure returned
  completed, failed, and unexecuted groups. The packaged approval/result UI is still pending.

### PLAN-03 — Gate writes on Beads capability and schema compatibility — Current

- **Setup:** Provide compatible, missing-command, unsupported-command, and schema-mismatch fake
  Beads environments without accepting a migration.
- **Steps:** Run the planned non-mutating capability probe and inspect every mutation control.
- **Expected:** Only the observed compatible environment enables mutations. Unsupported and
  schema-mismatch states show their exact reason and do not initialize, migrate, or emit a mutation.
- **Evidence:** Capability result, disabled-control screenshots, and an executable call log with no
  mutation or migration command.

### PLAN-04 — Generate tasks from one goal — Current, pending packaged verification

- **Setup:** Use a packaged extension with fake Ollama, Hugging Face, OpenAI, and Anthropic
  responses. Provide one valid response, one schema-invalid response, one prose-wrapped response,
  one cancellation, and an incompatible Beads database that remains readable.
- **Steps:** Enter a goal, select **Generate task plan with AI**, inspect and cancel the confirmation,
  repeat with each response fixture, edit the valid result, preview it, and leave import unapproved.
- **Expected:** only direct-response providers are offered; cancellation makes no provider call;
  valid JSON becomes an editable local draft; validation errors identify the affected path; unsafe
  response text is not executed; the raw response artifact remains available; generation performs
  no Beads write and still remains separate from schema-gated import.
- **Evidence:** Provider/confirmation screenshots, captured request metadata with secrets and full
  paths excluded, artifact reference, preview screenshots, and an empty Beads mutation log.

## Remaining roadmap-only user acceptance

These tests describe intended behavior and must not be used as evidence that the feature exists.

### FUT-03 — Evidence freshness and intervention — Future-only

- **Setup:** Provide fresh, stale, unavailable, and explicitly failing Git/PR/check evidence.
- **Steps:** Refresh evidence and inspect the attention queue.
- **Expected:** Source and checked-at time are visible; stale and unknown are distinct from failure;
  resolution removes an item only after refreshed evidence confirms it.
- **Evidence:** Before/after screenshots and sanitized evidence records.

### FUT-04 — Verify and close under human control — Future-only

- **Setup:** Prepare complete, partially evidenced, and failing tasks with acceptance criteria.
- **Steps:** Open completion evidence, cancel once, then approve an eligible task.
- **Expected:** Commits, changed files, tests/checks, and unknowns are visible; Cancel makes no
  mutation; closing always requires explicit user approval.
- **Evidence:** Evidence-view screenshots, fake `bd close` log, and final status.

## Result summary

Report automated and manual results separately. A source-level or Vitest pass does not count as an
Extension Host pass. Do not describe recorded batch outcomes as live agent monitoring until evidence
collection and freshness scenarios pass. Do not describe AI plan generation, mixed-provider
parallel execution, or plan import as packaged-verified until their provider, cancellation,
capability, preview, approval, and partial-failure scenarios pass.
