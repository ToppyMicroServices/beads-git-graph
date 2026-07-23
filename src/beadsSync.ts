export type BdCommandRunner = (args: string[], cwd: string) => Promise<string>;

export type BeadsFlushResult = { status: "flushed" } | { status: "unsupported" };

export type BeadsSyncResult =
  | { status: "synced"; flush: BeadsFlushResult }
  | { status: "unsupported" };

function isUnknownSyncCommand(error: unknown) {
  return error instanceof Error && /unknown command "sync"/i.test(error.message);
}

export async function flushBeadsWorkspace(
  runBdCommand: BdCommandRunner,
  workspacePath: string
): Promise<BeadsFlushResult> {
  try {
    await runBdCommand(["sync", "--flush-only"], workspacePath);
    return { status: "flushed" };
  } catch (error) {
    if (!isUnknownSyncCommand(error)) {
      throw error;
    }
    return { status: "unsupported" };
  }
}

export async function syncBeadsWorkspace(
  runBdCommand: BdCommandRunner,
  workspacePath: string
): Promise<BeadsSyncResult> {
  try {
    await runBdCommand(["sync"], workspacePath);
  } catch (error) {
    if (isUnknownSyncCommand(error)) {
      return { status: "unsupported" };
    }
    throw error;
  }
  return {
    status: "synced",
    flush: await flushBeadsWorkspace(runBdCommand, workspacePath)
  };
}
