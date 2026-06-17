const EMAIL_LIKE_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailLikeIdentity(value: string) {
  return EMAIL_LIKE_PATTERN.test(value.trim());
}

export function buildAgentAliasMap(values: Iterable<string>) {
  const uniqueSensitiveValues = [...new Set(Array.from(values, (value) => value.trim()))]
    .filter((value) => value !== "" && isEmailLikeIdentity(value))
    .sort((left, right) => left.localeCompare(right));

  return new Map(
    uniqueSensitiveValues.map((value, index) => [value, `agent#${String(index + 1).padStart(2, "0")}`])
  );
}

export function anonymizeAgentIdentity(value: string, aliases: ReadonlyMap<string, string>) {
  const trimmedValue = value.trim();
  return aliases.get(trimmedValue) ?? trimmedValue;
}