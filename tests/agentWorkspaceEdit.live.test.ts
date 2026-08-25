import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { expect, it } from "vitest";

import { requestAgentProviderResponse } from "../src/agentProviderClient";
import { applyAgentWorkspaceEdit, generateVerifiedAgentEdit } from "../src/agentWorkspaceEdit";

const model = process.env.BEADS_AGENT_LIVE_OLLAMA_MODEL?.trim();
const liveIt = model ? it : it.skip;

liveIt(
  "creates two verified dependency-linked artifacts with a local sub-1B Ollama model",
  async () => {
    const workspace = await fs.promises.mkdtemp(path.join(os.tmpdir(), "beads-agent-live-"));
    try {
      const request = (prompt: string, phase: "generation" | "verification") =>
        requestAgentProviderResponse({
          provider: "ollama",
          model: model!,
          prompt,
          ollamaBaseUrl: "http://127.0.0.1:11434",
          maxOutputTokens: 512,
          timeoutMs: 180_000,
          jsonMode: phase === "verification",
          temperature: 0
        });
      const task = {
        issueId: "live-ollama-1",
        title: "Create a greeting module",
        description: "Create one dependency-free JavaScript ES module.",
        acceptanceCriteria:
          "The file exports a function named greeting(name) and that function returns the template literal `Hello, $" +
          "{name}!`.",
        outputPath: "src/greeting.js"
      };
      const result = await generateVerifiedAgentEdit({
        task,
        provider: "ollama",
        model: model!,
        ssot: "README.md",
        dependencyIds: [],
        currentContent: null,
        upstreamArtifacts: [],
        request
      });

      expect(result.status, JSON.stringify(result, null, 2)).toBe("verified");
      if (result.status !== "verified") {
        return;
      }
      const applied = await applyAgentWorkspaceEdit(workspace, task.outputPath, result.content);
      const content = await fs.promises.readFile(applied.absolutePath, "utf8");
      expect(content).toMatch(/export (?:default )?function greeting\(name\)/);
      expect(content).toContain("Hello, $" + "{name}!");

      const downstreamTask = {
        issueId: "live-ollama-2",
        title: "Document the greeting module",
        description: "Create a short Markdown handoff based on the upstream JavaScript module.",
        acceptanceCriteria:
          "The file starts with '# Greeting module', contains '@param {string} name', and contains '@returns {string}'.",
        outputPath: "docs/greeting.md"
      };
      const downstream = await generateVerifiedAgentEdit({
        task: downstreamTask,
        provider: "ollama",
        model: model!,
        ssot: "README.md",
        dependencyIds: [task.issueId],
        currentContent: null,
        upstreamArtifacts: [{ issueId: task.issueId, outputPath: task.outputPath, content }],
        request
      });
      expect(downstream.status, JSON.stringify(downstream, null, 2)).toBe("verified");
      if (downstream.status !== "verified") {
        return;
      }
      const downstreamApplied = await applyAgentWorkspaceEdit(
        workspace,
        downstreamTask.outputPath,
        downstream.content
      );
      const testContent = await fs.promises.readFile(downstreamApplied.absolutePath, "utf8");
      expect(testContent.startsWith("# Greeting module\n")).toBe(true);
      expect(testContent).toContain("@param {string} name");
      expect(testContent).toContain("@returns {string}");
    } finally {
      await fs.promises.rm(workspace, { recursive: true, force: true });
    }
  },
  300_000
);
