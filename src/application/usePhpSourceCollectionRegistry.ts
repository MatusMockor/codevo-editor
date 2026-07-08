import { useCallback, useRef, type MutableRefObject } from "react";
import type { WorkspaceFileGateway } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface PhpSourceCollectionCacheEntry {
  signature: string;
  sources: readonly string[];
}

export interface PhpSourceCollectionRegistryDependencies {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  isActive: boolean;
  isSourcePath(root: string, path: string): boolean;
  loadSources(
    rootPath: string,
    workspaceFiles: Pick<WorkspaceFileGateway, "readDirectory" | "readTextFile">,
  ): Promise<readonly string[]>;
  onSourcesLoaded(rootPath: string): void;
  sourceSignature(sources: readonly string[]): string;
  workspaceFiles: Pick<WorkspaceFileGateway, "readDirectory" | "readTextFile">;
}

export interface PhpSourceCollectionRegistry {
  currentSourceCollectionEntry(
    rootPath: string,
  ): PhpSourceCollectionCacheEntry | null;
  ensureSourceCollectionLoaded(rootPath: string): Promise<void>;
  invalidateSourceCollectionForPath(rootPath: string, path: string): void;
  resetSourceCollectionRegistry(): void;
}

export function usePhpSourceCollectionRegistry({
  currentWorkspaceRootRef,
  isActive,
  isSourcePath,
  loadSources,
  onSourcesLoaded,
  sourceSignature,
  workspaceFiles,
}: PhpSourceCollectionRegistryDependencies): PhpSourceCollectionRegistry {
  const sourcesByRootRef = useRef<Record<string, PhpSourceCollectionCacheEntry>>(
    {},
  );
  const sourcesLoadInFlightRef = useRef<Set<string>>(new Set());

  const resetSourceCollectionRegistry = useCallback((): void => {
    sourcesByRootRef.current = {};
    sourcesLoadInFlightRef.current = new Set();
  }, []);

  const currentSourceCollectionEntry = useCallback(
    (rootPath: string): PhpSourceCollectionCacheEntry | null =>
      sourcesByRootRef.current[rootPath] ?? null,
    [],
  );

  const ensureSourceCollectionLoaded = useCallback(
    async (requestedRoot: string): Promise<void> => {
      if (!isActive || !requestedRoot) {
        return;
      }

      if (
        sourcesByRootRef.current[requestedRoot] ||
        sourcesLoadInFlightRef.current.has(requestedRoot)
      ) {
        return;
      }

      sourcesLoadInFlightRef.current.add(requestedRoot);

      try {
        const sources = await loadSources(requestedRoot, workspaceFiles);

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        sourcesByRootRef.current[requestedRoot] = {
          signature: sourceSignature(sources),
          sources,
        };
        onSourcesLoaded(requestedRoot);
      } catch {
        // Graceful: unavailable framework source collections keep existing fallbacks.
      } finally {
        sourcesLoadInFlightRef.current.delete(requestedRoot);
      }
    },
    [
      currentWorkspaceRootRef,
      isActive,
      loadSources,
      onSourcesLoaded,
      sourceSignature,
      workspaceFiles,
    ],
  );

  const invalidateSourceCollectionForPath = useCallback(
    (root: string, path: string): void => {
      if (!isSourcePath(root, path)) {
        return;
      }

      delete sourcesByRootRef.current[root];
      sourcesLoadInFlightRef.current.delete(root);
    },
    [isSourcePath],
  );

  return {
    currentSourceCollectionEntry,
    ensureSourceCollectionLoaded,
    invalidateSourceCollectionForPath,
    resetSourceCollectionRegistry,
  };
}
