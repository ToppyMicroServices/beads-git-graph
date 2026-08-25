import { describe, expect, it } from "vitest";

import { AgentCredentialStore, type SecretStorageLike } from "../src/agentCredentialStore";
import {
  AGENT_EXECUTION_OUTCOME_STATUSES,
  AGENT_PROVIDERS,
  normalizeAgentProviderId,
  resolveAgentProviderId
} from "../src/agentProvider";

class FakeSecretStorage implements SecretStorageLike {
  public readonly values = new Map<string, string>();

  get(key: string) {
    return Promise.resolve(this.values.get(key));
  }

  store(key: string, value: string) {
    this.values.set(key, value);
    return Promise.resolve();
  }

  delete(key: string) {
    this.values.delete(key);
    return Promise.resolve();
  }
}

describe("agent providers", () => {
  it("accepts only known provider identifiers and defaults legacy tasks to Copilot", () => {
    expect(AGENT_PROVIDERS.map((provider) => provider.id)).toEqual([
      "copilot",
      "ollama",
      "huggingface",
      "openai",
      "anthropic"
    ]);
    expect(AGENT_EXECUTION_OUTCOME_STATUSES).toEqual([
      "session-opened",
      "prompt-prepared",
      "response-opened",
      "response-stored",
      "edit-applied",
      "failed"
    ]);
    expect(normalizeAgentProviderId(" OpenAI ")).toBe("openai");
    expect(normalizeAgentProviderId("openai\n")).toBeNull();
    expect(normalizeAgentProviderId("openai\nanthropic")).toBeNull();
    expect(normalizeAgentProviderId("custom")).toBeNull();
    expect(resolveAgentProviderId(undefined)).toBe("copilot");
  });

  it("keeps credentials in secret storage with an environment fallback", async () => {
    const secrets = new FakeSecretStorage();
    const store = new AgentCredentialStore(secrets, {
      OPENAI_API_KEY: " environment-key ",
      HF_TOKEN: "",
      ANTHROPIC_API_KEY: undefined
    });

    expect(await store.get("openai")).toEqual({
      value: "environment-key",
      source: "environment"
    });
    await store.store("openai", " stored-key ");
    expect(await store.get("openai")).toEqual({
      value: "stored-key",
      source: "secret-storage"
    });
    expect(await store.hasStoredCredential("openai")).toBe(true);
    await store.delete("openai");
    expect(await store.get("openai")).toEqual({
      value: "environment-key",
      source: "environment"
    });
    expect(await store.get("ollama")).toBeNull();
  });
});
