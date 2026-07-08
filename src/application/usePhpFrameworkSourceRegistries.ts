import { phpLaravelFrameworkSourceRegistryProvider } from "./phpLaravelFrameworkSourceRegistryAdapter";
import {
  useLaravelSourceRegistries,
  type UseLaravelSourceRegistriesDependencies,
} from "./useLaravelSourceRegistries";

export interface PhpFrameworkSourceRegistryContext {
  signature: string;
  workspaceSources: readonly string[];
}

export type UsePhpFrameworkSourceRegistriesDependencies =
  UseLaravelSourceRegistriesDependencies;

export interface PhpFrameworkSourceRegistryProvider {
  currentPhpFrameworkSourceContextForRoot(
    rootPath: string,
  ): PhpFrameworkSourceRegistryContext;
  ensurePhpFrameworkSourceCollectionsLoaded(rootPath: string): Promise<void>;
  invalidatePhpFrameworkSourcePathForRoot(rootPath: string, path: string): void;
  resetPhpFrameworkSourceRegistries(): void;
}

export interface PhpFrameworkSourceRegistries {
  currentPhpFrameworkSourceContext(): PhpFrameworkSourceRegistryContext;
  ensurePhpFrameworkSourceCollectionsLoaded(rootPath: string): Promise<void>;
  invalidatePhpFrameworkSourcePath(root: string, path: string): void;
  resetPhpFrameworkSourceRegistries(): void;
}

export function usePhpFrameworkSourceRegistries(
  dependencies: UsePhpFrameworkSourceRegistriesDependencies,
): PhpFrameworkSourceRegistries {
  const { currentWorkspaceRootRef } = dependencies;
  const laravelSources = useLaravelSourceRegistries(dependencies);
  const sourceRegistryProviders = [
    phpLaravelFrameworkSourceRegistryProvider(laravelSources),
  ];

  return {
    currentPhpFrameworkSourceContext: () =>
      currentPhpFrameworkSourceContextForRoot(
        currentWorkspaceRootRef.current,
        sourceRegistryProviders,
      ),
    ensurePhpFrameworkSourceCollectionsLoaded: async (rootPath: string) => {
      await Promise.all(
        sourceRegistryProviders.map((sourceRegistryProvider) =>
          sourceRegistryProvider.ensurePhpFrameworkSourceCollectionsLoaded(
            rootPath,
          ),
        ),
      );
    },
    invalidatePhpFrameworkSourcePath: (root: string, path: string) => {
      sourceRegistryProviders.forEach((sourceRegistryProvider) => {
        sourceRegistryProvider.invalidatePhpFrameworkSourcePathForRoot(
          root,
          path,
        );
      });
    },
    resetPhpFrameworkSourceRegistries: () => {
      sourceRegistryProviders.forEach((sourceRegistryProvider) => {
        sourceRegistryProvider.resetPhpFrameworkSourceRegistries();
      });
    },
  };
}

function currentPhpFrameworkSourceContextForRoot(
  rootPath: string | null,
  sourceRegistryProviders: readonly PhpFrameworkSourceRegistryProvider[],
): PhpFrameworkSourceRegistryContext {
  if (!rootPath) {
    return { signature: "", workspaceSources: [] };
  }

  const sourceContexts = sourceRegistryProviders.map((sourceRegistryProvider) =>
    sourceRegistryProvider.currentPhpFrameworkSourceContextForRoot(rootPath),
  );

  if (sourceContexts.length === 0) {
    return { signature: "", workspaceSources: [] };
  }

  if (sourceContexts.length === 1) {
    return sourceContexts[0] ?? { signature: "", workspaceSources: [] };
  }

  return {
    signature: sourceContexts
      .map((sourceContext) => sourceContext.signature)
      .join("|"),
    workspaceSources: sourceContexts.flatMap(
      (sourceContext) => sourceContext.workspaceSources,
    ),
  };
}
