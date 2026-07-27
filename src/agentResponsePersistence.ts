export type AgentResponseArtifactOpenStatus = "response-opened" | "response-stored";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The Beads update could not be completed.";
}

export async function persistGeneratedAgentResponse<TArtifact>(values: {
  createArtifact: () => Promise<TArtifact>;
  updateBead: (artifact: TArtifact) => Promise<void>;
  flushBeads: () => Promise<void>;
  openArtifact: (artifact: TArtifact) => Promise<AgentResponseArtifactOpenStatus>;
}) {
  const artifact = await values.createArtifact();
  let beadUpdated = false;
  try {
    await values.updateBead(artifact);
    beadUpdated = true;
    await values.flushBeads();
  } catch (error) {
    const artifactOpenResult = await values.openArtifact(artifact);
    const artifactDetail =
      artifactOpenResult === "response-opened"
        ? "The response artifact was preserved and opened for review."
        : "The response artifact was preserved in extension storage but could not be opened.";
    const mutationDetail = beadUpdated
      ? "The Beads update completed, but its flush failed."
      : "No Beads update completed.";
    throw new Error(`${mutationDetail} ${artifactDetail} ${errorMessage(error)}`);
  }
  return values.openArtifact(artifact);
}
