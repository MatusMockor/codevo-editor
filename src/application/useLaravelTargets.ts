import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpFrameworkConfigKeysFromSource,
  phpFrameworkConfigTargetFromSource,
  phpFrameworkJsonTranslationKeysFromSource,
  phpFrameworkJsonTranslationTargetFromSource,
  phpFrameworkRouteDefinitionsFromSource,
  phpFrameworkRouteSearchQueries,
  phpFrameworkSupportsConfig,
  phpFrameworkSupportsRoutes,
  phpFrameworkSupportsTranslations,
  phpFrameworkSupportsViews,
  phpFrameworkTranslationKeysFromSource,
  phpFrameworkTranslationTargetFromSource,
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
import {
  phpLaravelAuthGuardConfigKey,
  phpLaravelAuthGuardNameFromConfigKey,
} from "../domain/phpLaravelAuth";
import {
  phpLaravelCacheStoreConfigKey,
  phpLaravelCacheStoreNameFromConfigKey,
} from "../domain/phpLaravelCache";
import {
  phpLaravelDatabaseConnectionConfigKey,
  phpLaravelDatabaseConnectionNameFromConfigKey,
} from "../domain/phpLaravelDatabase";
import {
  phpLaravelBroadcastConnectionConfigKey,
  phpLaravelBroadcastConnectionNameFromConfigKey,
} from "../domain/phpLaravelBroadcasting";
import {
  phpLaravelQueueConnectionConfigKey,
  phpLaravelQueueConnectionNameFromConfigKey,
} from "../domain/phpLaravelQueue";
import {
  phpLaravelRedisConnectionConfigKey,
  phpLaravelRedisConnectionNameFromConfigKey,
} from "../domain/phpLaravelRedis";
import {
  phpLaravelMailMailerConfigKey,
  phpLaravelMailMailerNameFromConfigKey,
} from "../domain/phpLaravelMail";
import {
  phpLaravelPasswordBrokerConfigKey,
  phpLaravelPasswordBrokerNameFromConfigKey,
} from "../domain/phpLaravelPassword";
import {
  phpLaravelLogChannelConfigKey,
  phpLaravelLogChannelNameFromConfigKey,
} from "../domain/phpLaravelLog";
import {
  phpLaravelStorageDiskConfigKey,
  phpLaravelStorageDiskNameFromConfigKey,
} from "../domain/phpLaravelStorage";
import {
  phpLaravelTranslationFileNameFromKey,
  phpLaravelTranslationFileNameFromRelativePath,
  phpLaravelJsonTranslationLocaleFromRelativePath,
  isUsableLaravelTranslationLocale,
  type PhpLaravelTranslationTarget,
} from "../domain/phpLaravelTranslations";
import {
  phpLaravelViewNameCandidateRelativePaths,
  phpLaravelViewNameFromRelativePath,
  type PhpLaravelViewTarget,
} from "../domain/phpLaravelViews";
import { getFileName, type FileEntry, type TextSearchGateway } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
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

/**
 * A resolved view navigation target: the parsed view plus the 1:1 blade file
 * position navigation jumps to.
 */
export interface PhpLaravelViewNavigationTarget extends PhpLaravelViewTarget {
  position: EditorPosition;
}

/**
 * A Laravel config target whose key is one segment of a well-known config
 * namespace (`auth.guards.*`, `database.connections.*`, ...), plus the
 * human-facing name extracted from that segment under `property` (e.g.
 * `guardName`, `connectionName`). Every "config-derived" collector below
 * shares this shape; only the property name and the name/config-key mapping
 * functions differ per collector.
 */
export type PhpLaravelConfigDerivedTarget<Property extends string> =
  PhpLaravelConfigTarget & Record<Property, string>;

export type PhpLaravelAuthGuardTarget = PhpLaravelConfigDerivedTarget<"guardName">;
export type PhpLaravelCacheStoreTarget = PhpLaravelConfigDerivedTarget<"storeName">;
export type PhpLaravelDatabaseConnectionTarget =
  PhpLaravelConfigDerivedTarget<"connectionName">;
