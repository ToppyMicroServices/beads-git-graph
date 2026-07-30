import * as vscode from "vscode";

import { AgentCredentialStore, type CredentialProviderId } from "./agentCredentialStore";
import { getAgentProviderDefinition } from "./agentProvider";

const CREDENTIAL_PROVIDERS: readonly CredentialProviderId[] = [
  "huggingface",
  "openai",
  "anthropic"
];

export async function manageAgentProviderCredentials(store: AgentCredentialStore) {
  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage(
      "Trust this workspace before managing AI provider credentials."
    );
    return;
  }

  const providerChoice = await vscode.window.showQuickPick(
    await Promise.all(
      CREDENTIAL_PROVIDERS.map(async (provider) => {
        const credential = await store.get(provider);
        return {
          label: getAgentProviderDefinition(provider).label,
          description:
            credential === null
              ? "No credential available"
              : credential.source === "secret-storage"
                ? "Stored securely by VS Code"
                : `Using ${getAgentProviderDefinition(provider).credentialEnvironmentVariable}`,
          provider
        };
      })
    ),
    {
      title: "Manage AI provider credentials",
      placeHolder: "Choose a provider. Credentials are never stored in workspace settings or Beads."
    }
  );
  if (providerChoice === undefined) {
    return;
  }

  const hasStoredCredential = await store.hasStoredCredential(providerChoice.provider);
  const action = await vscode.window.showQuickPick(
    [
      {
        label: hasStoredCredential ? "Replace stored credential" : "Store credential",
        action: "store" as const
      },
      ...(hasStoredCredential
        ? [{ label: "Delete stored credential", action: "delete" as const }]
        : [])
    ],
    { title: `${providerChoice.label} credential` }
  );
  if (action === undefined) {
    return;
  }

  if (action.action === "delete") {
    await store.delete(providerChoice.provider);
    const fallback = await store.get(providerChoice.provider);
    vscode.window.showInformationMessage(
      fallback?.source === "environment"
        ? `Deleted the stored ${providerChoice.label} credential. ${getAgentProviderDefinition(providerChoice.provider).credentialEnvironmentVariable} remains active.`
        : `Deleted the stored ${providerChoice.label} credential.`
    );
    return;
  }

  const credential = await vscode.window.showInputBox({
    title: `${providerChoice.label} credential`,
    prompt: "Stored in VS Code SecretStorage. It is not written to settings, Beads, or prompts.",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() === "" ? "Credential must not be empty." : null)
  });
  if (credential === undefined) {
    return;
  }
  await store.store(providerChoice.provider, credential);
  vscode.window.showInformationMessage(`Stored the ${providerChoice.label} credential securely.`);
}
