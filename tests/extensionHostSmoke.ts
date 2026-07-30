import * as vscode from "vscode";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export async function run() {
  const extension = vscode.extensions.all.find(
    (candidate) => candidate.id.toLowerCase() === "toppymicroservices.beads-git-graph"
  );
  assert(extension, "The packaged Beads Git Graph extension is not installed.");

  await extension.activate();
  assert(extension.isActive, "The packaged extension did not activate.");

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "beads-git-graph.view",
    "beads-git-graph.refreshBeads",
    "beads-git-graph.clearAgentResponseArtifacts"
  ]) {
    assert(commands.includes(command), `The packaged extension did not register ${command}.`);
  }

  const manifest = extension.packageJSON as {
    capabilities?: {
      untrustedWorkspaces?: {
        supported?: string;
        restrictedConfigurations?: string[];
      };
    };
    contributes?: {
      configuration?: {
        properties?: Record<string, { scope?: string }>;
      };
    };
  };
  assert(
    manifest.contributes?.configuration?.properties?.["beads-git-graph.bdPath"]?.scope ===
      "machine",
    "The packaged bdPath setting is not machine-scoped."
  );
  assert(
    manifest.capabilities?.untrustedWorkspaces?.supported === "limited" &&
      manifest.capabilities.untrustedWorkspaces.restrictedConfigurations?.includes(
        "beads-git-graph.bdPath"
      ),
    "The packaged Restricted Mode manifest does not restrict bdPath."
  );
}
