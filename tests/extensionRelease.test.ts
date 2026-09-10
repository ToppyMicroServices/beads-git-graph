import { describe, expect, it } from "vitest";

import {
  validateExtensionRelease,
  validatePublishCredentials
} from "../scripts/check-extension-release.mjs";

const release = {
  tag: "v0.6.6",
  refType: "tag",
  manifest: { name: "beads-git-graph", publisher: "ToppyMicroServices", version: "0.6.6" },
  readme: "![Version 0.6.6](https://img.shields.io/badge/version-0.6.6-blue)",
  changelog: "# Changelog\n\n## [0.6.6] - 2026-09-11\n"
};

describe("extension publication preflight", () => {
  it("selects the exact package for a matching stable tag", () => {
    expect(validateExtensionRelease(release)).toBe("beads-git-graph-0.6.6.vsix");
  });

  it.each(["", "main", "daily-20260911", "agent-plugin-v0.1.2", "v0.6.6-beta.1", "v00.6.6"])(
    "rejects a non-stable release ref: %s",
    (tag) =>
      expect(() => validateExtensionRelease({ ...release, tag })).toThrow("stable extension tag")
  );

  it.each([undefined, "", "branch"])(
    "rejects a version-shaped ref that is not a tag: %s",
    (refType) =>
      expect(() => validateExtensionRelease({ ...release, refType })).toThrow(
        "stable extension tag"
      )
  );

  it.each(["0.6.60", "0.6.6-beta.1", "0.6.6--beta.1", "0.6.6.1"])(
    "rejects a badge whose version only starts with the release version: %s",
    (version) =>
      expect(() =>
        validateExtensionRelease({
          ...release,
          readme: `![Version 0.6.6](https://img.shields.io/badge/version-${version}-blue)`
        })
      ).toThrow("badge")
  );

  it("rejects a stale badge label even when the image URL is correct", () => {
    expect(() =>
      validateExtensionRelease({
        ...release,
        readme: release.readme.replace("[Version 0.6.6]", "[Version 0.6.5]")
      })
    ).toThrow("badge");
  });

  it("accepts the version badge with style query parameters", () => {
    expect(
      validateExtensionRelease({
        ...release,
        readme: release.readme.replace("-blue)", "-0366d6?style=flat-square)")
      })
    ).toBe("beads-git-graph-0.6.6.vsix");
  });

  it.each([
    "",
    "not-a-date",
    "2026-9-11",
    "2026-09-00",
    "2026-13-01",
    "2026-02-29",
    "2026-04-31",
    "1900-02-29"
  ])("rejects a changelog heading with an invalid ISO calendar date: %s", (date) =>
    expect(() =>
      validateExtensionRelease({
        ...release,
        changelog: `## [0.6.6] - ${date}`
      })
    ).toThrow("dated changelog")
  );

  it.each(["2024-02-29", "2000-02-29", "2026-09-11"])(
    "accepts a valid ISO calendar date: %s",
    (date) =>
      expect(
        validateExtensionRelease({
          ...release,
          changelog: `## [0.6.6] - ${date}\r\n`
        })
      ).toBe("beads-git-graph-0.6.6.vsix")
  );

  it("rejects mismatched tags, publisher identity, and stale documentation", () => {
    expect(() => validateExtensionRelease({ ...release, tag: "v0.6.5" })).toThrow("does not match");
    expect(() =>
      validateExtensionRelease({
        ...release,
        manifest: { ...release.manifest, publisher: "other" }
      })
    ).toThrow("identity");
    expect(() => validateExtensionRelease({ ...release, readme: "old badge" })).toThrow("badge");
    expect(() => validateExtensionRelease({ ...release, changelog: "## [Unreleased]" })).toThrow(
      "dated changelog"
    );
  });

  it("fails instead of silently skipping a missing publishing destination", () => {
    expect(() => validatePublishCredentials({})).toThrow("OPEN_VSX_TOKEN, VS_MARKETPLACE_TOKEN");
    expect(() => validatePublishCredentials({ OPEN_VSX_TOKEN: "configured" })).toThrow(
      "VS_MARKETPLACE_TOKEN"
    );
    expect(() =>
      validatePublishCredentials({ OPEN_VSX_TOKEN: "  ", VS_MARKETPLACE_TOKEN: "configured" })
    ).toThrow("OPEN_VSX_TOKEN");
    expect(() =>
      validatePublishCredentials({
        OPEN_VSX_TOKEN: "configured",
        VS_MARKETPLACE_TOKEN: "configured"
      })
    ).not.toThrow();
  });
});
