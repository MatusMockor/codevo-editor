import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import { findNetteLatteSnippetReference } from "../domain/netteAjaxSnippets";
import { componentTemplateCandidatePathsForClass } from "../domain/nettePathResolution";
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
  PhpFrameworkNetteAjaxSnippetTarget,
  PhpFrameworkTranslationTarget,
} from "./usePhpFrameworkTargets";

const PHP_NETTE_TARGET_CACHE_TTL_MS = 30_000;
const NETTE_TRANSLATION_BASE_ROOTS: readonly string[] = ["lang", "app/lang"];
const NETTE_MODULES_ROOT = "app/modules";
const NETTE_TRANSLATION_MODULE_ROOT_MAX_DEPTH = 8;
const NETTE_TRANSLATION_FILE_MAX_DEPTH = 8;
const NETTE_TRANSLATION_MAX_DIRECTORIES = 500;
const NETTE_TRANSLATION_MAX_FILES = 1_000;

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

interface PhpNetteTranslationScanState {
  filesFound: number;
  rootsFound: number;
  visitedDirectories: Set<string>;
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

export interface PhpNetteAjaxSnippetTargetFinderDeps {
  currentWorkspaceRootRef: { readonly current: string | null };
  workspaceRoot: string | null;
  readNavigationFileContent: (path: string) => Promise<string>;
  relativeWorkspacePath: (workspaceRoot: string, path: string) => string;
  joinWorkspacePath: (workspaceRoot: string, relativePath: string) => string;
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
  findNetteAjaxSnippetTarget: async () => null,
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

export async function findPhpNetteAjaxSnippetTarget(
  currentPath: string,
  snippetName: string,
  deps: PhpNetteAjaxSnippetTargetFinderDeps,
): Promise<PhpFrameworkNetteAjaxSnippetTarget | null> {
  const requestedRoot = deps.workspaceRoot;

  if (
    !requestedRoot ||
    !workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot)
  ) {
    return null;
  }

  const currentRelativePath = deps.relativeWorkspacePath(
    requestedRoot,
    currentPath,
  );
  const candidatePaths =
    componentTemplateCandidatePathsForClass(currentRelativePath);

  for (const relativePath of candidatePaths) {
    if (
      !workspaceRootKeysEqual(
        deps.currentWorkspaceRootRef.current,
        requestedRoot,
      )
    ) {
      return null;
    }

    const path = deps.joinWorkspacePath(requestedRoot, relativePath);
    let content: string;

    try {
      content = await deps.readNavigationFileContent(path);
    } catch {
      if (
        !workspaceRootKeysEqual(
          deps.currentWorkspaceRootRef.current,
          requestedRoot,
        )
      ) {
        return null;
      }

      continue;
    }

    if (
      !workspaceRootKeysEqual(
        deps.currentWorkspaceRootRef.current,
        requestedRoot,
      )
    ) {
      return null;
    }

    const reference = findNetteLatteSnippetReference(content, snippetName);

    if (!reference) {
      continue;
    }

    return {
      name: reference.name,
      path,
      position: editorPositionAtOffset(content, reference.nameStart),
      relativePath,
    };
  }

  return null;
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const before = source.slice(0, Math.max(0, offset));
  const lines = before.split("\n");

