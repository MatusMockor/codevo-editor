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
  onSourcesAccepted?(
    rootPath: string,
    sources: readonly string[],
  ): void;
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
  onSourcesAccepted,
  onSourcesLoaded,
  sourceSignature,
  workspaceFiles,
}: PhpSourceCollectionRegistryDependencies): PhpSourceCollectionRegistry {
  const sourcesByRootRef = useRef<Record<string, PhpSourceCollectionCacheEntry>>(
    {},
  );
  const sourcesLoadInFlightRef = useRef<
    Record<
      string,
      { epoch: number; generation: number; promise: Promise<void> }
    >
  >({});
  const sourceCollectionEpochRef = useRef(0);
  const sourceCollectionGenerationByRootRef = useRef<Record<string, number>>(
    {},
  );

  const resetSourceCollectionRegistry = useCallback((): void => {
    sourceCollectionEpochRef.current += 1;
    sourceCollectionGenerationByRootRef.current = {};
    sourcesByRootRef.current = {};
    sourcesLoadInFlightRef.current = {};
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

      if (sourcesByRootRef.current[requestedRoot]) {
        return;
      }

      const existingLoad = sourcesLoadInFlightRef.current[requestedRoot];

      if (existingLoad) {
        return existingLoad.promise;
      }

      const requestedEpoch = sourceCollectionEpochRef.current;
      const requestedGeneration =
        sourceCollectionGenerationByRootRef.current[requestedRoot] ?? 0;
      const load = (async (): Promise<void> => {
        try {
          const sources = await loadSources(requestedRoot, workspaceFiles);

          if (
            sourceCollectionEpochRef.current !== requestedEpoch ||
            (sourceCollectionGenerationByRootRef.current[requestedRoot] ?? 0) !==
              requestedGeneration ||
            !workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              requestedRoot,
            )
          ) {
            return;
          }

          sourcesByRootRef.current[requestedRoot] = {
            signature: sourceSignature(sources),
            sources,
          };
          onSourcesAccepted?.(requestedRoot, sources);
          onSourcesLoaded(requestedRoot);
        } catch {
          // Graceful: unavailable framework source collections keep existing fallbacks.
        } finally {
          const currentLoad = sourcesLoadInFlightRef.current[requestedRoot];

          if (
            currentLoad?.epoch === requestedEpoch &&
            currentLoad.generation === requestedGeneration
          ) {
            delete sourcesLoadInFlightRef.current[requestedRoot];
          }
        }
      })();

      sourcesLoadInFlightRef.current[requestedRoot] = {
        epoch: requestedEpoch,
        generation: requestedGeneration,
        promise: load,
      };
      return load;
    },
    [
      currentWorkspaceRootRef,
      isActive,
      loadSources,
      onSourcesAccepted,
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

      sourceCollectionGenerationByRootRef.current[root] =
        (sourceCollectionGenerationByRootRef.current[root] ?? 0) + 1;
      delete sourcesByRootRef.current[root];
      delete sourcesLoadInFlightRef.current[root];
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
