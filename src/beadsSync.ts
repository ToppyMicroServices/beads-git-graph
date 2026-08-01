export type BdCommandRunner = (args: string[], cwd: string) => Promise<string>;

export type BeadsFlushResult = { status: "flushed" } | { status: "unsupported" };

export type BeadsSyncResult =
  | { status: "synced"; flush: BeadsFlushResult }
  | { status: "unsupported" };

export type BeadsSyncCapability =
  | { supported: true; reason: string }
  | { supported: false; reason: string };

function isUnknownSyncCommand(error: unknown) {
  return error instanceof Error && /unknown command ["']?sync["']?/i.test(error.message);
}

function isUnsupportedFlushOption(error: unknown) {
  return (
    error instanceof Error &&
    /(?:unknown (?:flag|option)|unrecognized option|no such option|flag provided but not defined)[^\n]*-+flush-only/i.test(
      error.message
    )
  );
}

export async function probeBeadsSyncCapability(
  runBdCommand: BdCommandRunner,
  workspacePath: string
): Promise<BeadsSyncCapability> {
  try {
    await runBdCommand(["sync", "--help"], workspacePath);
    return { supported: true, reason: "The active Beads CLI provides bd sync." };
  } catch (error) {
    return {
      supported: false,
      reason: isUnknownSyncCommand(error)
        ? "The active Beads CLI does not provide bd sync."
        : error instanceof Error
          ? `Unable to verify bd sync support: ${error.message}`
          : "Unable to verify bd sync support."
    };
  }
}

export async function flushBeadsWorkspace(
  runBdCommand: BdCommandRunner,
  workspacePath: string
): Promise<BeadsFlushResult> {
  try {
    await runBdCommand(["sync", "--flush-only"], workspacePath);
    return { status: "flushed" };
  } catch (error) {
    if (!isUnknownSyncCommand(error) && !isUnsupportedFlushOption(error)) {
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