export type PhpLaravelBroadcastConnectionTarget =
  PhpLaravelConfigDerivedTarget<"connectionName">;
export type PhpLaravelQueueConnectionTarget =
  PhpLaravelConfigDerivedTarget<"connectionName">;
export type PhpLaravelRedisConnectionTarget =
  PhpLaravelConfigDerivedTarget<"connectionName">;
export type PhpLaravelMailMailerTarget = PhpLaravelConfigDerivedTarget<"mailerName">;
export type PhpLaravelPasswordBrokerTarget =
  PhpLaravelConfigDerivedTarget<"brokerName">;
export type PhpLaravelLogChannelTarget = PhpLaravelConfigDerivedTarget<"channelName">;
export type PhpLaravelStorageDiskTarget = PhpLaravelConfigDerivedTarget<"diskName">;

interface PhpLaravelConfigDerivedTargetDefinition<Property extends string> {
  configKeyFromName: (name: string) => string | null;
  nameFromConfigKey: (configKey: string) => string | null;
  property: Property;
}

const phpLaravelAuthGuardTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"guardName"> =
  {
    configKeyFromName: phpLaravelAuthGuardConfigKey,
    nameFromConfigKey: phpLaravelAuthGuardNameFromConfigKey,
    property: "guardName",
  };

const phpLaravelCacheStoreTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"storeName"> =
  {
    configKeyFromName: phpLaravelCacheStoreConfigKey,
    nameFromConfigKey: phpLaravelCacheStoreNameFromConfigKey,
    property: "storeName",
  };

const phpLaravelDatabaseConnectionTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"connectionName"> =
  {
    configKeyFromName: phpLaravelDatabaseConnectionConfigKey,
    nameFromConfigKey: phpLaravelDatabaseConnectionNameFromConfigKey,
    property: "connectionName",
  };

const phpLaravelBroadcastConnectionTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"connectionName"> =
  {
    configKeyFromName: phpLaravelBroadcastConnectionConfigKey,
    nameFromConfigKey: phpLaravelBroadcastConnectionNameFromConfigKey,
    property: "connectionName",
  };

const phpLaravelQueueConnectionTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"connectionName"> =
  {
    configKeyFromName: phpLaravelQueueConnectionConfigKey,
    nameFromConfigKey: phpLaravelQueueConnectionNameFromConfigKey,
    property: "connectionName",
  };

const phpLaravelRedisConnectionTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"connectionName"> =
  {
    configKeyFromName: phpLaravelRedisConnectionConfigKey,
    nameFromConfigKey: phpLaravelRedisConnectionNameFromConfigKey,
    property: "connectionName",
  };

const phpLaravelMailMailerTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"mailerName"> =
  {
    configKeyFromName: phpLaravelMailMailerConfigKey,
    nameFromConfigKey: phpLaravelMailMailerNameFromConfigKey,
    property: "mailerName",
  };

const phpLaravelPasswordBrokerTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"brokerName"> =
  {
    configKeyFromName: phpLaravelPasswordBrokerConfigKey,
    nameFromConfigKey: phpLaravelPasswordBrokerNameFromConfigKey,
    property: "brokerName",
  };

const phpLaravelLogChannelTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"channelName"> =
  {
    configKeyFromName: phpLaravelLogChannelConfigKey,
    nameFromConfigKey: phpLaravelLogChannelNameFromConfigKey,
    property: "channelName",
  };

const phpLaravelStorageDiskTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"diskName"> =
  {
    configKeyFromName: phpLaravelStorageDiskConfigKey,
    nameFromConfigKey: phpLaravelStorageDiskNameFromConfigKey,
    property: "diskName",
  };

