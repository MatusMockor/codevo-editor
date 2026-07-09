import { useMemo, type MutableRefObject } from "react";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { PhpLaravelEnvTarget } from "../domain/phpLaravelEnv";
import type { PhpLaravelConfigTarget } from "../domain/phpLaravelConfig";
import type { PhpLaravelTranslationTarget } from "../domain/phpLaravelTranslations";
import type { PhpLaravelViewTarget } from "../domain/phpLaravelViews";
import { type FileEntry, type TextSearchGateway } from "../domain/workspace";
import {
  usePhpLaravelConfigDerivedTargetBundle,
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
} from "./phpLaravelConfigDerivedTargetBundle";
import { createPhpLaravelConfigTargetResolver } from "./phpLaravelConfigTargets";
import { createPhpLaravelEnvTargetResolver } from "./phpLaravelEnvTargets";
import { usePhpLaravelTargetCache } from "./phpLaravelTargetCache";
import {
  createPhpLaravelTextSearchTargetCollectors,
  type PhpLaravelGateAbilityTarget,
  type PhpLaravelMiddlewareAliasTarget,
  type PhpLaravelNamedRouteTarget,
} from "./phpLaravelTextSearchTargets";
import { createPhpLaravelTranslationTargetResolver } from "./phpLaravelTranslationTargets";
import {
  createPhpLaravelViewTargetResolver,
  type PhpLaravelViewNavigationTarget,
} from "./phpLaravelViewTargets";
import { phpFrameworkRuntimeContextFromDependencies } from "./phpFrameworkRuntimeDependencies";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { type WorkspaceTargetCollectorDeps } from "./phpWorkspaceTargetCollector";

export type {
  PhpLaravelGateAbilityTarget,
  PhpLaravelMiddlewareAliasTarget,
  PhpLaravelNamedRouteTarget,
} from "./phpLaravelTextSearchTargets";
export type {
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
} from "./phpLaravelConfigDerivedTargetBundle";
export type { PhpLaravelConfigDerivedTarget } from "./phpLaravelConfigDerivedTargets";
export type { PhpLaravelViewNavigationTarget } from "./phpLaravelViewTargets";

/**
 * Collaborators the Laravel target collectors need from the workbench shell.
 * Every collaborator is a shared shell primitive (the file/search gateways, the
 * active-root ref/value, the path helpers, the framework runtime) - the
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
  activePhpFrameworkProviders?: readonly PhpFrameworkProvider[];
  frameworkRuntime?: PhpFrameworkRuntimeContext;
  /**
   * Legacy fallback for callers that have not migrated to frameworkRuntime yet.
   * New framework-boundary callers should pass PhpFrameworkRuntimeContext so
   * capability gates are sourced from the runtime contract.
   */
  isLaravelFrameworkActive?: boolean;
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
    frameworkRuntime: providedFrameworkRuntime,
    isLaravelFrameworkActive,
  } = dependencies;
  const frameworkRuntime = useMemo(
    () =>
      phpFrameworkRuntimeContextFromDependencies({
        activePhpFrameworkProviders,
        frameworkRuntime: providedFrameworkRuntime,
        isLaravelFrameworkActive,
      }),
    [
      activePhpFrameworkProviders,
      providedFrameworkRuntime,
      isLaravelFrameworkActive,
    ],
  );

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

  const textSearchTargetCollectors = useMemo(
    () =>
      createPhpLaravelTextSearchTargetCollectors({
        workspaceRoot,
        frameworkRuntime,
        workspaceTargetCollectorDeps: engineDeps,
      }),
    [
      workspaceRoot,
      frameworkRuntime,
      engineDeps,
    ],
  );

  const envTargetResolver = useMemo(
    () =>
      createPhpLaravelEnvTargetResolver({
        workspaceRoot,
        frameworkRuntime,
        workspaceTargetCollectorDeps: engineDeps,
      }),
    [workspaceRoot, frameworkRuntime, engineDeps],
  );

  const viewTargetResolver = useMemo(
    () =>
      createPhpLaravelViewTargetResolver({
        currentWorkspaceRootRef,
        workspaceRoot,
        frameworkRuntime,
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
      frameworkRuntime,
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
        frameworkRuntime,
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
      frameworkRuntime,
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
        frameworkRuntime,
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
      frameworkRuntime,
      readNavigationFileContent,
      readWorkspaceDirectory,
      relativeWorkspacePath,
      joinWorkspacePath,
      readPhpLaravelTargetCache,
      writePhpLaravelTargetCache,
    ],
  );

  const configDerivedTargetBundle =
    usePhpLaravelConfigDerivedTargetBundle(configTargetResolver);

  return {
    collectPhpLaravelNamedRouteTargets:
      textSearchTargetCollectors.collectNamedRoutes,
    collectPhpLaravelGateAbilityTargets:
      textSearchTargetCollectors.collectGateAbilities,
    collectPhpLaravelMiddlewareAliasTargets:
      textSearchTargetCollectors.collectMiddlewareAliases,
    collectPhpLaravelEnvTargets: envTargetResolver.collect,
    collectPhpLaravelViewTargets: viewTargetResolver.collect,
    collectPhpLaravelConfigTargets: configTargetResolver.collect,
    collectPhpLaravelTranslationTargets: translationTargetResolver.collect,
    findPhpLaravelViewTarget: viewTargetResolver.find,
    findPhpLaravelConfigTarget: configTargetResolver.find,
    findPhpLaravelTranslationTarget: translationTargetResolver.find,
    ...configDerivedTargetBundle,
    invalidatePhpLaravelTargetCache,
  };
}

export function useLaravelTargets(
  dependencies: LaravelTargetsDependencies,
): LaravelTargets {
  return useLaravelFrameworkTargetAdapter(dependencies);
}
