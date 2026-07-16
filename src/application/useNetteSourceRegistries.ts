import { useCallback, useRef, type MutableRefObject } from "react";
import type { WorkspaceFileGateway } from "../domain/workspace";
import {
  isPhpNetteNeonConfigPath,
  loadPhpNetteNeonConfigSourceCollection,
  phpNetteNeonConfigSourcesSignature,
} from "./phpNetteNeonSources";
import { usePhpSourceCollectionRegistry } from "./usePhpSourceCollectionRegistry";

export interface PhpNetteSourceContext {
  signature: string;
  workspaceSources: readonly string[];
}

export interface UseNetteSourceRegistriesDependencies {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  isActive: boolean;
  onSourcesLoaded(rootPath: string): void;
  workspaceFiles: Pick<WorkspaceFileGateway, "readDirectory" | "readTextFile">;
}

export interface NetteSourceRegistries {
  currentPhpNetteSourceContextForRoot(rootPath: string): PhpNetteSourceContext;
  ensurePhpNetteNeonConfigSourcesLoaded(rootPath: string): Promise<void>;
  invalidatePhpNetteNeonConfigSourcesForPath(
    rootPath: string,
    path: string,
  ): void;
  resetPhpNetteSourceRegistries(): void;
}

export function useNetteSourceRegistries({
  currentWorkspaceRootRef,
  isActive,
  onSourcesLoaded,
  workspaceFiles,
}: UseNetteSourceRegistriesDependencies): NetteSourceRegistries {
  const discoveredPathsByRootRef = useRef<Record<string, ReadonlySet<string>>>(
    {},
  );
  const isTrackedNetteSourcePath = useCallback(
    (rootPath: string, path: string): boolean =>
      isPhpNetteNeonConfigPath(rootPath, path) ||
      discoveredPathsByRootRef.current[rootPath]?.has(path) === true,
    [],
  );
  const loadTrackedNetteSources = useCallback(
    async (
      rootPath: string,
      reader: Pick<WorkspaceFileGateway, "readDirectory" | "readTextFile">,
    ): Promise<readonly string[]> => {
      const collection = await loadPhpNetteNeonConfigSourceCollection(
        rootPath,
        reader,
      );
      discoveredPathsByRootRef.current[rootPath] = collection.discoveredPaths;
      return collection.entries.map((entry) => entry.source);
    },
    [],
  );
  const {
    currentSourceCollectionEntry: currentNeonSourceEntry,
    ensureSourceCollectionLoaded: ensurePhpNetteNeonConfigSourcesLoaded,
    invalidateSourceCollectionForPath:
      invalidatePhpNetteNeonConfigSourcesForPath,
    resetSourceCollectionRegistry: resetPhpNetteNeonSourceRegistry,
  } = usePhpSourceCollectionRegistry({
    currentWorkspaceRootRef,
    isActive,
    isSourcePath: isTrackedNetteSourcePath,
    loadSources: loadTrackedNetteSources,
    onSourcesLoaded,
    sourceSignature: phpNetteNeonConfigSourcesSignature,
    workspaceFiles,
  });
  const resetPhpNetteSourceRegistries = useCallback((): void => {
    discoveredPathsByRootRef.current = {};
    resetPhpNetteNeonSourceRegistry();
  }, [resetPhpNetteNeonSourceRegistry]);

  const currentPhpNetteSourceContextForRoot = useCallback(
    (rootPath: string): PhpNetteSourceContext => {
      if (!rootPath) {
        return { signature: "", workspaceSources: [] };
      }

      const neonEntry = currentNeonSourceEntry(rootPath);

      return {
        signature: `neon:${neonEntry?.signature ?? ""}`,
        workspaceSources: neonEntry?.sources ?? [],
      };
    },
    [currentNeonSourceEntry],
  );

  return {
    currentPhpNetteSourceContextForRoot,
    ensurePhpNetteNeonConfigSourcesLoaded,
    invalidatePhpNetteNeonConfigSourcesForPath,
    resetPhpNetteSourceRegistries,
  };
}