  return {
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
    lineNumber: lines.length,
  };
}

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

function normalizedNetteDirectoryKey(path: string): string {
  return path.split("\\").join("/").replace(/\/+$/, "").toLowerCase();
}

async function collectPhpNetteNestedTranslationRoots(
  deps: PhpNetteTranslationTargetResolverDeps,
  requestedRoot: string,
  directory: string,
  depth: number,
  roots: Set<string>,
  scanState: PhpNetteTranslationScanState,
): Promise<boolean> {
  if (depth > NETTE_TRANSLATION_MODULE_ROOT_MAX_DEPTH) {
    return true;
  }

  if (
    scanState.visitedDirectories.size >= NETTE_TRANSLATION_MAX_DIRECTORIES ||
    scanState.rootsFound >= NETTE_TRANSLATION_MAX_DIRECTORIES
  ) {
    return true;
  }

  const directoryKey = normalizedNetteDirectoryKey(directory);

  if (scanState.visitedDirectories.has(directoryKey)) {
    return true;
  }

  scanState.visitedDirectories.add(directoryKey);

  let entries: FileEntry[];

  try {
    entries = await deps.readWorkspaceDirectory(directory);
  } catch {
    return isWorkspaceRootActive(deps, requestedRoot);
  }

  if (!isWorkspaceRootActive(deps, requestedRoot)) {
    return false;
  }

  for (const entry of entries) {
    if (!isWorkspaceRootActive(deps, requestedRoot)) {
      return false;
    }

    if (entry.kind !== "directory") {
      continue;
    }

    const relativePath = deps.relativeWorkspacePath(requestedRoot, entry.path);

    if (entry.name === "lang") {
      roots.add(relativePath);
      scanState.rootsFound += 1;
      continue;
    }

    const active = await collectPhpNetteNestedTranslationRoots(
      deps,
      requestedRoot,
      entry.path,
      depth + 1,
      roots,
      scanState,
    );

    if (!active) {
      return false;
    }
  }

  return true;
}

async function collectPhpNetteTranslationRoots(
  deps: PhpNetteTranslationTargetResolverDeps,
  requestedRoot: string,
): Promise<string[]> {
  const roots = new Set<string>(NETTE_TRANSLATION_BASE_ROOTS);
  const modulesRoot = deps.joinWorkspacePath(requestedRoot, NETTE_MODULES_ROOT);
  const scanState: PhpNetteTranslationScanState = {
    filesFound: 0,
    rootsFound: roots.size,
    visitedDirectories: new Set(),
  };
  const active = await collectPhpNetteNestedTranslationRoots(
    deps,
    requestedRoot,
    modulesRoot,
    0,
    roots,
    scanState,
  );

  if (!active || !isWorkspaceRootActive(deps, requestedRoot)) {
    return [];
  }

  return Array.from(roots).sort((left, right) => left.localeCompare(right));
}

async function collectPhpNetteTranslationFilesFromDirectory(
  deps: PhpNetteTranslationTargetResolverDeps,
  requestedRoot: string,
  directory: string,
  depth: number,
  wantedDomain: string | null | undefined,
  files: Map<string, PhpNetteTranslationFile>,
  scanState: PhpNetteTranslationScanState,
): Promise<boolean> {
  if (depth > NETTE_TRANSLATION_FILE_MAX_DEPTH) {
    return true;
  }

  if (
    scanState.visitedDirectories.size >= NETTE_TRANSLATION_MAX_DIRECTORIES ||
    scanState.filesFound >= NETTE_TRANSLATION_MAX_FILES
  ) {
    return true;
  }

  const directoryKey = normalizedNetteDirectoryKey(directory);

  if (scanState.visitedDirectories.has(directoryKey)) {
    return true;
  }

  scanState.visitedDirectories.add(directoryKey);

  let entries: FileEntry[];

  try {
    entries = await deps.readWorkspaceDirectory(directory);
  } catch {
    return isWorkspaceRootActive(deps, requestedRoot);
  }

  if (!isWorkspaceRootActive(deps, requestedRoot)) {
    return false;
  }

  for (const entry of entries) {
    if (!isWorkspaceRootActive(deps, requestedRoot)) {
      return false;
    }

    if (scanState.filesFound >= NETTE_TRANSLATION_MAX_FILES) {
      return true;
    }

    if (entry.kind === "directory") {
      const active = await collectPhpNetteTranslationFilesFromDirectory(
        deps,
        requestedRoot,
        entry.path,
        depth + 1,
        wantedDomain,
        files,
        scanState,
      );

      if (!active) {
        return false;
      }

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
      scanState.filesFound += 1;
    }
  }

  return true;
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
  const scanState: PhpNetteTranslationScanState = {
    filesFound: 0,
    rootsFound: 0,
    visitedDirectories: new Set(),
  };

  for (const root of roots) {
    if (!isWorkspaceRootActive(deps, requestedRoot)) {
      return [];
    }

    const active = await collectPhpNetteTranslationFilesFromDirectory(
      deps,
      requestedRoot,
      deps.joinWorkspacePath(requestedRoot, root),
      0,
      wantedDomain,
      files,
      scanState,
    );

    if (!active) {
      return [];
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

  const cachedTranslations = deps.readCachedTranslationTargets(requestedRoot);

  if (cachedTranslations) {
    return (
      cachedTranslations.find((target) => target.key === translationKey) ?? null
    );
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
    findNetteAjaxSnippetTarget: async (
      _currentSource,
      currentPath,
      snippetName,
    ) =>
      findPhpNetteAjaxSnippetTarget(currentPath, snippetName, {
        currentWorkspaceRootRef,
        workspaceRoot,
        readNavigationFileContent,
        relativeWorkspacePath,
        joinWorkspacePath,
      }),
    findTranslationTarget: translationTargetResolver.find,
    invalidateTargetCache: targetCache.invalidate,
  };
}

export const phpNetteFrameworkTargetCollectorAdapter: PhpFrameworkTargetCollectorAdapter =
  {
    providerId: "nette",
    useTargets: usePhpNetteFrameworkTargetAdapter,
  };
