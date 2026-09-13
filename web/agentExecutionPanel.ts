import { getObservedModelLabel } from "../src/agentDisplay";
import {
  type AgentExecutionSnapshot,
  EXECUTION_PHASE_LABELS,
  isActiveExecutionPhase,
  isAgentExecutionSnapshot
} from "../src/agentExecutionTrace";
import { getAgentProviderDefinition } from "../src/agentProvider";

/** Never restore execution observations from persisted webview state. */
export function createAgentExecutionPanelController(root: Document) {
  let current: AgentExecutionSnapshot | null = null;
  const retiredSessions = new Set<string>();

  function setText(element: Element, text: string) {
    if (element.textContent !== text) element.textContent = text;
  }

  function setAttribute(element: Element, name: string, value: string) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  function render() {
    for (const panel of Array.from(root.querySelectorAll<HTMLElement>(".agentExecutionPanel"))) {
      const entries = (current?.entries ?? []).filter(
        (entry) => entry.workspacePath === panel.dataset.workspacePath
      );
      const list = panel.querySelector<HTMLElement>(".agentExecutionList");
      if (list === null) continue;
      const scrollTop = list.scrollTop;
      const existing = new Map(
        Array.from(list.querySelectorAll<HTMLElement>("[data-execution-run-id]")).map(
          (row) => [row.dataset.executionRunId, row] as const
        )
      );
      const retained = new Set(entries.map((entry) => entry.runId));
      for (const [runId, row] of existing) {
        if (!retained.has(runId ?? "")) row.remove();
      }
      for (const entry of entries) {
        let row = existing.get(entry.runId);
        if (row === undefined) {
          row = root.createElement("li");
          row.className = "agentExecutionRow";
          row.dataset.executionRunId = entry.runId;
          const heading = root.createElement("div");
          heading.className = "agentExecutionHeading";
          const title = root.createElement("span");
          title.className = "agentExecutionTitle";
          const button = root.createElement("button");
          button.className = "graphDetailsBead agentExecutionDetails";
          button.type = "button";
          button.textContent = "Details";
          heading.append(title, button);
          const phase = root.createElement("span");
          phase.className = "agentExecutionPhase";
          const meta = root.createElement("span");
          meta.className = "agentExecutionMeta";
          const time = root.createElement("time");
          time.className = "agentExecutionTime";
          row.append(heading, phase, meta, time);
          list.append(row);
        }
        setAttribute(row, "data-execution-phase", entry.phase);
        setAttribute(row, "data-execution-active", isActiveExecutionPhase(entry.phase) ? "1" : "0");
        const title = row.querySelector<HTMLElement>(".agentExecutionTitle")!;
        const phase = row.querySelector<HTMLElement>(".agentExecutionPhase")!;
        const meta = row.querySelector<HTMLElement>(".agentExecutionMeta")!;
        const time = row.querySelector<HTMLTimeElement>(".agentExecutionTime")!;
        const button = row.querySelector<HTMLButtonElement>(".agentExecutionDetails")!;
        setText(title, `${entry.issueId}: ${entry.title}`);
        setText(phase, EXECUTION_PHASE_LABELS[entry.phase]);
        setText(
          meta,
          `Requested: ${getAgentProviderDefinition(entry.provider).label} · ${getObservedModelLabel(entry.model)}`
        );
        setAttribute(time, "datetime", entry.updatedAt);
        setText(time, `Observed ${entry.updatedAt}`);
        setAttribute(button, "data-graph-details-id", entry.issueId);
        setAttribute(button, "data-graph-details-workspace", entry.workspacePath);
        setAttribute(button, "aria-label", `Details for ${entry.issueId}: ${entry.title}`);
        const disabled = !Array.from(root.querySelectorAll<HTMLElement>(".beadRow")).some(
          (task) =>
            task.dataset.id === entry.issueId && task.dataset.workspacePath === entry.workspacePath
        );
        if (button.disabled !== disabled) button.disabled = disabled;
      }
      const empty = panel.querySelector<HTMLElement>(".agentExecutionEmpty");
      if (empty !== null && empty.hidden !== entries.length > 0) empty.hidden = entries.length > 0;
      const summary = panel.querySelector<HTMLElement>(".agentExecutionSummary");
      if (summary !== null) {
        const active = entries.filter((entry) => isActiveExecutionPhase(entry.phase)).length;
        const text = `${active} active · ${entries.length} recent`;
        if (summary.textContent !== text) summary.textContent = text;
      }
      if (list.scrollTop !== scrollTop) list.scrollTop = scrollTop;
    }
  }

  function update(snapshot: unknown) {
    if (!isAgentExecutionSnapshot(snapshot) || retiredSessions.has(snapshot.sessionId))
      return false;
    if (
      current !== null &&
      current.sessionId === snapshot.sessionId &&
      snapshot.revision <= current.revision
    )
      return false;
    if (current !== null && current.sessionId !== snapshot.sessionId)
      retiredSessions.add(current.sessionId);
    current = snapshot;
    render();
    return true;
  }

  function readSnapshot(source: Document) {
    const encoded = source.querySelector<HTMLElement>("#agentExecutionState")?.dataset.snapshot;
    if (encoded === undefined) {
      render();
      return;
    }
    try {
      if (!update(JSON.parse(decodeURIComponent(encoded)))) render();
    } catch {
      render();
    }
  }

  readSnapshot(root);
  return { update, readSnapshot };
}
