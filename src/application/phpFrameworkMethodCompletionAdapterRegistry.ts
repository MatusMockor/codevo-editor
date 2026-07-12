import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export interface PhpFrameworkMethodCompletionAdapterContribution<TAdapter> {
  readonly providerId: string;
  createAdapter(): TAdapter;
}

export function activePhpFrameworkMethodCompletionAdapter<TAdapter>(
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">,
  genericAdapter: TAdapter,
  contributions: readonly PhpFrameworkMethodCompletionAdapterContribution<TAdapter>[],
): TAdapter {
  const contribution = contributions.find(({ providerId }) =>
    frameworkRuntime.hasProvider(providerId),
  );

  if (!contribution) {
    return genericAdapter;
  }

  return contribution.createAdapter();
}
