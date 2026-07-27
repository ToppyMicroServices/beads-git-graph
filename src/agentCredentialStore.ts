import { type AgentProviderId, getAgentProviderDefinition } from "./agentProvider";

export type CredentialProviderId = Extract<AgentProviderId, "huggingface" | "openai" | "anthropic">;

export interface SecretStorageLike {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

const SECRET_KEYS: Record<CredentialProviderId, string> = {
  huggingface: "agent-provider.huggingface.token",
  openai: "agent-provider.openai.api-key",
  anthropic: "agent-provider.anthropic.api-key"
};

export interface AgentCredential {
  value: string;
  source: "secret-storage" | "environment";
}

function isCredentialProvider(provider: AgentProviderId): provider is CredentialProviderId {
  return provider === "huggingface" || provider === "openai" || provider === "anthropic";
}

export class AgentCredentialStore {
  constructor(
    private readonly secretStorage: SecretStorageLike,
    private readonly environment: Readonly<Record<string, string | undefined>> = process.env
  ) {}

  public async get(provider: AgentProviderId): Promise<AgentCredential | null> {
    if (!isCredentialProvider(provider)) {
      return null;
    }
    const stored = (await this.secretStorage.get(SECRET_KEYS[provider]))?.trim();
    if (stored) {
      return { value: stored, source: "secret-storage" };
    }

    const environmentVariable = getAgentProviderDefinition(provider).credentialEnvironmentVariable;
    const fromEnvironment =
      environmentVariable === undefined ? undefined : this.environment[environmentVariable]?.trim();
    return fromEnvironment ? { value: fromEnvironment, source: "environment" } : null;
  }

  public async store(provider: CredentialProviderId, value: string) {
    const normalized = value.trim();
    if (normalized === "") {
      throw new Error("Credential must not be empty.");
    }
    await this.secretStorage.store(SECRET_KEYS[provider], normalized);
  }

  public delete(provider: CredentialProviderId) {
    return this.secretStorage.delete(SECRET_KEYS[provider]);
  }

  public async hasStoredCredential(provider: CredentialProviderId) {
    return Boolean((await this.secretStorage.get(SECRET_KEYS[provider]))?.trim());
  }
}
