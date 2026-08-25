export interface AgentOutputPathDeclaration {
  issueId: string;
  outputPath: string;
}

export function findConflictingAgentOutputPathIssueIds(
  declarations: readonly AgentOutputPathDeclaration[]
) {
  const issueIdsByPath = new Map<string, string[]>();
  for (const declaration of declarations) {
    const normalized = normalizeAgentOutputPath(declaration.outputPath);
    if (normalized === null) {
      continue;
    }
    const key = normalized.toLowerCase();
    issueIdsByPath.set(key, [...(issueIdsByPath.get(key) ?? []), declaration.issueId]);
  }
  return new Set(
    [...issueIdsByPath.values()]
      .filter((issueIds) => issueIds.length > 1)
      .flatMap((issueIds) => issueIds)
  );
}

export function normalizeAgentOutputPath(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\\/g, "/");
  if (
    normalized === "" ||
    normalized.length > 512 ||
    normalized.includes("\u0000") ||
    /[\r\n]/.test(normalized) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized) ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return null;
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const first = lowerSegments[0];
  const reservedWindowsNames = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  const hasUnsafeCrossPlatformSegment = segments.some(
    (segment) =>
      segment.endsWith(".") ||
      segment.endsWith(" ") ||
      reservedWindowsNames.test(segment) ||
      [...segment].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127 || '<>:"|?*'.includes(character);
      })
  );
  if (
    hasUnsafeCrossPlatformSegment ||
    [".git", ".beads", ".vscode", ".codex", ".agents", ".github"].includes(first) ||
    lowerSegments.some(
      (segment) => segment === ".env" || segment.startsWith(".env.") || segment === "agents.md"
    )
  ) {
    return null;
  }
  return segments.join("/");
}
