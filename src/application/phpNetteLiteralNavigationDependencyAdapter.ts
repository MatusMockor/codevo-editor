import { useCallback, useMemo } from "react";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { findNetteRedrawControlSnippetDefinitionTarget } from "./netteAjaxSnippetDefinitions";
import type {
  PhpFrameworkLiteralNavigationDependencyAdapterExtras,
  PhpFrameworkLiteralNavigationDependencyAdapterHookDependencies,
} from "./phpFrameworkLiteralNavigationDependencyAdapters";

export function usePhpNetteLiteralNavigationDependencyAdapter({
  currentWorkspaceRootRef,
  joinWorkspacePath,
  readNavigationFileContent,
  relativeWorkspacePath,
  workspaceRoot,
}: PhpFrameworkLiteralNavigationDependencyAdapterHookDependencies): PhpFrameworkLiteralNavigationDependencyAdapterExtras {
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
      findNetteRedrawControlSnippetTarget,
    }),
    [findNetteRedrawControlSnippetTarget],
  );
}
