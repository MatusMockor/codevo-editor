import { useMemo } from "react";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { PhpFrameworkLiteralNavigationDependencies } from "./phpFrameworkLiteralNavigation";
import {
  phpFrameworkLiteralNavigationDependencyExtrasForProviders,
  usePhpFrameworkLiteralNavigationDependencyAdapterResults,
  type PhpFrameworkLiteralNavigationDependencyAdapterHookDependencies,
} from "./phpFrameworkLiteralNavigationDependencyAdapters";

export interface PhpFrameworkLiteralNavigationDependencyHookDependencies
  extends PhpFrameworkLiteralNavigationDependencyAdapterHookDependencies {
  collectNamedRouteTargets: PhpFrameworkLiteralNavigationDependencies["collectNamedRouteTargets"];
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
  providers: readonly PhpFrameworkProvider[];
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
  providers,
  readNavigationFileContent,
  readWorkspaceDirectory,
  relativeWorkspacePath,
  workspaceRoot,
}: PhpFrameworkLiteralNavigationDependencyHookDependencies): PhpFrameworkLiteralNavigationDependencies {
  const adapterResults = usePhpFrameworkLiteralNavigationDependencyAdapterResults(
    {
      currentWorkspaceRootRef,
      joinWorkspacePath,
      readNavigationFileContent,
      readWorkspaceDirectory,
      relativeWorkspacePath,
      workspaceRoot,
    },
  );
  const providerSpecificDependencies =
    phpFrameworkLiteralNavigationDependencyExtrasForProviders(
      providers,
      adapterResults,
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
      findLogChannelTarget,
      findMailMailerTarget,
      findPasswordBrokerTarget,
      findQueueConnectionTarget,
      findRedisConnectionTarget,
      findStorageDiskTarget,
      findTranslationTarget,
      findViewTarget,
      ...providerSpecificDependencies,
    }),
    [
      collectNamedRouteTargets,
      findAuthGuardTarget,
      findBroadcastConnectionTarget,
      findCacheStoreTarget,
      findConfigTarget,
      findDatabaseConnectionTarget,
      findEnvTarget,
      findLogChannelTarget,
      findMailMailerTarget,
      findPasswordBrokerTarget,
      providerSpecificDependencies,
      findQueueConnectionTarget,
      findRedisConnectionTarget,
      findStorageDiskTarget,
      findTranslationTarget,
      findViewTarget,
    ],
  );
}
