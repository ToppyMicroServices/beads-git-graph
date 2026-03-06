import { describe, expect, it } from "vitest";

import {
  CANONICAL_TYPES,
  classifyCommitSubject,
  COMMIT_TYPE_ALIASES,
  normalizeCommitSubject,
  toCanonicalCommitType
} from "../src/commitTypes";

// ---------------------------------------------------------------------------
// normalizeCommitSubject
// ---------------------------------------------------------------------------
describe("normalizeCommitSubject", () => {
  it("trims whitespace", () => {
    expect(normalizeCommitSubject("  feat: hello  ")).toBe("feat: hello");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeCommitSubject("feat:  lots   of  spaces")).toBe("feat: lots of spaces");
  });

  it("replaces full-width colons and parens", () => {
    expect(normalizeCommitSubject("feat（scope）： description")).toBe("feat(scope): description");
  });

  it("strips fixup! prefix", () => {
    expect(normalizeCommitSubject("fixup! feat: real message")).toBe("feat: real message");
  });

  it("strips squash! prefix", () => {
    expect(normalizeCommitSubject("squash! fix: something")).toBe("fix: something");
  });

  it("strips WIP: prefix (case-insensitive)", () => {
    expect(normalizeCommitSubject("WIP: chore: wip stuff")).toBe("chore: wip stuff");
    expect(normalizeCommitSubject("wip: chore: wip stuff")).toBe("chore: wip stuff");
  });

  it("strips leading bracketed scope like [JIRA-123]", () => {
    expect(normalizeCommitSubject("[JIRA-123] feat: something")).toBe("feat: something");
  });

  it("strips leading parenthesized scope like (scope)", () => {
    expect(normalizeCommitSubject("(core) fix: issue")).toBe("fix: issue");
  });

  it("strips leading non-alphanumeric chars", () => {
    expect(normalizeCommitSubject("-- fix: thing")).toBe("fix: thing");
    expect(normalizeCommitSubject("## docs: readme")).toBe("docs: readme");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeCommitSubject("")).toBe("");
    expect(normalizeCommitSubject("   ")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// toCanonicalCommitType
// ---------------------------------------------------------------------------
describe("toCanonicalCommitType", () => {
  it("maps exact canonical types", () => {
    expect(toCanonicalCommitType("feat")).toBe("feat");
    expect(toCanonicalCommitType("fix")).toBe("fix");
    expect(toCanonicalCommitType("docs")).toBe("docs");
    expect(toCanonicalCommitType("chore")).toBe("chore");
    expect(toCanonicalCommitType("refactor")).toBe("refactor");
    expect(toCanonicalCommitType("perf")).toBe("perf");
    expect(toCanonicalCommitType("test")).toBe("test");
    expect(toCanonicalCommitType("build")).toBe("build");
    expect(toCanonicalCommitType("ci")).toBe("ci");
    expect(toCanonicalCommitType("style")).toBe("style");
    expect(toCanonicalCommitType("revert")).toBe("revert");
  });

  it("maps common aliases to canonical types", () => {
    expect(toCanonicalCommitType("feature")).toBe("feat");
    expect(toCanonicalCommitType("add")).toBe("feat");
    expect(toCanonicalCommitType("new")).toBe("feat");
    expect(toCanonicalCommitType("bugfix")).toBe("fix");
    expect(toCanonicalCommitType("hotfix")).toBe("fix");
    expect(toCanonicalCommitType("doc")).toBe("docs");
    expect(toCanonicalCommitType("documentation")).toBe("docs");
    expect(toCanonicalCommitType("readme")).toBe("docs");
    expect(toCanonicalCommitType("maintenance")).toBe("chore");
    expect(toCanonicalCommitType("deps")).toBe("chore");
    expect(toCanonicalCommitType("bump")).toBe("chore");
    expect(toCanonicalCommitType("update")).toBe("chore");
    expect(toCanonicalCommitType("cleanup")).toBe("refactor");
    expect(toCanonicalCommitType("tidy")).toBe("refactor");
    expect(toCanonicalCommitType("performance")).toBe("perf");
    expect(toCanonicalCommitType("tests")).toBe("test");
    expect(toCanonicalCommitType("testing")).toBe("test");
    expect(toCanonicalCommitType("github-actions")).toBe("ci");
    expect(toCanonicalCommitType("pipeline")).toBe("ci");
  });

  it("is case-insensitive", () => {
    expect(toCanonicalCommitType("FEAT")).toBe("feat");
    expect(toCanonicalCommitType("Fix")).toBe("fix");
    expect(toCanonicalCommitType("DOCS")).toBe("docs");
    expect(toCanonicalCommitType("BugFix")).toBe("fix");
  });

  it("handles slash-prefixed types (takes first segment)", () => {
    expect(toCanonicalCommitType("feat/something")).toBe("feat");
    expect(toCanonicalCommitType("ci/deploy")).toBe("ci");
  });

  it("returns null for unknown types", () => {
    expect(toCanonicalCommitType("unknown")).toBeNull();
    expect(toCanonicalCommitType("misc")).toBeNull();
    expect(toCanonicalCommitType("wip")).toBeNull();
    expect(toCanonicalCommitType("release")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifyCommitSubject — Conventional Commit format
// ---------------------------------------------------------------------------
describe("classifyCommitSubject — conventional commits", () => {
  it("parses standard conventional commit", () => {
    expect(classifyCommitSubject("feat: add login page")).toBe("feat");
    expect(classifyCommitSubject("fix: resolve crash on startup")).toBe("fix");
    expect(classifyCommitSubject("docs: update README")).toBe("docs");
    expect(classifyCommitSubject("chore: bump deps")).toBe("chore");
    expect(classifyCommitSubject("refactor: simplify logic")).toBe("refactor");
  });

  it("parses conventional commit with scope", () => {
    expect(classifyCommitSubject("feat(auth): add OAuth support")).toBe("feat");
    expect(classifyCommitSubject("fix(ui): button alignment")).toBe("fix");
    expect(classifyCommitSubject("docs(api): endpoint reference")).toBe("docs");
  });

  it("parses breaking change indicator", () => {
    expect(classifyCommitSubject("feat!: breaking API change")).toBe("feat");
    expect(classifyCommitSubject("fix(core)!: drop legacy support")).toBe("fix");
  });

  it("handles aliases in conventional format", () => {
    expect(classifyCommitSubject("feature: new dashboard")).toBe("feat");
    expect(classifyCommitSubject("bugfix: null pointer")).toBe("fix");
    expect(classifyCommitSubject("hotfix: urgent fix")).toBe("fix");
    expect(classifyCommitSubject("maintenance: cleanup old code")).toBe("chore");
  });
});

// ---------------------------------------------------------------------------
// classifyCommitSubject — Bracket tag format
// ---------------------------------------------------------------------------
describe("classifyCommitSubject — bracket tags", () => {
  it("parses [type] style", () => {
    expect(classifyCommitSubject("[feat] add new widget")).toBe("feat");
    expect(classifyCommitSubject("[fix] resolve race condition")).toBe("fix");
    expect(classifyCommitSubject("[docs] update changelog")).toBe("docs");
  });

  it("handles aliases in bracket format", () => {
    expect(classifyCommitSubject("[bugfix] stop the crash")).toBe("fix");
    expect(classifyCommitSubject("[feature] new page")).toBe("feat");
  });

  it("returns null for unknown bracket types", () => {
    expect(classifyCommitSubject("[release] v1.0.0")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifyCommitSubject — Keyword-colon/dash format
// ---------------------------------------------------------------------------
describe("classifyCommitSubject — keyword style", () => {
  it("parses keyword - description style", () => {
    expect(classifyCommitSubject("feat - add something")).toBe("feat");
    expect(classifyCommitSubject("fix - resolve issue")).toBe("fix");
  });

  it("parses keyword: description style (non-conventional)", () => {
    // This should also work via keyword regex if not matched by CC regex
    // Actually CC regex matches this too, so test is the same
    expect(classifyCommitSubject("build: compile assets")).toBe("build");
  });
});

// ---------------------------------------------------------------------------
// classifyCommitSubject — Edge cases and unrecognized subjects
// ---------------------------------------------------------------------------
describe("classifyCommitSubject — edge cases", () => {
  it("returns null for empty string", () => {
    expect(classifyCommitSubject("")).toBeNull();
    expect(classifyCommitSubject("   ")).toBeNull();
  });

  it("returns null for plain message without type keyword", () => {
    expect(classifyCommitSubject("Updated the README file")).toBeNull();
    expect(classifyCommitSubject("Initial commit")).toBeNull();
    expect(classifyCommitSubject("WIP")).toBeNull();
  });

  it("handles fixup! prefix and still classifies", () => {
    expect(classifyCommitSubject("fixup! feat: the real message")).toBe("feat");
    expect(classifyCommitSubject("squash! fix(ui): button crash")).toBe("fix");
  });

  it("handles full-width punctuation", () => {
    expect(classifyCommitSubject("feat（scope）： add feature")).toBe("feat");
  });

  it("handles leading bracketed ticket then conventional commit", () => {
    expect(classifyCommitSubject("[PROJ-42] feat: implement feature")).toBe("feat");
    expect(classifyCommitSubject("(v2) fix: something broken")).toBe("fix");
  });

  it("returns null for Merge commits", () => {
    expect(classifyCommitSubject("Merge branch 'main' into dev")).toBeNull();
    expect(classifyCommitSubject("Merge pull request #42 from user/branch")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// COMMIT_TYPE_ALIASES and CANONICAL_TYPES consistency
// ---------------------------------------------------------------------------
describe("COMMIT_TYPE_ALIASES / CANONICAL_TYPES consistency", () => {
  it("CANONICAL_TYPES matches COMMIT_TYPE_ALIASES keys", () => {
    expect(CANONICAL_TYPES).toEqual(Object.keys(COMMIT_TYPE_ALIASES));
  });

  it("every canonical type is in its own alias list", () => {
    for (const type of CANONICAL_TYPES) {
      expect(COMMIT_TYPE_ALIASES[type]).toContain(type);
    }
  });

  it("no alias appears in more than one canonical type", () => {
    const seen = new Map<string, string>();
    for (const canonical of CANONICAL_TYPES) {
      for (const alias of COMMIT_TYPE_ALIASES[canonical]) {
        expect(seen.has(alias)).toBe(false);
        seen.set(alias, canonical);
      }
    }
  });
});
