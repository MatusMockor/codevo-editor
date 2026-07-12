import type { PhpFrameworkSourceRegistryProvider } from "./usePhpFrameworkSourceRegistries";
import type { LaravelSourceRegistries } from "./useLaravelSourceRegistries";
import type { PhpFrameworkSourceRegistryAdapter } from "./phpFrameworkSourceRegistryAdapters";

export const phpLaravelFrameworkSourceRegistryProviderId = "laravel";

export function phpLaravelFrameworkSourceRegistryAdapter(
  laravelSources: LaravelSourceRegistries,
): PhpFrameworkSourceRegistryAdapter {
  return {
    providerId: phpLaravelFrameworkSourceRegistryProviderId,
    provider: phpLaravelFrameworkSourceRegistryProvider(laravelSources),
  };
}

export function phpLaravelFrameworkSourceRegistryProvider(
  laravelSources: LaravelSourceRegistries,
): PhpFrameworkSourceRegistryProvider {
  return {
    currentPhpFrameworkSourceContextForRoot: (rootPath: string) =>
      laravelSources.currentPhpLaravelSourceContextForRoot(rootPath),
    ensurePhpFrameworkSourceCollectionsLoaded: async (rootPath: string) => {
      await Promise.all([
        laravelSources.ensurePhpLaravelMigrationSourcesLoaded(rootPath),
        laravelSources.ensurePhpLaravelProviderSourcesLoaded(rootPath),
      ]);
    },
    invalidatePhpFrameworkSourcePathForRoot: (
      rootPath: string,
      path: string,
    ) => {
      laravelSources.invalidatePhpLaravelMigrationSourcesForPath(rootPath, path);
      laravelSources.invalidatePhpLaravelProviderSourcesForPath(rootPath, path);
    },
    resetPhpFrameworkSourceRegistries:
      laravelSources.resetPhpLaravelSourceRegistries,
  };
}
