import { type TextResponseProviderId } from "./agentProviderClient";

function metadataValue(value: string, maxLength: number) {
  return value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function formatAgentResponseArtifact(values: {
  runId: string;
  issueId: string;
  title: string | undefined;
  provider: TextResponseProviderId;
  requestedModel: string;
  confirmedModel: string;
  text: string;
}) {
  return [
    "Beads Git Graph AI response artifact",
    "UNTRUSTED MODEL OUTPUT: review before using; this file is never executed automatically.",
    "",
    `Run ID: ${values.runId}`,
    `Task: ${metadataValue(values.issueId, 200)}${
      values.title?.trim() ? ` — ${metadataValue(values.title, 500)}` : ""
    }`,
    `Provider: ${values.provider}`,
    `Requested model: ${metadataValue(values.requestedModel, 100)}`,
    `Confirmed model: ${metadataValue(values.confirmedModel, 200)}`,
    "",
    "--- BEGIN GENERATED RESPONSE ---",
    values.text,
    "--- END GENERATED RESPONSE ---",
    ""
  ].join("\n");
}
