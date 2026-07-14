import { useCallback, useMemo } from "react";
import type { FileEntry } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { findInertiaComponentTarget as findLaravelInertiaComponentTarget } from "./inertiaComponentTarget";
import { findNetteRedrawControlSnippetDefinitionTarget } from "./netteAjaxSnippetDefinitions";
import type { PhpFrameworkLiteralNavigationDependencies } from "./phpFrameworkLiteralNavigation";

export interface PhpFrameworkLiteralNavigationDependencyHookDependencies {
  collectNamedRouteTargets: PhpFrameworkLiteralNavigationDependencies["collectNamedRouteTargets"];
  currentWorkspaceRootRef: { readonly current: string | null };
  findCacheStoreTarget: NonNullable<
    PhpFrameworkLiteralNavigationDependencies["findCacheStoreTarget"]
  >;
  findConfigTarget: PhpFrameworkLiteralNavigationDependencies["findConfigTarget"];
  findEnvTarget: PhpFrameworkLiteralNavigationDependencies["findEnvTarget"];
  findTranslationTarget: PhpFrameworkLiteralNavigationDependencies["findTranslationTarget"];
  findViewTarget: PhpFrameworkLiteralNavigationDependencies["findViewTarget"];
  joinWorkspacePath: (workspaceRoot: string, relativePath: string) => string;
  readNavigationFileContent: (path: string) => Promise<string>;
  readWorkspaceDirectory: (path: string) => Promise<FileEntry[]>;
  relativeWorkspacePath: (workspaceRoot: string, path: string) => string;
  workspaceRoot: string | null;
}

export function usePhpFrameworkLiteralNavigationDependencies({
  collectNamedRouteTargets,
  currentWorkspaceRootRef,
  findCacheStoreTarget,
  findConfigTarget,
  findEnvTarget,
  findTranslationTarget,
  findViewTarget,
  joinWorkspacePath,
  readNavigationFileContent,
  readWorkspaceDirectory,
  relativeWorkspacePath,
  workspaceRoot,
}: PhpFrameworkLiteralNavigationDependencyHookDependencies): PhpFrameworkLiteralNavigationDependencies {
  const findInertiaComponentTarget = useCallback(
    (componentName: string) =>
      findLaravelInertiaComponentTarget(componentName, {
        currentWorkspaceRootRef,
        readDirectory: readWorkspaceDirectory,
      }),
    [currentWorkspaceRootRef, readWorkspaceDirectory],
  );

  const findNetteRedrawControlSnippetTarget = useCallback(
    async (currentPath: string, snippetName: string) => {
      const requestedRoot = workspaceRoot;

      if (
        !requestedRoot ||
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return null;
      }

      return findNetteRedrawControlSnippetDefinitionTarget(
        {
          currentPhpRelativePath: relativeWorkspacePath(
            requestedRoot,
            currentPath,
          ),
          deps: {
            joinPath: joinWorkspacePath,
            readFileContent: readNavigationFileContent,
          },
          isRequestedRootActive: () =>
            workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              requestedRoot,
            ),
          requestedRoot,
        },
        snippetName,
      );
    },
    [
      currentWorkspaceRootRef,
      joinWorkspacePath,
      readNavigationFileContent,
      relativeWorkspacePath,
      workspaceRoot,
    ],
  );

  return useMemo(
    () => ({
      collectNamedRouteTargets,
      findCacheStoreTarget,
      findConfigTarget,
      findEnvTarget,
      findInertiaComponentTarget,
      findNetteRedrawControlSnippetTarget,
      findTranslationTarget,
      findViewTarget,
    }),
    [
      collectNamedRouteTargets,
      findCacheStoreTarget,
      findConfigTarget,
      findEnvTarget,
      findInertiaComponentTarget,
      findNetteRedrawControlSnippetTarget,
      findTranslationTarget,
      findViewTarget,
    ],
  );
}
