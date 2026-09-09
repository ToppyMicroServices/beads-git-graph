# GUI screenshots

`graph-overview.png` and `manage-overview.png` show the extension's actual webview renderer with
synthetic task records, not live agent execution or a generated UI mockup.

- Source: v0.6.5, commit `024639d38981cdbc908584a1f72e935860c9bbf4`.
- Renderer: `src/beadsWebview.ts` and compiled `out/beadsWebview.min.js`, captured in Chromium.
- Viewport: 1280 CSS pixels wide, 2× pixel density, dark theme, reduced motion.
- Graph: **Fit all**, with one recorded in-progress task, one ready task, and a review task
  depending on both. The sample providers are GitHub Copilot and Ollama.
- Manage: **All** status filter, with additional blocked, PR-review, and closed sample tasks.

No provider was called, no agent was started, and no Beads database was changed during capture.
The older `plan-draft-preview.png` is retained for existing references but is not the README hero.
