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
  verification?: {
    accepted: boolean;
    reason: string;
    evidence: readonly string[];
    attempts: number;
    confirmedModel: string;
    candidate?: string;
  };
}) {
  return [
    "Beads Git Graph AI response artifact",
    "UNTRUSTED MODEL OUTPUT: never execute this text as commands.",
    "",
    `Run ID: ${values.runId}`,
    `Task: ${metadataValue(values.issueId, 200)}${
      values.title?.trim() ? ` — ${metadataValue(values.title, 500)}` : ""
    }`,
    `Provider: ${values.provider}`,
    `Requested model: ${metadataValue(values.requestedModel, 100)}`,
    `Confirmed model: ${metadataValue(values.confirmedModel, 200)}`,
    ...(values.verification === undefined
      ? []
      : [
          `Model content check: ${values.verification.accepted ? "passed" : "failed"} (not human approval; no commands or tests were run)`,
          `Content-check model: ${metadataValue(values.verification.confirmedModel, 200)}`,
          `Generation attempts: ${Math.max(1, Math.round(values.verification.attempts))}`,
          `Content-check reason: ${metadataValue(values.verification.reason, 1_000)}`,
          ...values.verification.evidence
            .slice(0, 20)
            .map((evidence) => `Content-check evidence: ${metadataValue(evidence, 500)}`),
          ...(values.verification.candidate === undefined
            ? []
            : [
                "",
                "--- BEGIN PROPOSED FILE CONTENT ---",
                values.verification.candidate,
                "--- END PROPOSED FILE CONTENT ---"
              ])
        ]),
    "",
    "--- BEGIN RAW PROVIDER RESPONSE ---",
    values.text,
    "--- END RAW PROVIDER RESPONSE ---",
    ""
  ].join("\n");
}
