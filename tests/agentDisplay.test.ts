import { describe, expect, it } from "vitest";

import {
  anonymizeAgentIdentity,
  buildAgentAliasMap,
  isEmailLikeIdentity
} from "../src/agentDisplay";

describe("agent display aliases", () => {
  it("detects email-like identities", () => {
    expect(isEmailLikeIdentity("develop@toppymicros.com")).toBe(true);
    expect(isEmailLikeIdentity("gpt-5-codex")).toBe(false);
  });

  it("assigns deterministic agent aliases only to email-like values", () => {
    const aliases = buildAgentAliasMap([
      "okutomi@pm.me",
      "gpt-5-codex",
      "develop@toppymicros.com",
      "okutomi@pm.me"
    ]);

    expect(aliases.get("develop@toppymicros.com")).toBe("agent#01");
    expect(aliases.get("okutomi@pm.me")).toBe("agent#02");
    expect(aliases.has("gpt-5-codex")).toBe(false);
    expect(anonymizeAgentIdentity("gpt-5-codex", aliases)).toBe("gpt-5-codex");
    expect(anonymizeAgentIdentity("okutomi@pm.me", aliases)).toBe("agent#02");
  });
});