/**
 * Builds the collect/find pair for a single config-derived target kind on top
 * of the shared `collectPhpLaravelConfigTargets`/`findPhpLaravelConfigTarget`
 * primitives. Every one of the ten config-derived collectors (auth guards,
 * cache stores, database/broadcast/queue/redis connections, mail mailers,
 * password brokers, log channels, storage disks) previously duplicated the
 * same collect -> map -> dedup -> sort skeleton and the same find -> map
 * skeleton; only the property name and the name/config-key mapping functions
 * differed, so those differences are captured declaratively in the
 * definitions above and this hook does the (identical) collecting/finding
 * once. Enablement (Laravel active, config supported) is entirely delegated
 * to `collectConfigTargets`/`findConfigTarget`, which already return an empty
 * result when disabled - there is nothing extra to gate here.
 */
function useConfigDerivedLaravelTarget<Property extends string>(
  definition: PhpLaravelConfigDerivedTargetDefinition<Property>,
  collectConfigTargets: () => Promise<PhpLaravelConfigTarget[]>,
  findConfigTarget: (configKey: string) => Promise<PhpLaravelConfigTarget | null>,
): {
  collect: () => Promise<Array<PhpLaravelConfigDerivedTarget<Property>>>;
  find: (name: string) => Promise<PhpLaravelConfigDerivedTarget<Property> | null>;
} {
  const { configKeyFromName, nameFromConfigKey, property } = definition;

  const collect = useCallback(async (): Promise<
    Array<PhpLaravelConfigDerivedTarget<Property>>
  > => {
    const targets = new Map<string, PhpLaravelConfigDerivedTarget<Property>>();

    for (const target of await collectConfigTargets()) {
      const name = nameFromConfigKey(target.key);

      if (!name) {
        continue;
      }

      const key = name.toLowerCase();

      if (!targets.has(key)) {
        targets.set(key, {
          ...target,
          [property]: name,
        } as PhpLaravelConfigDerivedTarget<Property>);
      }
    }

    return Array.from(targets.values()).sort((left, right) =>
      left[property].localeCompare(right[property]),
    );
  }, [collectConfigTargets, nameFromConfigKey, property]);

  const find = useCallback(
    async (name: string): Promise<PhpLaravelConfigDerivedTarget<Property> | null> => {
      const configKey = configKeyFromName(name);

      if (!configKey) {
        return null;
      }

      const target = await findConfigTarget(configKey);

      return target
        ? ({
            ...target,
            [property]: name,
          } as PhpLaravelConfigDerivedTarget<Property>)
        : null;
    },
    [configKeyFromName, findConfigTarget, property],
  );

  return { collect, find };
}

// Laravel config/view/translation completions previously triggered a full
// directory scan on every keystroke (recursive resources/views walk, reads of
// every config/*.php and lang file). The targets only change when files change,
// so they are memoized per workspace root with a short TTL. The cache is keyed
// by workspace root and reset on workspace switch and on index reindex (through
// `invalidatePhpLaravelTargetCache`) so it can never leak across project tabs or
// serve stale targets after a reindex.
const PHP_LARAVEL_TARGET_CACHE_TTL_MS = 30_000;

interface PhpLaravelTargetCacheEntry<T> {
  expiresAt: number;
  targets: T[];
}

