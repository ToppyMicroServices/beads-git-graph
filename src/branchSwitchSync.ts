export type BranchStateLoader = (workspacePath: string) => Promise<string | null>;
export type WorkspaceSyncRunner = (workspacePath: string) => Promise<void>;
export type BranchSyncCallback = (workspacePath: string) => void | Promise<void>;
export type BranchSyncErrorHandler = (
  workspacePath: string,
  error: unknown
) => void | Promise<void>;

export class BranchSwitchSyncCoordinator {
  private readonly branchKeys = new Map<string, string | null>();
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly loadBranchState: BranchStateLoader,
    private readonly syncWorkspace: WorkspaceSyncRunner,
    private readonly onDidSync?: BranchSyncCallback,
    private readonly onDidError?: BranchSyncErrorHandler
  ) {}

  public async primeWorkspace(workspacePath: string) {
    this.branchKeys.set(workspacePath, await this.loadBranchState(workspacePath));
  }

  public forgetWorkspace(workspacePath: string) {
    this.branchKeys.delete(workspacePath);
    this.queues.delete(workspacePath);
  }

  public scheduleWorkspaceCheck(workspacePath: string) {
    const previous = this.queues.get(workspacePath) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await this.processWorkspace(workspacePath);
      })
      .finally(() => {
        if (this.queues.get(workspacePath) === next) {
          this.queues.delete(workspacePath);
        }
      });

    this.queues.set(workspacePath, next);
    return next;
  }

  private async processWorkspace(workspacePath: string) {
    const currentBranchKey = await this.loadBranchState(workspacePath);
    const previousBranchKey = this.branchKeys.get(workspacePath);

    this.branchKeys.set(workspacePath, currentBranchKey);

    if (
      previousBranchKey === undefined ||
      previousBranchKey === currentBranchKey ||
      isMaintenanceBranchKey(currentBranchKey)
    ) {
      return;
    }

    try {
      await this.syncWorkspace(workspacePath);
      await this.onDidSync?.(workspacePath);
    } catch (error) {
      await this.onDidError?.(workspacePath, error);
    }
  }
}

export function isMaintenanceBranchKey(branchKey: string | null) {
  if (branchKey === null || !branchKey.startsWith("branch:")) {
    return false;
  }

  const branchName = branchKey.substring("branch:".length);
  return (
    branchName === "beads-sync" ||
    branchName.startsWith("beads-sync/") ||
    branchName === "beads" ||
    branchName.startsWith("beads/") ||
    branchName === "db" ||
    branchName.startsWith("db/")
  );
}
