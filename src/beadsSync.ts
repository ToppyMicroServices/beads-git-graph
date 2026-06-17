export type BdCommandRunner = (args: string[], cwd: string) => Promise<string>;

function isUnknownSyncCommand(error: unknown) {
  return error instanceof Error && /unknown command "sync"/i.test(error.message);
}

export async function flushBeadsWorkspace(runBdCommand: BdCommandRunner, workspacePath: string) {
  try {
    await runBdCommand(["sync", "--flush-only"], workspacePath);
  } catch (error) {
    if (!isUnknownSyncCommand(error)) {
      throw error;
    }
  }
}

export async function syncBeadsWorkspace(runBdCommand: BdCommandRunner, workspacePath: string) {
  try {
    await runBdCommand(["sync"], workspacePath);
  } catch (error) {
    if (isUnknownSyncCommand(error)) {
      return;
    }
    throw error;
  }
  await flushBeadsWorkspace(runBdCommand, workspacePath);
}
