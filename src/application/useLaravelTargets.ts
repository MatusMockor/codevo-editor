import { useCallback, useMemo, type MutableRefObject } from "react";
import {
  phpFrameworkRouteDefinitionsFromSource,
  phpFrameworkRouteSearchQueries,
  phpFrameworkSupportsRoutes,
  type PhpFrameworkProvider,
  type PhpFrameworkRouteDefinition,
} from "../domain/phpFrameworkProviders";
import {
  phpLaravelGateAbilityDefinitions,
  type PhpLaravelGateAbilityDefinition,
} from "../domain/phpLaravelAuthorization";
import {
  phpLaravelMiddlewareAliasDefinitions,
  type PhpLaravelMiddlewareAliasDefinition,
} from "../domain/phpLaravelMiddleware";
import {
  phpLaravelEnvEntriesFromSource,
  type PhpLaravelEnvTarget,
} from "../domain/phpLaravelEnv";
import type { PhpLaravelConfigTarget } from "../domain/phpLaravelConfig";
import type { PhpLaravelTranslationTarget } from "../domain/phpLaravelTranslations";
import type { PhpLaravelViewTarget } from "../domain/phpLaravelViews";
import { type FileEntry, type TextSearchGateway } from "../domain/workspace";
import {
  phpLaravelAuthGuardTargetDefinition,
  phpLaravelBroadcastConnectionTargetDefinition,
  phpLaravelCacheStoreTargetDefinition,
  phpLaravelDatabaseConnectionTargetDefinition,
  phpLaravelLogChannelTargetDefinition,
  phpLaravelMailMailerTargetDefinition,
  phpLaravelPasswordBrokerTargetDefinition,
  phpLaravelQueueConnectionTargetDefinition,
  phpLaravelRedisConnectionTargetDefinition,
  phpLaravelStorageDiskTargetDefinition,
  useConfigDerivedLaravelTarget,
  type PhpLaravelAuthGuardTarget,
  type PhpLaravelBroadcastConnectionTarget,
  type PhpLaravelCacheStoreTarget,
  type PhpLaravelDatabaseConnectionTarget,
  type PhpLaravelLogChannelTarget,
  type PhpLaravelMailMailerTarget,
  type PhpLaravelPasswordBrokerTarget,
  type PhpLaravelQueueConnectionTarget,
  type PhpLaravelRedisConnectionTarget,
  type PhpLaravelStorageDiskTarget,
} from "./phpLaravelConfigDerivedTargets";
import { createPhpLaravelConfigTargetResolver } from "./phpLaravelConfigTargets";
import { usePhpLaravelTargetCache } from "./phpLaravelTargetCache";
import { createPhpLaravelTranslationTargetResolver } from "./phpLaravelTranslationTargets";
import {
  createPhpLaravelViewTargetResolver,
  type PhpLaravelViewNavigationTarget,
} from "./phpLaravelViewTargets";
import {
  type WorkspaceFileTarget,
  type WorkspaceTargetCollectorDeps,
  createWorkspaceTargetCollector,
} from "./phpWorkspaceTargetCollector";

export type PhpLaravelNamedRouteTarget =
  WorkspaceFileTarget<PhpFrameworkRouteDefinition>;
export type PhpLaravelGateAbilityTarget =
  WorkspaceFileTarget<PhpLaravelGateAbilityDefinition>;
export type PhpLaravelMiddlewareAliasTarget =
  WorkspaceFileTarget<PhpLaravelMiddlewareAliasDefinition>;
export type {
  PhpLaravelAuthGuardTarget,
  PhpLaravelBroadcastConnectionTarget,
  PhpLaravelCacheStoreTarget,
  PhpLaravelConfigDerivedTarget,
  PhpLaravelDatabaseConnectionTarget,
  PhpLaravelLogChannelTarget,
  PhpLaravelMailMailerTarget,
  PhpLaravelPasswordBrokerTarget,
  PhpLaravelQueueConnectionTarget,
  PhpLaravelRedisConnectionTarget,
  PhpLaravelStorageDiskTarget,
} from "./phpLaravelConfigDerivedTargets";
export type { PhpLaravelViewNavigationTarget } from "./phpLaravelViewTargets";

const EMPTY_PHP_FRAMEWORK_PROVIDERS: readonly PhpFrameworkProvider[] = [];

