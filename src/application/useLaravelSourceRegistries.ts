import { useCallback, type MutableRefObject } from "react";
import {
  isPhpLaravelMigrationPath,
  loadPhpLaravelMigrationSources,
  phpLaravelMigrationSourcesSignature,
} from "./phpLaravelMigrationSources";
import {
  isPhpLaravelProviderPath,
  loadPhpLaravelProviderSources,
  phpLaravelProviderSourcesSignature,
} from "./phpLaravelProviderSources";
import type { WorkspaceFileGateway } from "../domain/workspace";
import { usePhpSourceCollectionRegistry } from "./usePhpSourceCollectionRegistry";

export interface PhpLaravelSourceContext {
  signature: string;
  workspaceSources: readonly string[];
}

export interface UseLaravelSourceRegistriesDependencies {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  isLaravelFrameworkActive: boolean;
  onSourcesLoaded(rootPath: string): void;
  workspaceFiles: Pick<WorkspaceFileGateway, "readDirectory" | "readTextFile">;
}

export interface LaravelSourceRegistries {
  currentPhpLaravelSourceContext(): PhpLaravelSourceContext;
  ensurePhpLaravelMigrationSourcesLoaded(rootPath: string): Promise<void>;
  ensurePhpLaravelProviderSourcesLoaded(rootPath: string): Promise<void>;
  invalidatePhpLaravelMigrationSourcesForPath(root: string, path: string): void;
  invalidatePhpLaravelProviderSourcesForPath(root: string, path: string): void;
  resetPhpLaravelSourceRegistries(): void;
}

export function useLaravelSourceRegistries({
  currentWorkspaceRootRef,
  isLaravelFrameworkActive,
  onSourcesLoaded,
  workspaceFiles,
}: UseLaravelSourceRegistriesDependencies): LaravelSourceRegistries {
  const {
    currentSourceCollectionEntry: currentMigrationSourceEntry,
    ensureSourceCollectionLoaded: ensurePhpLaravelMigrationSourcesLoaded,
    invalidateSourceCollectionForPath:
      invalidatePhpLaravelMigrationSourcesForPath,
    resetSourceCollectionRegistry: resetPhpLaravelMigrationSourceRegistry,
  } = usePhpSourceCollectionRegistry({
    currentWorkspaceRootRef,
    isActive: isLaravelFrameworkActive,
    isSourcePath: isPhpLaravelMigrationPath,
    loadSources: loadPhpLaravelMigrationSources,
    onSourcesLoaded,
    sourceSignature: phpLaravelMigrationSourcesSignature,
    workspaceFiles,
  });
  const {
    currentSourceCollectionEntry: currentProviderSourceEntry,
    ensureSourceCollectionLoaded: ensurePhpLaravelProviderSourcesLoaded,
    invalidateSourceCollectionForPath:
      invalidatePhpLaravelProviderSourcesForPath,
    resetSourceCollectionRegistry: resetPhpLaravelProviderSourceRegistry,
  } = usePhpSourceCollectionRegistry({
    currentWorkspaceRootRef,
    isActive: isLaravelFrameworkActive,
    isSourcePath: isPhpLaravelProviderPath,
    loadSources: loadPhpLaravelProviderSources,
    onSourcesLoaded,
    sourceSignature: phpLaravelProviderSourcesSignature,
    workspaceFiles,
  });

  const resetPhpLaravelSourceRegistries = useCallback((): void => {
    resetPhpLaravelMigrationSourceRegistry();
    resetPhpLaravelProviderSourceRegistry();
  }, [
    resetPhpLaravelMigrationSourceRegistry,
    resetPhpLaravelProviderSourceRegistry,
  ]);

  const currentPhpLaravelSourceContext =
    useCallback((): PhpLaravelSourceContext => {
      const root = currentWorkspaceRootRef.current;

      if (!root) {
        return { signature: "", workspaceSources: [] };
      }

      const migrationEntry = currentMigrationSourceEntry(root);
      const providerEntry = currentProviderSourceEntry(root);
      const migrationSources = migrationEntry?.sources ?? [];
      const providerSources = providerEntry?.sources ?? [];
      const signature = `m:${migrationEntry?.signature ?? ""}|p:${providerEntry?.signature ?? ""}`;

      if (providerSources.length === 0) {
        return { signature, workspaceSources: migrationSources };
      }

      if (migrationSources.length === 0) {
        return { signature, workspaceSources: providerSources };
      }

      return {
        signature,
        workspaceSources: [...migrationSources, ...providerSources],
      };
    },
    [
      currentWorkspaceRootRef,
      currentMigrationSourceEntry,
      currentProviderSourceEntry,
    ],
  );

  return {
    currentPhpLaravelSourceContext,
    ensurePhpLaravelMigrationSourcesLoaded,
    ensurePhpLaravelProviderSourcesLoaded,
    invalidatePhpLaravelMigrationSourcesForPath,
    invalidatePhpLaravelProviderSourcesForPath,
    resetPhpLaravelSourceRegistries,
  };
}
