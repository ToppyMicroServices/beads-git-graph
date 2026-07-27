import { randomUUID } from "node:crypto";

import * as vscode from "vscode";

import { formatAgentResponseArtifact } from "./agentArtifactFormat";
import { getAgentArtifactRunId } from "./agentArtifactReference";
import { type AgentProviderResponse } from "./agentProviderClient";

export interface AgentResponseArtifact {
  runId: string;
  reference: string;
  uri: vscode.Uri;
}

export type AgentArtifactCaptureResult =
  | { status: "stored"; artifact: AgentResponseArtifact }
  | { status: "opened-unsaved"; storageError: string };

export type AgentArtifactOpenResult =
  | { status: "opened" }
  | { status: "invalid-reference" }
  | { status: "could-not-open" };

export class AgentArtifactStore {
  constructor(private readonly storageUri: vscode.Uri) {}

  private responseDirectory() {
    return vscode.Uri.joinPath(this.storageUri, "agent-responses");
  }

  private prepareArtifact(values: {
    issueId: string;
    title: string | undefined;
    response: AgentProviderResponse;
  }) {
    const runId = randomUUID();
    const directory = this.responseDirectory();
    const uri = vscode.Uri.joinPath(directory, `${runId}.txt`);
    const content = formatAgentResponseArtifact({
      runId,
      issueId: values.issueId,
      title: values.title,
      provider: values.response.provider,
      requestedModel: values.response.requestedModel,
      confirmedModel: values.response.confirmedModel,
      text: values.response.text
    });
    return {
      artifact: { runId, reference: `beads-response:${runId}`, uri },
      content,
      directory
    };
  }

  public async write(values: {
    issueId: string;
    title: string | undefined;
    response: AgentProviderResponse;
  }): Promise<AgentResponseArtifact> {
    const prepared = this.prepareArtifact(values);
    await vscode.workspace.fs.createDirectory(prepared.directory);
    await vscode.workspace.fs.writeFile(
      prepared.artifact.uri,
      Buffer.from(prepared.content, "utf8")
    );
    return prepared.artifact;
  }

  public async writeOrOpenFallback(values: {
    issueId: string;
    title: string | undefined;
    response: AgentProviderResponse;
  }): Promise<AgentArtifactCaptureResult> {
    const prepared = this.prepareArtifact(values);
    try {
      await vscode.workspace.fs.createDirectory(prepared.directory);
      await vscode.workspace.fs.writeFile(
        prepared.artifact.uri,
        Buffer.from(prepared.content, "utf8")
      );
      return { status: "stored", artifact: prepared.artifact };
    } catch (error) {
      const document = await vscode.workspace.openTextDocument({
        content: prepared.content,
        language: "plaintext"
      });
      await vscode.window.showTextDocument(document, { preview: false });
      return {
        status: "opened-unsaved",
        storageError: error instanceof Error ? error.message : "extension storage write failed"
      };
    }
  }

  public async open(artifact: AgentResponseArtifact) {
    const document = await vscode.workspace.openTextDocument(artifact.uri);
    await vscode.window.showTextDocument(document, { preview: true });
  }

  public async openRecordedUri(value: string): Promise<AgentArtifactOpenResult> {
    const runId = getAgentArtifactRunId(value);
    if (runId === null) {
      return { status: "invalid-reference" };
    }
    const uri = vscode.Uri.joinPath(this.responseDirectory(), `${runId}.txt`);
    try {
      await this.open({ runId, reference: `beads-response:${runId}`, uri });
      return { status: "opened" };
    } catch {
      return { status: "could-not-open" };
    }
  }
}
