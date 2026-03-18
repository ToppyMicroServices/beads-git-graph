import { describe, expect, it } from "vitest";

import {
  filterBranchesForRemote,
  getPreferredMainBranch,
  getPreferredRemote,
  getRemoteNameFromBranchOption
} from "../src/remotes";

describe("remote helpers", () => {
  it("extracts remote names from branch options", () => {
    expect(getRemoteNameFromBranchOption("main")).toBeNull();
    expect(getRemoteNameFromBranchOption("feature/demo")).toBeNull();
    expect(getRemoteNameFromBranchOption("remotes/origin/main")).toBe("origin");
    expect(getRemoteNameFromBranchOption("remotes/public/develop")).toBe("public");
  });

  it("filters remote branches while keeping local branches visible", () => {
    expect(
      filterBranchesForRemote(
        ["main", "feature/demo", "remotes/origin/main", "remotes/public/main"],
        "public"
      )
    ).toEqual(["main", "feature/demo", "remotes/public/main"]);
  });

  it("prefers saved or upstream remotes before falling back", () => {
    expect(getPreferredRemote(["origin", "public"], "public", "origin")).toBe("public");
    expect(getPreferredRemote(["origin", "public"], null, null, "public")).toBe("public");
    expect(getPreferredRemote(["upstream", "fork"], null, null, null)).toBe("upstream");
    expect(getPreferredRemote([], "origin")).toBeNull();
  });

  it("prefers local main branches before the selected remote main branch", () => {
    expect(
      getPreferredMainBranch(["main", "remotes/public/main", "remotes/public/master"], "public")
    ).toBe("main");
    expect(
      getPreferredMainBranch(
        ["feature/demo", "remotes/public/main", "remotes/origin/main"],
        "public"
      )
    ).toBe("remotes/public/main");
  });
});
