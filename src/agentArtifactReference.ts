const AGENT_ARTIFACT_REFERENCE_PATTERN =
  /^beads-response:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function normalizeAgentArtifactReference(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const match = value.trim().match(AGENT_ARTIFACT_REFERENCE_PATTERN);
  return match === null ? null : `beads-response:${match[1].toLowerCase()}`;
}

export function getAgentArtifactRunId(value: unknown) {
  return normalizeAgentArtifactReference(value)?.slice("beads-response:".length) ?? null;
}
