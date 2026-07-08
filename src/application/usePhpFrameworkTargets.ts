import type { MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpFrameworkRouteDefinition } from "../domain/phpFrameworkProviders";
import type { PhpLaravelGateAbilityDefinition } from "../domain/phpLaravelAuthorization";
import type { PhpLaravelConfigTarget } from "../domain/phpLaravelConfig";
import type { PhpLaravelEnvTarget } from "../domain/phpLaravelEnv";
import type {
  PhpLaravelMiddlewareAliasDefinition,
} from "../domain/phpLaravelMiddleware";
import type { PhpLaravelTranslationTarget } from "../domain/phpLaravelTranslations";
import type { PhpLaravelViewTarget } from "../domain/phpLaravelViews";
import type { FileEntry, TextSearchGateway } from "../domain/workspace";
import type {
  PhpLaravelAuthGuardTarget,
  PhpLaravelBroadcastConnectionTarget,
  PhpLaravelCacheStoreTarget,
  PhpLaravelDatabaseConnectionTarget,
  PhpLaravelLogChannelTarget,
  PhpLaravelMailMailerTarget,
  PhpLaravelPasswordBrokerTarget,
  PhpLaravelQueueConnectionTarget,
  PhpLaravelRedisConnectionTarget,
  PhpLaravelStorageDiskTarget,
} from "./phpLaravelConfigDerivedTargets";
import type { PhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { phpLaravelFrameworkTargetCollectorAdapter } from "./phpLaravelFrameworkTargetAdapter";
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
  WorkspaceFileTarget<PhpLaravelGateAbilityDefinition>;
export type PhpFrameworkMiddlewareAliasTarget =
  WorkspaceFileTarget<PhpLaravelMiddlewareAliasDefinition>;
export type PhpFrameworkEnvironmentTarget = PhpLaravelEnvTarget;
export type PhpFrameworkViewTarget = PhpLaravelViewTarget;
export type PhpFrameworkConfigTarget = PhpLaravelConfigTarget;
export type PhpFrameworkTranslationTarget = PhpLaravelTranslationTarget;
export type PhpFrameworkAuthGuardTarget = PhpLaravelAuthGuardTarget;
export type PhpFrameworkCacheStoreTarget = PhpLaravelCacheStoreTarget;
export type PhpFrameworkDatabaseConnectionTarget =
  PhpLaravelDatabaseConnectionTarget;
export type PhpFrameworkBroadcastConnectionTarget =
  PhpLaravelBroadcastConnectionTarget;
export type PhpFrameworkQueueConnectionTarget = PhpLaravelQueueConnectionTarget;
export type PhpFrameworkRedisConnectionTarget = PhpLaravelRedisConnectionTarget;
export type PhpFrameworkMailMailerTarget = PhpLaravelMailMailerTarget;
export type PhpFrameworkPasswordBrokerTarget = PhpLaravelPasswordBrokerTarget;
export type PhpFrameworkLogChannelTarget = PhpLaravelLogChannelTarget;
export type PhpFrameworkStorageDiskTarget = PhpLaravelStorageDiskTarget;

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
