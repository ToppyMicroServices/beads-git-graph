export type GuardedAgentStartResult<TResult> =
  | { status: "started"; result: TResult }
  | { status: "not-ready"; phase: "before-preparation" | "before-mutation" };

export async function runReadinessGuardedStart<TPrepared, TResult>(values: {
  issueId: string;
  queryReadyItemIds: () => Promise<ReadonlySet<string>>;
  queryDependencyIds: () => Promise<readonly string[]>;
  prepare: () => Promise<TPrepared>;
  mutateAndLaunch: (prepared: TPrepared, dependencyIds: readonly string[]) => Promise<TResult>;
}): Promise<GuardedAgentStartResult<TResult>> {
  await values.queryDependencyIds();
  const readyBeforePreparation = await values.queryReadyItemIds();
  if (!readyBeforePreparation.has(values.issueId)) {
    return { status: "not-ready", phase: "before-preparation" };
  }

  const prepared = await values.prepare();

  const dependencyIds = await values.queryDependencyIds();
  const readyBeforeMutation = await values.queryReadyItemIds();
  if (!readyBeforeMutation.has(values.issueId)) {
    return { status: "not-ready", phase: "before-mutation" };
  }

  return {
    status: "started",
    result: await values.mutateAndLaunch(prepared, dependencyIds)
  };
}