/**
 * Collaborators the Laravel target collectors need from the workbench shell.
 * Every collaborator is a shared shell primitive (the file/search gateways, the
 * active-root ref/value, the path helpers, the active framework providers) - the
 * hook owns only the per-root target cache, wiring the shared isolation-guarded
 * target-collection engine to Laravel's parsers.
 */
export interface LaravelTargetsDependencies {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  workspaceRoot: string | null;
  textSearch: Pick<TextSearchGateway, "searchText">;
  readNavigationFileContent: (path: string) => Promise<string>;
  readWorkspaceDirectory: (path: string) => Promise<FileEntry[]>;
  relativeWorkspacePath: (workspaceRoot: string, path: string) => string;
  joinWorkspacePath: (workspaceRoot: string, relativePath: string) => string;
  isPhpPath: (path: string) => boolean;
  activePhpFrameworkProviders: readonly PhpFrameworkProvider[];
  isLaravelFrameworkActive: boolean;
}

export interface LaravelTargets {
  collectPhpLaravelNamedRouteTargets: (
    currentSource: string,
    currentPath: string,
  ) => Promise<PhpLaravelNamedRouteTarget[]>;
  collectPhpLaravelGateAbilityTargets: (
    currentSource: string,
    currentPath: string,
  ) => Promise<PhpLaravelGateAbilityTarget[]>;
  collectPhpLaravelMiddlewareAliasTargets: (
    currentSource: string,
    currentPath: string,
  ) => Promise<PhpLaravelMiddlewareAliasTarget[]>;
  collectPhpLaravelEnvTargets: () => Promise<PhpLaravelEnvTarget[]>;
  collectPhpLaravelViewTargets: () => Promise<PhpLaravelViewTarget[]>;
  collectPhpLaravelConfigTargets: () => Promise<PhpLaravelConfigTarget[]>;
  collectPhpLaravelTranslationTargets: () => Promise<
    PhpLaravelTranslationTarget[]
  >;
  collectPhpLaravelAuthGuardTargets: () => Promise<PhpLaravelAuthGuardTarget[]>;
  collectPhpLaravelCacheStoreTargets: () => Promise<PhpLaravelCacheStoreTarget[]>;
  collectPhpLaravelDatabaseConnectionTargets: () => Promise<
    PhpLaravelDatabaseConnectionTarget[]
  >;
  collectPhpLaravelBroadcastConnectionTargets: () => Promise<
    PhpLaravelBroadcastConnectionTarget[]
  >;
  collectPhpLaravelQueueConnectionTargets: () => Promise<
    PhpLaravelQueueConnectionTarget[]
  >;
  collectPhpLaravelRedisConnectionTargets: () => Promise<
    PhpLaravelRedisConnectionTarget[]
  >;
  collectPhpLaravelMailMailerTargets: () => Promise<PhpLaravelMailMailerTarget[]>;
  collectPhpLaravelPasswordBrokerTargets: () => Promise<
    PhpLaravelPasswordBrokerTarget[]
  >;
  collectPhpLaravelLogChannelTargets: () => Promise<PhpLaravelLogChannelTarget[]>;
  collectPhpLaravelStorageDiskTargets: () => Promise<PhpLaravelStorageDiskTarget[]>;
  findPhpLaravelViewTarget: (
    viewName: string,
  ) => Promise<PhpLaravelViewNavigationTarget | null>;
  findPhpLaravelConfigTarget: (
    configKey: string,
  ) => Promise<PhpLaravelConfigTarget | null>;
  findPhpLaravelTranslationTarget: (
    translationKey: string,
  ) => Promise<PhpLaravelTranslationTarget | null>;
  findPhpLaravelAuthGuardTarget: (
    guardName: string,
  ) => Promise<PhpLaravelAuthGuardTarget | null>;
  findPhpLaravelCacheStoreTarget: (
    storeName: string,
  ) => Promise<PhpLaravelCacheStoreTarget | null>;
  findPhpLaravelDatabaseConnectionTarget: (
    connectionName: string,
  ) => Promise<PhpLaravelDatabaseConnectionTarget | null>;
  findPhpLaravelBroadcastConnectionTarget: (
    connectionName: string,
  ) => Promise<PhpLaravelBroadcastConnectionTarget | null>;
  findPhpLaravelQueueConnectionTarget: (
    connectionName: string,
  ) => Promise<PhpLaravelQueueConnectionTarget | null>;
  findPhpLaravelRedisConnectionTarget: (
    connectionName: string,
  ) => Promise<PhpLaravelRedisConnectionTarget | null>;
  findPhpLaravelMailMailerTarget: (
    mailerName: string,
  ) => Promise<PhpLaravelMailMailerTarget | null>;
  findPhpLaravelPasswordBrokerTarget: (
    brokerName: string,
  ) => Promise<PhpLaravelPasswordBrokerTarget | null>;
  findPhpLaravelLogChannelTarget: (
    channelName: string,
  ) => Promise<PhpLaravelLogChannelTarget | null>;
  findPhpLaravelStorageDiskTarget: (
    diskName: string,
  ) => Promise<PhpLaravelStorageDiskTarget | null>;
  invalidatePhpLaravelTargetCache: () => void;
}

