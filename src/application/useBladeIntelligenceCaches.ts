import { useCallback, useMemo, useRef } from "react";
import type { BladeViewDataEntry } from "../domain/bladeViewVariables";
import type { FileEntry, TextSearchGateway } from "../domain/workspace";
import type { BladeIntelligenceDependencies } from "./bladeIntelligenceContracts";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  collectBladeComponentNames as collectBladeComponentNamesFromWorkspace,
  invalidateBladeComponentNamesForPath as invalidateBladeComponentNamesForCachePath,
} from "./bladeComponentDiscovery";
import {
  createBladeViewVariableResolver,
  type BladeViewVariableResolver,
} from "./bladeViewVariableResolver";
import {
  ensureBladeViewDataEntriesLoaded as loadBladeViewDataEntries,
  invalidateBladeViewDataEntriesForPath as invalidateBladeViewDataEntriesForCachePath,
} from "./bladeViewDataCache";

export interface BladeIntelligenceCacheDependencies {
  currentWorkspaceRootRef: { readonly current: string | null };
  frameworkRuntime: PhpFrameworkRuntimeContext;
  readNavigationFileContent: (path: string) => Promise<string>;
  relativeWorkspacePath: (workspaceRoot: string, path: string) => string;
  resolvePhpClassPropertyOrRelationType: BladeIntelligenceDependencies["resolvePhpClassPropertyOrRelationType"];
  resolvePhpDeclaredType: BladeIntelligenceDependencies["resolvePhpDeclaredType"];
  resolvePhpExpressionType: BladeIntelligenceDependencies["resolvePhpExpressionType"];
  textSearch: Pick<TextSearchGateway, "searchText">;
  workspaceFiles: { readDirectory: (path: string) => Promise<FileEntry[]> };
  workspaceRoot: string | null;
}

export interface BladeIntelligenceCaches extends BladeViewVariableResolver {
  collectBladeComponentNames: () => Promise<string[]>;
  invalidateBladeComponentNamesForPath: (root: string, path: string) => void;
  invalidateBladeViewDataEntriesForPath: (root: string, path: string) => void;
  resetBladeIntelligenceCaches: () => void;
}

export function useBladeIntelligenceCaches(
  dependencies: BladeIntelligenceCacheDependencies,
): BladeIntelligenceCaches {
  const {
    currentWorkspaceRootRef,
    frameworkRuntime,
    readNavigationFileContent,
    relativeWorkspacePath,
    resolvePhpClassPropertyOrRelationType,
    resolvePhpDeclaredType,
    resolvePhpExpressionType,
    textSearch,
    workspaceFiles,
    workspaceRoot,
  } = dependencies;
  const bladeViewDataEntriesByRootRef = useRef<
    Record<string, BladeViewDataEntry[]>
  >({});
  const bladeViewDataEntriesLoadInFlightRef = useRef<
    Map<string, Promise<BladeViewDataEntry[] | null>>
  >(new Map());
  const bladeComponentNamesByRootRef = useRef<Record<string, string[]>>({});

  const ensureBladeViewDataEntriesLoaded = useCallback(
    async (requestedRoot: string): Promise<BladeViewDataEntry[] | null> => {
      return loadBladeViewDataEntries(requestedRoot, {
        currentWorkspaceRootRef,
        entriesByRootRef: bladeViewDataEntriesByRootRef,
        frameworkRuntime,
        loadInFlightRef: bladeViewDataEntriesLoadInFlightRef,
        readNavigationFileContent,
        textSearch,
      });
    },
    [
      currentWorkspaceRootRef,
      frameworkRuntime,
      readNavigationFileContent,
      textSearch,
    ],
  );

  const invalidateBladeViewDataEntriesForPath = useCallback(
    (root: string, path: string): void => {
      invalidateBladeViewDataEntriesForCachePath(
        bladeViewDataEntriesByRootRef,
        bladeViewDataEntriesLoadInFlightRef,
        root,
        path,
      );
    },
    [],
  );

  const viewVariableResolver = useMemo(
    () =>
      createBladeViewVariableResolver({
        currentWorkspaceRootRef,
        ensureBladeViewDataEntriesLoaded,
        resolvePhpClassPropertyOrRelationType,
        resolvePhpDeclaredType,
        resolvePhpExpressionType,
        workspaceRoot,
      }),
    [
      currentWorkspaceRootRef,
      ensureBladeViewDataEntriesLoaded,
      resolvePhpClassPropertyOrRelationType,
      resolvePhpDeclaredType,
      resolvePhpExpressionType,
      workspaceRoot,
    ],
  );

  const collectBladeComponentNames = useCallback(async (): Promise<string[]> => {
    return collectBladeComponentNamesFromWorkspace({
      cacheRef: bladeComponentNamesByRootRef,
      currentWorkspaceRootRef,
      relativeWorkspacePath,
      workspaceFiles,
      workspaceRoot,
    });
  }, [
    currentWorkspaceRootRef,
    relativeWorkspacePath,
    workspaceFiles,
    workspaceRoot,
  ]);

  const invalidateBladeComponentNamesForPath = useCallback(
    (root: string, path: string): void => {
      invalidateBladeComponentNamesForCachePath(
        bladeComponentNamesByRootRef,
        root,
        path,
      );
    },
    [],
  );

  const resetBladeIntelligenceCaches = useCallback((): void => {
    bladeViewDataEntriesByRootRef.current = {};
    bladeViewDataEntriesLoadInFlightRef.current = new Map();
    bladeComponentNamesByRootRef.current = {};
  }, []);

  return {
    collectBladeComponentNames,
    collectBladeForeachLoopVariables:
      viewVariableResolver.collectBladeForeachLoopVariables,
    collectBladeViewVariablesWithDisplayTypes:
      viewVariableResolver.collectBladeViewVariablesWithDisplayTypes,
    invalidateBladeComponentNamesForPath,
    invalidateBladeViewDataEntriesForPath,
    resolveBladeForeachElementTypeForVariable:
      viewVariableResolver.resolveBladeForeachElementTypeForVariable,
    resolveBladeViewVariableTypeForView:
      viewVariableResolver.resolveBladeViewVariableTypeForView,
    resetBladeIntelligenceCaches,
  };
}
