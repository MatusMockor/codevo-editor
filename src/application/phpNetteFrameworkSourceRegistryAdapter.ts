import type {
  PhpFrameworkSourceRegistryAdapter,
  PhpFrameworkSourceRegistryContributionDescriptor,
} from "./phpFrameworkSourceRegistryAdapters";
import type { NetteSourceRegistries } from "./useNetteSourceRegistries";
import { useNetteSourceRegistries } from "./useNetteSourceRegistries";
import type {
  PhpFrameworkSourceRegistryProvider,
  UsePhpFrameworkSourceRegistriesDependencies,
} from "./usePhpFrameworkSourceRegistries";

export const phpNetteFrameworkSourceRegistryProviderId = "nette";

export const phpNetteFrameworkSourceRegistryContribution: PhpFrameworkSourceRegistryContributionDescriptor =
  {
    providerId: phpNetteFrameworkSourceRegistryProviderId,
    useSourceRegistryAdapter: usePhpNetteFrameworkSourceRegistryContribution,
  };

export function usePhpNetteFrameworkSourceRegistryContribution(
  dependencies: UsePhpFrameworkSourceRegistriesDependencies,
): PhpFrameworkSourceRegistryAdapter {
  const netteSources = useNetteSourceRegistries({
    ...dependencies,
    isActive: dependencies.frameworkRuntime.hasProvider(
      phpNetteFrameworkSourceRegistryProviderId,
    ),
  });

  return phpNetteFrameworkSourceRegistryAdapter(netteSources);
}

export function phpNetteFrameworkSourceRegistryAdapter(
  netteSources: NetteSourceRegistries,
): PhpFrameworkSourceRegistryAdapter {
  return {
    providerId: phpNetteFrameworkSourceRegistryProviderId,
    provider: phpNetteFrameworkSourceRegistryProvider(netteSources),
  };
}

export function phpNetteFrameworkSourceRegistryProvider(
  netteSources: NetteSourceRegistries,
): PhpFrameworkSourceRegistryProvider {
  return {
    currentPhpFrameworkSourceContextForRoot: (rootPath: string) =>
      netteSources.currentPhpNetteSourceContextForRoot(rootPath),
    ensurePhpFrameworkSourceCollectionsLoaded: async (rootPath: string) => {
      await netteSources.ensurePhpNetteNeonConfigSourcesLoaded(rootPath);
    },
    invalidatePhpFrameworkSourcePathForRoot: (rootPath: string, path: string) => {
      netteSources.invalidatePhpNetteNeonConfigSourcesForPath(rootPath, path);
    },
    resetPhpFrameworkSourceRegistries:
      netteSources.resetPhpNetteSourceRegistries,
  };
}
