import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import {
  netteTranslationDomainFromPath,
  netteTranslationKeysFromSource,
  netteTranslationTargetFromSource,
} from "../domain/netteTranslations";
import type { FileEntry } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type {
  PhpFrameworkTargetCollectorAdapter,
  PhpFrameworkTargets,
  PhpFrameworkTargetsDependencies,
  PhpFrameworkTranslationTarget,
} from "./usePhpFrameworkTargets";

const PHP_NETTE_TARGET_CACHE_TTL_MS = 30_000;
const NETTE_TRANSLATION_BASE_ROOTS: readonly string[] = ["lang", "app/lang"];
const NETTE_MODULES_ROOT = "app/modules";

interface PhpNetteTargetCacheEntry<Target> {
  expiresAt: number;
  targets: Target[];
}

interface PhpNetteTargetCache {
  translations?: PhpNetteTargetCacheEntry<PhpFrameworkTranslationTarget>;
}

interface PhpNetteTranslationFile {
  path: string;
  relativePath: string;
}

export interface PhpNetteTranslationTargetResolverDeps {
  currentWorkspaceRootRef: { readonly current: string | null };
  workspaceRoot: string | null;
  readNavigationFileContent: (path: string) => Promise<string>;
  readWorkspaceDirectory: (path: string) => Promise<FileEntry[]>;
  relativeWorkspacePath: (workspaceRoot: string, path: string) => string;
  joinWorkspacePath: (workspaceRoot: string, relativePath: string) => string;
  supportsTranslations: () => boolean;
  readCachedTranslationTargets: (
    workspaceRoot: string,
  ) => PhpFrameworkTranslationTarget[] | null;
  writeCachedTranslationTargets: (
    workspaceRoot: string,
    targets: PhpFrameworkTranslationTarget[],
  ) => void;
}

export interface PhpNetteTranslationTargetResolver {
  collect: () => Promise<PhpFrameworkTranslationTarget[]>;
  find: (translationKey: string) => Promise<PhpFrameworkTranslationTarget | null>;
}

const inertPhpNetteFrameworkTargets: PhpFrameworkTargets = {
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

function usePhpNetteTargetCache(
  currentWorkspaceRootRef: MutableRefObject<string | null>,
) {
  const cacheRef = useRef<Record<string, PhpNetteTargetCache>>({});

  const read = useCallback(
    (requestedRoot: string): PhpFrameworkTranslationTarget[] | null => {
      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return null;
      }

      const entry = cacheRef.current[requestedRoot]?.translations;

      if (!entry || entry.expiresAt <= Date.now()) {
        return null;
      }

      return entry.targets;
    },
    [currentWorkspaceRootRef],
  );

  const write = useCallback(
    (requestedRoot: string, targets: PhpFrameworkTranslationTarget[]): void => {
      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return;
      }

      cacheRef.current[requestedRoot] = {
        ...cacheRef.current[requestedRoot],
        translations: {
          expiresAt: Date.now() + PHP_NETTE_TARGET_CACHE_TTL_MS,
          targets,
        },
      };
    },
    [currentWorkspaceRootRef],
  );

  const invalidate = useCallback(() => {
    cacheRef.current = {};
  }, []);

  return { invalidate, read, write };
}

function isWorkspaceRootActive(
  deps: PhpNetteTranslationTargetResolverDeps,
  requestedRoot: string | null,
): boolean {
  return workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot);
}

function netteTranslationDomainFromKey(translationKey: string): string | null {
  const domainEnd = translationKey.indexOf(".");

  return domainEnd > 0 ? translationKey.slice(0, domainEnd) : null;
}

function isNetteTranslationRelativePath(relativePath: string): boolean {
  const normalized = relativePath.split("\\").join("/");

  return (
    (normalized.startsWith("lang/") || normalized.includes("/lang/")) &&
    normalized.toLowerCase().endsWith(".neon") &&
    netteTranslationDomainFromPath(normalized) !== null
  );
}

