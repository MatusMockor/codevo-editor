import { useCallback, useRef, type MutableRefObject } from "react";
import { phpLaravelMorphMapEntriesFromSource } from "../domain/phpFrameworkLaravel";
import type { TextSearchGateway, WorkspaceDescriptor } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export interface UsePhpLaravelMorphMapResolverOptions {
  activePhpFrameworkProviderSignature: string;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkRuntime?: PhpFrameworkRuntimeContext;
  isLaravelFrameworkActive?: boolean;
  readNavigationFileContent: (path: string) => Promise<string>;
  textSearch: Pick<TextSearchGateway, "searchText">;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export interface PhpLaravelMorphMapResolver {
  resetPhpLaravelMorphMapModelTypeCache(): void;
  resolvePhpLaravelProjectMorphMapModelType(): Promise<string | null>;
}

export function usePhpLaravelMorphMapResolver({
  activePhpFrameworkProviderSignature,
  currentWorkspaceRootRef,
  frameworkRuntime,
  isLaravelFrameworkActive: legacyIsLaravelFrameworkActive = false,
  readNavigationFileContent,
  textSearch,
  workspaceDescriptor,
  workspaceRoot,
}: UsePhpLaravelMorphMapResolverOptions): PhpLaravelMorphMapResolver {
  const phpLaravelMorphMapModelTypeCacheRef = useRef<
    Record<string, string | null>
  >({});
  const frameworkProviderSignature = frameworkRuntime
    ? phpFrameworkRuntimeProviderSignature(frameworkRuntime)
    : activePhpFrameworkProviderSignature;
  const isLaravelFrameworkActive =
    frameworkRuntime?.isLaravel ?? legacyIsLaravelFrameworkActive;

  const resetPhpLaravelMorphMapModelTypeCache = useCallback((): void => {
    phpLaravelMorphMapModelTypeCacheRef.current = {};
  }, []);

  const resolvePhpLaravelProjectMorphMapModelType =
    useCallback(async (): Promise<string | null> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !isLaravelFrameworkActive ||
        !requestedRoot ||
        !workspaceDescriptor?.php ||
        !isRequestedRootActive()
      ) {
        return null;
      }

      const cacheKey = `${requestedRoot}:${frameworkProviderSignature}`;

      if (
        Object.prototype.hasOwnProperty.call(
          phpLaravelMorphMapModelTypeCacheRef.current,
          cacheKey,
        )
      ) {
        return phpLaravelMorphMapModelTypeCacheRef.current[cacheKey] ?? null;
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

      phpLaravelMorphMapModelTypeCacheRef.current[cacheKey] = modelType;

      return modelType;
    }, [
      currentWorkspaceRootRef,
      frameworkProviderSignature,
      isLaravelFrameworkActive,
      readNavigationFileContent,
      textSearch,
      workspaceDescriptor,
      workspaceRoot,
    ]);

  return {
    resetPhpLaravelMorphMapModelTypeCache,
    resolvePhpLaravelProjectMorphMapModelType,
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
