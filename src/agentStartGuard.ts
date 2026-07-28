export type GuardedAgentStartResult<TResult> =
  | { status: "started"; result: TResult }
  | {
      status: "not-ready";
      phase: "before-preparation" | "before-mutation" | "dependencies-changed";
    };

export async function runReadinessGuardedStart<TPrepared, TResult>(values: {
  issueId: string;
  queryReadyItemIds: () => Promise<ReadonlySet<string>>;
  queryDependencyIds: () => Promise<readonly string[]>;
  preflight?: () => Promise<void>;
  prepare: (dependencyIds: readonly string[]) => Promise<TPrepared>;
  preservePreparedOnAbort?: (prepared: TPrepared) => Promise<void>;
  isPreparedStillValid?: (prepared: TPrepared, dependencyIds: readonly string[]) => boolean;
  mutateAndLaunch: (prepared: TPrepared, dependencyIds: readonly string[]) => Promise<TResult>;
  runFinalization?: (
    operation: () => Promise<GuardedAgentStartResult<TResult>>
  ) => Promise<GuardedAgentStartResult<TResult>>;
}): Promise<GuardedAgentStartResult<TResult>> {
  const dependenciesBeforePreparation = await values.queryDependencyIds();
  const readyBeforePreparation = await values.queryReadyItemIds();
  if (!readyBeforePreparation.has(values.issueId)) {
    return { status: "not-ready", phase: "before-preparation" };
  }

  await values.preflight?.();
  const prepared = await values.prepare(dependenciesBeforePreparation);

  const finalize = async (): Promise<GuardedAgentStartResult<TResult>> => {
    let dependencyIds: readonly string[];
    let readyBeforeMutation: ReadonlySet<string>;
    try {
      dependencyIds = await values.queryDependencyIds();
      readyBeforeMutation = await values.queryReadyItemIds();
    } catch (error) {
      await values.preservePreparedOnAbort?.(prepared);
      throw error;
    }
    if (!readyBeforeMutation.has(values.issueId)) {
      await values.preservePreparedOnAbort?.(prepared);
      return { status: "not-ready", phase: "before-mutation" };
    }
    if (
      values.isPreparedStillValid !== undefined &&
      !values.isPreparedStillValid(prepared, dependencyIds)
    ) {
      await values.preservePreparedOnAbort?.(prepared);
      return { status: "not-ready", phase: "dependencies-changed" };
    }

    return {
      status: "started",
      result: await values.mutateAndLaunch(prepared, dependencyIds)
    };
  };

  return values.runFinalization === undefined ? finalize() : values.runFinalization(finalize);
}