async function collectPhpNetteTranslationRoots(
  deps: PhpNetteTranslationTargetResolverDeps,
  requestedRoot: string,
): Promise<string[]> {
  const roots = new Set<string>(NETTE_TRANSLATION_BASE_ROOTS);
  const modulesRoot = deps.joinWorkspacePath(requestedRoot, NETTE_MODULES_ROOT);

  try {
    const entries = await deps.readWorkspaceDirectory(modulesRoot);

    if (!isWorkspaceRootActive(deps, requestedRoot)) {
      return [];
    }

    for (const entry of entries) {
      if (entry.kind !== "directory") {
        continue;
      }

      const moduleRelativePath = deps.relativeWorkspacePath(
        requestedRoot,
        entry.path,
      );

      roots.add(`${moduleRelativePath}/lang`);
    }
  } catch {
    if (!isWorkspaceRootActive(deps, requestedRoot)) {
      return [];
    }
  }

  return Array.from(roots).sort((left, right) => left.localeCompare(right));
}

async function collectPhpNetteTranslationFiles(
  deps: PhpNetteTranslationTargetResolverDeps,
  requestedRoot: string,
  wantedDomain?: string | null,
): Promise<PhpNetteTranslationFile[]> {
  const roots = await collectPhpNetteTranslationRoots(deps, requestedRoot);

  if (!isWorkspaceRootActive(deps, requestedRoot)) {
    return [];
  }

  const files = new Map<string, PhpNetteTranslationFile>();

  for (const root of roots) {
    if (!isWorkspaceRootActive(deps, requestedRoot)) {
      return [];
    }

    let entries: FileEntry[];

    try {
      entries = await deps.readWorkspaceDirectory(
        deps.joinWorkspacePath(requestedRoot, root),
      );
    } catch {
      if (!isWorkspaceRootActive(deps, requestedRoot)) {
        return [];
      }

      continue;
    }

    if (!isWorkspaceRootActive(deps, requestedRoot)) {
      return [];
    }

    for (const entry of entries) {
      if (entry.kind === "directory") {
        continue;
      }

      const relativePath = deps.relativeWorkspacePath(requestedRoot, entry.path);

      if (!isNetteTranslationRelativePath(relativePath)) {
        continue;
      }

      if (
        wantedDomain &&
        netteTranslationDomainFromPath(relativePath) !== wantedDomain
      ) {
        continue;
      }

      const key = relativePath.toLowerCase();

      if (!files.has(key)) {
        files.set(key, { path: entry.path, relativePath });
      }
    }
  }

  return Array.from(files.values()).sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

async function collectPhpNetteTranslationTargets(
  deps: PhpNetteTranslationTargetResolverDeps,
): Promise<PhpFrameworkTranslationTarget[]> {
  const requestedRoot = deps.workspaceRoot;

  if (!deps.supportsTranslations() || !requestedRoot) {
    return [];
  }

  const cachedTranslations = deps.readCachedTranslationTargets(requestedRoot);

  if (cachedTranslations) {
    return cachedTranslations;
  }

  const files = await collectPhpNetteTranslationFiles(deps, requestedRoot);

  if (!isWorkspaceRootActive(deps, requestedRoot)) {
    return [];
  }

  const targets = new Map<string, PhpFrameworkTranslationTarget>();

  for (const file of files) {
    if (!isWorkspaceRootActive(deps, requestedRoot)) {
      return [];
    }

    try {
      const content = await deps.readNavigationFileContent(file.path);

      if (!isWorkspaceRootActive(deps, requestedRoot)) {
        return [];
      }

      for (const target of netteTranslationKeysFromSource(
        content,
        file.relativePath,
      )) {
        const key = target.key.toLowerCase();

        if (targets.has(key)) {
          continue;
        }

        targets.set(key, {
          key: target.key,
          path: file.path,
          position: target.position,
          relativePath: file.relativePath,
        });
      }
    } catch {
      if (!isWorkspaceRootActive(deps, requestedRoot)) {
        return [];
      }
    }
  }

  if (!isWorkspaceRootActive(deps, requestedRoot)) {
    return [];
  }

  const result = Array.from(targets.values()).sort((left, right) =>
    left.key.localeCompare(right.key),
  );

  deps.writeCachedTranslationTargets(requestedRoot, result);

  return result;
}

async function findPhpNetteTranslationTarget(
  deps: PhpNetteTranslationTargetResolverDeps,
  translationKey: string,
): Promise<PhpFrameworkTranslationTarget | null> {
  const requestedRoot = deps.workspaceRoot;
  const domain = netteTranslationDomainFromKey(translationKey);

  if (!deps.supportsTranslations() || !requestedRoot || !domain) {
    return null;
  }

  const files = await collectPhpNetteTranslationFiles(
    deps,
    requestedRoot,
    domain,
  );

  if (!isWorkspaceRootActive(deps, requestedRoot)) {
    return null;
  }

  for (const file of files) {
    if (!isWorkspaceRootActive(deps, requestedRoot)) {
      return null;
    }

    try {
      const content = await deps.readNavigationFileContent(file.path);

      if (!isWorkspaceRootActive(deps, requestedRoot)) {
        return null;
      }

      const target = netteTranslationTargetFromSource(
        content,
        file.relativePath,
        translationKey,
      );

      if (!target) {
        continue;
      }

      return {
        key: target.key,
        path: file.path,
        position: target.position,
        relativePath: file.relativePath,
      };
    } catch {
      if (!isWorkspaceRootActive(deps, requestedRoot)) {
        return null;
      }
    }
  }

  return null;
}

export function createPhpNetteTranslationTargetResolver(
  deps: PhpNetteTranslationTargetResolverDeps,
): PhpNetteTranslationTargetResolver {
  return {
    collect: () => collectPhpNetteTranslationTargets(deps),
    find: (translationKey) => findPhpNetteTranslationTarget(deps, translationKey),
  };
}

function usePhpNetteFrameworkTargetAdapter(
  dependencies: PhpFrameworkTargetsDependencies,
): PhpFrameworkTargets {
  const {
    currentWorkspaceRootRef,
    workspaceRoot,
    readNavigationFileContent,
    readWorkspaceDirectory,
    relativeWorkspacePath,
    joinWorkspacePath,
    frameworkIntelligence,
  } = dependencies;
  const frameworkRuntime = createPhpFrameworkRuntimeContext(frameworkIntelligence);
  const targetCache = usePhpNetteTargetCache(currentWorkspaceRootRef);

  const translationTargetResolver = useMemo(
    () =>
      createPhpNetteTranslationTargetResolver({
        currentWorkspaceRootRef,
        workspaceRoot,
        readNavigationFileContent,
        readWorkspaceDirectory,
        relativeWorkspacePath,
        joinWorkspacePath,
        supportsTranslations: () => frameworkRuntime.supports("translations"),
        readCachedTranslationTargets: targetCache.read,
        writeCachedTranslationTargets: targetCache.write,
      }),
    [
      currentWorkspaceRootRef,
      workspaceRoot,
      readNavigationFileContent,
      readWorkspaceDirectory,
      relativeWorkspacePath,
      joinWorkspacePath,
      frameworkRuntime,
      targetCache.read,
      targetCache.write,
    ],
  );

  return {
    ...inertPhpNetteFrameworkTargets,
    collectTranslationTargets: translationTargetResolver.collect,
    findTranslationTarget: translationTargetResolver.find,
    invalidateTargetCache: targetCache.invalidate,
  };
}

export const phpNetteFrameworkTargetCollectorAdapter: PhpFrameworkTargetCollectorAdapter =
  {
    providerId: "nette",
    useTargets: usePhpNetteFrameworkTargetAdapter,
  };
