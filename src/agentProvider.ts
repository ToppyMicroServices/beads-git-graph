export const AGENT_PROVIDER_IDS = [
  "copilot",
  "ollama",
  "huggingface",
  "openai",
  "anthropic"
] as const;

export type AgentProviderId = (typeof AGENT_PROVIDER_IDS)[number];

export const AGENT_EXECUTION_OUTCOME_STATUSES = [
  "session-opened",
  "prompt-prepared",
  "response-opened",
  "response-stored",
  "edit-applied",
  "failed"
] as const;

export type AgentExecutionOutcomeStatus = (typeof AGENT_EXECUTION_OUTCOME_STATUSES)[number];

export interface AgentProviderDefinition {
  id: AgentProviderId;
  label: string;
  description: string;
  mode: "coding-session" | "text-response";
  credentialEnvironmentVariable?: "HF_TOKEN" | "OPENAI_API_KEY" | "ANTHROPIC_API_KEY";
}

export const AGENT_PROVIDERS: readonly AgentProviderDefinition[] = [
  {
    id: "copilot",
    label: "GitHub Copilot",
    description: "Open a coding-agent session in VS Code",
    mode: "coding-session"
  },
  {
    id: "ollama",
    label: "Ollama",
    description: "Edit one declared workspace artifact with a local Ollama model",
    mode: "text-response"
  },
  {
    id: "huggingface",
    label: "Hugging Face Inference",
    description: "Create one declared new artifact through Hugging Face Inference Providers",
    mode: "text-response",
    credentialEnvironmentVariable: "HF_TOKEN"
  },
  {
    id: "openai",
    label: "OpenAI API",
    description: "Create one declared new artifact with the OpenAI Responses API",
    mode: "text-response",
    credentialEnvironmentVariable: "OPENAI_API_KEY"
  },
  {
    id: "anthropic",
    label: "Anthropic API (Claude)",
    description: "Create one declared new artifact with the Anthropic Messages API",
    mode: "text-response",
    credentialEnvironmentVariable: "ANTHROPIC_API_KEY"
  }
];

export function normalizeAgentProviderId(value: unknown): AgentProviderId | null {
  if (typeof value !== "string") {
    return null;
  }
  if (value.includes("\r") || value.includes("\n") || value.includes("\u0000")) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return AGENT_PROVIDER_IDS.includes(normalized as AgentProviderId)
    ? (normalized as AgentProviderId)
    : null;
}

export function resolveAgentProviderId(value: unknown): AgentProviderId {
  return normalizeAgentProviderId(value) ?? "copilot";
}

export function getAgentProviderDefinition(provider: AgentProviderId) {
  return AGENT_PROVIDERS.find((candidate) => candidate.id === provider)!;
}
