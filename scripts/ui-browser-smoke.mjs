import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

// Use an existing Playwright installation; this optional smoke does not add runtime dependencies.
const playwrightModule = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(
  playwrightModule ? pathToFileURL(resolve(playwrightModule)).href : "playwright"
);
const output = await mkdtemp(join(tmpdir(), "beads-ui-smoke-"));
const bundle = await build({
  entryPoints: ["src/beadsWebview.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "vscode-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^vscode$/ }, () => ({ path: "vscode", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents:
            "export const Uri = { joinPath: () => '/beadsWebview.min.js' }; export const env = {};",
          loader: "js"
        }));
      }
    }
  ]
});
const { renderBeadsWebviewHtml } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const workspacePath = "/fixture/project";
const defaults = {
  type: "task",
  status: "open",
  progress: null,
  priority: "P2",
  updatedAt: "2026-09-09T00:00:00Z",
  createdAt: "2026-09-09T00:00:00Z",
  commitHash: "",
  description: "A bounded example task",
  notes: "-",
  assignee: "-",
  labels: "-",
  parentId: "",
  dependencyIds: [],
  readyByBd: true,
  parallelizable: false,
  parallelizableSource: "",
  parallelizableSuppressed: false,
  agent: "",
  provider: "copilot",
  model: "",
  ssot: "",
  artifact: "",
  worktree: "",
  branch: "",
  pullRequest: "",
  checkStatus: "",
  syncRisk: "",
  synthetic: false,
  syntheticKind: ""
};
const items = [
  { id: "project", title: "Release a small project", type: "epic", readyByBd: false },
  {
    id: "task-1",
    title: "Implement the feature",
    parentId: "project",
    agent: "worker",
    provider: "openai",
    model: "small-model"
  },
  {
    id: "task-2",
    title: "Review the feature",
    parentId: "project",
    dependencyIds: ["task-1"],
    readyByBd: false
  },
  {
    id: "task-3",
    title: "Ship the feature",
    dispatchPolicy: "pinned",
    provider: "ollama",
    model: "local-model",
    status: "in_progress",
    parentId: "project",
    dependencyIds: ["task-2"],
    readyByBd: false
  }
].map((item) => ({ ...defaults, ...item }));
const emptySnapshot = { sessionId: "session-1", revision: 0, entries: [] };
function executionRun(index = 1, phase = "queued") {
  return {
    runId: `session-1:${index}`,
    workspacePath,
    issueId: "task-1",
    title: "Implement the feature",
    provider: "openai",
    model: "small-model",
    phase,
    startedAt: "2026-09-13T00:00:00Z",
    updatedAt: "2026-09-13T00:00:01Z"
  };
}
function render(revision = 0, executionSnapshot = emptySnapshot, overrides = {}) {
  const capability = { supported: true, state: "supported", reason: "Fixture supports writes" };
  return renderBeadsWebviewHtml(
    { cspSource: "https://fixture.invalid", asWebviewUri: (uri) => uri },
    {},
    {
      groups: [
        {
          workspace: "UI smoke",
          workspacePath,
          readinessKnown: true,
          items: items.map((item) => ({ ...item, notes: `Revision ${revision}` }))
        }
      ],
      emptyWorkspaces: [],
      unavailableWorkspaces: [],
      errors: [],
      executionSnapshot,
      warnings: [],
      bdExecutableStatus: { available: true, message: "" },
      agentWriteCapabilities: [{ workspace: "UI smoke", workspacePath, capability }],
      planImportCapabilities: [{ workspace: "UI smoke", workspacePath, capability }],
      ...overrides
    }
  );
}
const script = await readFile(
  process.env.BEADS_WEBVIEW_SCRIPT || "out/beadsWebview.min.js",
  "utf8"
);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
const results = [];
const errors = [];
let page;
async function reset(mode = "graph", executionSnapshot = emptySnapshot, overrides = {}) {
  await page?.close();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  const fixtureHtml = await page.evaluate(
    (source) => {
      // Adapt our generated fixture in an inert DOM, before any scripts can execute.
      const doc = new DOMParser().parseFromString(source, "text/html");
      for (const script of doc.querySelectorAll("script")) script.remove();
      for (const meta of doc.querySelectorAll("meta[http-equiv]")) {
        if (meta.getAttribute("http-equiv").toLowerCase() === "content-security-policy")
          meta.remove();
      }
      const style = doc.createElement("style");
      style.textContent =
        ":root{--vscode-font-family:Arial;--vscode-font-size:13px;--vscode-foreground:#ddd;--vscode-descriptionForeground:#aaa;--vscode-editor-background:#181818;--vscode-button-background:#16769b;--vscode-button-foreground:#fff;--vscode-focusBorder:#66c8ff;--vscode-panel-border:#555;--vscode-editorWidget-background:#242424;}body{margin:0;}";
      doc.head.append(style);
      return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
    },
    render(0, executionSnapshot, overrides)
  );
  await page.setContent(fixtureHtml);
  await page.evaluate((viewMode) => {
    let state = { viewMode };
    window.messages = [];
    window.acquireVsCodeApi = () => ({
      getState: () => state,
      setState: (next) => {
        state = next;
      },
      postMessage: (message) => window.messages.push(message)
    });
  }, mode);
  await page.addScriptTag({ content: script });
  await settle();
}
async function settle() {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  );
}
async function transform() {
  return page.locator(".graphContent").evaluate((node) => ({
    zoom: node.style.getPropertyValue("--graph-zoom"),
    x: node.style.getPropertyValue("--graph-pan-x"),
    y: node.style.getPropertyValue("--graph-pan-y")
  }));
}
async function refresh(executionSnapshot = emptySnapshot, generation = 1) {
  await page.evaluate(
    ({ nextHtml, generation }) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "beadsRenderUpdate", generation, html: nextHtml }
        })
      ),
    { nextHtml: render(generation, executionSnapshot), generation }
  );
  await settle();
}
async function test(name, run, mode = "graph") {
  try {
    await reset(mode);
    await run();
    results.push({ name, passed: true });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    process.stderr.write(`FAIL ${name}: ${error.message}\n`);
    await page?.screenshot({ path: join(output, `failure-${results.length}.png`) });
  }
}
async function executionSnapshot(snapshot) {
  await page.evaluate(
    (snapshot) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "agentExecutionSnapshot", snapshot }
        })
      ),
    snapshot
  );
  await settle();
}
const localWorkspace = { workspace: "Native tasks", workspacePath, storageKind: "local" };
const localCapability = {
  supported: true,
  state: "supported",
  reason: "Local task storage is writable."
};
function nativeFixture(empty = false) {
  return {
    groups: empty ? [] : [{ ...localWorkspace, readinessKnown: true, items }],
    emptyWorkspaces: empty ? [localWorkspace] : [],
    bdExecutableStatus: { available: false, command: "bd", message: "bd is not installed" },
    agentWriteCapabilities: [{ ...localWorkspace, capability: localCapability }],
    planImportCapabilities: [{ ...localWorkspace, capability: localCapability }]
  };
}
async function settleAction(clientActionId) {
  await page.evaluate(
    (id) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "actionSettled", clientActionId: id }
        })
      ),
    clientActionId
  );
  await settle();
}
try {
  await test("Native empty workspace enables creation and local plan import without bd", async () => {
    await reset("table", emptySnapshot, nativeFixture(true));
    assert.equal(await page.locator("#syncBeads").isVisible(), false);
    assert.match(
      await page.locator("#beadsWorkspaceViews").innerText(),
      /when you first create or import tasks/
    );
    await page.locator(".workspaceCreateBead").click();
    const create = await page.evaluate(() =>
      window.messages.find((message) => message.command === "createBead")
    );
    assert.equal(create.workspacePath, workspacePath);
    assert.ok(create.clientActionId);
    await settleAction(create.clientActionId);
    assert.equal(await page.locator(".workspaceCreateBead").isEnabled(), true);
    await page.setViewportSize({ width: 640, height: 900 });
    await page.screenshot({ path: join(output, "native-empty-640.png"), fullPage: true });
    await page.locator("#planView").click();
    await page.locator(".planAdvanced summary").click();
    await page.locator("#loadPlanDraftExample").click();
    assert.match(
      await page.locator(".planMutationPreview").innerText(),
      /Tasks to save in .taskgraph\/tasks.json/
    );
    assert.doesNotMatch(
      await page.locator(".planMutationPreview").innerText(),
      /bd create|Beads mutations/
    );
    await page.screenshot({ path: join(output, "native-plan-640.png"), fullPage: true });
    await page.locator("#importPlanDraft").click();
    const imported = await page.evaluate(() =>
      window.messages.find((message) => message.command === "importPlanDraft")
    );
    assert.equal(imported.workspacePath, workspacePath);
    assert.ok(imported.clientActionId);
    assert.equal(await page.locator("#generatePlanDraftWithAi").isEnabled(), true);
    const bounds = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth
    }));
    assert.ok(bounds.scroll <= bounds.width + 1, `Native Plan overflow: ${JSON.stringify(bounds)}`);
  });
  await test("Native task details post edit and Start AI actions without bd", async () => {
    await reset("graph", emptySnapshot, nativeFixture());
    await page.locator('[data-graph-details-id="task-1"]').first().click();
    const edit = page.locator(".graphSelectedDetails .editLocalTask");
    assert.equal(await edit.isEnabled(), true);
    await edit.click();
    const edited = await page.evaluate(() =>
      window.messages.find((message) => message.command === "editLocalTask")
    );
    assert.equal(edited.workspacePath, workspacePath);
    assert.equal(edited.issueId, "task-1");
    assert.ok(edited.clientActionId);
    assert.equal(await edit.isEnabled(), false);
    await settleAction(edited.clientActionId);
    assert.equal(await edit.isEnabled(), true);
    await page.locator('[data-assign-start-id="task-1"]').first().click();
    const started = await page.evaluate(() =>
      window.messages.find((message) => message.command === "assignStartBead")
    );
    assert.equal(started.issueId, "task-1");
    assert.ok(started.clientActionId);
    await settleAction(started.clientActionId);
    for (const mode of ["graph", "control", "table"]) {
      await reset(mode, emptySnapshot, nativeFixture());
      await page.setViewportSize({ width: 640, height: 900 });
      await settle();
      const bounds = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth
      }));
      assert.ok(
        bounds.scroll <= bounds.width + 1,
        `Native ${mode} overflow: ${JSON.stringify(bounds)}`
      );
      await page.screenshot({ path: join(output, `native-${mode}-640.png`), fullPage: true });
    }
    await page.locator('.beadRow[data-id="task-1"] .rowActionsButton').click();
    assert.equal(await page.locator("#editLocalTaskAction").isVisible(), true);
    await page.locator("#editLocalTaskAction").click();
    assert.equal(
      await page.evaluate(() =>
        window.messages.some((message) => message.command === "editLocalTask")
      ),
      true
    );
  });
  await test("Workspace refresh preserves native storage and sync visibility", async () => {
    await page.evaluate(
      (html) =>
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { command: "beadsRenderUpdate", generation: 1, html }
          })
        ),
      render(1, emptySnapshot, nativeFixture())
    );
    await settle();
    assert.equal(await page.locator("#syncBeads").isVisible(), false);
    assert.equal(
      await page.locator("#planDraftWorkspace option").getAttribute("data-storage-kind"),
      "local"
    );
    await page.locator('[data-graph-details-id="task-1"]').first().click();
    assert.equal(await page.locator(".graphSelectedDetails .editLocalTask").isEnabled(), true);
  });
  await test(
    "Manage maps explicit plan parents and dependencies without inferring live activity",
    async () => {
      assert.equal(
        await page.locator(".agentDispatchSummary").innerText(),
        "2 automatic · 1 preferred · 1 pinned"
      );
      assert.equal(
        await page
          .locator('.agentPlanRow[data-plan-issue-id="task-3"]')
          .getAttribute("data-dispatch-policy"),
        "pinned"
      );
      assert.match(
        await page
          .locator('.agentPlanRow[data-plan-issue-id="task-2"] .agentPlanAssignment')
          .innerText(),
        /^Dispatch: Automatic$/
      );
      const leaf = page.locator('.agentPlanRow[data-plan-issue-id="task-2"]');
      assert.equal(await leaf.getAttribute("data-plan-parent-id"), "project");
      assert.equal(await leaf.getAttribute("data-plan-depth"), "1");
      assert.match(
        await leaf.locator(".agentPlanRelations").innerText(),
        /Parent: project · Depends on: task-1/
      );
      assert.match(
        await page
          .locator('.agentPlanRow[data-plan-issue-id="task-1"] .agentPlanAssignment')
          .innerText(),
        /Dispatch: Preferred · Requested: OpenAI API \/ small-model · Owner: worker/
      );
      assert.match(
        await page
          .locator('.agentPlanRow[data-plan-issue-id="task-3"] .agentPlanStatus')
          .innerText(),
        /Recorded: In Progress/
      );
      assert.equal(await page.locator(".agentExecutionRow").count(), 0);
      assert.equal(await page.locator(".agentExecutionEmpty").isVisible(), true);
      assert.equal(
        await page.evaluate(
          () =>
            window.messages.filter((message) => message.command === "getAgentExecutionSnapshot")
              .length
        ),
        1
      );
      await leaf.locator(".graphDetailsBead").click();
      assert.equal(
        await page
          .locator(".agentWorkDetailsHost .graphSelectedDetails")
          .getAttribute("data-issue-id"),
        "task-2"
      );
    },
    "control"
  );
  await test(
    "Execution stages update run rows in place and preserve focus and scroll",
    async () => {
      const entries = Array.from({ length: 12 }, (_, index) => executionRun(index + 1));
      await executionSnapshot({ sessionId: "session-1", revision: 1, entries });
      await page.locator(".agentExecutionDetails").nth(3).focus();
      await page.locator(".agentExecutionList").evaluate((list) => {
        list.scrollTop = 180;
      });
      const before = await page.evaluate(() => {
        window.executionFocused = document.activeElement;
        window.executionRow = document.querySelector(".agentExecutionRow");
        const list = document.querySelector(".agentExecutionList");
        return { scrollTop: list.scrollTop, height: list.clientHeight, windowY: window.scrollY };
      });
      const phases = [
        "preparing",
        "generating",
        "checking",
        "awaiting-review",
        "applying",
        "edit-applied"
      ];
      for (const [index, phase] of phases.entries()) {
        await executionSnapshot({
          sessionId: "session-1",
          revision: index + 2,
          entries: entries.map((entry) => ({ ...entry, phase }))
        });
        assert.equal(await page.locator(".agentExecutionRow").count(), 12);
        assert.equal(
          await page.locator(".agentExecutionRow").first().getAttribute("data-execution-phase"),
          phase
        );
        assert.deepEqual(
          await page.evaluate(() => {
            const list = document.querySelector(".agentExecutionList");
            return {
              sameFocus: window.executionFocused === document.activeElement,
              sameRow: window.executionRow === document.querySelector(".agentExecutionRow"),
              scrollTop: list.scrollTop,
              height: list.clientHeight,
              windowY: window.scrollY
            };
          }),
          { sameFocus: true, sameRow: true, ...before }
        );
      }
      assert.equal(await page.locator('.agentExecutionRow[data-execution-active="1"]').count(), 0);
      assert.match(
        await page.locator(".agentExecutionPhase").first().innerText(),
        /acceptance pending/
      );
    },
    "control"
  );
  await test(
    "Stale snapshots and ordinary refresh cannot regress current execution",
    async () => {
      const entries = [executionRun(1, "generating")];
      await executionSnapshot({ sessionId: "session-1", revision: 5, entries });
      const button = page.locator(".agentExecutionDetails");
      await button.focus();
      await executionSnapshot({
        sessionId: "session-1",
        revision: 4,
        entries: [executionRun(1, "queued")]
      });
      await executionSnapshot({
        sessionId: "session-1",
        revision: 6,
        entries: [executionRun(1), executionRun(1)]
      });
      await refresh({
        sessionId: "session-1",
        revision: 3,
        entries: [executionRun(1, "preparing")]
      });
      assert.equal(
        await page.locator(".agentExecutionRow").getAttribute("data-execution-phase"),
        "generating"
      );
      assert.equal(await button.evaluate((node) => node === document.activeElement), true);
      await refresh(
        { sessionId: "session-1", revision: 6, entries: [executionRun(1, "checking")] },
        2
      );
      assert.equal(
        await page.locator(".agentExecutionRow").getAttribute("data-execution-phase"),
        "checking"
      );
    },
    "control"
  );
  await test(
    "A host restart clears old activity and rejects a delayed previous session",
    async () => {
      const oldSnapshot = {
        sessionId: "session-1",
        revision: 8,
        entries: [executionRun(1, "generating")]
      };
      await executionSnapshot(oldSnapshot);
      await executionSnapshot({ sessionId: "session-2", revision: 0, entries: [] });
      await executionSnapshot({ ...oldSnapshot, revision: 9 });
      assert.equal(await page.locator(".agentExecutionRow").count(), 0);
      assert.equal(await page.locator(".agentExecutionEmpty").isVisible(), true);
    },
    "control"
  );

  await test(
    "Unchanged, stale, and invalid snapshots do not mutate execution DOM",
    async () => {
      const snapshot = {
        sessionId: "session-1",
        revision: 5,
        entries: [executionRun(1, "generating")]
      };
      await executionSnapshot(snapshot);
      await page.evaluate(() => {
        window.executionMutationCount = 0;
        window.executionObserver = new MutationObserver((records) => {
          window.executionMutationCount += records.length;
        });
        window.executionObserver.observe(document.querySelector(".agentExecutionPanel"), {
          attributes: true,
          childList: true,
          characterData: true,
          subtree: true
        });
      });
      await executionSnapshot(snapshot);
      await executionSnapshot({ ...snapshot, revision: 4 });
      await executionSnapshot({
        ...snapshot,
        revision: 6,
        entries: [executionRun(1), executionRun(1)]
      });
      await refresh(snapshot);
      assert.equal(await page.evaluate(() => window.executionMutationCount), 0);
      await executionSnapshot({ ...snapshot, revision: 6, entries: [executionRun(1, "checking")] });
      assert.ok(await page.evaluate(() => window.executionMutationCount > 0));
    },
    "control"
  );
  await test(
    "Execution timestamps update and email-like model identities stay masked",
    async () => {
      const entry = { ...executionRun(1, "generating"), model: "person@example.com" };
      await executionSnapshot({ sessionId: "session-1", revision: 1, entries: [entry] });
      assert.match(await page.locator(".agentExecutionMeta").innerText(), /Model identity hidden/);
      assert.doesNotMatch(
        await page.locator(".agentExecutionPanel").innerText(),
        /person@example.com/
      );
      assert.equal(
        await page.locator(".agentExecutionTime").getAttribute("datetime"),
        entry.updatedAt
      );
      await executionSnapshot({
        sessionId: "session-1",
        revision: 2,
        entries: [{ ...entry, updatedAt: "2026-09-13T00:00:02Z" }]
      });
      assert.equal(
        await page.locator(".agentExecutionTime").innerText(),
        "Observed 2026-09-13T00:00:02Z"
      );
      assert.equal(await page.locator(".agentExecutionRow").count(), 1);
    },
    "control"
  );
  await test(
    "Initial host snapshot restores observations without treating review as accepted",
    async () => {
      await reset("control", {
        sessionId: "session-1",
        revision: 2,
        entries: [executionRun(1, "awaiting-review")]
      });
      assert.equal(await page.locator(".agentExecutionRow").count(), 1);
      assert.equal(await page.locator(".agentExecutionPhase").innerText(), "Human review");
      await executionSnapshot({
        sessionId: "session-1",
        revision: 3,
        entries: [executionRun(1, "response-ready")]
      });
      assert.equal(
        await page.locator(".agentExecutionPhase").innerText(),
        "Response ready · not accepted"
      );
    },
    "control"
  );
  await test(
    "Manage plan scrolling and Details focus survive an ordinary refresh",
    async () => {
      const list = page.locator(".agentPlanList");
      const button = page.locator('.agentPlanRow[data-plan-issue-id="task-3"] .graphDetailsBead');
      await button.focus();
      await list.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      const scrollTop = await list.evaluate((node) => node.scrollTop);
      await refresh();
      assert.equal(await list.evaluate((node) => node.scrollTop), scrollTop);
      assert.equal(await button.evaluate((node) => node === document.activeElement), true);
    },
    "control"
  );
  await test(
    "Execution and plan controls remain reachable at 390px",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await executionSnapshot({
        sessionId: "session-1",
        revision: 1,
        entries: [executionRun(1, "awaiting-review")]
      });
      for (const selector of [".agentPlanList", ".agentExecutionList"]) {
        const list = page.locator(selector);
        await list.focus();
        const box = await list.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= 391);
        assert.ok(box.height <= 262);
        const button = list.locator("button").first();
        await button.scrollIntoViewIfNeeded();
        const rect = await button.boundingBox();
        assert.ok(rect.x >= 0 && rect.x + rect.width <= 391);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 391));
      await page.screenshot({ path: join(output, "execution-narrow.png"), fullPage: true });
    },
    "control"
  );
  await test("Dependency paths and scoped Parent links remain visible", async () => {
    const paths = page.locator(".dependencyOverlay .dependencyPath");
    const count = await paths.count();
    assert.ok(count >= 4);
    assert.equal(await page.locator(".graphParentPath").count(), 0);
    await page.locator('[data-graph-details-id="task-1"]').first().click();
    assert.equal(await page.locator(".graphSelectedDetails").count(), 1);
    assert.equal(await page.locator(".graphParentPath").count(), 1);
    assert.equal(await paths.count(), count);
  });
  await test("Modified keyboard shortcuts do not move the Graph", async () => {
    await page.locator(".graphScroller").focus();
    const before = await transform();
    await page.keyboard.press("Meta+-");
    assert.deepEqual(await transform(), before);
    await page.keyboard.press("Control+-");
    assert.deepEqual(await transform(), before);
    await page.keyboard.press("ArrowRight");
    assert.notDeepEqual(await transform(), before);
  });
  await test("Cancelled selection does not zoom", async () => {
    const box = await page.locator(".graphScroller").boundingBox();
    const before = await transform();
    await page.keyboard.down("Alt");
    await page.mouse.move(box.x + 8, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 100);
    await page
      .locator(".graphScroller")
      .dispatchEvent("pointercancel", { pointerId: 1, clientX: box.x + 120, clientY: box.y + 100 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    assert.deepEqual(await transform(), before);
    assert.equal(await page.locator(".graphZoomSelection").isVisible(), false);
  });
  await test("Escape cancels a selection without zooming", async () => {
    const box = await page.locator(".graphScroller").boundingBox();
    const before = await transform();
    await page.keyboard.down("Alt");
    await page.mouse.move(box.x + 8, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 100);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.keyboard.up("Alt");
    assert.deepEqual(await transform(), before);
    assert.equal(await page.locator(".graphZoomSelection").isVisible(), false);
  });
  for (const interruption of ["lostpointercapture", "blur", "refresh"]) {
    await test(`Selection cleanup on ${interruption} does not zoom`, async () => {
      const box = await page.locator(".graphScroller").boundingBox();
      const before = await transform();
      await page.keyboard.down("Alt");
      await page.mouse.move(box.x + 8, box.y + 8);
      await page.mouse.down();
      await page.mouse.move(box.x + 120, box.y + 100);
      if (interruption === "refresh") await refresh();
      else if (interruption === "blur")
        await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      else await page.locator(".graphScroller").dispatchEvent(interruption, { pointerId: 1 });
      await page.mouse.up();
      await page.keyboard.up("Alt");
      assert.deepEqual(await transform(), before);
      assert.equal(await page.locator(".graphZoomSelection").isVisible(), false);
      assert.equal(
        await page.locator(".graphScroller").evaluate((node) => node.hasPointerCapture(1)),
        false
      );
    });
  }
  await test("An unrelated pointer cannot finish an active selection", async () => {
    const scroller = page.locator(".graphScroller");
    const box = await scroller.boundingBox();
    const before = await transform();
    await page.keyboard.down("Alt");
    await page.mouse.move(box.x + 8, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 100);
    await scroller.dispatchEvent("pointerup", {
      pointerId: 2,
      clientX: box.x + 250,
      clientY: box.y + 250
    });
    assert.deepEqual(await transform(), before);
    assert.equal(await page.locator(".graphZoomSelection").isVisible(), true);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.keyboard.up("Alt");
  });
  await test("Wheel zoom keeps the point under the cursor fixed", async () => {
    const box = await page.locator(".graphScroller").boundingBox();
    const anchor = { x: box.width / 3, y: box.height / 3 };
    const before = await transform();
    await page.mouse.move(box.x + anchor.x, box.y + anchor.y);
    await page.mouse.wheel(0, -100);
    await page.waitForFunction(
      (zoom) =>
        document.querySelector(".graphContent").style.getPropertyValue("--graph-zoom") !== zoom,
      before.zoom
    );
    const after = await transform();
    for (const axis of ["x", "y"]) {
      const point = (anchor[axis] - parseFloat(before[axis])) / Number(before.zoom);
      const restored = point * Number(after.zoom) + parseFloat(after[axis]);
      assert.ok(Math.abs(restored - anchor[axis]) < 1);
    }
  });
  await test("Refresh preserves details keyboard focus", async () => {
    await page.locator('[data-graph-details-id="task-1"]').first().click();
    await page.locator(".graphSelectedDetailsClose").focus();
    await refresh();
    assert.equal(
      await page
        .locator(".graphSelectedDetailsClose")
        .evaluate((node) => node === document.activeElement),
      true
    );
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(".graphSelectedDetails").count(), 0);
  });
  await test("Refresh preserves Graph selection and viewport", async () => {
    await page.locator('[data-graph-details-id="task-1"]').first().click();
    await page.locator(".graphScroller").focus();
    await page.keyboard.press("+");
    await page.keyboard.press("ArrowRight");
    const before = await transform();
    await refresh();
    assert.deepEqual(await transform(), before);
    assert.equal(
      await page.locator(".graphSelectedDetails").getAttribute("data-issue-id"),
      "task-1"
    );
  });
  await test(
    "Refresh preserves Table selection and row focus",
    async () => {
      const row = page.locator('.beadRow[data-id="task-1"]');
      const button = row.locator(".beadDetailsButton");
      await button.focus();
      await page.keyboard.press("Enter");
      assert.equal(await button.getAttribute("aria-expanded"), "true");
      await refresh();
      assert.equal(await button.evaluate((node) => node === document.activeElement), true);
      assert.equal(await button.getAttribute("aria-expanded"), "true");
    },
    "table"
  );
  await test("Disabled Start never posts; enabled Start posts once", async () => {
    await page.locator('.graphNode[data-graph-id="task-2"] .assignStartBead').focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(
        () => window.messages.filter((message) => message.command === "assignStartBead").length
      ),
      0
    );
    await page.locator('.graphNode[data-graph-id="task-1"] .assignStartBead').focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(
        () => window.messages.filter((message) => message.command === "assignStartBead").length
      ),
      1
    );
  });
  await test("Filter menu supports arrow navigation and leaves no stale popup", async () => {
    await page.locator("#preset").selectOption("open");
    await page.locator("#addFilter").click();
    const buttons = page.locator("#filterMenu button");
    assert.ok((await buttons.count()) > 1);
    await page.keyboard.press("ArrowDown");
    assert.equal(await buttons.nth(1).evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press("Home");
    assert.equal(await buttons.first().evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press("End");
    assert.equal(await buttons.last().evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press("Tab");
    assert.equal(await page.locator("#filterMenu").isVisible(), false);
  });
  await test("Removing a custom filter keeps keyboard focus usable", async () => {
    await page.locator("#preset").selectOption("open");
    await page.locator("#addFilter").click();
    await page.locator('#filterMenu [data-add-filter="closed"]').click();
    const remove = page.locator('[data-remove-filter="closed"]');
    await remove.focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator("#addFilter").evaluate((node) => node === document.activeElement),
      true
    );
  });
  await test("A Graph task context menu addresses that task", async () => {
    await page
      .locator('.graphNode[data-graph-id="task-1"] .graphNodeTitle')
      .click({ button: "right" });
    assert.equal(await page.locator("#closeBeadAction").isEnabled(), true);
    await page.locator("#closeBeadAction").click();
    const messages = await page.evaluate(() =>
      window.messages.filter((message) => message.command === "closeBead")
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].issueId, "task-1");
    assert.equal(messages[0].workspacePath, workspacePath);
  });
  await test("Graph details dismiss an open filter menu", async () => {
    await page.locator("#addFilter").click();
    assert.equal(await page.locator("#filterMenu").isVisible(), true);
    await page.locator('[data-graph-details-id="task-1"]').first().click();
    assert.equal(await page.locator("#filterMenu").isVisible(), false);
    assert.equal(await page.locator(".graphSelectedDetails").count(), 1);
  });
  await test("Clearing custom filters returns focus to the preset", async () => {
    await page.locator("#preset").selectOption("open");
    await page.locator("#addFilter").click();
    await page.locator('#filterMenu [data-add-filter="closed"]').click();
    await page.locator("#clearFilters").focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator("#preset").evaluate((node) => node === document.activeElement),
      true
    );
    assert.equal(await page.locator("#preset").inputValue(), "default");
  });
  await test(
    "Table action menu supports keyboard navigation and dismissal",
    async () => {
      await page.locator("#addFilter").click();
      const trigger = page.locator('.beadRow[data-id="task-1"] .rowActionsButton');
      await trigger.click();
      assert.equal(await page.locator("#filterMenu").isVisible(), false);
      assert.equal(
        await page.locator("#createBeadAction").evaluate((node) => node === document.activeElement),
        true
      );
      await page.keyboard.press("ArrowDown");
      assert.equal(
        await page.locator("#closeBeadAction").evaluate((node) => node === document.activeElement),
        true
      );
      await page.keyboard.press("ArrowDown");
      assert.equal(
        await page.locator("#createBeadAction").evaluate((node) => node === document.activeElement),
        true
      );
      await page.keyboard.press("Escape");
      assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
      assert.equal(await trigger.getAttribute("aria-expanded"), "false");
      await trigger.click();
      await page.keyboard.press("Tab");
      assert.equal(await page.locator("#rowContextMenu").isVisible(), false);
      assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    },
    "table"
  );
  await test(
    "A Manage task context menu addresses that task",
    async () => {
      await page
        .locator('.agentWorkCard[data-work-item-id="task-1"] .agentWorkCardTitle')
        .click({ button: "right" });
      await page.keyboard.press("Escape");
      assert.equal(
        await page
          .locator('.agentWorkCard[data-work-item-id="task-1"] .graphDetailsBead')
          .evaluate((node) => node === document.activeElement),
        true
      );
      await page
        .locator('.agentWorkCard[data-work-item-id="task-1"] .agentWorkCardTitle')
        .click({ button: "right" });
      assert.equal(await page.locator("#closeBeadAction").isEnabled(), true);
      await page.locator("#closeBeadAction").click();
      const messages = await page.evaluate(() =>
        window.messages.filter((message) => message.command === "closeBead")
      );
      assert.equal(messages.length, 1);
      assert.equal(messages[0].issueId, "task-1");
      assert.equal(messages[0].workspacePath, workspacePath);
    },
    "control"
  );
  for (const mode of ["graph", "table", "control", "plan"]) {
    await test(
      `${mode} keeps toolbar controls reachable in a narrow sidebar`,
      async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        await settle();
        const bounds = await page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          controls: Array.from(document.querySelectorAll(".toolbar button, .toolbar select"))
            .filter((node) => node.getClientRects().length > 0)
            .map((node) => ({
              id: node.id,
              left: node.getBoundingClientRect().left,
              right: node.getBoundingClientRect().right
            }))
        }));
        assert.ok(
          bounds.scrollWidth <= bounds.width + 1,
          `page width ${bounds.scrollWidth} exceeds ${bounds.width}`
        );
        for (const control of bounds.controls) {
          assert.ok(
            control.left >= 0 && control.right <= bounds.width + 1,
            `${control.id} is outside the sidebar`
          );
        }
        if (mode === "graph") {
          const obscured = await page.locator(".graphControls button").evaluateAll((buttons) =>
            buttons
              .filter((button) => {
                const rect = button.getBoundingClientRect();
                return !button.contains(
                  document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
                );
              })
              .map((button) => button.dataset.graphAction)
          );
          assert.deepEqual(obscured, [], "Graph controls are covered by another element");
        }
        await page.screenshot({ path: join(output, `${mode}-narrow.png`), fullPage: true });
      },
      mode
    );
  }
  await reset("control");
  await executionSnapshot({
    sessionId: "session-1",
    revision: 2,
    entries: [
      executionRun(1, "generating"),
      { ...executionRun(2, "awaiting-review"), issueId: "task-2", title: "Review the feature" }
    ]
  });
  await page.screenshot({ path: join(output, "manage-execution.png"), fullPage: true });
  await reset();
  await page.screenshot({ path: join(output, "graph.png"), fullPage: true });
  await reset("table");
  await page.screenshot({ path: join(output, "table.png"), fullPage: true });
  assert.deepEqual(errors, [], "Unexpected browser errors");
} finally {
  await writeFile(join(output, "report.json"), JSON.stringify({ results, errors }, null, 2));
  await browser.close();
  process.stdout.write(`Evidence: ${output}\n`);
}
if (results.some((result) => !result.passed)) process.exitCode = 1;
