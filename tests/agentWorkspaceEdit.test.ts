import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { type AgentProviderResponse } from "../src/agentProviderClient";
import {
  applyAgentWorkspaceEdit,
  buildAutonomousEditPrompt,
  candidateQualityProblem,
  copiedUpstreamArtifactProblem,
  findConflictingAgentOutputPathIssueIds,
  generateVerifiedAgentEdit,
  normalizeAgentCandidate,
  normalizeAgentOutputPath,
  parseAcceptanceVerification,
  parseAgentTaskExecutionSpec,
  readAgentWorkspaceTarget,
  selectProviderWorkspaceContext
} from "../src/agentWorkspaceEdit";

const temporaryDirectories: string[] = [];

async function temporaryWorkspace() {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "beads-agent-edit-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.promises.rm(directory, { recursive: true, force: true }))
  );
});

function response(text: string): AgentProviderResponse {
  return {
    provider: "ollama",
    requestedModel: "small-model",
    confirmedModel: "small-model",
    text
  };
}

const task = {
  issueId: "task-1",
  title: "Write the report",
  description: "Record the safe workflow.",
  acceptanceCriteria: "The report contains three numbered recommendations.",
  outputPath: "outputs/report.md"
};

describe("autonomous workspace edit contract", () => {
  it("parses a relative artifact path and observable acceptance criteria from bd show", () => {
    expect(
      parseAgentTaskExecutionSpec(
        [
          {
            id: "task-1",
            title: "Write the report",
            description: "Record the safe workflow.",
            acceptance_criteria: "Three recommendations are present.",
            metadata: { artifact: "outputs/report.md" }
          }
        ],
        "task-1"
      )
    ).toEqual({
      issueId: "task-1",
      title: "Write the report",
      description: "Record the safe workflow.",
      acceptanceCriteria: "Three recommendations are present.",
      outputPath: "outputs/report.md"
    });
  });

  it("uses imported task instructions when the Beads description is empty", () => {
    expect(
      parseAgentTaskExecutionSpec(
        {
          id: "task-1",
          title: "Write the report",
          description: "",
          acceptance_criteria: "Three recommendations are present.",
          metadata: JSON.stringify({
            task_instructions:
              "Use the supplied evidence and write three numbered recommendations.",
            output_path: "outputs/report.md"
          })
        },
        "task-1"
      )
    ).toMatchObject({
      description: "Use the supplied evidence and write three numbered recommendations."
    });
  });

  it("includes the declared SSOT string without claiming its files are attached", () => {
    const prompt = buildAutonomousEditPrompt({
      task,
      provider: "ollama",
      model: "small-model",
      ssot: "AGENTS.md, docs/decision.md",
      dependencyIds: [],
      currentContent: null,
      upstreamArtifacts: []
    });

    expect(prompt).toContain('Declared SSOT reference string: "AGENTS.md, docs/decision.md"');
    expect(prompt).toContain("Referenced file contents are not automatically attached");
  });

  it.each([
    "../outside.md",
    "/tmp/outside.md",
    "file:///tmp/outside.md",
    ".git/config",
    ".beads/issues.jsonl",
    ".github/workflows/release.yml",
    ".github/ISSUE_TEMPLATE/bug.md",
    ".env",
    "docs/AGENTS.md",
    "bad:name.md",
    "NUL.txt",
    "trailing-dot./file.md",
    "AGENTS.md"
  ])("rejects protected or escaping output path %s", (value) => {
    expect(normalizeAgentOutputPath(value)).toBeNull();
  });

  it("identifies every task in a case-insensitive output-path collision", () => {
    expect(
      findConflictingAgentOutputPathIssueIds([
        { issueId: "task-a", outputPath: "outputs/shared.md" },
        { issueId: "task-b", outputPath: "Outputs/Shared.md" },
        { issueId: "task-c", outputPath: "outputs/distinct.md" }
      ])
    ).toEqual(new Set(["task-a", "task-b"]));
  });

  it("removes one provider-added outer code fence", () => {
    expect(normalizeAgentCandidate("```markdown\n# Report\n```")).toBe("# Report\n");
    expect(normalizeAgentCandidate("# Report")).toBe("# Report\n");
  });

  it("detects refusal text before verification", () => {
    expect(candidateQualityProblem("I can't assist with that task.")).toContain("refused");
    expect(candidateQualityProblem("# Report\n\n1. First\n2. Second\n3. Third\n")).toBeNull();
  });

  it("accepts only a structured model content-check verdict", () => {
    expect(
      parseAcceptanceVerification(
        '```json\n{"accepted":true,"reason":"All three are present","evidence":["1, 2, 3"]}\n```'
      )
    ).toEqual({
      accepted: true,
      reason: "All three are present",
      evidence: ["1, 2, 3"]
    });
    expect(parseAcceptanceVerification("looks good")).toBeNull();
    expect(
      parseAcceptanceVerification('{"accepted":true,"reason":"Looks good","evidence":[]}')
    ).toBeNull();
  });

  it("keeps workspace contents local to Ollama", async () => {
    const loadUpstreamArtifacts = vi.fn(async () => [
      { issueId: "upstream", outputPath: "outputs/upstream.md", content: "private" }
    ]);
    await expect(
      selectProviderWorkspaceContext({
        provider: "openai",
        outputPath: "outputs/report.md",
        currentContent: "private",
        dependencyIds: [],
        loadUpstreamArtifacts
      })
    ).rejects.toThrow("cannot receive or replace existing workspace file");
    await expect(
      selectProviderWorkspaceContext({
        provider: "anthropic",
        outputPath: "outputs/report.md",
        currentContent: null,
        dependencyIds: ["upstream"],
        loadUpstreamArtifacts
      })
    ).rejects.toThrow("cannot receive upstream workspace artifacts");
    expect(loadUpstreamArtifacts).not.toHaveBeenCalled();

    await expect(
      selectProviderWorkspaceContext({
        provider: "ollama",
        outputPath: "outputs/report.md",
        currentContent: "private",
        dependencyIds: ["upstream"],
        loadUpstreamArtifacts
      })
    ).resolves.toEqual({
      currentContent: "private",
      upstreamArtifacts: [
        { issueId: "upstream", outputPath: "outputs/upstream.md", content: "private" }
      ]
    });
    expect(loadUpstreamArtifacts).toHaveBeenCalledOnce();
  });

  it("rejects an exact copy of an upstream artifact before verification", () => {
    expect(
      copiedUpstreamArtifactProblem("upstream content\n", [
        {
          issueId: "upstream",
          outputPath: "outputs/upstream.md",
          content: "upstream content\n"
        }
      ])
    ).toContain("closely repeated upstream artifact upstream");
    expect(
      copiedUpstreamArtifactProblem("alpha\nbeta\ngamma\ndelta\ndifferent\n", [
        {
          issueId: "upstream",
          outputPath: "outputs/upstream.md",
          content: "alpha\nbeta\ngamma\ndelta\nepsilon\n"
        }
      ])
    ).toContain("closely repeated upstream artifact upstream");
  });

  it("retries a refusal and applies only a content-checked candidate", async () => {
    const request = vi
      .fn<(prompt: string) => Promise<AgentProviderResponse>>()
      .mockResolvedValueOnce(response("I cannot access the workspace."))
      .mockResolvedValueOnce(response("# Report\n\n1. First\n2. Second\n3. Third"))
      .mockResolvedValueOnce(
        response(
          '{"accepted":true,"reason":"Three numbered recommendations are present.","evidence":["1 through 3"]}'
        )
      );

    const result = await generateVerifiedAgentEdit({
      task,
      provider: "ollama",
      model: "small-model",
      ssot: "README.md",
      dependencyIds: [],
      currentContent: null,
      upstreamArtifacts: [],
      request
    });

    expect(result.status).toBe("verified");
    expect(result.attempts).toBe(2);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[1][0]).toContain("previous candidate was rejected");
    expect(request.mock.calls[2][0]).not.toContain("```markdown");
  });

  it("does not approve a generic candidate when the content checker rejects both attempts", async () => {
    const request = vi
      .fn<(prompt: string) => Promise<AgentProviderResponse>>()
      .mockResolvedValueOnce(response("General advice without the requested list."))
      .mockResolvedValueOnce(
        response('{"accepted":false,"reason":"No three recommendations.","evidence":[]}')
      )
      .mockResolvedValueOnce(response("Still generic."))
      .mockResolvedValueOnce(
        response('{"accepted":false,"reason":"Still missing the required content.","evidence":[]}')
      );

    const result = await generateVerifiedAgentEdit({
      task,
      provider: "ollama",
      model: "small-model",
      ssot: "README.md",
      dependencyIds: [],
      currentContent: null,
      upstreamArtifacts: [],
      request
    });

    expect(result).toMatchObject({
      status: "review-required",
      reason: "Still missing the required content.",
      attempts: 2
    });
  });

  it("writes one declared file and can roll the edit back", async () => {
    const workspace = await temporaryWorkspace();
    const filename = path.join(workspace, "outputs", "report.md");
    await fs.promises.mkdir(path.dirname(filename), { recursive: true });
    await fs.promises.writeFile(filename, "before\n");

    const applied = await applyAgentWorkspaceEdit(
      workspace,
      "outputs/report.md",
      "# Report\n\n1. First\n2. Second\n3. Third\n"
    );
    expect(await fs.promises.readFile(filename, "utf8")).toContain("Third");

    await applied.rollback();
    expect(await fs.promises.readFile(filename, "utf8")).toBe("before\n");
  });

  it("removes newly created empty directories when a new file is rolled back", async () => {
    const workspace = await temporaryWorkspace();
    const applied = await applyAgentWorkspaceEdit(
      workspace,
      "new/nested/report.md",
      "verified content\n"
    );

    await applied.rollback();

    await expect(fs.promises.stat(path.join(workspace, "new"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("rejects symlinks even when their destination stays inside the workspace", async () => {
    const workspace = await temporaryWorkspace();
    await fs.promises.mkdir(path.join(workspace, "real-outputs"));
    await fs.promises.symlink("real-outputs", path.join(workspace, "outputs"));

    await expect(readAgentWorkspaceTarget(workspace, "outputs/report.md")).rejects.toThrow(
      "must not cross a symlink"
    );
  });

  it("rejects a symlink target that leaves the workspace", async () => {
    const workspace = await temporaryWorkspace();
    const outside = await temporaryWorkspace();
    await fs.promises.symlink(outside, path.join(workspace, "outputs"));

    await expect(readAgentWorkspaceTarget(workspace, "outputs/report.md")).rejects.toThrow(
      "must not cross a symlink"
    );
  });
});
