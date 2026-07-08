import type { PhpFrameworkSourceRegistryProvider } from "./usePhpFrameworkSourceRegistries";
import type { LaravelSourceRegistries } from "./useLaravelSourceRegistries";

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
