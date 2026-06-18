import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");

describe("ssot-usage manifest", () => {
  it("declares default agent context refs as JSON", () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, "ssot-usage.json"), "utf8")) as Record<
      string,
      unknown
    >;

    expect(manifest).toMatchObject({
      version: 1
    });
    expect(manifest.default).toEqual(
      expect.arrayContaining([
        "bd:$" + "{issueId}",
        "AGENTS.md",
        ".beads/issues.jsonl",
        "README.md"
      ])
    );
    expect(manifest.contexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "agent-rules",
          path: "AGENTS.md"
        }),
        expect.objectContaining({
          id: "beads-state",
          path: ".beads/issues.jsonl"
        })
      ])
    );
  });
});
