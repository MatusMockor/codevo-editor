import { useCallback, useRef, type MutableRefObject } from "react";
import { phpLaravelMorphMapEntriesFromSource } from "../domain/phpFrameworkLaravel";
import type { TextSearchGateway, WorkspaceDescriptor } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export interface UsePhpFrameworkMorphMapResolverOptions {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkRuntime: PhpFrameworkRuntimeContext;
  readNavigationFileContent: (path: string) => Promise<string>;
  textSearch: Pick<TextSearchGateway, "searchText">;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export interface PhpFrameworkMorphMapResolver {
  resetPhpFrameworkMorphMapModelTypeCache(): void;
  resolvePhpFrameworkProjectMorphMapModelType(): Promise<string | null>;
}

export function usePhpFrameworkMorphMapResolver({
  currentWorkspaceRootRef,
  frameworkRuntime,
  readNavigationFileContent,
  textSearch,
  workspaceDescriptor,
  workspaceRoot,
}: UsePhpFrameworkMorphMapResolverOptions): PhpFrameworkMorphMapResolver {
  const phpFrameworkMorphMapModelTypeCacheRef = useRef<
    Record<string, string | null>
  >({});
  const frameworkProviderSignature =
    phpFrameworkRuntimeProviderSignature(frameworkRuntime);
  const supportsEloquentModelSemantics = frameworkRuntime.supports(
    "eloquentModelSemantics",
  );

  const resetPhpFrameworkMorphMapModelTypeCache = useCallback((): void => {
    phpFrameworkMorphMapModelTypeCacheRef.current = {};
  }, []);

  const resolvePhpFrameworkProjectMorphMapModelType =
    useCallback(async (): Promise<string | null> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !supportsEloquentModelSemantics ||
        !requestedRoot ||
        !workspaceDescriptor?.php ||
        !isRequestedRootActive()
      ) {
        return null;
      }

      const cacheKey = `${requestedRoot}:${frameworkProviderSignature}`;

      if (
        Object.prototype.hasOwnProperty.call(
          phpFrameworkMorphMapModelTypeCacheRef.current,
          cacheKey,
        )
      ) {
        return phpFrameworkMorphMapModelTypeCacheRef.current[cacheKey] ?? null;
      }

      const modelTypes = new Set<string>();
      const searchResults = await Promise.all(
        ["morphMap", "enforceMorphMap"].map((query) =>
          textSearch.searchText(requestedRoot, query, 200),
        ),
      );

      if (!isRequestedRootActive()) {
        return null;
      }

      const visitedPaths = new Set<string>();

      for (const result of searchResults.flat()) {
        if (!isRequestedRootActive()) {
          return null;
        }

        if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
          continue;
        }

        visitedPaths.add(result.path);

        try {
          const content = await readNavigationFileContent(result.path);

          if (!isRequestedRootActive()) {
            return null;
          }

          for (const entry of phpLaravelMorphMapEntriesFromSource(content)) {
            modelTypes.add(entry.modelClassName.replace(/^\\+/, ""));
          }
        } catch {
          if (!isRequestedRootActive()) {
            return null;
          }

          continue;
        }
      }

      const modelType =
        modelTypes.size === 1 ? (Array.from(modelTypes)[0] ?? null) : null;

      if (!isRequestedRootActive()) {
        return null;
      }

      phpFrameworkMorphMapModelTypeCacheRef.current[cacheKey] = modelType;

      return modelType;
    }, [
      currentWorkspaceRootRef,
      frameworkProviderSignature,
      supportsEloquentModelSemantics,
      readNavigationFileContent,
      textSearch,
      workspaceDescriptor,
      workspaceRoot,
    ]);

  return {
    resetPhpFrameworkMorphMapModelTypeCache,
    resolvePhpFrameworkProjectMorphMapModelType,
  };
}

function isPhpPath(path: string): boolean {
  return path.toLowerCase().endsWith(".php");
}

function phpFrameworkRuntimeProviderSignature(
  frameworkRuntime: PhpFrameworkRuntimeContext,
): string {
  return `${frameworkRuntime.profile}:${frameworkRuntime.providers
    .map((provider) => provider.id)
    .join(",")}`;
}
