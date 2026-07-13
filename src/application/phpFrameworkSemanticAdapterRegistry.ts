import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export interface PhpFrameworkSemanticAdapterContribution<TAdapter> {
  readonly providerId: string;
  createAdapter(): TAdapter;
}

export function activePhpFrameworkSemanticAdapter<TAdapter>(
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">,
  contributions: readonly PhpFrameworkSemanticAdapterContribution<TAdapter>[],
  fallback: TAdapter,
): TAdapter {
  const contribution = contributions.find(({ providerId }) =>
    frameworkRuntime.hasProvider(providerId),
  );

  if (!contribution) {
    return fallback;
  }

  return contribution.createAdapter();
}
