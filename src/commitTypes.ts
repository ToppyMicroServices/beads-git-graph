/**
 * Shared commit type classification logic.
 * Used by both the extension backend (dataSource) and the webview frontend.
 */

/** Canonical commit type alias map */
export const COMMIT_TYPE_ALIASES: { [canonicalType: string]: string[] } = {
  feat: ["feat", "feature", "features", "add", "added", "new"],
  fix: ["fix", "bugfix", "hotfix", "fixed", "bug"],
  docs: ["docs", "doc", "documentation", "readme"],
  chore: ["chore", "maintenance", "maint", "deps", "dep", "bump", "update"],
  refactor: ["refactor", "refactoring", "cleanup", "tidy"],
  perf: ["perf", "performance"],
  test: ["test", "tests", "testing"],
  build: ["build"],
  ci: ["ci", "github-actions", "actions", "pipeline"],
  style: ["style"],
  revert: ["revert"]
};

/** All canonical commit types */
export const CANONICAL_TYPES = Object.keys(COMMIT_TYPE_ALIASES);

/**
 * Normalize a commit subject line for classification.
 * Strips full-width punctuation, fixup/squash/WIP prefixes,
 * bracketed scopes, and leading non-alphanumeric chars.
 */
export function normalizeCommitSubject(subject: string): string {
  let normalized = subject
    .replace(/：/g, ":")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .trim()
    .replace(/\s+/g, " ");

  normalized = normalized.replace(/^(fixup!|squash!|WIP:)\s*/i, "");
  normalized = normalized.replace(/^(\[[^\]]+\]|\([^\)]+\))\s*/g, "");
  normalized = normalized.replace(/^[^A-Za-z0-9\[]+/, "").trim();

  return normalized;
}

/**
 * Map a raw type string to its canonical commit type.
 * Returns null if no known alias matches.
 */
export function toCanonicalCommitType(rawType: string): string | null {
  let type = rawType.toLowerCase().replace(/[^a-z0-9_\/-]/g, "");
  if (type.indexOf("/") > -1) {
    type = type.split("/")[0];
  }

  for (let i = 0; i < CANONICAL_TYPES.length; i++) {
    const canonicalType = CANONICAL_TYPES[i];
    if (COMMIT_TYPE_ALIASES[canonicalType].indexOf(type) > -1) {
      return canonicalType;
    }
  }
  return null;
}

/**
 * Classify a commit subject line into a canonical commit type.
 * Tries conventional commit format, bracket tags, and keyword-colon styles.
 * Returns null if the subject doesn't match any known type.
 */
export function classifyCommitSubject(subject: string): string | null {
  // Light pre-normalization: trim, collapse spaces, strip fixup/squash/WIP
  let lightly = subject
    .replace(/：/g, ":")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(fixup!|squash!|WIP:)\s*/i, "");

  if (lightly === "") return null;

  let rawType: string | null = null;

  // Bracket tag first (before normalizeCommitSubject strips brackets):
  // [type] description
  const bracketTagMatch = lightly.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (bracketTagMatch !== null) {
    const candidate = toCanonicalCommitType(bracketTagMatch[1]);
    if (candidate !== null) return candidate;
    // Not a known type tag — fall through to full normalization
  }

  const normalized = normalizeCommitSubject(subject);
  if (normalized === "") return null;

  // Conventional commit: type(scope)!: description
  const ccMatch = normalized.match(/^([a-zA-Z]+)(\(([^)]+)\))?(!)?:\s*(.+)$/);
  if (ccMatch !== null) {
    rawType = ccMatch[1];
  } else {
    // Keyword style: type - description  or  type: description
    const keywordMatch = normalized.match(
      /^([a-zA-Z][a-zA-Z0-9_\/-]*)\s*(?:-|:)\s*(.+)$/
    );
    if (keywordMatch !== null) {
      rawType = keywordMatch[1];
    }
  }

  if (rawType === null) return null;
  return toCanonicalCommitType(rawType);
}
