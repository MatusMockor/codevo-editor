import { useCallback, useMemo, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpFrameworkConfigKeysFromSource,
  phpFrameworkConfigTargetFromSource,
  phpFrameworkRouteDefinitionsFromSource,
  phpFrameworkRouteSearchQueries,
  phpFrameworkSupportsConfig,
  phpFrameworkSupportsRoutes,
  phpFrameworkSupportsViews,
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
import {
  phpLaravelConfigFileNameFromRelativePath,
  phpLaravelConfigKeyCandidateRelativePath,
  type PhpLaravelConfigTarget,
} from "../domain/phpLaravelConfig";
import type { PhpLaravelTranslationTarget } from "../domain/phpLaravelTranslations";
import {
  phpLaravelViewNameCandidateRelativePaths,
  phpLaravelViewNameFromRelativePath,
  type PhpLaravelViewTarget,
} from "../domain/phpLaravelViews";
import { type FileEntry, type TextSearchGateway } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
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
import { usePhpLaravelTargetCache } from "./phpLaravelTargetCache";
import { createPhpLaravelTranslationTargetResolver } from "./phpLaravelTranslationTargets";
import {
  createWorkspaceTargetCollector,
  type WorkspaceFileTarget,
  type WorkspaceTargetCollectorDeps,
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

/**
 * A resolved view navigation target: the parsed view plus the 1:1 blade file
 * position navigation jumps to.
 */
export interface PhpLaravelViewNavigationTarget extends PhpLaravelViewTarget {
  position: EditorPosition;
}

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

  const collectPhpLaravelViewTargets = useCallback((): Promise<
    PhpLaravelViewTarget[]
  > => {
    const collect = createWorkspaceTargetCollector<PhpLaravelViewTarget>(
      engineDeps,
      {
        kind: "directoryScan",
        isEnabled: () => phpFrameworkSupportsViews(targetPhpFrameworkProviders),
        roots: ["resources/views"],
        recursive: true,
        parseEntry: ({ path, relativePath }) => {
          const viewName = phpLaravelViewNameFromRelativePath(relativePath);

          if (!viewName) {
            return [];
          }

          return [{ name: viewName, path, relativePath }];
        },
        dedupKey: (target) => target.name.toLowerCase(),
        compareTargets: (left, right) => left.name.localeCompare(right.name),
        cache: {
          read: (root) => readPhpLaravelTargetCache(root, "views"),
          write: (root, targets) =>
            writePhpLaravelTargetCache(root, "views", targets),
        },
      },
    );

    return collect({ workspaceRoot });
  }, [
    engineDeps,
    targetPhpFrameworkProviders,
    readPhpLaravelTargetCache,
    workspaceRoot,
    writePhpLaravelTargetCache,
  ]);

  const collectPhpLaravelConfigTargets = useCallback((): Promise<
    PhpLaravelConfigTarget[]
  > => {
    const collect = createWorkspaceTargetCollector<PhpLaravelConfigTarget>(
      engineDeps,
      {
        kind: "directoryScan",
        isEnabled: () => phpFrameworkSupportsConfig(targetPhpFrameworkProviders),
        roots: ["config"],
        readsContent: true,
        // A flat config scan never memoizes an unreadable `config/`; it
        // re-attempts the scan on the next call (matches the pre-extraction
        // early return before the cache write).
        rescanAfterDirectoryReadFailure: true,
        parseEntry: ({ path, relativePath, content }) => {
          const fileName = phpLaravelConfigFileNameFromRelativePath(relativePath);

          if (!fileName) {
            return [];
          }

          // The file-level target is recorded before the file is read so it
          // survives a read failure.
          const fileTarget: PhpLaravelConfigTarget = {
            key: fileName,
            path,
            position: { column: 1, lineNumber: 1 },
            relativePath,
          };

          if (content === undefined) {
            return [fileTarget];
          }

          return [
            fileTarget,
            ...phpFrameworkConfigKeysFromSource(
              content,
              fileName,
              targetPhpFrameworkProviders,
            ).map((target) => ({
              ...target,
              path,
              relativePath,
            })),
          ];
        },
        dedupKey: (target) => target.key.toLowerCase(),
        compareTargets: (left, right) => left.key.localeCompare(right.key),
        cache: {
          read: (root) => readPhpLaravelTargetCache(root, "config"),
          write: (root, targets) =>
            writePhpLaravelTargetCache(root, "config", targets),
        },
      },
    );

    return collect({ workspaceRoot });
  }, [
    engineDeps,
    targetPhpFrameworkProviders,
    readPhpLaravelTargetCache,
    workspaceRoot,
    writePhpLaravelTargetCache,
  ]);

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

  const findPhpLaravelViewTarget = useCallback(
    async (viewName: string): Promise<PhpLaravelViewNavigationTarget | null> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !phpFrameworkSupportsViews(targetPhpFrameworkProviders) ||
        !requestedRoot
      ) {
        return null;
      }

      for (const relativePath of phpLaravelViewNameCandidateRelativePaths(
        viewName,
      )) {
        if (!isRequestedRootActive()) {
          return null;
        }

        const path = joinWorkspacePath(requestedRoot, relativePath);

        try {
          await readNavigationFileContent(path);

          if (!isRequestedRootActive()) {
            return null;
          }

          return {
            name: viewName,
            path,
            position: { column: 1, lineNumber: 1 },
            relativePath,
          };
        } catch {
          if (!isRequestedRootActive()) {
            return null;
          }
        }
      }

      return null;
    },
    [
      targetPhpFrameworkProviders,
      currentWorkspaceRootRef,
      joinWorkspacePath,
      readNavigationFileContent,
      workspaceRoot,
    ],
  );

  const findPhpLaravelConfigTarget = useCallback(
    async (configKey: string): Promise<PhpLaravelConfigTarget | null> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !phpFrameworkSupportsConfig(targetPhpFrameworkProviders) ||
        !requestedRoot
      ) {
        return null;
      }

      const relativePath = phpLaravelConfigKeyCandidateRelativePath(configKey);

      if (!relativePath) {
        return null;
      }

      const fileName = phpLaravelConfigFileNameFromRelativePath(relativePath);

      if (!fileName) {
        return null;
      }

      const path = joinWorkspacePath(requestedRoot, relativePath);

      try {
        const content = await readNavigationFileContent(path);

        if (!isRequestedRootActive()) {
          return null;
        }

        const target = phpFrameworkConfigTargetFromSource(
          content,
          fileName,
          configKey,
          targetPhpFrameworkProviders,
        );

        if (!target) {
          return null;
        }

        return {
          ...target,
          path,
          relativePath,
        };
      } catch {
        if (!isRequestedRootActive()) {
          return null;
        }

        return null;
      }
    },
    [
      targetPhpFrameworkProviders,
      currentWorkspaceRootRef,
      joinWorkspacePath,
      readNavigationFileContent,
      workspaceRoot,
    ],
  );

  // The ten config-derived collectors below (auth guards, cache stores,
  // database/broadcast/queue/redis connections, mail mailers, password
  // brokers, log channels, storage disks) are all thin, declarative wrappers
  // over collectPhpLaravelConfigTargets/findPhpLaravelConfigTarget - see
  // useConfigDerivedLaravelTarget for the shared collect/find skeleton.
  const authGuardTarget = useConfigDerivedLaravelTarget(
    phpLaravelAuthGuardTargetDefinition,
    collectPhpLaravelConfigTargets,
    findPhpLaravelConfigTarget,
  );
  const cacheStoreTarget = useConfigDerivedLaravelTarget(
    phpLaravelCacheStoreTargetDefinition,
    collectPhpLaravelConfigTargets,
    findPhpLaravelConfigTarget,
  );
  const databaseConnectionTarget = useConfigDerivedLaravelTarget(
    phpLaravelDatabaseConnectionTargetDefinition,
    collectPhpLaravelConfigTargets,
    findPhpLaravelConfigTarget,
  );
  const broadcastConnectionTarget = useConfigDerivedLaravelTarget(
    phpLaravelBroadcastConnectionTargetDefinition,
    collectPhpLaravelConfigTargets,
    findPhpLaravelConfigTarget,
  );
  const queueConnectionTarget = useConfigDerivedLaravelTarget(
    phpLaravelQueueConnectionTargetDefinition,
    collectPhpLaravelConfigTargets,
    findPhpLaravelConfigTarget,
  );
  const redisConnectionTarget = useConfigDerivedLaravelTarget(
    phpLaravelRedisConnectionTargetDefinition,
    collectPhpLaravelConfigTargets,
    findPhpLaravelConfigTarget,
  );
  const mailMailerTarget = useConfigDerivedLaravelTarget(
    phpLaravelMailMailerTargetDefinition,
    collectPhpLaravelConfigTargets,
    findPhpLaravelConfigTarget,
  );
  const passwordBrokerTarget = useConfigDerivedLaravelTarget(
    phpLaravelPasswordBrokerTargetDefinition,
    collectPhpLaravelConfigTargets,
    findPhpLaravelConfigTarget,
  );
  const logChannelTarget = useConfigDerivedLaravelTarget(
    phpLaravelLogChannelTargetDefinition,
    collectPhpLaravelConfigTargets,
    findPhpLaravelConfigTarget,
  );
  const storageDiskTarget = useConfigDerivedLaravelTarget(
    phpLaravelStorageDiskTargetDefinition,
    collectPhpLaravelConfigTargets,
    findPhpLaravelConfigTarget,
  );

  return {
    collectPhpLaravelNamedRouteTargets,
    collectPhpLaravelGateAbilityTargets,
    collectPhpLaravelMiddlewareAliasTargets,
    collectPhpLaravelEnvTargets,
    collectPhpLaravelViewTargets,
    collectPhpLaravelConfigTargets,
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
    findPhpLaravelViewTarget,
    findPhpLaravelConfigTarget,
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
