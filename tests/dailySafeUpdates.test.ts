import { describe, expect, it } from "vitest";

import {
  classifyDependabotUpdate,
  parseDependabotTitle,
  planDependabotTriage
} from "../scripts/daily-safe-updates.mjs";

describe("daily safe update triage", () => {
  it("parses standard Dependabot titles", () => {
    expect(
      parseDependabotTitle("build(deps): bump github/codeql-action from 3.32.6 to 4.35.1")
    ).toEqual({
      dependencyName: "github/codeql-action",
      fromVersion: "3.32.6",
      toVersion: "4.35.1"
    });
  });

  it("classifies patch, minor, and major semver updates", () => {
    expect(classifyDependabotUpdate("build(deps): bump foo from 1.2.3 to 1.2.4").updateType).toBe(
      "patch"
    );
    expect(classifyDependabotUpdate("build(deps): bump foo from 1.2.3 to 1.3.0").updateType).toBe(
      "minor"
    );
    expect(classifyDependabotUpdate("build(deps): bump foo from 1.2.3 to 2.0.0").updateType).toBe(
      "major"
    );
  });

  it("keeps the newest duplicate Dependabot PR and closes older ones", () => {
    const triagePlan = planDependabotTriage([
      {
        number: 1,
        title: "build(deps): bump foo from 1.2.3 to 1.2.5",
        author: "dependabot[bot]",
        updatedAt: "2026-03-31T00:00:00.000Z",
        labels: []
      },
      {
        number: 2,
        title: "build(deps): bump foo from 1.2.5 to 1.3.0",
        author: "dependabot[bot]",
        updatedAt: "2026-03-31T01:00:00.000Z",
        labels: []
      },
      {
        number: 3,
        title: "build(deps): bump bar from 2.0.0 to 3.0.0",
        author: "dependabot[bot]",
        updatedAt: "2026-03-31T02:00:00.000Z",
        labels: []
      }
    ]);

    expect(triagePlan.find((pullRequest) => pullRequest.number === 1)?.action).toBe(
      "close-superseded"
    );
    expect(triagePlan.find((pullRequest) => pullRequest.number === 2)?.action).toBe("automerge");
    expect(triagePlan.find((pullRequest) => pullRequest.number === 3)?.action).toBe(
      "manual-review"
    );
  });

  it("keeps @types/vscode bumps in manual review even when semver looks safe", () => {
    const triagePlan = planDependabotTriage([
      {
        number: 10,
        title: "build(deps-dev): bump @types/vscode from 1.110.0 to 1.116.0",
        author: "dependabot[bot]",
        updatedAt: "2026-04-18T00:00:00.000Z",
        labels: []
      }
    ]);

    expect(triagePlan[0]?.action).toBe("manual-review");
  });
});
