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
  constructor(
    private readonly storageUri: vscode.Uri,
    private readonly retentionCount: () => number = () => 50
  ) {}

  private responseDirectory() {
    return vscode.Uri.joinPath(this.storageUri, "agent-responses");
  }

  private prepareArtifact(values: {
    issueId: string;
    title: string | undefined;
    response: AgentProviderResponse;
    verification?: {
      accepted: boolean;
      reason: string;
      evidence: readonly string[];
      attempts: number;
      confirmedModel: string;
      candidate?: string;
    };
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
      text: values.response.text,
      verification: values.verification
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
    verification?: {
      accepted: boolean;
      reason: string;
      evidence: readonly string[];
      attempts: number;
      confirmedModel: string;
      candidate?: string;
    };
  }): Promise<AgentResponseArtifact> {
    const prepared = this.prepareArtifact(values);
    await vscode.workspace.fs.createDirectory(prepared.directory);
    await vscode.workspace.fs.writeFile(
      prepared.artifact.uri,
      Buffer.from(prepared.content, "utf8")
    );
    await this.pruneBestEffort();
    return prepared.artifact;
  }

  public async writeOrOpenFallback(values: {
    issueId: string;
    title: string | undefined;
    response: AgentProviderResponse;
    verification?: {
      accepted: boolean;
      reason: string;
      evidence: readonly string[];
      attempts: number;
      confirmedModel: string;
      candidate?: string;
    };
  }): Promise<AgentArtifactCaptureResult> {
    const prepared = this.prepareArtifact(values);
    try {
      await vscode.workspace.fs.createDirectory(prepared.directory);
      await vscode.workspace.fs.writeFile(
        prepared.artifact.uri,
        Buffer.from(prepared.content, "utf8")
      );
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
    await this.pruneBestEffort();
    return { status: "stored", artifact: prepared.artifact };
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

  public async clearAll() {
    const directory = this.responseDirectory();
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(directory);
    } catch (error) {
      if ((error as { code?: unknown }).code === "FileNotFound") {
        return 0;
      }
      throw error;
    }
    const artifacts = entries.filter(([name]) => this.isArtifactFilename(name));
    await Promise.all(
      artifacts.map(([name]) =>
        vscode.workspace.fs.delete(vscode.Uri.joinPath(directory, name), {
          recursive: false,
          useTrash: false
        })
      )
    );
    return artifacts.length;
  }

  private isArtifactFilename(name: string) {
    return (
      name.toLowerCase().endsWith(".txt") &&
      getAgentArtifactRunId(`beads-response:${name.slice(0, -4)}`) !== null
    );
  }

  private async pruneBestEffort() {
    try {
      const directory = this.responseDirectory();
      const entries = (await vscode.workspace.fs.readDirectory(directory)).filter(([name]) =>
        this.isArtifactFilename(name)
      );
      const files = await Promise.all(
        entries.map(async ([name]) => {
          const uri = vscode.Uri.joinPath(directory, name);
          const stat = await vscode.workspace.fs.stat(uri);
          return { name, uri, modified: stat.mtime };
        })
      );
      const configuredRetention = Math.round(this.retentionCount());
      const keep = Number.isFinite(configuredRetention)
        ? Math.max(1, Math.min(500, configuredRetention))
        : 50;
      files.sort((a, b) => b.modified - a.modified || b.name.localeCompare(a.name));
      await Promise.all(
        files
          .slice(keep)
          .map(({ uri }) => vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false }))
      );
    } catch {
      // Artifact storage already succeeded; pruning must not discard or hide that result.
    }
  }
}
