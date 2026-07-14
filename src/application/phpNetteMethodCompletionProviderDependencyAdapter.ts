import { useMemo } from "react";
import { createNetteRedrawControlSnippetTargetCollector } from "./netteAjaxSnippetCompletions";
import type {
  PhpFrameworkMethodCompletionProviderDependencyAdapterExtras,
  PhpFrameworkMethodCompletionProviderDependencyAdapterHookDependencies,
} from "./phpFrameworkMethodCompletionProviderDependencyAdapters";

export function usePhpNetteMethodCompletionProviderDependencyAdapter({
  currentWorkspaceRootRef,
  joinWorkspacePath,
  readNavigationFileContent,
  relativeWorkspacePath,
  workspaceRoot,
}: PhpFrameworkMethodCompletionProviderDependencyAdapterHookDependencies): PhpFrameworkMethodCompletionProviderDependencyAdapterExtras {
  const collectNetteRedrawControlSnippetTargets = useMemo(
    () =>
      createNetteRedrawControlSnippetTargetCollector({
        currentWorkspaceRootRef,
        joinWorkspacePath,
        readNavigationFileContent,
        relativeWorkspacePath,
        workspaceRoot,
      }),
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
      collectNetteRedrawControlSnippetTargets,
    }),
    [collectNetteRedrawControlSnippetTargets],
  );
}
