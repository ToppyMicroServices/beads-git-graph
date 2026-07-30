export const DEFAULT_AGENT_MODEL = "gpt-5-codex";
export const MAX_AGENT_MODEL_LENGTH = 100;

export function normalizeAgentModelName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (
    normalized === "" ||
    normalized.length > MAX_AGENT_MODEL_LENGTH ||
    normalized.includes("\r") ||
    normalized.includes("\n") ||
    normalized.includes("\u0000")
  ) {
    return null;
  }
  return normalized;
}

export function buildAgentModelOptions(
  taskModel: string | undefined,
  configuredModels: readonly string[]
) {
  const models = [taskModel, ...configuredModels, DEFAULT_AGENT_MODEL]
    .map(normalizeAgentModelName)
    .filter((model): model is string => model !== null);
  return [...new Set(models)];
}

export function applyAgentModelOverride<T extends { model?: string }>(
  items: readonly T[],
  overrideModel: string | null
): T[] {
  const normalizedOverride = normalizeAgentModelName(overrideModel);
  return items.map((item) =>
    normalizedOverride === null ? { ...item } : { ...item, model: normalizedOverride }
  );
}