/**
 * Laravel workspace target collectors (named routes, gate abilities, middleware
 * aliases, `.env` entries, plus the memoized view/config/translation directory
 * scans) built on the shared, isolation-guarded `createWorkspaceTargetCollector`
 * engine. Each text-search / known-file / directory-scan collector is a few
 * lines of declarative config, so the copy-pasted search/read/parse/dedup/sort/
 * isolation skeleton lives in one place. Behaviour (outputs, dedup key, sort
 * order, `.env`-first-wins, per-root cache hit/miss/invalidate, per-project
 * isolation) is identical to the pre-extraction inline collectors.
 */
function useLaravelFrameworkTargetAdapter(
  dependencies: LaravelTargetsDependencies,
): LaravelTargets {
  const {
    currentWorkspaceRootRef,
    workspaceRoot,
    textSearch,
    readNavigationFileContent,
    readWorkspaceDirectory,
    relativeWorkspacePath,
    joinWorkspacePath,
    isPhpPath,
    activePhpFrameworkProviders,
    isLaravelFrameworkActive,
  } = dependencies;
  const targetPhpFrameworkProviders = isLaravelFrameworkActive
    ? activePhpFrameworkProviders
    : EMPTY_PHP_FRAMEWORK_PROVIDERS;

  const engineDeps = useMemo<WorkspaceTargetCollectorDeps>(
    () => ({
      currentWorkspaceRootRef,
      textSearch,
      readFileContent: readNavigationFileContent,
      readWorkspaceDirectory,
      relativeWorkspacePath,
      joinWorkspacePath,
      isPhpPath,
    }),
    [
      currentWorkspaceRootRef,
      textSearch,
      readNavigationFileContent,
      readWorkspaceDirectory,
      relativeWorkspacePath,
      joinWorkspacePath,
      isPhpPath,
    ],
  );

  const {
    read: readPhpLaravelTargetCache,
    write: writePhpLaravelTargetCache,
    invalidate: invalidatePhpLaravelTargetCache,
  } = usePhpLaravelTargetCache(currentWorkspaceRootRef);

  const collectPhpLaravelNamedRouteTargets = useCallback(
    (
      currentSource: string,
      currentPath: string,
    ): Promise<PhpLaravelNamedRouteTarget[]> => {
      const collect = createWorkspaceTargetCollector(engineDeps, {
        kind: "textSearch",
        isEnabled: () => phpFrameworkSupportsRoutes(targetPhpFrameworkProviders),
        queries: () => phpFrameworkRouteSearchQueries(targetPhpFrameworkProviders),
        parseDefinitions: (source) =>
          phpFrameworkRouteDefinitionsFromSource(
            source,
            targetPhpFrameworkProviders,
          ),
      });

      return collect({
        workspaceRoot,
        currentDocument: { content: currentSource, path: currentPath },
      });
    },
    [engineDeps, targetPhpFrameworkProviders, workspaceRoot],
  );

  const collectPhpLaravelGateAbilityTargets = useCallback(
    (
      currentSource: string,
      currentPath: string,
    ): Promise<PhpLaravelGateAbilityTarget[]> => {
      const collect = createWorkspaceTargetCollector(engineDeps, {
        kind: "textSearch",
        isEnabled: () => isLaravelFrameworkActive,
        queries: () => ["Gate::define"],
        parseDefinitions: phpLaravelGateAbilityDefinitions,
      });

      return collect({
        workspaceRoot,
        currentDocument: { content: currentSource, path: currentPath },
      });
    },
    [engineDeps, isLaravelFrameworkActive, workspaceRoot],
  );

  const collectPhpLaravelMiddlewareAliasTargets = useCallback(
    (
      currentSource: string,
      currentPath: string,
    ): Promise<PhpLaravelMiddlewareAliasTarget[]> => {
      const collect = createWorkspaceTargetCollector(engineDeps, {
        kind: "textSearch",
        isEnabled: () => isLaravelFrameworkActive,
        queries: () => ["middlewareAliases", "routeMiddleware"],
        parseDefinitions: phpLaravelMiddlewareAliasDefinitions,
      });

      return collect({
        workspaceRoot,
        currentDocument: { content: currentSource, path: currentPath },
      });
    },
    [engineDeps, isLaravelFrameworkActive, workspaceRoot],
  );

  const collectPhpLaravelEnvTargets = useCallback((): Promise<
    PhpLaravelEnvTarget[]
  > => {
    const collect = createWorkspaceTargetCollector<PhpLaravelEnvTarget>(
      engineDeps,
      {
        kind: "knownFiles",
        isEnabled: () => isLaravelFrameworkActive,
        relativePaths: [".env", ".env.example"],
        parseTargets: ({ content, path, relativePath }) =>
          phpLaravelEnvEntriesFromSource(content).map((entry) => ({
            ...entry,
            path,
            relativePath,
          })),
      },
    );

    return collect({ workspaceRoot });
  }, [engineDeps, isLaravelFrameworkActive, workspaceRoot]);

  const viewTargetResolver = useMemo(
    () =>
      createPhpLaravelViewTargetResolver({
        currentWorkspaceRootRef,
        workspaceRoot,
        phpFrameworkProviders: targetPhpFrameworkProviders,
        workspaceTargetCollectorDeps: engineDeps,
        readNavigationFileContent,
        joinWorkspacePath,
        readCachedViewTargets: (root) =>
          readPhpLaravelTargetCache(root, "views"),
        writeCachedViewTargets: (root, targets) =>
          writePhpLaravelTargetCache(root, "views", targets),
      }),
    [
      currentWorkspaceRootRef,
      workspaceRoot,
      targetPhpFrameworkProviders,
      engineDeps,
      readNavigationFileContent,
      joinWorkspacePath,
      readPhpLaravelTargetCache,
      writePhpLaravelTargetCache,
    ],
  );

  const configTargetResolver = useMemo(
    () =>
      createPhpLaravelConfigTargetResolver({
        currentWorkspaceRootRef,
        workspaceRoot,
        phpFrameworkProviders: targetPhpFrameworkProviders,
        workspaceTargetCollectorDeps: engineDeps,
        readNavigationFileContent,
        joinWorkspacePath,
        readCachedConfigTargets: (root) =>
          readPhpLaravelTargetCache(root, "config"),
        writeCachedConfigTargets: (root, targets) =>
          writePhpLaravelTargetCache(root, "config", targets),
      }),
    [
      currentWorkspaceRootRef,
      workspaceRoot,
      targetPhpFrameworkProviders,
      engineDeps,
      readNavigationFileContent,
      joinWorkspacePath,
      readPhpLaravelTargetCache,
      writePhpLaravelTargetCache,
    ],
  );

  const translationTargetResolver = useMemo(
    () =>
      createPhpLaravelTranslationTargetResolver({
        currentWorkspaceRootRef,
        workspaceRoot,
        phpFrameworkProviders: targetPhpFrameworkProviders,
        readNavigationFileContent,
        readWorkspaceDirectory,
        relativeWorkspacePath,
        joinWorkspacePath,
        readCachedTranslationTargets: (root) =>
          readPhpLaravelTargetCache(root, "translations"),
        writeCachedTranslationTargets: (root, targets) =>
          writePhpLaravelTargetCache(root, "translations", targets),
      }),
    [
      currentWorkspaceRootRef,
      workspaceRoot,
      targetPhpFrameworkProviders,
      readNavigationFileContent,
      readWorkspaceDirectory,
      relativeWorkspacePath,
      joinWorkspacePath,
      readPhpLaravelTargetCache,
      writePhpLaravelTargetCache,
    ],
  );

  // The ten config-derived collectors below (auth guards, cache stores,
  // database/broadcast/queue/redis connections, mail mailers, password
  // brokers, log channels, storage disks) are all thin, declarative wrappers
  // over collectPhpLaravelConfigTargets/findPhpLaravelConfigTarget - see
  // useConfigDerivedLaravelTarget for the shared collect/find skeleton.
  const authGuardTarget = useConfigDerivedLaravelTarget(
    phpLaravelAuthGuardTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );
  const cacheStoreTarget = useConfigDerivedLaravelTarget(
    phpLaravelCacheStoreTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );
  const databaseConnectionTarget = useConfigDerivedLaravelTarget(
    phpLaravelDatabaseConnectionTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );
  const broadcastConnectionTarget = useConfigDerivedLaravelTarget(
    phpLaravelBroadcastConnectionTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );
  const queueConnectionTarget = useConfigDerivedLaravelTarget(
    phpLaravelQueueConnectionTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );
  const redisConnectionTarget = useConfigDerivedLaravelTarget(
    phpLaravelRedisConnectionTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );
  const mailMailerTarget = useConfigDerivedLaravelTarget(
    phpLaravelMailMailerTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );
  const passwordBrokerTarget = useConfigDerivedLaravelTarget(
    phpLaravelPasswordBrokerTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );
  const logChannelTarget = useConfigDerivedLaravelTarget(
    phpLaravelLogChannelTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );
  const storageDiskTarget = useConfigDerivedLaravelTarget(
    phpLaravelStorageDiskTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );

  return {
    collectPhpLaravelNamedRouteTargets,
    collectPhpLaravelGateAbilityTargets,
    collectPhpLaravelMiddlewareAliasTargets,
    collectPhpLaravelEnvTargets,
    collectPhpLaravelViewTargets: viewTargetResolver.collect,
    collectPhpLaravelConfigTargets: configTargetResolver.collect,
    collectPhpLaravelTranslationTargets: translationTargetResolver.collect,
    collectPhpLaravelAuthGuardTargets: authGuardTarget.collect,
    collectPhpLaravelCacheStoreTargets: cacheStoreTarget.collect,
    collectPhpLaravelDatabaseConnectionTargets: databaseConnectionTarget.collect,
    collectPhpLaravelBroadcastConnectionTargets: broadcastConnectionTarget.collect,
    collectPhpLaravelQueueConnectionTargets: queueConnectionTarget.collect,
    collectPhpLaravelRedisConnectionTargets: redisConnectionTarget.collect,
    collectPhpLaravelMailMailerTargets: mailMailerTarget.collect,
    collectPhpLaravelPasswordBrokerTargets: passwordBrokerTarget.collect,
    collectPhpLaravelLogChannelTargets: logChannelTarget.collect,
    collectPhpLaravelStorageDiskTargets: storageDiskTarget.collect,
    findPhpLaravelViewTarget: viewTargetResolver.find,
    findPhpLaravelConfigTarget: configTargetResolver.find,
    findPhpLaravelTranslationTarget: translationTargetResolver.find,
    findPhpLaravelAuthGuardTarget: authGuardTarget.find,
    findPhpLaravelCacheStoreTarget: cacheStoreTarget.find,
    findPhpLaravelDatabaseConnectionTarget: databaseConnectionTarget.find,
    findPhpLaravelBroadcastConnectionTarget: broadcastConnectionTarget.find,
    findPhpLaravelQueueConnectionTarget: queueConnectionTarget.find,
    findPhpLaravelRedisConnectionTarget: redisConnectionTarget.find,
    findPhpLaravelMailMailerTarget: mailMailerTarget.find,
    findPhpLaravelPasswordBrokerTarget: passwordBrokerTarget.find,
    findPhpLaravelLogChannelTarget: logChannelTarget.find,
    findPhpLaravelStorageDiskTarget: storageDiskTarget.find,
    invalidatePhpLaravelTargetCache,
  };
}

export function useLaravelTargets(
  dependencies: LaravelTargetsDependencies,
): LaravelTargets {
  return useLaravelFrameworkTargetAdapter(dependencies);
}
