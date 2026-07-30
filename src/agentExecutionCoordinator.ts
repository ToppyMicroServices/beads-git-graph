export type BoundedExecutionResult<T> =
  | { readonly status: "fulfilled"; readonly value: T }
  | { readonly status: "rejected"; readonly reason: unknown }
  | { readonly status: "cancelled"; readonly reason?: unknown };

export interface BoundedExecutionProgress<TInput, TOutput> {
  readonly index: number;
  readonly item: TInput;
  readonly result: BoundedExecutionResult<TOutput>;
  readonly completed: number;
  readonly total: number;
  readonly active: number;
}

export interface BoundedExecutionOptions<TInput, TOutput> {
  readonly limit?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: BoundedExecutionProgress<TInput, TOutput>) => void;
}

export type BoundedExecutionWorker<TInput, TOutput> = (
  item: TInput,
  index: number,
  signal: AbortSignal | undefined
) => TOutput | PromiseLike<TOutput>;

export function normalizeExecutionLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return 1;
  }
  return Math.max(1, Math.floor(limit));
}

export function runBoundedAllSettled<TInput, TOutput>(
  items: readonly TInput[],
  worker: BoundedExecutionWorker<TInput, TOutput>,
  options: BoundedExecutionOptions<TInput, TOutput> = {}
): Promise<BoundedExecutionResult<TOutput>[]> {
  const itemList = Array.from(items);
  const results: BoundedExecutionResult<TOutput>[] = [];
  results.length = itemList.length;
  const limit = normalizeExecutionLimit(options.limit);
  let active = 0;
  let completed = 0;
  let nextIndex = 0;

  return new Promise((resolve) => {
    const report = (index: number, result: BoundedExecutionResult<TOutput>): void => {
      results[index] = result;
      completed += 1;
      try {
        options.onProgress?.({
          index,
          item: itemList[index],
          result,
          completed,
          total: itemList.length,
          active
        });
      } catch {
        return;
      }
    };

    const finishIfComplete = (): boolean => {
      if (completed !== itemList.length) {
        return false;
      }
      options.signal?.removeEventListener("abort", cancelPending);
      resolve(results);
      return true;
    };

    const cancelPending = (): void => {
      while (nextIndex < itemList.length) {
        const index = nextIndex;
        nextIndex += 1;
        const reason = options.signal?.reason;
        report(
          index,
          reason === undefined ? { status: "cancelled" } : { status: "cancelled", reason }
        );
      }
      finishIfComplete();
    };

    const schedule = (): void => {
      if (options.signal?.aborted) {
        cancelPending();
        return;
      }

      while (active < limit && nextIndex < itemList.length) {
        const index = nextIndex;
        const item = itemList[index];
        nextIndex += 1;
        active += 1;

        Promise.resolve()
          .then(() => worker(item, index, options.signal))
          .then(
            (value) => {
              active -= 1;
              report(index, { status: "fulfilled", value });
            },
            (reason: unknown) => {
              active -= 1;
              report(index, { status: "rejected", reason });
            }
          )
          .then(() => {
            if (!finishIfComplete()) {
              schedule();
            }
          });
      }
    };

    if (itemList.length === 0) {
      resolve(results);
      return;
    }

    options.signal?.addEventListener("abort", cancelPending, { once: true });
    schedule();
  });
}

export class WorkspaceSerialQueue<TKey = string> {
  private readonly tails = new Map<TKey, Promise<void>>();

  enqueue<T>(workspaceKey: TKey, operation: () => T | PromiseLike<T>): Promise<T> {
    const previous = this.tails.get(workspaceKey) ?? Promise.resolve();
    const result = previous.then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined
    );

    this.tails.set(workspaceKey, settled);
    void settled.then(() => {
      if (this.tails.get(workspaceKey) === settled) {
        this.tails.delete(workspaceKey);
      }
    });

    return result;
  }
}
