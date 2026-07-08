import type { MutableRefObject } from "react";
import type { FileEntry, TextSearchGateway } from "../domain/workspace";
import type { PhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { phpLaravelFrameworkTargetCollectorAdapter } from "./phpLaravelFrameworkTargetAdapter";
import type { LaravelTargets } from "./useLaravelTargets";

export interface PhpFrameworkTargetsDependencies {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  workspaceRoot: string | null;
  textSearch: Pick<TextSearchGateway, "searchText">;
  readNavigationFileContent: (path: string) => Promise<string>;
  readWorkspaceDirectory: (path: string) => Promise<FileEntry[]>;
  relativeWorkspacePath: (workspaceRoot: string, path: string) => string;
  joinWorkspacePath: (workspaceRoot: string, relativePath: string) => string;
  isPhpPath: (path: string) => boolean;
  frameworkIntelligence: PhpFrameworkIntelligence;
}

export interface PhpFrameworkTargets {
  collectNamedRouteTargets: LaravelTargets["collectPhpLaravelNamedRouteTargets"];
  collectAuthorizationAbilityTargets: LaravelTargets["collectPhpLaravelGateAbilityTargets"];
  collectMiddlewareAliasTargets: LaravelTargets["collectPhpLaravelMiddlewareAliasTargets"];
  collectEnvironmentTargets: LaravelTargets["collectPhpLaravelEnvTargets"];
  collectViewTargets: LaravelTargets["collectPhpLaravelViewTargets"];
  collectConfigTargets: LaravelTargets["collectPhpLaravelConfigTargets"];
  collectTranslationTargets: LaravelTargets["collectPhpLaravelTranslationTargets"];
  collectAuthGuardTargets: LaravelTargets["collectPhpLaravelAuthGuardTargets"];
  collectCacheStoreTargets: LaravelTargets["collectPhpLaravelCacheStoreTargets"];
  collectDatabaseConnectionTargets: LaravelTargets["collectPhpLaravelDatabaseConnectionTargets"];
  collectBroadcastConnectionTargets: LaravelTargets["collectPhpLaravelBroadcastConnectionTargets"];
  collectQueueConnectionTargets: LaravelTargets["collectPhpLaravelQueueConnectionTargets"];
  collectRedisConnectionTargets: LaravelTargets["collectPhpLaravelRedisConnectionTargets"];
  collectMailMailerTargets: LaravelTargets["collectPhpLaravelMailMailerTargets"];
  collectPasswordBrokerTargets: LaravelTargets["collectPhpLaravelPasswordBrokerTargets"];
  collectLogChannelTargets: LaravelTargets["collectPhpLaravelLogChannelTargets"];
  collectStorageDiskTargets: LaravelTargets["collectPhpLaravelStorageDiskTargets"];
  findViewTarget: LaravelTargets["findPhpLaravelViewTarget"];
  findConfigTarget: LaravelTargets["findPhpLaravelConfigTarget"];
  findTranslationTarget: LaravelTargets["findPhpLaravelTranslationTarget"];
  findAuthGuardTarget: LaravelTargets["findPhpLaravelAuthGuardTarget"];
  findCacheStoreTarget: LaravelTargets["findPhpLaravelCacheStoreTarget"];
  findDatabaseConnectionTarget: LaravelTargets["findPhpLaravelDatabaseConnectionTarget"];
  findBroadcastConnectionTarget: LaravelTargets["findPhpLaravelBroadcastConnectionTarget"];
  findQueueConnectionTarget: LaravelTargets["findPhpLaravelQueueConnectionTarget"];
  findRedisConnectionTarget: LaravelTargets["findPhpLaravelRedisConnectionTarget"];
  findMailMailerTarget: LaravelTargets["findPhpLaravelMailMailerTarget"];
  findPasswordBrokerTarget: LaravelTargets["findPhpLaravelPasswordBrokerTarget"];
  findLogChannelTarget: LaravelTargets["findPhpLaravelLogChannelTarget"];
  findStorageDiskTarget: LaravelTargets["findPhpLaravelStorageDiskTarget"];
  invalidateTargetCache: LaravelTargets["invalidatePhpLaravelTargetCache"];
}

export interface PhpFrameworkTargetCollectorAdapter {
  providerId: string;
  useTargets: (dependencies: PhpFrameworkTargetsDependencies) => PhpFrameworkTargets;
}

const inertPhpFrameworkTargets: PhpFrameworkTargets = {
  collectNamedRouteTargets: async () => [],
  collectAuthorizationAbilityTargets: async () => [],
  collectMiddlewareAliasTargets: async () => [],
  collectEnvironmentTargets: async () => [],
  collectViewTargets: async () => [],
  collectConfigTargets: async () => [],
  collectTranslationTargets: async () => [],
  collectAuthGuardTargets: async () => [],
  collectCacheStoreTargets: async () => [],
  collectDatabaseConnectionTargets: async () => [],
  collectBroadcastConnectionTargets: async () => [],
  collectQueueConnectionTargets: async () => [],
  collectRedisConnectionTargets: async () => [],
  collectMailMailerTargets: async () => [],
  collectPasswordBrokerTargets: async () => [],
  collectLogChannelTargets: async () => [],
  collectStorageDiskTargets: async () => [],
  findViewTarget: async () => null,
  findConfigTarget: async () => null,
  findTranslationTarget: async () => null,
  findAuthGuardTarget: async () => null,
  findCacheStoreTarget: async () => null,
  findDatabaseConnectionTarget: async () => null,
  findBroadcastConnectionTarget: async () => null,
  findQueueConnectionTarget: async () => null,
  findRedisConnectionTarget: async () => null,
  findMailMailerTarget: async () => null,
  findPasswordBrokerTarget: async () => null,
  findLogChannelTarget: async () => null,
  findStorageDiskTarget: async () => null,
  invalidateTargetCache: () => {},
};

function inactivePhpFrameworkTargets(
  mountedTargets: readonly PhpFrameworkTargets[],
): PhpFrameworkTargets {
  return {
    ...inertPhpFrameworkTargets,
    invalidateTargetCache: () => {
      for (const targets of mountedTargets) {
        targets.invalidateTargetCache();
      }
    },
  };
}

const phpFrameworkTargetCollectorAdapters: readonly PhpFrameworkTargetCollectorAdapter[] =
  [phpLaravelFrameworkTargetCollectorAdapter];

export function usePhpFrameworkTargets(
  dependencies: PhpFrameworkTargetsDependencies,
): PhpFrameworkTargets {
  const targetAdapters = phpFrameworkTargetCollectorAdapters.map((adapter) => ({
    adapter,
    targets: adapter.useTargets(dependencies),
  }));

  const activeTargets = targetAdapters.find(({ adapter }) =>
    dependencies.frameworkIntelligence.hasProvider(adapter.providerId),
  )?.targets;

  return (
    activeTargets ??
    inactivePhpFrameworkTargets(targetAdapters.map(({ targets }) => targets))
  );
}
