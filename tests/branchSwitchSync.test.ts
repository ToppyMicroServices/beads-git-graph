import { describe, expect, it, vi } from "vitest";

import { BranchSwitchSyncCoordinator, isMaintenanceBranchKey } from "../src/branchSwitchSync";

describe("BranchSwitchSyncCoordinator", () => {
  it("uses the initial branch state as a baseline without syncing", async () => {
    const loadBranchState = vi.fn(async () => "main");
    const syncWorkspace = vi.fn(async () => undefined);
    const coordinator = new BranchSwitchSyncCoordinator(loadBranchState, syncWorkspace);

    await coordinator.primeWorkspace("/tmp/demo");
    await coordinator.scheduleWorkspaceCheck("/tmp/demo");

    expect(syncWorkspace).not.toHaveBeenCalled();
  });

  it("syncs after a tracked workspace switches branches", async () => {
    const branchStates = ["main", "feature/login"];
    const loadBranchState = vi.fn(async () => branchStates.shift() ?? "feature/login");
    const syncWorkspace = vi.fn(async () => undefined);
    const onDidSync = vi.fn(async () => undefined);
    const coordinator = new BranchSwitchSyncCoordinator(loadBranchState, syncWorkspace, onDidSync);

    await coordinator.primeWorkspace("/tmp/demo");
    await coordinator.scheduleWorkspaceCheck("/tmp/demo");

    expect(syncWorkspace).toHaveBeenCalledTimes(1);
    expect(syncWorkspace).toHaveBeenCalledWith("/tmp/demo");
    expect(onDidSync).toHaveBeenCalledWith("/tmp/demo");
  });

  it("serializes repeated checks and only syncs for real branch transitions", async () => {
    const branchStates = ["main", "feature/a", "feature/a", "feature/b"];
    const loadBranchState = vi.fn(async () => branchStates.shift() ?? "feature/b");
    const syncWorkspace = vi.fn(async () => undefined);
    const coordinator = new BranchSwitchSyncCoordinator(loadBranchState, syncWorkspace);

    await coordinator.primeWorkspace("/tmp/demo");
    await Promise.all([
      coordinator.scheduleWorkspaceCheck("/tmp/demo"),
      coordinator.scheduleWorkspaceCheck("/tmp/demo"),
      coordinator.scheduleWorkspaceCheck("/tmp/demo")
    ]);

    expect(syncWorkspace).toHaveBeenCalledTimes(2);
  });

  it("reports sync failures and continues processing later branch changes", async () => {
    const branchStates = ["main", "feature/a", "feature/b"];
    const loadBranchState = vi.fn(async () => branchStates.shift() ?? "feature/b");
    const syncWorkspace = vi
      .fn<(_: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("sync failed"))
      .mockResolvedValue(undefined);
    const onDidError = vi.fn(async () => undefined);
    const coordinator = new BranchSwitchSyncCoordinator(
      loadBranchState,
      syncWorkspace,
      undefined,
      onDidError
    );

    await coordinator.primeWorkspace("/tmp/demo");
    await coordinator.scheduleWorkspaceCheck("/tmp/demo");
    await coordinator.scheduleWorkspaceCheck("/tmp/demo");

    expect(syncWorkspace).toHaveBeenCalledTimes(2);
    expect(onDidError).toHaveBeenCalledTimes(1);
    expect(onDidError.mock.calls[0][0]).toBe("/tmp/demo");
    expect(onDidError.mock.calls[0][1]).toBeInstanceOf(Error);
  });

  it("ignores internal maintenance branches", async () => {
    const branchStates = ["branch:main", "branch:beads-sync", "branch:feature/a"];
    const loadBranchState = vi.fn(async () => branchStates.shift() ?? "branch:feature/a");
    const syncWorkspace = vi.fn(async () => undefined);
    const coordinator = new BranchSwitchSyncCoordinator(loadBranchState, syncWorkspace);

    await coordinator.primeWorkspace("/tmp/demo");
    await coordinator.scheduleWorkspaceCheck("/tmp/demo");
    await coordinator.scheduleWorkspaceCheck("/tmp/demo");

    expect(syncWorkspace).toHaveBeenCalledTimes(1);
  });
});

describe("isMaintenanceBranchKey", () => {
  it("matches beads maintenance branches only", () => {
    expect(isMaintenanceBranchKey("branch:beads-sync")).toBe(true);
    expect(isMaintenanceBranchKey("branch:beads-sync/worktree")).toBe(true);
    expect(isMaintenanceBranchKey("branch:db/archive")).toBe(true);
    expect(isMaintenanceBranchKey("branch:feature/login")).toBe(false);
    expect(isMaintenanceBranchKey("detached:abc123")).toBe(false);
    expect(isMaintenanceBranchKey(null)).toBe(false);
  });
});