interface PhpLaravelTargetCacheBucket {
  config?: PhpLaravelTargetCacheEntry<PhpLaravelConfigTarget>;
  translations?: PhpLaravelTargetCacheEntry<PhpLaravelTranslationTarget>;
  views?: PhpLaravelTargetCacheEntry<PhpLaravelViewTarget>;
}

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
export function useLaravelTargets(
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

  const phpLaravelTargetCacheRef = useRef<
    Record<string, PhpLaravelTargetCacheBucket>
  >({});

  const readPhpLaravelTargetCache = useCallback(
    <Kind extends keyof PhpLaravelTargetCacheBucket>(
      requestedRoot: string,
      kind: Kind,
    ): NonNullable<PhpLaravelTargetCacheBucket[Kind]>["targets"] | null => {
      // Only serve cached targets while the requested root is still the active
      // workspace; never let a stale tab's cache satisfy another tab's request.
      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return null;
      }

      const entry = phpLaravelTargetCacheRef.current[requestedRoot]?.[kind];

      if (!entry || entry.expiresAt <= Date.now()) {
        return null;
      }

      return entry.targets as NonNullable<
        PhpLaravelTargetCacheBucket[Kind]
      >["targets"];
    },
    [currentWorkspaceRootRef],
  );

  const writePhpLaravelTargetCache = useCallback(
    <Kind extends keyof PhpLaravelTargetCacheBucket>(
      requestedRoot: string,
      kind: Kind,
      targets: NonNullable<PhpLaravelTargetCacheBucket[Kind]>["targets"],
    ): void => {
      // Drop results computed for a root that is no longer active so the cache
      // can never be populated with another tab's targets.
      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return;
      }

      const bucket = phpLaravelTargetCacheRef.current[requestedRoot] ?? {};

      phpLaravelTargetCacheRef.current[requestedRoot] = {
        ...bucket,
        [kind]: {
          expiresAt: Date.now() + PHP_LARAVEL_TARGET_CACHE_TTL_MS,
          targets,
        },
      };
    },
    [currentWorkspaceRootRef],
  );

  const invalidatePhpLaravelTargetCache = useCallback(() => {
    phpLaravelTargetCacheRef.current = {};
  }, []);

  const collectPhpLaravelNamedRouteTargets = useCallback(
    (
      currentSource: string,
      currentPath: string,
    ): Promise<PhpLaravelNamedRouteTarget[]> => {
      const collect = createWorkspaceTargetCollector(engineDeps, {
        kind: "textSearch",
        isEnabled: () => phpFrameworkSupportsRoutes(activePhpFrameworkProviders),
        queries: () => phpFrameworkRouteSearchQueries(activePhpFrameworkProviders),
        parseDefinitions: (source) =>
          phpFrameworkRouteDefinitionsFromSource(
            source,
            activePhpFrameworkProviders,
          ),
      });

      return collect({
        workspaceRoot,
        currentDocument: { content: currentSource, path: currentPath },
      });
    },
    [engineDeps, activePhpFrameworkProviders, workspaceRoot],
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
        isEnabled: () => phpFrameworkSupportsViews(activePhpFrameworkProviders),
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
    activePhpFrameworkProviders,
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
        isEnabled: () => phpFrameworkSupportsConfig(activePhpFrameworkProviders),
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
              activePhpFrameworkProviders,
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
    activePhpFrameworkProviders,
    readPhpLaravelTargetCache,
    workspaceRoot,
    writePhpLaravelTargetCache,
  ]);

  const collectPhpLaravelTranslationLocaleRoots = useCallback(async (): Promise<
    string[]
  > => {
    const requestedRoot = workspaceRoot;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

    if (
      !phpFrameworkSupportsTranslations(activePhpFrameworkProviders) ||
      !requestedRoot
    ) {
      return [];
    }

    const localeRoots: string[] = [];

    for (const translationBase of ["lang", "resources/lang"]) {
      if (!isRequestedRootActive()) {
        return [];
      }

      try {
        const entries = await readWorkspaceDirectory(
          joinWorkspacePath(requestedRoot, translationBase),
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        for (const entry of entries) {
          if (
            entry.kind === "directory" &&
            isUsableLaravelTranslationLocale(entry.name)
          ) {
            localeRoots.push(`${translationBase}/${entry.name}`);
          }
        }
      } catch {
        if (!isRequestedRootActive()) {
          return [];
        }
      }
    }

    return localeRoots.sort((left, right) => {
      const leftLocale = getFileName(left);
      const rightLocale = getFileName(right);

      if (leftLocale === "en" && rightLocale !== "en") {
        return -1;
      }

      if (rightLocale === "en" && leftLocale !== "en") {
        return 1;
      }

      return left.localeCompare(right);
    });
  }, [
    activePhpFrameworkProviders,
    currentWorkspaceRootRef,
    joinWorkspacePath,
    readWorkspaceDirectory,
    workspaceRoot,
  ]);

  const collectPhpLaravelJsonTranslationFiles = useCallback(async (): Promise<
    Array<{ path: string; relativePath: string }>
  > => {
    const requestedRoot = workspaceRoot;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

    if (
      !phpFrameworkSupportsTranslations(activePhpFrameworkProviders) ||
      !requestedRoot
    ) {
      return [];
    }

    const files = new Map<string, { path: string; relativePath: string }>();

    for (const translationBase of ["lang", "resources/lang"]) {
      if (!isRequestedRootActive()) {
        return [];
      }

      try {
        const entries = await readWorkspaceDirectory(
          joinWorkspacePath(requestedRoot, translationBase),
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        for (const entry of entries) {
          if (entry.kind === "directory") {
            continue;
          }

          const relativePath = relativeWorkspacePath(requestedRoot, entry.path);

          if (!phpLaravelJsonTranslationLocaleFromRelativePath(relativePath)) {
            continue;
          }

          const key = relativePath.toLowerCase();

          if (!files.has(key)) {
            files.set(key, {
              path: entry.path,
              relativePath,
            });
          }
        }
      } catch {
        if (!isRequestedRootActive()) {
          return [];
        }
      }
    }

    return Array.from(files.values()).sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    );
  }, [
    activePhpFrameworkProviders,
    currentWorkspaceRootRef,
    joinWorkspacePath,
    readWorkspaceDirectory,
    relativeWorkspacePath,
    workspaceRoot,
  ]);

  const collectPhpLaravelTranslationTargets = useCallback(async (): Promise<
    PhpLaravelTranslationTarget[]
  > => {
    const requestedRoot = workspaceRoot;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

    if (
      !phpFrameworkSupportsTranslations(activePhpFrameworkProviders) ||
      !requestedRoot
    ) {
      return [];
    }

    const cachedTranslations = readPhpLaravelTargetCache(
      requestedRoot,
      "translations",
    );

    if (cachedTranslations) {
      return cachedTranslations;
    }

    const targets = new Map<string, PhpLaravelTranslationTarget>();

    const translationRoots = await collectPhpLaravelTranslationLocaleRoots();

    if (!isRequestedRootActive()) {
      return [];
    }

    for (const translationRoot of translationRoots) {
      if (!isRequestedRootActive()) {
        return [];
      }

      const rootPath = joinWorkspacePath(requestedRoot, translationRoot);
      let entries: FileEntry[];

      try {
        entries = await readWorkspaceDirectory(rootPath);
      } catch {
        if (!isRequestedRootActive()) {
          return [];
        }

        continue;
      }

      if (!isRequestedRootActive()) {
        return [];
      }

      for (const entry of entries) {
        if (!isRequestedRootActive()) {
          return [];
        }

        if (entry.kind === "directory") {
          continue;
        }

        const relativePath = relativeWorkspacePath(requestedRoot, entry.path);
        const fileName =
          phpLaravelTranslationFileNameFromRelativePath(relativePath);

        if (!fileName) {
          continue;
        }

        try {
          const content = await readNavigationFileContent(entry.path);

          if (!isRequestedRootActive()) {
            return [];
          }

          for (const target of phpFrameworkTranslationKeysFromSource(
            content,
            fileName,
            activePhpFrameworkProviders,
          )) {
            const key = target.key.toLowerCase();

            if (targets.has(key)) {
              continue;
            }

            targets.set(key, {
              key: target.key,
              path: entry.path,
              position: target.position,
              relativePath,
            });
          }
        } catch {
          if (!isRequestedRootActive()) {
            return [];
          }
        }
      }
    }

    const jsonFiles = await collectPhpLaravelJsonTranslationFiles();

    if (!isRequestedRootActive()) {
      return [];
    }

    for (const jsonFile of jsonFiles) {
      if (!isRequestedRootActive()) {
        return [];
      }

      try {
        const content = await readNavigationFileContent(jsonFile.path);

        if (!isRequestedRootActive()) {
          return [];
        }

        for (const target of phpFrameworkJsonTranslationKeysFromSource(
          content,
          activePhpFrameworkProviders,
        )) {
          const key = target.key.toLowerCase();

          if (targets.has(key)) {
            continue;
          }

          targets.set(key, {
            key: target.key,
            path: jsonFile.path,
            position: target.position,
            relativePath: jsonFile.relativePath,
          });
        }
      } catch {
        if (!isRequestedRootActive()) {
          return [];
        }
      }
    }

    if (!isRequestedRootActive()) {
      return [];
    }

    const result = Array.from(targets.values()).sort((left, right) =>
      left.key.localeCompare(right.key),
    );

    writePhpLaravelTargetCache(requestedRoot, "translations", result);

    return result;
  }, [
    activePhpFrameworkProviders,
    collectPhpLaravelJsonTranslationFiles,
    collectPhpLaravelTranslationLocaleRoots,
    currentWorkspaceRootRef,
    joinWorkspacePath,
    readNavigationFileContent,
    readPhpLaravelTargetCache,
    readWorkspaceDirectory,
    relativeWorkspacePath,
    workspaceRoot,
    writePhpLaravelTargetCache,
  ]);

  const findPhpLaravelViewTarget = useCallback(
    async (viewName: string): Promise<PhpLaravelViewNavigationTarget | null> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !phpFrameworkSupportsViews(activePhpFrameworkProviders) ||
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
      activePhpFrameworkProviders,
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
        !phpFrameworkSupportsConfig(activePhpFrameworkProviders) ||
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
          activePhpFrameworkProviders,
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
      activePhpFrameworkProviders,
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

  const findPhpLaravelTranslationTarget = useCallback(
    async (
      translationKey: string,
    ): Promise<PhpLaravelTranslationTarget | null> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !phpFrameworkSupportsTranslations(activePhpFrameworkProviders) ||
        !requestedRoot
      ) {
        return null;
      }

      const fileName = phpLaravelTranslationFileNameFromKey(translationKey);

      if (fileName) {
        const translationRoots = await collectPhpLaravelTranslationLocaleRoots();

        if (!isRequestedRootActive()) {
          return null;
        }

        for (const translationRoot of translationRoots) {
          if (!isRequestedRootActive()) {
            return null;
          }

          const relativePath = `${translationRoot}/${fileName}.php`;
          const path = joinWorkspacePath(requestedRoot, relativePath);

          try {
            const content = await readNavigationFileContent(path);

            if (!isRequestedRootActive()) {
              return null;
            }

            const target = phpFrameworkTranslationTargetFromSource(
              content,
              fileName,
              translationKey,
              activePhpFrameworkProviders,
            );

            if (!target) {
              continue;
            }

            return {
              key: target.key,
              path,
              position: target.position,
              relativePath,
            };
          } catch {
            if (!isRequestedRootActive()) {
              return null;
            }
          }
        }
      }

      const jsonFiles = await collectPhpLaravelJsonTranslationFiles();

      if (!isRequestedRootActive()) {
        return null;
      }

      for (const jsonFile of jsonFiles) {
        if (!isRequestedRootActive()) {
          return null;
        }

        try {
          const content = await readNavigationFileContent(jsonFile.path);

          if (!isRequestedRootActive()) {
            return null;
          }

          const target = phpFrameworkJsonTranslationTargetFromSource(
            content,
            translationKey,
            activePhpFrameworkProviders,
          );

          if (!target) {
            continue;
          }

          return {
            key: target.key,
            path: jsonFile.path,
            position: target.position,
            relativePath: jsonFile.relativePath,
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
      activePhpFrameworkProviders,
      collectPhpLaravelJsonTranslationFiles,
      collectPhpLaravelTranslationLocaleRoots,
      currentWorkspaceRootRef,
      joinWorkspacePath,
      readNavigationFileContent,
      workspaceRoot,
    ],
  );

  return {
    collectPhpLaravelNamedRouteTargets,
    collectPhpLaravelGateAbilityTargets,
    collectPhpLaravelMiddlewareAliasTargets,
    collectPhpLaravelEnvTargets,
    collectPhpLaravelViewTargets,
    collectPhpLaravelConfigTargets,
    collectPhpLaravelTranslationTargets,
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
    findPhpLaravelTranslationTarget,
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
