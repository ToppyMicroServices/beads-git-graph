import { anonymizeAgentIdentity, getObservedModelLabel } from "./agentDisplay";
import {
  type AgentExecutionSnapshot,
  EXECUTION_PHASE_LABELS,
  isActiveExecutionPhase
} from "./agentExecutionTrace";
import { getAgentProviderDefinition } from "./agentProvider";
import { type BeadItem, beadStatusLabel, normalizeBeadStatus } from "./beadsData";
import { escapeHtml } from "./utils";

export function renderAgentPlan(
  items: BeadItem[],
  workspacePath: string,
  agentAliases: ReadonlyMap<string, string>
) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const children = new Map<string, BeadItem[]>();
  for (const item of items) {
    const parent = item.parentId.trim();
    if (parent !== "" && parent !== item.id && byId.has(parent)) {
      const siblings = children.get(parent) ?? [];
      siblings.push(item);
      children.set(parent, siblings);
    }
  }
  const visited = new Set<string>();
  const rows: string[] = [];
  const append = (first: BeadItem) => {
    const stack = [{ item: first, depth: 0 }];
    while (stack.length > 0) {
      const { item, depth } = stack.pop()!;
      if (visited.has(item.id)) continue;
      visited.add(item.id);
      const parent = item.parentId.trim();
      const assignee = item.assignee.trim() === "-" ? "" : item.assignee.trim();
      const owner =
        anonymizeAgentIdentity(item.agent.trim() || assignee, agentAliases) || "Unassigned";
      const model = anonymizeAgentIdentity(item.model.trim(), agentAliases) || "Unassigned";
      const providerExplicit =
        item.providerExplicit === true ||
        (item.providerExplicit === undefined && item.provider !== "copilot");
      const provider = providerExplicit
        ? getAgentProviderDefinition(item.provider).label
        : "Unassigned";
      const dependencies =
        item.dependencyIds.length === 0
          ? "None"
          : item.dependencyIds
              .map((id) => `${id}${byId.has(id) ? "" : " (not loaded)"}`)
              .join(", ");
      rows.push(
        `<li class="agentPlanRow" data-plan-issue-id="${escapeHtml(item.id)}" data-plan-parent-id="${escapeHtml(parent)}" data-plan-depth="${depth}" style="--plan-depth:${Math.min(depth, 4)}"><div class="agentExecutionHeading"><span class="agentPlanTitle"><span class="beadId">${escapeHtml(item.id)}</span> ${escapeHtml(item.title)}</span><button class="graphDetailsBead" type="button" data-graph-details-id="${escapeHtml(item.id)}" data-graph-details-workspace="${escapeHtml(workspacePath)}" aria-label="${escapeHtml(`Details for ${item.id}: ${item.title}`)}">Details</button></div><div class="agentPlanRelations">Parent: ${escapeHtml(parent === "" ? "None" : `${parent}${byId.has(parent) ? "" : " (not loaded)"}`)} · Depends on: ${escapeHtml(dependencies)}</div><div class="agentPlanAssignment">Requested: ${escapeHtml(provider)} / ${escapeHtml(model)} · Owner: ${escapeHtml(owner)}</div><div class="agentPlanStatus">Recorded: ${escapeHtml(beadStatusLabel(normalizeBeadStatus(item.status)))}</div></li>`
      );
      const descendants = children.get(item.id) ?? [];
      for (let index = descendants.length - 1; index >= 0; index--) {
        stack.push({ item: descendants[index], depth: depth + 1 });
      }
    }
  };
  for (const item of items) {
    if (item.parentId.trim() === "" || !byId.has(item.parentId.trim())) append(item);
  }
  // Keep malformed parent cycles visible without inventing or duplicating edges.
  for (const item of items) append(item);
  return `<div class="agentPlanPanel"><div class="agentExecutionSectionHeader"><h3>Subagent plan</h3><span>${items.length} tasks</span></div><p class="agentExecutionHint">All loaded tasks, parent → leaf. Parent and dependency links are recorded separately; assignments are requested, not confirmed execution.</p><ol class="agentPlanList" tabindex="0" aria-label="Recorded subagent plan">${rows.join("")}</ol></div>`;
}

export function renderAgentExecutionPanel(
  workspacePath: string,
  snapshot?: AgentExecutionSnapshot
) {
  const entries = (snapshot?.entries ?? []).filter(
    (entry) => entry.workspacePath === workspacePath
  );
  const active = entries.filter((entry) => isActiveExecutionPhase(entry.phase)).length;
  const rows = entries
    .map(
      (entry) =>
        `<li class="agentExecutionRow" data-execution-run-id="${escapeHtml(entry.runId)}" data-execution-phase="${escapeHtml(entry.phase)}" data-execution-active="${isActiveExecutionPhase(entry.phase) ? "1" : "0"}"><div class="agentExecutionHeading"><span class="agentExecutionTitle">${escapeHtml(`${entry.issueId}: ${entry.title}`)}</span><button class="graphDetailsBead agentExecutionDetails" type="button" data-graph-details-id="${escapeHtml(entry.issueId)}" data-graph-details-workspace="${escapeHtml(workspacePath)}" aria-label="${escapeHtml(`Details for ${entry.issueId}: ${entry.title}`)}">Details</button></div><span class="agentExecutionPhase">${escapeHtml(EXECUTION_PHASE_LABELS[entry.phase])}</span><span class="agentExecutionMeta">Requested: ${escapeHtml(getAgentProviderDefinition(entry.provider).label)} · ${escapeHtml(getObservedModelLabel(entry.model))}</span><time class="agentExecutionTime" datetime="${escapeHtml(entry.updatedAt)}">Observed ${escapeHtml(entry.updatedAt)}</time></li>`
    )
    .join("");
  return `<div class="agentExecutionPanel" data-workspace-path="${escapeHtml(workspacePath)}"><div class="agentExecutionSectionHeader"><h3>Recent execution</h3><span class="agentExecutionSummary" role="status" aria-live="polite">${active} active · ${entries.length} recent</span></div><p class="agentExecutionHint">Host-observed stages in this session only, up to 100 runs. External sessions are not monitored. Review and applying an edit do not mean task acceptance.</p><ol class="agentExecutionList" tabindex="0" aria-label="Recent host-observed execution"><li class="agentExecutionEmpty"${entries.length > 0 ? " hidden" : ""}>No execution observed in this session. Recorded task status is not live activity.</li>${rows}</ol></div>`;
}
