import type { MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type {
  PhpFrameworkAuthorizationAbilityDefinition,
  PhpFrameworkMiddlewareAliasDefinition,
  PhpFrameworkRouteDefinition,
} from "../domain/phpFrameworkProviders";
import type { FileEntry, TextSearchGateway } from "../domain/workspace";
import {
  activePhpFrameworkTargetCollectorAdapter,
  phpFrameworkTargetCollectorAdapters,
} from "./phpFrameworkTargetCollectorAdapters";
import type { PhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import type { WorkspaceFileTarget } from "./phpWorkspaceTargetCollector";

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

export type PhpFrameworkNamedRouteTarget =
  WorkspaceFileTarget<PhpFrameworkRouteDefinition>;
export type PhpFrameworkAuthorizationAbilityTarget =
  WorkspaceFileTarget<PhpFrameworkAuthorizationAbilityDefinition>;
export type PhpFrameworkMiddlewareAliasTarget =
  WorkspaceFileTarget<PhpFrameworkMiddlewareAliasDefinition>;

export interface PhpFrameworkEnvironmentTarget {
  name: string;
  path: string;
  position: EditorPosition;
  relativePath: string;
}

export interface PhpFrameworkViewTarget {
  name: string;
  path: string;
  relativePath: string;
}

export interface PhpFrameworkConfigTarget {
  key: string;
  path: string;
  position: EditorPosition;
  relativePath: string;
}

export interface PhpFrameworkTranslationTarget {
  key: string;
  path: string;
  position: EditorPosition;
  relativePath: string;
}

export type PhpFrameworkConfigDerivedTarget<Property extends string> =
  PhpFrameworkConfigTarget & Record<Property, string>;

export type PhpFrameworkAuthGuardTarget =
  PhpFrameworkConfigDerivedTarget<"guardName">;
export type PhpFrameworkCacheStoreTarget =
  PhpFrameworkConfigDerivedTarget<"storeName">;
export type PhpFrameworkDatabaseConnectionTarget =
  PhpFrameworkConfigDerivedTarget<"connectionName">;
export type PhpFrameworkBroadcastConnectionTarget =
  PhpFrameworkConfigDerivedTarget<"connectionName">;
export type PhpFrameworkQueueConnectionTarget =
  PhpFrameworkConfigDerivedTarget<"connectionName">;
export type PhpFrameworkRedisConnectionTarget =
  PhpFrameworkConfigDerivedTarget<"connectionName">;
export type PhpFrameworkMailMailerTarget =
  PhpFrameworkConfigDerivedTarget<"mailerName">;
export type PhpFrameworkPasswordBrokerTarget =
  PhpFrameworkConfigDerivedTarget<"brokerName">;
export type PhpFrameworkLogChannelTarget =
  PhpFrameworkConfigDerivedTarget<"channelName">;
export type PhpFrameworkStorageDiskTarget =
  PhpFrameworkConfigDerivedTarget<"diskName">;

export interface PhpFrameworkViewNavigationTarget
  extends PhpFrameworkViewTarget {
  position: EditorPosition;
}

type PhpFrameworkCurrentDocumentTargetCollector<Target> = (
  currentSource: string,
  currentPath: string,
) => Promise<Target[]>;

type PhpFrameworkWorkspaceTargetCollector<Target> = () => Promise<Target[]>;

type PhpFrameworkTargetFinder<Target> = (
  targetName: string,
) => Promise<Target | null>;

export interface PhpFrameworkTargets {
  collectNamedRouteTargets: PhpFrameworkCurrentDocumentTargetCollector<
    PhpFrameworkNamedRouteTarget
  >;
  collectAuthorizationAbilityTargets: PhpFrameworkCurrentDocumentTargetCollector<
    PhpFrameworkAuthorizationAbilityTarget
  >;
  collectMiddlewareAliasTargets: PhpFrameworkCurrentDocumentTargetCollector<
    PhpFrameworkMiddlewareAliasTarget
  >;
  collectEnvironmentTargets: PhpFrameworkWorkspaceTargetCollector<
    PhpFrameworkEnvironmentTarget
  >;
  collectViewTargets: PhpFrameworkWorkspaceTargetCollector<PhpFrameworkViewTarget>;
  collectConfigTargets: PhpFrameworkWorkspaceTargetCollector<PhpFrameworkConfigTarget>;
  collectTranslationTargets: PhpFrameworkWorkspaceTargetCollector<
    PhpFrameworkTranslationTarget
  >;
  collectAuthGuardTargets: PhpFrameworkWorkspaceTargetCollector<
    PhpFrameworkAuthGuardTarget
  >;
  collectCacheStoreTargets: PhpFrameworkWorkspaceTargetCollector<
    PhpFrameworkCacheStoreTarget
  >;
  collectDatabaseConnectionTargets: PhpFrameworkWorkspaceTargetCollector<
    PhpFrameworkDatabaseConnectionTarget
  >;
  collectBroadcastConnectionTargets: PhpFrameworkWorkspaceTargetCollector<
    PhpFrameworkBroadcastConnectionTarget
  >;
  collectQueueConnectionTargets: PhpFrameworkWorkspaceTargetCollector<
    PhpFrameworkQueueConnectionTarget
  >;
  collectRedisConnectionTargets: PhpFrameworkWorkspaceTargetCollector<
    PhpFrameworkRedisConnectionTarget
  >;
  collectMailMailerTargets: PhpFrameworkWorkspaceTargetCollector<
    PhpFrameworkMailMailerTarget
  >;
  collectPasswordBrokerTargets: PhpFrameworkWorkspaceTargetCollector<
    PhpFrameworkPasswordBrokerTarget
  >;
  collectLogChannelTargets: PhpFrameworkWorkspaceTargetCollector<
    PhpFrameworkLogChannelTarget
  >;
  collectStorageDiskTargets: PhpFrameworkWorkspaceTargetCollector<
    PhpFrameworkStorageDiskTarget
  >;
  findViewTarget: PhpFrameworkTargetFinder<PhpFrameworkViewNavigationTarget>;
  findConfigTarget: PhpFrameworkTargetFinder<PhpFrameworkConfigTarget>;
  findTranslationTarget: PhpFrameworkTargetFinder<PhpFrameworkTranslationTarget>;
  findAuthGuardTarget: PhpFrameworkTargetFinder<PhpFrameworkAuthGuardTarget>;
  findCacheStoreTarget: PhpFrameworkTargetFinder<PhpFrameworkCacheStoreTarget>;
  findDatabaseConnectionTarget: PhpFrameworkTargetFinder<
    PhpFrameworkDatabaseConnectionTarget
  >;
  findBroadcastConnectionTarget: PhpFrameworkTargetFinder<
    PhpFrameworkBroadcastConnectionTarget
  >;
  findQueueConnectionTarget: PhpFrameworkTargetFinder<PhpFrameworkQueueConnectionTarget>;
  findRedisConnectionTarget: PhpFrameworkTargetFinder<PhpFrameworkRedisConnectionTarget>;
  findMailMailerTarget: PhpFrameworkTargetFinder<PhpFrameworkMailMailerTarget>;
  findPasswordBrokerTarget: PhpFrameworkTargetFinder<PhpFrameworkPasswordBrokerTarget>;
  findLogChannelTarget: PhpFrameworkTargetFinder<PhpFrameworkLogChannelTarget>;
  findStorageDiskTarget: PhpFrameworkTargetFinder<PhpFrameworkStorageDiskTarget>;
  invalidateTargetCache: () => void;
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

export function usePhpFrameworkTargets(
  dependencies: PhpFrameworkTargetsDependencies,
): PhpFrameworkTargets {
  const targetAdapters = phpFrameworkTargetCollectorAdapters.map((adapter) => ({
    providerId: adapter.providerId,
    targets: adapter.useTargets(dependencies),
  }));

  const activeTargets = activePhpFrameworkTargetCollectorAdapter(
    targetAdapters,
    dependencies.frameworkIntelligence,
  )?.targets;

  return (
    activeTargets ??
    inactivePhpFrameworkTargets(targetAdapters.map(({ targets }) => targets))
  );
}
