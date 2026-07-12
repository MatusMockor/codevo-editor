import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { PhpFrameworkSourceRegistryProvider } from "./usePhpFrameworkSourceRegistries";

export interface PhpFrameworkSourceRegistryAdapter {
  readonly providerId: string;
  readonly provider: PhpFrameworkSourceRegistryProvider;
}

export function activePhpFrameworkSourceRegistryProviders(
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">,
  adapters: readonly PhpFrameworkSourceRegistryAdapter[],
): readonly PhpFrameworkSourceRegistryProvider[] {
  return adapters
    .filter((adapter) => frameworkRuntime.hasProvider(adapter.providerId))
    .map((adapter) => adapter.provider);
}
