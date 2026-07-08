import {
  useLaravelSourceRegistries,
  type PhpLaravelSourceContext,
  type UseLaravelSourceRegistriesDependencies,
} from "./useLaravelSourceRegistries";

export type PhpFrameworkSourceRegistryContext = PhpLaravelSourceContext;

export type UsePhpFrameworkSourceRegistriesDependencies =
  UseLaravelSourceRegistriesDependencies;

export interface PhpFrameworkSourceRegistries {
  currentPhpFrameworkSourceContext(): PhpFrameworkSourceRegistryContext;
  ensurePhpFrameworkSourceCollectionsLoaded(rootPath: string): Promise<void>;
  invalidatePhpFrameworkSourcePath(root: string, path: string): void;
  resetPhpFrameworkSourceRegistries(): void;
}

export function usePhpFrameworkSourceRegistries(
  dependencies: UsePhpFrameworkSourceRegistriesDependencies,
): PhpFrameworkSourceRegistries {
  const laravelSources = useLaravelSourceRegistries(dependencies);

  return {
    currentPhpFrameworkSourceContext:
      laravelSources.currentPhpLaravelSourceContext,
    ensurePhpFrameworkSourceCollectionsLoaded: async (rootPath: string) => {
      await Promise.all([
        laravelSources.ensurePhpLaravelMigrationSourcesLoaded(rootPath),
        laravelSources.ensurePhpLaravelProviderSourcesLoaded(rootPath),
      ]);
    },
    invalidatePhpFrameworkSourcePath: (root: string, path: string) => {
      laravelSources.invalidatePhpLaravelMigrationSourcesForPath(root, path);
      laravelSources.invalidatePhpLaravelProviderSourcesForPath(root, path);
    },
    resetPhpFrameworkSourceRegistries:
      laravelSources.resetPhpLaravelSourceRegistries,
  };
}
