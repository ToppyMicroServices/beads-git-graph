import { afterEach, describe, expect, it, vi } from "vitest";

const { trustListeners, trustSubscriptionDispose } = vi.hoisted(() => ({
  trustListeners: new Set<() => void>(),
  trustSubscriptionDispose: vi.fn()
}));

vi.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [],
    createFileSystemWatcher: () => ({
      dispose: vi.fn(),
      onDidCreate: () => ({ dispose: vi.fn() }),
      onDidChange: () => ({ dispose: vi.fn() }),
      onDidDelete: () => ({ dispose: vi.fn() })
    }),
    onDidChangeWorkspaceFolders: () => ({ dispose: vi.fn() }),
    onDidGrantWorkspaceTrust: (listener: () => void) => {
      trustListeners.add(listener);
      return {
        dispose() {
          trustListeners.delete(listener);
          trustSubscriptionDispose();
        }
      };
    }
  }
}));

vi.mock("../src/beadsWebview", () => ({ renderBeadsWebviewHtml: vi.fn() }));

import { BeadsViewProvider } from "../src/beadsView";

describe("Beads view lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    trustListeners.clear();
    trustSubscriptionDispose.mockClear();
  });

  it("refreshes unavailable actions when the user grants workspace trust", () => {
    const refresh = vi.spyOn(BeadsViewProvider.prototype, "refresh").mockResolvedValue();
    const provider = new BeadsViewProvider({} as never, {} as never, {} as never);
    expect(refresh).not.toHaveBeenCalled();

    for (const listener of trustListeners) listener();

    expect(refresh).toHaveBeenCalledOnce();
    provider.dispose();
  });

  it("removes the trust listener when the provider is disposed", () => {
    const refresh = vi.spyOn(BeadsViewProvider.prototype, "refresh").mockResolvedValue();
    const provider = new BeadsViewProvider({} as never, {} as never, {} as never);
    expect(trustListeners.size).toBe(1);

    provider.dispose();
    for (const listener of trustListeners) listener();

    expect(trustSubscriptionDispose).toHaveBeenCalledOnce();
    expect(trustListeners.size).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("aborts and releases active provider requests when disposed", () => {
    vi.spyOn(BeadsViewProvider.prototype, "refresh").mockResolvedValue();
    const provider = new BeadsViewProvider({} as never, {} as never, {} as never);
    const controller = new AbortController();
    const internals = provider as unknown as {
      activeAgentControllers: Set<AbortController>;
    };
    internals.activeAgentControllers.add(controller);

    provider.dispose();

    expect(controller.signal.aborted).toBe(true);
    expect(internals.activeAgentControllers.size).toBe(0);
  });
});
