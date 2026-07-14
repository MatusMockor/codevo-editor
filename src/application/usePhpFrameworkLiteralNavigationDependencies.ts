import { useCallback, useMemo } from "react";
import type { FileEntry } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { findInertiaComponentTarget as findLaravelInertiaComponentTarget } from "./inertiaComponentTarget";
import { findNetteRedrawControlSnippetDefinitionTarget } from "./netteAjaxSnippetDefinitions";
import type { PhpFrameworkLiteralNavigationDependencies } from "./phpFrameworkLiteralNavigation";

export interface PhpFrameworkLiteralNavigationDependencyHookDependencies {
  collectNamedRouteTargets: PhpFrameworkLiteralNavigationDependencies["collectNamedRouteTargets"];
  currentWorkspaceRootRef: { readonly current: string | null };
  findAuthGuardTarget: NonNullable<
    PhpFrameworkLiteralNavigationDependencies["findAuthGuardTarget"]
  >;
  findBroadcastConnectionTarget: NonNullable<
    PhpFrameworkLiteralNavigationDependencies["findBroadcastConnectionTarget"]
  >;
  findCacheStoreTarget: NonNullable<
    PhpFrameworkLiteralNavigationDependencies["findCacheStoreTarget"]
  >;
  findConfigTarget: PhpFrameworkLiteralNavigationDependencies["findConfigTarget"];
  findDatabaseConnectionTarget: NonNullable<
    PhpFrameworkLiteralNavigationDependencies["findDatabaseConnectionTarget"]
  >;
  findEnvTarget: PhpFrameworkLiteralNavigationDependencies["findEnvTarget"];
  findLogChannelTarget: NonNullable<
    PhpFrameworkLiteralNavigationDependencies["findLogChannelTarget"]
  >;
  findMailMailerTarget: NonNullable<
    PhpFrameworkLiteralNavigationDependencies["findMailMailerTarget"]
  >;
  findPasswordBrokerTarget: NonNullable<
    PhpFrameworkLiteralNavigationDependencies["findPasswordBrokerTarget"]
  >;
  findQueueConnectionTarget: NonNullable<
    PhpFrameworkLiteralNavigationDependencies["findQueueConnectionTarget"]
  >;
  findRedisConnectionTarget: NonNullable<
    PhpFrameworkLiteralNavigationDependencies["findRedisConnectionTarget"]
  >;
  findStorageDiskTarget: NonNullable<
    PhpFrameworkLiteralNavigationDependencies["findStorageDiskTarget"]
  >;
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
  findAuthGuardTarget,
  findBroadcastConnectionTarget,
  findCacheStoreTarget,
  findConfigTarget,
  findDatabaseConnectionTarget,
  findEnvTarget,
  findLogChannelTarget,
  findMailMailerTarget,
  findPasswordBrokerTarget,
  findQueueConnectionTarget,
  findRedisConnectionTarget,
  findStorageDiskTarget,
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
      findAuthGuardTarget,
      findBroadcastConnectionTarget,
      findCacheStoreTarget,
      findConfigTarget,
      findDatabaseConnectionTarget,
      findEnvTarget,
      findInertiaComponentTarget,
      findLogChannelTarget,
      findMailMailerTarget,
      findNetteRedrawControlSnippetTarget,
      findPasswordBrokerTarget,
      findQueueConnectionTarget,
      findRedisConnectionTarget,
      findStorageDiskTarget,
      findTranslationTarget,
      findViewTarget,
    }),
    [
      collectNamedRouteTargets,
      findAuthGuardTarget,
      findBroadcastConnectionTarget,
      findCacheStoreTarget,
      findConfigTarget,
      findDatabaseConnectionTarget,
      findEnvTarget,
      findInertiaComponentTarget,
      findLogChannelTarget,
      findMailMailerTarget,
      findNetteRedrawControlSnippetTarget,
      findPasswordBrokerTarget,
      findQueueConnectionTarget,
      findRedisConnectionTarget,
      findStorageDiskTarget,
      findTranslationTarget,
      findViewTarget,
    ],
  );
}
