import { useCallback, type MutableRefObject } from "react";
import type { WorkspaceFileGateway } from "../domain/workspace";
import {
  isPhpNetteNeonConfigPath,
  loadPhpNetteNeonConfigSources,
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
  const {
    currentSourceCollectionEntry: currentNeonSourceEntry,
    ensureSourceCollectionLoaded: ensurePhpNetteNeonConfigSourcesLoaded,
    invalidateSourceCollectionForPath:
      invalidatePhpNetteNeonConfigSourcesForPath,
    resetSourceCollectionRegistry: resetPhpNetteNeonSourceRegistry,
  } = usePhpSourceCollectionRegistry({
    currentWorkspaceRootRef,
    isActive,
    isSourcePath: isPhpNetteNeonConfigPath,
    loadSources: loadPhpNetteNeonConfigSources,
    onSourcesLoaded,
    sourceSignature: phpNetteNeonConfigSourcesSignature,
    workspaceFiles,
  });

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
    resetPhpNetteSourceRegistries: resetPhpNetteNeonSourceRegistry,
  };
}
