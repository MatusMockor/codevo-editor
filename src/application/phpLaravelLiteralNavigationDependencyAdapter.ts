import { useCallback, useMemo } from "react";
import { findInertiaComponentTarget as findLaravelInertiaComponentTarget } from "./inertiaComponentTarget";
import type {
  PhpFrameworkLiteralNavigationDependencyAdapterExtras,
  PhpFrameworkLiteralNavigationDependencyAdapterHookDependencies,
} from "./phpFrameworkLiteralNavigationDependencyAdapters";

export function usePhpLaravelLiteralNavigationDependencyAdapter({
  currentWorkspaceRootRef,
  readWorkspaceDirectory,
}: PhpFrameworkLiteralNavigationDependencyAdapterHookDependencies): PhpFrameworkLiteralNavigationDependencyAdapterExtras {
  const findInertiaComponentTarget = useCallback(
    (componentName: string) =>
      findLaravelInertiaComponentTarget(componentName, {
        currentWorkspaceRootRef,
        readDirectory: readWorkspaceDirectory,
      }),
    [currentWorkspaceRootRef, readWorkspaceDirectory],
  );

  return useMemo(
    () => ({
      findInertiaComponentTarget,
    }),
    [findInertiaComponentTarget],
  );
}
