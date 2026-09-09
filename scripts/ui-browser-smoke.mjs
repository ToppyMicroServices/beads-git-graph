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
  { id: "task-1", title: "Implement the feature", parentId: "project" },
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
    parentId: "project",
    dependencyIds: ["task-2"],
    readyByBd: false
  }
].map((item) => ({ ...defaults, ...item }));
function render(revision = 0) {
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
      warnings: [],
      bdExecutableStatus: { available: true, message: "" },
      agentWriteCapabilities: [{ workspace: "UI smoke", workspacePath, capability }],
      planImportCapabilities: [{ workspace: "UI smoke", workspacePath, capability }]
    }
  );
}
const html = render();
const script = await readFile(
  process.env.BEADS_WEBVIEW_SCRIPT || "out/beadsWebview.min.js",
  "utf8"
);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
const results = [];
const errors = [];
let page;
async function reset(mode = "graph") {
  await page?.close();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  const fixtureHtml = await page.evaluate((source) => {
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
  }, html);
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
async function refresh() {
  await page.evaluate(
    (nextHtml) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "beadsRenderUpdate", generation: 1, html: nextHtml }
        })
      ),
    render(1)
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
try {
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
