import { useCallback, useRef, type MutableRefObject } from "react";
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
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

interface PhpLaravelSourcesCacheEntry {
  signature: string;
  sources: readonly string[];
}

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
  const phpLaravelMigrationSourcesByRootRef = useRef<
    Record<string, PhpLaravelSourcesCacheEntry>
  >({});
  const phpLaravelMigrationSourcesLoadInFlightRef = useRef<Set<string>>(
    new Set(),
  );
  const phpLaravelProviderSourcesByRootRef = useRef<
    Record<string, PhpLaravelSourcesCacheEntry>
  >({});
  const phpLaravelProviderSourcesLoadInFlightRef = useRef<Set<string>>(
    new Set(),
  );

  const resetPhpLaravelSourceRegistries = useCallback((): void => {
    phpLaravelMigrationSourcesByRootRef.current = {};
    phpLaravelMigrationSourcesLoadInFlightRef.current = new Set();
    phpLaravelProviderSourcesByRootRef.current = {};
    phpLaravelProviderSourcesLoadInFlightRef.current = new Set();
  }, []);

  const currentPhpLaravelSourceContext =
    useCallback((): PhpLaravelSourceContext => {
      const root = currentWorkspaceRootRef.current;

      if (!root) {
        return { signature: "", workspaceSources: [] };
      }

      const migrationEntry = phpLaravelMigrationSourcesByRootRef.current[root];
      const providerEntry = phpLaravelProviderSourcesByRootRef.current[root];
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
    }, [currentWorkspaceRootRef]);

  const ensurePhpLaravelMigrationSourcesLoaded = useCallback(
    async (requestedRoot: string): Promise<void> => {
      if (!isLaravelFrameworkActive || !requestedRoot) {
        return;
      }

      if (
        phpLaravelMigrationSourcesByRootRef.current[requestedRoot] ||
        phpLaravelMigrationSourcesLoadInFlightRef.current.has(requestedRoot)
      ) {
        return;
      }

      phpLaravelMigrationSourcesLoadInFlightRef.current.add(requestedRoot);

      try {
        const sources = await loadPhpLaravelMigrationSources(
          requestedRoot,
          workspaceFiles,
        );

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        phpLaravelMigrationSourcesByRootRef.current[requestedRoot] = {
          signature: phpLaravelMigrationSourcesSignature(sources),
          sources,
        };
        onSourcesLoaded(requestedRoot);
      } catch {
        // Graceful: migrations unavailable -> keep the $fillable/$casts fallback.
      } finally {
        phpLaravelMigrationSourcesLoadInFlightRef.current.delete(requestedRoot);
      }
    },
    [
      currentWorkspaceRootRef,
      isLaravelFrameworkActive,
      onSourcesLoaded,
      workspaceFiles,
    ],
  );

  const invalidatePhpLaravelMigrationSourcesForPath = useCallback(
    (root: string, path: string): void => {
      if (!isPhpLaravelMigrationPath(root, path)) {
        return;
      }

      delete phpLaravelMigrationSourcesByRootRef.current[root];
      phpLaravelMigrationSourcesLoadInFlightRef.current.delete(root);
    },
    [],
  );

  const ensurePhpLaravelProviderSourcesLoaded = useCallback(
    async (requestedRoot: string): Promise<void> => {
      if (!isLaravelFrameworkActive || !requestedRoot) {
        return;
      }

      if (
        phpLaravelProviderSourcesByRootRef.current[requestedRoot] ||
        phpLaravelProviderSourcesLoadInFlightRef.current.has(requestedRoot)
      ) {
        return;
      }

      phpLaravelProviderSourcesLoadInFlightRef.current.add(requestedRoot);

      try {
        const sources = await loadPhpLaravelProviderSources(
          requestedRoot,
          workspaceFiles,
        );

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        phpLaravelProviderSourcesByRootRef.current[requestedRoot] = {
          signature: phpLaravelProviderSourcesSignature(sources),
          sources,
        };
        onSourcesLoaded(requestedRoot);
      } catch {
        // Graceful: providers unavailable -> no provider-defined macros surface.
      } finally {
        phpLaravelProviderSourcesLoadInFlightRef.current.delete(requestedRoot);
      }
    },
    [
      currentWorkspaceRootRef,
      isLaravelFrameworkActive,
      onSourcesLoaded,
      workspaceFiles,
    ],
  );

  const invalidatePhpLaravelProviderSourcesForPath = useCallback(
    (root: string, path: string): void => {
      if (!isPhpLaravelProviderPath(root, path)) {
        return;
      }

      delete phpLaravelProviderSourcesByRootRef.current[root];
      phpLaravelProviderSourcesLoadInFlightRef.current.delete(root);
    },
    [],
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
