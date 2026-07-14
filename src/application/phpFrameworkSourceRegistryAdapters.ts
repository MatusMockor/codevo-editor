import { phpLaravelFrameworkSourceRegistryContribution } from "./phpLaravelFrameworkSourceRegistryAdapter";
import { phpNetteFrameworkSourceRegistryContribution } from "./phpNetteFrameworkSourceRegistryAdapter";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type {
  PhpFrameworkSourceRegistryProvider,
  UsePhpFrameworkSourceRegistriesDependencies,
} from "./usePhpFrameworkSourceRegistries";

export interface PhpFrameworkSourceRegistryAdapter {
  readonly providerId: string;
  readonly provider: PhpFrameworkSourceRegistryProvider;
}

export interface PhpFrameworkSourceRegistryContributionDescriptor {
  readonly providerId: string;
  useSourceRegistryAdapter(
    dependencies: UsePhpFrameworkSourceRegistriesDependencies,
  ): PhpFrameworkSourceRegistryAdapter;
}

export const phpFrameworkSourceRegistryContributionDescriptors: readonly PhpFrameworkSourceRegistryContributionDescriptor[] =
  [
    phpLaravelFrameworkSourceRegistryContribution,
    phpNetteFrameworkSourceRegistryContribution,
  ];

export function activePhpFrameworkSourceRegistryProviders(
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">,
  adapters: readonly PhpFrameworkSourceRegistryAdapter[],
): readonly PhpFrameworkSourceRegistryProvider[] {
  return adapters
    .filter((adapter) => frameworkRuntime.hasProvider(adapter.providerId))
    .map((adapter) => adapter.provider);
}
