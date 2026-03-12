export type BdCommandRunner = (args: string[], cwd: string) => Promise<string>;

export async function syncBeadsWorkspace(runBdCommand: BdCommandRunner, workspacePath: string) {
  await runBdCommand(["sync"], workspacePath);
  await runBdCommand(["sync", "--flush-only"], workspacePath);
}
