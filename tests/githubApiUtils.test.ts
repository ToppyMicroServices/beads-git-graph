import { describe, expect, it } from "vitest";

import { buildGitHubApiUrl, resolveGitHubNextPath } from "../scripts/github-api-utils.mjs";

describe("GitHub API URL helpers", () => {
  it("builds GitHub API URLs with enterprise prefixes intact", () => {
    expect(buildGitHubApiUrl("https://github.example.com/api/v3", "/repos/acme/tools")).toBe(
      "https://github.example.com/api/v3/repos/acme/tools"
    );
  });

  it("rejects pagination links that leave the configured GitHub API host", () => {
    expect(() =>
      resolveGitHubNextPath("https://api.github.com", "https://evil.example.com/repos/acme/tools")
    ).toThrow(/Refusing to follow non-GitHub API pagination URL/);
  });

  it("converts pagination links back into API-relative paths", () => {
    expect(
      resolveGitHubNextPath(
        "https://github.example.com/api/v3",
        "https://github.example.com/api/v3/repos/acme/tools/pulls?page=2"
      )
    ).toBe("/repos/acme/tools/pulls?page=2");
  });
});
