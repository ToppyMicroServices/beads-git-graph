import { describe, expect, it } from "vitest";

import {
  normalizeExecutionLimit,
  runBoundedAllSettled,
  WorkspaceSerialQueue
} from "../src/agentExecutionCoordinator";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("bounded all-settled execution", () => {
  it("normalizes unsafe limits to a positive integer", () => {
    expect(normalizeExecutionLimit(undefined)).toBe(1);
    expect(normalizeExecutionLimit(Number.NaN)).toBe(1);
    expect(normalizeExecutionLimit(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalizeExecutionLimit(0)).toBe(1);
    expect(normalizeExecutionLimit(-4)).toBe(1);
    expect(normalizeExecutionLimit(2.9)).toBe(2);
  });

  it("runs concurrently up to the limit, continues after failure, and preserves input order", async () => {
    const slowGate = deferred<void>();
    const failureGate = deferred<void>();
    const firstWaveStarted = deferred<void>();
    const lastStarted = deferred<void>();
    const failure = new Error("worker failed");
    const started: string[] = [];
    const progress: Array<{ index: number; completed: number; active: number }> = [];
    let active = 0;
    let maximumActive = 0;

    const run = runBoundedAllSettled(
      ["slow", "failure", "last"] as const,
      async (item) => {
        started.push(item);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (started.length === 2) {
          firstWaveStarted.resolve();
        }
        if (item === "last") {
          lastStarted.resolve();
        }

        try {
          if (item === "slow") {
            await slowGate.promise;
            return "slow-result";
          }
          if (item === "failure") {
            await failureGate.promise;
            throw failure;
          }
          return "last-result";
        } finally {
          active -= 1;
        }
      },
      {
        limit: 2.8,
        onProgress: ({ index, completed, active: reportedActive }) => {
          progress.push({ index, completed, active: reportedActive });
        }
      }
    );

    await firstWaveStarted.promise;
    expect(started).toEqual(["slow", "failure"]);
    expect(active).toBe(2);

    failureGate.resolve();
    await lastStarted.promise;
    expect(started).toEqual(["slow", "failure", "last"]);

    slowGate.resolve();
    await expect(run).resolves.toEqual([
      { status: "fulfilled", value: "slow-result" },
      { status: "rejected", reason: failure },
      { status: "fulfilled", value: "last-result" }
    ]);
    expect(maximumActive).toBe(2);
    expect(progress.map(({ index }) => index)).toEqual([1, 2, 0]);
    expect(progress.map(({ completed }) => completed)).toEqual([1, 2, 3]);
    expect(progress.every(({ active: reportedActive }) => reportedActive <= 1)).toBe(true);
  });

  it("marks only unstarted work as cancelled when aborted", async () => {
    const activeGate = deferred<void>();
    const activeStarted = deferred<void>();
    const controller = new AbortController();
    const started: number[] = [];
    const progressIndexes: number[] = [];

    const run = runBoundedAllSettled(
      [0, 1, 2, 3],
      async (item) => {
        started.push(item);
        if (started.length === 2) {
          activeStarted.resolve();
        }
        await activeGate.promise;
        return item * 10;
      },
      {
        limit: 2,
        signal: controller.signal,
        onProgress: ({ index }) => progressIndexes.push(index)
      }
    );

    await activeStarted.promise;
    controller.abort("stopped");
    expect(started).toEqual([0, 1]);

    activeGate.resolve();
    await expect(run).resolves.toEqual([
      { status: "fulfilled", value: 0 },
      { status: "fulfilled", value: 10 },
      { status: "cancelled", reason: "stopped" },
      { status: "cancelled", reason: "stopped" }
    ]);
    expect(started).toEqual([0, 1]);
    expect(progressIndexes.slice(0, 2)).toEqual([2, 3]);
  });
});

describe("workspace serial queue", () => {
  it("serializes a workspace, runs different workspaces in parallel, and releases after rejection", async () => {
    const queue = new WorkspaceSerialQueue<string>();
    const firstWorkspaceGate = deferred<void>();
    const otherWorkspaceGate = deferred<void>();
    const initialPairStarted = deferred<void>();
    const secondSameWorkspaceStarted = deferred<void>();
    const failure = new Error("first workspace failed");
    const events: string[] = [];
    let running = 0;
    let maximumRunning = 0;
    let runningInFirstWorkspace = 0;
    let maximumRunningInFirstWorkspace = 0;

    const enter = (event: string, firstWorkspace: boolean): void => {
      events.push(event);
      running += 1;
      maximumRunning = Math.max(maximumRunning, running);
      if (firstWorkspace) {
        runningInFirstWorkspace += 1;
        maximumRunningInFirstWorkspace = Math.max(
          maximumRunningInFirstWorkspace,
          runningInFirstWorkspace
        );
      }
      if (events.includes("a1:start") && events.includes("b1:start")) {
        initialPairStarted.resolve();
      }
    };
    const leave = (firstWorkspace: boolean): void => {
      running -= 1;
      if (firstWorkspace) {
        runningInFirstWorkspace -= 1;
      }
    };

    const first = queue.enqueue("workspace-a", async () => {
      enter("a1:start", true);
      try {
        await firstWorkspaceGate.promise;
        throw failure;
      } finally {
        leave(true);
        events.push("a1:end");
      }
    });
    const observedFirst = first.then(
      () => ({ status: "fulfilled" as const }),
      (reason: unknown) => ({ status: "rejected" as const, reason })
    );
    const second = queue.enqueue("workspace-a", async () => {
      enter("a2:start", true);
      secondSameWorkspaceStarted.resolve();
      leave(true);
      events.push("a2:end");
      return "a2-result";
    });
    const other = queue.enqueue("workspace-b", async () => {
      enter("b1:start", false);
      try {
        await otherWorkspaceGate.promise;
        return "b1-result";
      } finally {
        leave(false);
        events.push("b1:end");
      }
    });

    await initialPairStarted.promise;
    expect(events).toEqual(["a1:start", "b1:start"]);
    expect(running).toBe(2);

    firstWorkspaceGate.resolve();
    await secondSameWorkspaceStarted.promise;
    expect(await observedFirst).toEqual({ status: "rejected", reason: failure });
    await expect(second).resolves.toBe("a2-result");
    expect(maximumRunningInFirstWorkspace).toBe(1);

    otherWorkspaceGate.resolve();
    await expect(other).resolves.toBe("b1-result");
    expect(maximumRunning).toBe(2);
    expect(events).toEqual(["a1:start", "b1:start", "a1:end", "a2:start", "a2:end", "b1:end"]);
  });
});
