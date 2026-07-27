import { type BeadsWriteCapability } from "./beadsWriteCapability";
import { type PlanDraft, type PlanDraftValidationError } from "./planDraft";
import { projectPlanDraftToGraph } from "./planGraph";
import { formatPlanMutation, projectPlanDraftMutations } from "./planImport";

export interface PlanDraftPreviewInput {
  draft: PlanDraft | null;
  errors: PlanDraftValidationError[];
  capability: BeadsWriteCapability | null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderPlanDraftPreview(input: PlanDraftPreviewInput) {
  const validationHtml =
    input.errors.length === 0
      ? '<div class="planValidation planValidationValid">Draft validation passed.</div>'
      : `<div class="planValidation planValidationInvalid"><strong>${input.errors.length} validation error(s)</strong><ul>${input.errors.map((error) => `<li><code>${escapeHtml(error.path || "draft")}</code>: ${escapeHtml(error.message)}</li>`).join("")}</ul></div>`;
  const capability =
    input.capability ??
    ({
      supported: false,
      state: "probe-failed",
      reason: "Select an initialized Beads workspace to check import capability."
    } satisfies BeadsWriteCapability);
  const capabilityHtml = `<div class="planCapability ${capability.supported ? "supported" : "disabled"}"><strong>${capability.supported ? "Import available" : "Import disabled"}</strong><span>${escapeHtml(capability.reason)}</span></div>`;

  if (input.draft === null || input.errors.length > 0) {
    return `<div class="planPreviewResult">${validationHtml}${capabilityHtml}<div class="planPreviewActions"><button id="cancelPlanDraft" type="button">Cancel</button><button id="importPlanDraft" type="button" title="Fix validation errors before import." disabled>Import Plan</button></div></div>`;
  }

  const graph = projectPlanDraftToGraph(input.draft);
  const criticalIds = new Set(graph.criticalPathIds);
  const levels = Array.from(new Set(graph.nodes.map((node) => node.level))).sort(
    (left, right) => left - right
  );
  const graphHtml = `<div class="planDraftGraph" aria-label="Plan dependency graph">${levels
    .map(
      (level) =>
        `<div class="planDraftLevel"><div class="planDraftLevelLabel">Level ${level + 1}</div>${graph.nodes
          .filter((node) => node.level === level)
          .map(
            (node) =>
              `<div class="planDraftNode${criticalIds.has(node.id) ? " critical" : ""}"><strong>${escapeHtml(node.id)}</strong><span>${escapeHtml(node.title)}</span>${node.provider === undefined ? "" : `<span>Requested provider: ${escapeHtml(node.provider)}</span>`}${node.model === undefined ? "" : `<span>Requested model: ${escapeHtml(node.model)}</span>`}</div>`
          )
          .join("")}</div>`
    )
    .join("")}</div>`;
  const criticalPathHtml = `<div class="planPathSummary"><strong>Critical Path</strong><span>${graph.criticalPathIds.length === 0 ? "No dependency path yet" : escapeHtml(graph.criticalPathIds.join(" → "))}</span></div>`;
  const parallelHtml = `<div class="planParallelSummary"><strong>Parallel candidates</strong><span>${graph.parallelGroups.length === 0 ? "None" : graph.parallelGroups.map((ids) => escapeHtml(ids.join(" + "))).join("; ")}</span></div>`;
  const modelTransitionHtml = `<div class="planModelTransitionSummary"><strong>Requested model transitions</strong><span>${graph.requestedModelTransitions.length === 0 ? "None" : graph.requestedModelTransitions.map((transition) => `${escapeHtml(transition.fromId)} [${escapeHtml(transition.fromModel)}] → ${escapeHtml(transition.toId)} [${escapeHtml(transition.toModel)}]`).join("; ")}</span></div>`;
  const providerTransitionHtml = `<div class="planProviderTransitionSummary"><strong>Requested provider/model transitions</strong><span>${
    graph.requestedProviderModelTransitions.length === 0
      ? "None"
      : graph.requestedProviderModelTransitions
          .map(
            (transition) =>
              `${escapeHtml(transition.fromId)} [${transition.fromProvider === undefined ? "unspecified provider" : escapeHtml(transition.fromProvider)}${transition.fromModel === undefined ? "" : ` / ${escapeHtml(transition.fromModel)}`}] → ${escapeHtml(transition.toId)} [${transition.toProvider === undefined ? "unspecified provider" : escapeHtml(transition.toProvider)}${transition.toModel === undefined ? "" : ` / ${escapeHtml(transition.toModel)}`}]`
          )
          .join("; ")
  }</span></div>`;
  const taskHtml = input.draft.tasks
    .map(
      (task) =>
        `<article class="planDraftTask"><div class="planDraftTaskHeader"><strong>${escapeHtml(task.id)} · ${escapeHtml(task.title)}</strong><span>${escapeHtml(task.priority)}</span></div><div><b>Depends on:</b> ${task.dependencyIds.length === 0 ? "None" : task.dependencyIds.map(escapeHtml).join(", ")}</div><div><b>Acceptance:</b><ul>${task.acceptanceCriteria.map((criterion) => `<li>${escapeHtml(criterion)}</li>`).join("")}</ul></div><div><b>SSOT:</b> ${task.ssot.length === 0 ? "None declared" : task.ssot.map(escapeHtml).join(", ")}</div>${task.provider === undefined ? "" : `<div><b>Provider:</b> ${escapeHtml(task.provider)}</div>`}${task.model === undefined ? "" : `<div><b>Model:</b> ${escapeHtml(task.model)}</div>`}</article>`
    )
    .join("");
  const mutationHtml = projectPlanDraftMutations(input.draft)
    .map(
      (mutation, index) =>
        `<li><span>${index + 1}. ${escapeHtml(mutation.kind)}</span><code>${escapeHtml(formatPlanMutation(mutation))}</code></li>`
    )
    .join("");
  const importTitle = capability.supported
    ? "Review and approve the exact Beads mutations."
    : capability.reason;

  return `<div class="planPreviewResult">${validationHtml}<section class="planDraftSummary"><h2>${escapeHtml(input.draft.goal)}</h2><div class="planDraftStats"><span>${input.draft.tasks.length} tasks</span><span>${graph.edges.length} dependencies</span></div>${criticalPathHtml}${parallelHtml}${modelTransitionHtml}${providerTransitionHtml}${graphHtml}<div class="planDraftTasks">${taskHtml}</div></section><details class="planMutationPreview" open><summary>Pending Beads mutations (${projectPlanDraftMutations(input.draft).length})</summary><ol>${mutationHtml}</ol></details>${capabilityHtml}<div class="planPreviewActions"><button id="cancelPlanDraft" type="button">Cancel</button><button id="importPlanDraft" type="button" title="${escapeHtml(importTitle)}"${capability.supported ? "" : " disabled"}>Import Plan</button></div></div>`;
}
