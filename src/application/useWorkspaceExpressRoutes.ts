import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import {
  normalizeExpressPackageLabel,
  resolveExpressRouteMountsBounded,
  type ExpressImportPathResolver,
  type ResolvedExpressRouteCandidate,
} from "../domain/expressRouteMounts";
import {
  expressRoutePackageRoots,
  expressRouteScanRoots,
  MAX_ROOTS,
  type ExpressRoutePackageJsonDir,
} from "../domain/expressRouteScanRoots";
import {
  normalizeWorkspaceExpressRouteFilePath,
  type WorkspaceExpressRoute,
  type WorkspaceExpressRouteSourceSnapshot,
} from "../domain/workspaceExpressRoutes";
import { readExpressRouteTsconfigAliases } from "./expressRouteTsconfigAliases";
import {
  bindExpressRouteNavigationReceipts,
  createExpressRouteNavigationBindingCache,
  createExpressRouteNavigationGeneration,
  revokeExpressRouteNavigationBindingCache,
  type ExpressRouteNavigationGeneration,
  type NavigableWorkspaceExpressRoute,
} from "./expressRouteNavigationReceipt";

const DISCOVERY_LIMITS = { maxFiles: 2_000, maxVisited: 50_000 } as const;
const PACKAGE_DISCOVERY_LIMITS = { maxFiles: MAX_ROOTS, maxVisited: 50_000 } as const;
const MAX_PACKAGE_JSON_BYTES = 256 * 1024;
const MAX_TOTAL_PACKAGE_JSON_BYTES = 4 * 1024 * 1024;
const MAX_INTERACTIVE_SOURCE_BYTES = 256 * 1024;
const MAX_INTERACTIVE_TOTAL_SOURCE_BYTES = 256 * 1024;
const MAX_ROUTES = 2_000;
const READ_CONCURRENCY = 8;
const INVALIDATION_DEBOUNCE_MS = 75;
const DIRTY_PROJECTION_DEBOUNCE_MS = 75;
// Each entry retains at most the 256 KiB interactive analysis budget. Four
// entries cover short workspace switch-back flows while retaining at most 1 MiB.
const MAX_WORKSPACE_CACHE_ENTRIES = 4;

interface WorkspaceExpressRoutesCache {
  readonly error: string | null;
  readonly loaded: boolean;
  readonly loading: boolean;
  readonly importPathResolver: ExpressImportPathResolver | undefined;
  readonly packageJsonDirs: readonly ExpressRoutePackageJsonDir[];
  readonly routes: readonly WorkspaceExpressRoute[];
  readonly snapshots: readonly WorkspaceExpressRouteSourceSnapshot[];
  readonly sourceBytesByFile: Readonly<Record<string, number>>;
  readonly totalSourceBytes: number;
  readonly truncated: boolean;
}

interface WorkspaceExpressRoutesPresentation {
  readonly navigationGeneration: ExpressRouteNavigationGeneration | null;
  readonly ownerKey: string | null;
  readonly routes: readonly NavigableWorkspaceExpressRoute[];
  readonly truncated: boolean;
}

interface ExpressRouteNavigationRevision {
  readonly discoveryVersion: number;
  readonly rootPath: string | null;
  readonly routeSnapshot: readonly WorkspaceExpressRoute[];
  readonly workspaceId: string | null;
  readonly workspaceKey: string | null;
}

interface IndependentDirtyProjectionCache {
  base: WorkspaceExpressRoutesCache | null;
  readonly baselineMetadata: Map<
    string,
    {
      readonly independent: boolean;
      readonly source: string;
    }
  >;
  readonly entries: Map<
    string,
    {
      readonly independent: boolean;
      readonly sourceBytes: number;
      result?: ReturnType<typeof workspaceExpressRoutesFromSnapshotsWithResolverBounded>;
      readonly source: string;
    }
  >;
}

export type WorkspaceExpressRouteProjectionWork =
  | { readonly kind: "parse"; readonly relativeFilePath: string }
  | {
      readonly inspectedCodeUnits: number;
      readonly kind: "source-scan";
      readonly relativeFilePath: string;
    }
  | {
      readonly kind: "workspace-parse";
      readonly snapshotCount: number;
      readonly sourceBytes: number;
    };

export interface UseWorkspaceExpressRoutesOptions {
  readonly dirtySnapshots?: readonly WorkspaceExpressRouteSourceSnapshot[];
  readonly discoveryVersion: number;
  readonly gateway: WorkspaceSourceDiscoveryGateway;
  readonly isOpen: boolean;
  readonly onProjectionWork?: (work: WorkspaceExpressRouteProjectionWork) => void;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
}

export interface WorkspaceExpressRoutesState {
  readonly error: string | null;
  readonly loading: boolean;
  readonly navigationGeneration: ExpressRouteNavigationGeneration | null;
  readonly routes: readonly NavigableWorkspaceExpressRoute[];
  readonly truncated: boolean;
  refresh(): Promise<void>;
}

const EMPTY_CACHE: WorkspaceExpressRoutesCache = {
  error: null,
  importPathResolver: undefined,
  loaded: false,
  loading: false,
  packageJsonDirs: [],
  routes: [],
  snapshots: [],
  sourceBytesByFile: {},
  totalSourceBytes: 0,
  truncated: false,
};

const EMPTY_PRESENTATION: WorkspaceExpressRoutesPresentation = {
  navigationGeneration: null,
  ownerKey: null,
  routes: [],
  truncated: false,
};
const EMPTY_DIRTY_SNAPSHOTS: readonly WorkspaceExpressRouteSourceSnapshot[] = [];

export function useWorkspaceExpressRoutes({
  dirtySnapshots = EMPTY_DIRTY_SNAPSHOTS,
  discoveryVersion,
  gateway,
  isOpen,
  onProjectionWork,
  rootPath,
  workspaceId,
}: UseWorkspaceExpressRoutesOptions): WorkspaceExpressRoutesState {
  const [caches, setCaches] = useState<Record<string, WorkspaceExpressRoutesCache>>({});
  const [presentation, setPresentation] =
    useState<WorkspaceExpressRoutesPresentation>(EMPTY_PRESENTATION);
  const navigationBindingCache = useRef(createExpressRouteNavigationBindingCache());
  const independentDirtyProjectionCache = useRef<IndependentDirtyProjectionCache>({
    base: null,
    baselineMetadata: new Map(),
    entries: new Map(),
  });
  const stableDirtySnapshots = useSemanticallyStableDirtySnapshots(dirtySnapshots);
  const projectionSequence = useRef(0);
  const discoverySequences = useRef(new Map<string, number>());
  const discoveryVersions = useRef(new Map<string, number>());
  const nextDiscoverySequence = useRef(1);
  const workspaceKey = workspaceId && rootPath ? `${workspaceId}\u0000${rootPath}` : null;
  const currentKeyRef = useRef(workspaceKey);
  const isOpenRef = useRef(isOpen);
  currentKeyRef.current = workspaceKey;
  isOpenRef.current = isOpen;
  const cache = workspaceKey ? (caches[workspaceKey] ?? EMPTY_CACHE) : EMPTY_CACHE;

  const discover = useCallback(async (): Promise<void> => {
    if (!workspaceKey || !rootPath || !isOpenRef.current) return;
    const sequence = takeDiscoverySequence(nextDiscoverySequence);
    touchBoundedMap(discoverySequences.current, workspaceKey, sequence);
    const isCurrent = () =>
      isOpenRef.current &&
      currentKeyRef.current === workspaceKey &&
      discoverySequences.current.get(workspaceKey) === sequence;

    setCaches((current) =>
      withBoundedWorkspaceCache(current, workspaceKey, {
        ...(current[workspaceKey] ?? EMPTY_CACHE),
        error: null,
        loading: true,
      }),
    );

    try {
      const [enumeration, packageEnumeration] = await Promise.all([
        gateway.enumerateJavaScriptSourceFiles(rootPath, DISCOVERY_LIMITS),
        enumeratePackageJsonFiles(gateway, rootPath),
      ]);
      if (!isCurrent()) return;
      const packageJsonRead = await readPackageJsonDirs(
        gateway,
        rootPath,
        packageEnumeration.files,
        isCurrent,
      );
      if (!packageJsonRead || !isCurrent()) return;
      const packageJsonDirs = packageJsonRead.dirs;
      const packageRoots = expressRoutePackageRoots(packageJsonDirs);
      const tsconfigRead = await readExpressRouteTsconfigAliases({
        allowUnscopedRoot:
          !packageEnumeration.truncated && !packageJsonRead.unscopedAuthorityUncertain,
        gateway,
        incompleteDirectories: packageJsonRead.incompleteDirectories,
        isCurrent,
        packageDirectories: packageJsonRead.authorityDirectories,
        rootPath,
      });
      if (!isCurrent() || tsconfigRead.status === "stale") return;
      const scanRoots = expressRouteScanRoots({
        packageJsonDirs,
        relativeFilePaths: enumeration.files,
      });

      let totalSourceBytes = 0;
      let stoppedByBudget = false;
      let omittedSource = false;
      const snapshots: WorkspaceExpressRouteSourceSnapshot[] = [];
      const sourceBytesByFile: Record<string, number> = {};
      for (
        let start = 0;
        start < enumeration.files.length && !stoppedByBudget;
        start += READ_CONCURRENCY
      ) {
        const files = scanRoots.files.slice(start, start + READ_CONCURRENCY);
        const reads = await Promise.all(
          files.map(async ({ packageLabel, relativeFilePath }) => {
            let read = await gateway.readSourceTextBounded(
              rootPath,
              relativeFilePath,
              MAX_INTERACTIVE_SOURCE_BYTES,
            );
            if (read.status === "changed" && isCurrent()) {
              read = await gateway.readSourceTextBounded(
                rootPath,
                relativeFilePath,
                MAX_INTERACTIVE_SOURCE_BYTES,
              );
            }
            return { packageLabel, read, relativeFilePath };
          }),
        );
        if (!isCurrent()) return;

        for (const { packageLabel, read, relativeFilePath } of reads) {
          if (read.status !== "ok") {
            omittedSource = true;
            continue;
          }
          const sourceBytes = byteLengthBounded(read.content, MAX_INTERACTIVE_SOURCE_BYTES);
          if (
            sourceBytes > MAX_INTERACTIVE_SOURCE_BYTES ||
            totalSourceBytes + sourceBytes > MAX_INTERACTIVE_TOTAL_SOURCE_BYTES
          ) {
            stoppedByBudget = true;
            omittedSource = true;
            break;
          }
          totalSourceBytes += sourceBytes;
          snapshots.push({ packageLabel, relativeFilePath, source: read.content });
          sourceBytesByFile[snapshotIdentity(packageLabel, relativeFilePath)] = sourceBytes;
        }
      }
      if (!isCurrent()) return;
      const discovered = workspaceExpressRoutesFromSnapshotsWithResolverBounded(
        snapshots,
        MAX_ROUTES,
        tsconfigRead.importPathResolver,
      );
      if (!isCurrent()) return;

      setCaches((current) =>
        withBoundedWorkspaceCache(current, workspaceKey, {
          error: null,
          importPathResolver: tsconfigRead.importPathResolver,
          loaded: true,
          loading: false,
          packageJsonDirs,
          routes: discovered.routes,
          snapshots,
          sourceBytesByFile,
          totalSourceBytes,
          truncated:
            enumeration.truncated ||
            packageEnumeration.truncated ||
            packageJsonRead.truncated ||
            tsconfigRead.truncated ||
            packageRoots.truncated ||
            scanRoots.truncated ||
            omittedSource ||
            discovered.capacityTruncated,
        }),
      );
    } catch (error) {
      if (!isCurrent()) return;
      setCaches((current) =>
        withBoundedWorkspaceCache(current, workspaceKey, {
          ...(current[workspaceKey] ?? EMPTY_CACHE),
          error: errorMessage(error),
          loaded: true,
          loading: false,
        }),
      );
    }
  }, [gateway, rootPath, workspaceKey]);

  const refresh = useCallback(async () => {
    if (!isOpenRef.current) return;
    await discover();
  }, [discover]);

  useEffect(() => {
    if (isOpen && workspaceKey && !cache.loaded && !cache.loading) {
      void discover();
    }
  }, [cache.loaded, cache.loading, discover, isOpen, workspaceKey]);

  useEffect(() => {
    if (!workspaceKey || !cache.loaded) return;
    setCaches((current) => {
      const cached = current[workspaceKey];
      if (!cached) return current;
      const keys = Object.keys(current);
      if (keys[keys.length - 1] === workspaceKey) return current;
      return withBoundedWorkspaceCache(current, workspaceKey, cached);
    });
    touchExistingBoundedMap(discoverySequences.current, workspaceKey);
    touchExistingBoundedMap(discoveryVersions.current, workspaceKey);
  }, [cache.loaded, workspaceKey]);

  useEffect(() => {
    if (!workspaceKey) return;
    const previousVersion = discoveryVersions.current.get(workspaceKey);
    touchBoundedMap(discoveryVersions.current, workspaceKey, discoveryVersion);
    if (previousVersion === undefined || previousVersion === discoveryVersion) return;

    invalidateSequence(
      discoverySequences.current,
      workspaceKey,
      takeDiscoverySequence(nextDiscoverySequence),
    );
    setCaches((current) =>
      withBoundedWorkspaceCache(current, workspaceKey, {
        ...(current[workspaceKey] ?? EMPTY_CACHE),
        loading: false,
      }),
    );
    const timeout = setTimeout(() => {
      setCaches((current) =>
        withBoundedWorkspaceCache(current, workspaceKey, {
          ...(current[workspaceKey] ?? EMPTY_CACHE),
          loaded: false,
          loading: false,
        }),
      );
    }, INVALIDATION_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [discoveryVersion, workspaceKey]);

  useEffect(() => {
    if (isOpen || !workspaceKey) return;
    invalidateSequence(
      discoverySequences.current,
      workspaceKey,
      takeDiscoverySequence(nextDiscoverySequence),
    );
    discoverySequences.current.delete(workspaceKey);
    discoveryVersions.current.delete(workspaceKey);
    setCaches((current) => withoutWorkspaceCache(current, workspaceKey));
  }, [isOpen, workspaceKey]);

  useEffect(() => {
    if (!workspaceKey) return;
    const sequences = discoverySequences.current;
    const versions = discoveryVersions.current;
    return () => {
      invalidateSequence(sequences, workspaceKey, takeDiscoverySequence(nextDiscoverySequence));
      sequences.delete(workspaceKey);
      versions.delete(workspaceKey);
      setCaches((current) => {
        const cacheToPause = current[workspaceKey];
        if (!cacheToPause?.loading) return current;
        return {
          ...current,
          [workspaceKey]: { ...cacheToPause, loading: false },
        };
      });
    };
  }, [workspaceKey]);

  const navigationGeneration = useMemo(
    () =>
      createExpressRouteNavigationGenerationForRevision({
        discoveryVersion,
        rootPath,
        routeSnapshot: cache.routes,
        workspaceId,
        workspaceKey,
      }),
    [cache.routes, discoveryVersion, rootPath, workspaceId, workspaceKey],
  );

  useEffect(
    () => () => revokeExpressRouteNavigationBindingCache(navigationBindingCache.current),
    [navigationGeneration, workspaceKey],
  );

  useEffect(() => {
    const sequence = projectionSequence.current + 1;
    projectionSequence.current = sequence;
    if (!workspaceKey || !rootPath || !workspaceId || !navigationGeneration || !cache.loaded) {
      setPresentation(EMPTY_PRESENTATION);
      return;
    }
    const capturedDirtySnapshots = stableDirtySnapshots;
    const delay = capturedDirtySnapshots.length > 0 ? DIRTY_PROJECTION_DEBOUNCE_MS : 0;
    const timeout = setTimeout(() => {
      if (projectionSequence.current !== sequence) return;
      const overlay = projectWorkspaceExpressRoutes(
        cache,
        capturedDirtySnapshots,
        independentDirtyProjectionCache.current,
        onProjectionWork,
      );
      if (projectionSequence.current !== sequence) return;
      const presentedRoutes = overlay.routes.slice(0, MAX_ROUTES);
      const presentationTruncated = overlay.routes.length > MAX_ROUTES;
      const navigation = bindExpressRouteNavigationReceipts(
        presentedRoutes,
        overlay.snapshots,
        {
          generation: navigationGeneration,
          rootPath,
          workspaceId,
        },
        navigationBindingCache.current,
      );
      if (projectionSequence.current !== sequence) return;
      setPresentation({
        navigationGeneration,
        ownerKey: workspaceKey,
        routes: navigation.routes,
        truncated:
          cache.truncated || overlay.truncated || presentationTruncated || navigation.truncated,
      });
    }, delay);
    return () => {
      clearTimeout(timeout);
      if (projectionSequence.current === sequence) projectionSequence.current += 1;
    };
  }, [
    cache,
    navigationGeneration,
    onProjectionWork,
    rootPath,
    stableDirtySnapshots,
    workspaceId,
    workspaceKey,
  ]);

  const currentPresentation =
    presentation.ownerKey === workspaceKey &&
    presentation.navigationGeneration === navigationGeneration
      ? presentation
      : EMPTY_PRESENTATION;

  return {
    error: cache.error,
    loading:
      cache.loading ||
      (isOpen && Boolean(workspaceKey) && !cache.loaded && cache.error === null) ||
      (cache.loaded &&
        cache.error === null &&
        Boolean(workspaceKey) &&
        currentPresentation.navigationGeneration !== navigationGeneration),
    navigationGeneration: currentPresentation.navigationGeneration,
    refresh,
    routes: currentPresentation.routes,
    truncated: cache.truncated || currentPresentation.truncated,
  };
}

function createExpressRouteNavigationGenerationForRevision({
  rootPath,
  workspaceId,
  workspaceKey,
}: ExpressRouteNavigationRevision): ExpressRouteNavigationGeneration | null {
  return workspaceKey && rootPath && workspaceId ? createExpressRouteNavigationGeneration() : null;
}

function projectWorkspaceExpressRoutes(
  cache: WorkspaceExpressRoutesCache,
  dirtySnapshots: readonly WorkspaceExpressRouteSourceSnapshot[],
  independentCache: IndependentDirtyProjectionCache,
  onProjectionWork: ((work: WorkspaceExpressRouteProjectionWork) => void) | undefined,
): {
  readonly routes: readonly WorkspaceExpressRoute[];
  readonly snapshots: readonly WorkspaceExpressRouteSourceSnapshot[];
  readonly truncated: boolean;
} {
  prepareIndependentProjectionCache(independentCache, cache);
  if (dirtySnapshots.length === 0) {
    independentCache.baselineMetadata.clear();
    independentCache.entries.clear();
    return { routes: cache.routes, snapshots: cache.snapshots, truncated: false };
  }
  let truncated = dirtySnapshots.length > DISCOVERY_LIMITS.maxFiles;
  const normalizedDirtySnapshots: WorkspaceExpressRouteSourceSnapshot[] = [];
  for (const snapshot of dirtySnapshots.slice(0, DISCOVERY_LIMITS.maxFiles)) {
    const relativeFilePath = normalizeWorkspaceExpressRouteFilePath(snapshot.relativeFilePath);
    if (!relativeFilePath) {
      truncated = true;
      continue;
    }
    normalizedDirtySnapshots.push({ ...snapshot, relativeFilePath });
  }
  const inferredDirtyFiles = expressRouteScanRoots({
    packageJsonDirs: cache.packageJsonDirs,
    relativeFilePaths: normalizedDirtySnapshots.map((snapshot) => snapshot.relativeFilePath),
  }).files;
  const snapshotsByPath = new Map<string, WorkspaceExpressRouteSourceSnapshot>();
  for (let index = 0; index < normalizedDirtySnapshots.length; index += 1) {
    const snapshot = normalizedDirtySnapshots[index];
    if (!snapshot) continue;
    const packageLabel =
      normalizeExpressPackageLabel(snapshot.packageLabel) ??
      inferredDirtyFiles[index]?.packageLabel;
    const relativeFilePath = snapshot.relativeFilePath;
    snapshotsByPath.set(snapshotIdentity(packageLabel, relativeFilePath), {
      ...snapshot,
      relativeFilePath,
      ...(packageLabel ? { packageLabel } : { packageLabel: undefined }),
    });
  }
  const normalizedSnapshots = [...snapshotsByPath.values()].sort(
    (left, right) =>
      compareText(left.relativeFilePath, right.relativeFilePath) ||
      compareText(left.packageLabel ?? "", right.packageLabel ?? ""),
  );
  const dirtyPaths = new Set(
    normalizedSnapshots.map((snapshot) =>
      snapshotIdentity(snapshot.packageLabel, snapshot.relativeFilePath),
    ),
  );
  pruneIndependentProjectionCache(independentCache, dirtyPaths);
  let totalSourceBytes = cache.totalSourceBytes;
  for (const snapshotIdentityKey of dirtyPaths) {
    totalSourceBytes -= cache.sourceBytesByFile[snapshotIdentityKey] ?? 0;
  }

  const acceptedSnapshots: WorkspaceExpressRouteSourceSnapshot[] = [];
  const acceptedSnapshotKeys = new Set<string>();
  let degradedDirtySource = false;
  for (const snapshot of normalizedSnapshots) {
    const sourceBytes = dirtyProjectionMetadata(
      independentCache,
      snapshot,
      onProjectionWork,
    ).sourceBytes;
    if (sourceBytes > MAX_INTERACTIVE_SOURCE_BYTES) {
      degradedDirtySource = true;
      truncated = true;
      break;
    }
    if (totalSourceBytes + sourceBytes > MAX_INTERACTIVE_TOTAL_SOURCE_BYTES) {
      truncated = true;
      break;
    }
    totalSourceBytes += sourceBytes;
    acceptedSnapshots.push(snapshot);
    acceptedSnapshotKeys.add(snapshotIdentity(snapshot.packageLabel, snapshot.relativeFilePath));
  }
  pruneIndependentProjectionCache(independentCache, acceptedSnapshotKeys);
  const retainedSnapshots = cache.snapshots.filter(
    (snapshot) =>
      !dirtyPaths.has(snapshotIdentity(snapshot.packageLabel, snapshot.relativeFilePath)),
  );
  const combinedSnapshots = [...retainedSnapshots, ...acceptedSnapshots];
  if (degradedDirtySource) {
    return {
      routes: cache.routes.filter(
        (route) => !dirtyPaths.has(snapshotIdentity(route.packageLabel, route.relativeFilePath)),
      ),
      snapshots: retainedSnapshots,
      truncated: true,
    };
  }
  const incremental = canProjectDirtySnapshotsIncrementally(
    cache,
    acceptedSnapshots,
    dirtyPaths,
    truncated,
    independentCache,
    onProjectionWork,
  );
  if (!incremental) {
    notifyProjectionWork(onProjectionWork, {
      kind: "workspace-parse",
      snapshotCount: combinedSnapshots.length,
      sourceBytes: totalSourceBytes,
    });
  }
  const overlay = incremental
    ? projectIndependentDirtySnapshots(
        cache,
        acceptedSnapshots,
        dirtyPaths,
        independentCache,
        onProjectionWork,
      )
    : workspaceExpressRoutesFromSnapshotsWithResolverBounded(
        combinedSnapshots,
        MAX_ROUTES,
        cache.importPathResolver,
      );
  return {
    routes: overlay.routes,
    snapshots: combinedSnapshots,
    truncated: truncated || overlay.capacityTruncated || overlay.truncated,
  };
}

function canProjectDirtySnapshotsIncrementally(
  cache: WorkspaceExpressRoutesCache,
  acceptedSnapshots: readonly WorkspaceExpressRouteSourceSnapshot[],
  dirtyPaths: ReadonlySet<string>,
  rejectedDirtySnapshot: boolean,
  projectionCache: IndependentDirtyProjectionCache,
  onProjectionWork: ((work: WorkspaceExpressRouteProjectionWork) => void) | undefined,
): boolean {
  if (rejectedDirtySnapshot || cache.routes.length >= MAX_ROUTES) return false;
  const cachedSnapshots = new Map(
    cache.snapshots.map((snapshot) => [
      snapshotIdentity(snapshot.packageLabel, snapshot.relativeFilePath),
      snapshot,
    ]),
  );
  for (const snapshot of acceptedSnapshots) {
    if (!dirtyProjectionMetadata(projectionCache, snapshot, onProjectionWork).independent) {
      return false;
    }
    const previous = cachedSnapshots.get(
      snapshotIdentity(snapshot.packageLabel, snapshot.relativeFilePath),
    );
    if (
      previous &&
      !baselineProjectionMetadata(projectionCache, previous, onProjectionWork).independent
    ) {
      return false;
    }
  }
  return acceptedSnapshots.length === dirtyPaths.size;
}

function isMountIndependentExpressSource(source: string): boolean {
  if (/\b(?:export|exports|module)\b|\.\s*use\s*\(/u.test(source)) return false;
  for (const match of source.matchAll(/\b(?:import|require)\b/gu)) {
    if (!isSafeExpressDependencyAt(source, match.index ?? 0, match[0])) return false;
  }
  return true;
}

function isSafeExpressDependencyAt(source: string, offset: number, keyword: string): boolean {
  const tail = source.slice(offset + keyword.length, offset + keyword.length + 512);
  if (keyword === "require") {
    return /^\s*\(\s*(['"])express\1\s*\)/u.test(tail);
  }
  if (/^\s*\(/u.test(tail)) return false;
  const statementEnd = tail.search(/[;\r\n]/u);
  const statement = statementEnd < 0 ? tail : tail.slice(0, statementEnd);
  return (
    /^\s*(['"])express\1\s*$/u.test(statement) ||
    /^\s+(?:type\s+)?(?:.{0,440}?\s+from\s+)?(['"])express\1\s*$/u.test(statement)
  );
}

function projectIndependentDirtySnapshots(
  cache: WorkspaceExpressRoutesCache,
  dirtySnapshots: readonly WorkspaceExpressRouteSourceSnapshot[],
  dirtyPaths: ReadonlySet<string>,
  projectionCache: IndependentDirtyProjectionCache,
  onProjectionWork: ((work: WorkspaceExpressRouteProjectionWork) => void) | undefined,
): {
  readonly capacityTruncated: boolean;
  readonly routes: WorkspaceExpressRoute[];
  readonly truncated: boolean;
} {
  const retainedRoutes = cache.routes.filter(
    (route) => !dirtyPaths.has(snapshotIdentity(route.packageLabel, route.relativeFilePath)),
  );
  const retainedProjectionKeys = new Set<string>();
  const dirtyRoutes: WorkspaceExpressRoute[] = [];
  let capacityTruncated = false;
  let truncated = false;
  for (const snapshot of dirtySnapshots) {
    const key = snapshotIdentity(snapshot.packageLabel, snapshot.relativeFilePath);
    retainedProjectionKeys.add(key);
    const cached = dirtyProjectionMetadata(projectionCache, snapshot, onProjectionWork);
    if (!cached.result) {
      notifyProjectionWork(onProjectionWork, {
        kind: "parse",
        relativeFilePath: snapshot.relativeFilePath,
      });
      cached.result = workspaceExpressRoutesFromSnapshotsWithResolverBounded(
        [snapshot],
        MAX_ROUTES,
        cache.importPathResolver,
      );
    }
    const result = cached.result;
    capacityTruncated ||= result.capacityTruncated;
    truncated ||= result.truncated;
    const remainingCapacity = MAX_ROUTES - retainedRoutes.length - dirtyRoutes.length;
    if (remainingCapacity <= 0) {
      capacityTruncated = true;
      truncated = true;
      break;
    }
    dirtyRoutes.push(...result.routes.slice(0, remainingCapacity));
    if (result.routes.length > remainingCapacity) {
      capacityTruncated = true;
      truncated = true;
      break;
    }
  }
  for (const key of projectionCache.entries.keys()) {
    if (!retainedProjectionKeys.has(key)) projectionCache.entries.delete(key);
  }
  const routes = [...retainedRoutes, ...dirtyRoutes].sort(compareWorkspaceExpressRoutes);
  return {
    capacityTruncated,
    routes,
    truncated,
  };
}

function prepareIndependentProjectionCache(
  projectionCache: IndependentDirtyProjectionCache,
  cache: WorkspaceExpressRoutesCache,
): void {
  if (projectionCache.base === cache) return;
  projectionCache.base = cache;
  projectionCache.baselineMetadata.clear();
  projectionCache.entries.clear();
}

function pruneIndependentProjectionCache(
  projectionCache: IndependentDirtyProjectionCache,
  retainedKeys: ReadonlySet<string>,
): void {
  for (const key of projectionCache.entries.keys()) {
    if (!retainedKeys.has(key)) projectionCache.entries.delete(key);
  }
  for (const key of projectionCache.baselineMetadata.keys()) {
    if (!retainedKeys.has(key)) projectionCache.baselineMetadata.delete(key);
  }
}

function dirtyProjectionMetadata(
  projectionCache: IndependentDirtyProjectionCache,
  snapshot: WorkspaceExpressRouteSourceSnapshot,
  onProjectionWork: ((work: WorkspaceExpressRouteProjectionWork) => void) | undefined,
): {
  readonly independent: boolean;
  readonly sourceBytes: number;
  result?: ReturnType<typeof workspaceExpressRoutesFromSnapshotsWithResolverBounded>;
  readonly source: string;
} {
  const key = snapshotIdentity(snapshot.packageLabel, snapshot.relativeFilePath);
  const cached = projectionCache.entries.get(key);
  if (cached?.source === snapshot.source) return cached;
  const measurement = measureByteLengthBounded(snapshot.source, MAX_INTERACTIVE_SOURCE_BYTES);
  const metadata = {
    independent:
      measurement.bytes <= MAX_INTERACTIVE_SOURCE_BYTES &&
      isMountIndependentExpressSource(snapshot.source),
    source: snapshot.source,
    sourceBytes: measurement.bytes,
  };
  notifyProjectionWork(onProjectionWork, {
    inspectedCodeUnits: measurement.inspectedCodeUnits,
    kind: "source-scan",
    relativeFilePath: snapshot.relativeFilePath,
  });
  if (measurement.bytes <= MAX_INTERACTIVE_SOURCE_BYTES) {
    projectionCache.entries.set(key, metadata);
  } else {
    projectionCache.entries.delete(key);
  }
  return metadata;
}

function baselineProjectionMetadata(
  projectionCache: IndependentDirtyProjectionCache,
  snapshot: WorkspaceExpressRouteSourceSnapshot,
  onProjectionWork: ((work: WorkspaceExpressRouteProjectionWork) => void) | undefined,
): { readonly independent: boolean; readonly source: string } {
  const key = snapshotIdentity(snapshot.packageLabel, snapshot.relativeFilePath);
  const cached = projectionCache.baselineMetadata.get(key);
  if (cached?.source === snapshot.source) return cached;
  notifyProjectionWork(onProjectionWork, {
    inspectedCodeUnits: snapshot.source.length,
    kind: "source-scan",
    relativeFilePath: snapshot.relativeFilePath,
  });
  const metadata = {
    independent: isMountIndependentExpressSource(snapshot.source),
    source: snapshot.source,
  };
  projectionCache.baselineMetadata.set(key, metadata);
  return metadata;
}

function notifyProjectionWork(
  observer: ((work: WorkspaceExpressRouteProjectionWork) => void) | undefined,
  work: WorkspaceExpressRouteProjectionWork,
): void {
  try {
    observer?.(work);
  } catch {
    // Optional performance telemetry must not affect route authority or publication.
  }
}

function useSemanticallyStableDirtySnapshots(
  snapshots: readonly WorkspaceExpressRouteSourceSnapshot[],
): readonly WorkspaceExpressRouteSourceSnapshot[] {
  const stable = useRef(snapshots);
  if (!sameDirtySnapshots(stable.current, snapshots)) stable.current = snapshots;
  return stable.current;
}

function sameDirtySnapshots(
  left: readonly WorkspaceExpressRouteSourceSnapshot[],
  right: readonly WorkspaceExpressRouteSourceSnapshot[],
): boolean {
  if (left === right) return true;
  const leftLength = Math.min(left.length, DISCOVERY_LIMITS.maxFiles);
  const rightLength = Math.min(right.length, DISCOVERY_LIMITS.maxFiles);
  if (
    leftLength !== rightLength ||
    left.length > DISCOVERY_LIMITS.maxFiles !== right.length > DISCOVERY_LIMITS.maxFiles
  ) {
    return false;
  }
  for (let index = 0; index < leftLength; index += 1) {
    const snapshot = left[index];
    const candidate = right[index];
    if (
      !snapshot ||
      !candidate ||
      snapshot.packageLabel !== candidate.packageLabel ||
      snapshot.relativeFilePath !== candidate.relativeFilePath ||
      snapshot.source !== candidate.source
    ) {
      return false;
    }
  }
  return true;
}

function invalidateSequence(
  sequences: Map<string, number>,
  workspaceKey: string,
  sequence: number,
): void {
  touchBoundedMap(sequences, workspaceKey, sequence);
}

function takeDiscoverySequence(counter: { current: number }): number {
  if (!Number.isSafeInteger(counter.current) || counter.current <= 0) {
    throw new Error("Workspace Express route discovery sequence is exhausted.");
  }
  const sequence = counter.current;
  counter.current += 1;
  return sequence;
}

function byteLengthBounded(value: string, maxBytes: number): number {
  return measureByteLengthBounded(value, maxBytes).bytes;
}

function measureByteLengthBounded(
  value: string,
  maxBytes: number,
): { readonly bytes: number; readonly inspectedCodeUnits: number } {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 0x80) bytes += 1;
    else if (codeUnit < 0x800) bytes += 2;
    else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > maxBytes) {
      return { bytes: maxBytes + 1, inspectedCodeUnits: index + 1 };
    }
  }
  return { bytes, inspectedCodeUnits: value.length };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function workspaceExpressRoutesFromSnapshotsWithResolverBounded(
  snapshots: readonly WorkspaceExpressRouteSourceSnapshot[],
  maxRoutes: number,
  importPathResolver: ExpressImportPathResolver | undefined,
): {
  readonly capacityTruncated: boolean;
  readonly routes: WorkspaceExpressRoute[];
  readonly truncated: boolean;
} {
  const normalizedSnapshots = snapshots
    .map((snapshot) => {
      const relativeFilePath = normalizeWorkspaceExpressRouteFilePath(snapshot.relativeFilePath);
      if (!relativeFilePath) return null;
      const packageLabel = normalizeExpressPackageLabel(snapshot.packageLabel);
      return {
        ...snapshot,
        relativeFilePath,
        ...(packageLabel ? { packageLabel } : { packageLabel: undefined }),
      };
    })
    .filter((snapshot): snapshot is WorkspaceExpressRouteSourceSnapshot => snapshot !== null)
    .sort(
      (left, right) =>
        compareText(left.relativeFilePath, right.relativeFilePath) ||
        compareText(left.packageLabel ?? "", right.packageLabel ?? ""),
    );
  const limit = Number.isFinite(maxRoutes) ? Math.max(0, Math.floor(maxRoutes)) : Infinity;
  const resolved = resolveExpressRouteMountsBounded(normalizedSnapshots, limit, importPathResolver);
  const occurrences = new Map<string, number>();
  const routes = resolved.routes.map((route) => {
    const duplicateKey = [
      route.packageLabel ?? "",
      route.relativeFilePath,
      route.receiver,
      route.method,
      route.path,
    ].join("\u0000");
    const occurrence = (occurrences.get(duplicateKey) ?? 0) + 1;
    occurrences.set(duplicateKey, occurrence);
    return {
      ...route,
      id: workspaceExpressRouteId(route, occurrence),
      occurrence,
    };
  });
  return {
    capacityTruncated: resolved.capacityTruncated,
    routes: routes.sort(compareWorkspaceExpressRoutes),
    truncated: resolved.truncated,
  };
}

function workspaceExpressRouteId(route: ResolvedExpressRouteCandidate, occurrence: number): string {
  return [
    "express-route",
    normalizeExpressPackageLabel(route.packageLabel) ?? "",
    route.relativeFilePath,
    route.receiver,
    route.method,
    route.path,
    String(route.line),
    String(route.column),
    String(occurrence),
  ]
    .map(encodeURIComponent)
    .join(":");
}

function compareWorkspaceExpressRoutes(
  left: WorkspaceExpressRoute,
  right: WorkspaceExpressRoute,
): number {
  return (
    compareText(left.relativeFilePath, right.relativeFilePath) ||
    compareText(
      normalizeExpressPackageLabel(left.packageLabel) ?? "",
      normalizeExpressPackageLabel(right.packageLabel) ?? "",
    ) ||
    left.line - right.line ||
    left.column - right.column ||
    left.occurrence - right.occurrence ||
    compareText(left.id, right.id)
  );
}

async function enumeratePackageJsonFiles(
  gateway: WorkspaceSourceDiscoveryGateway,
  rootPath: string,
): Promise<{ readonly files: readonly string[]; readonly truncated: boolean }> {
  if (!gateway.enumeratePackageJsonFiles) return { files: [], truncated: false };
  try {
    return await gateway.enumeratePackageJsonFiles(rootPath, PACKAGE_DISCOVERY_LIMITS);
  } catch {
    return { files: [], truncated: true };
  }
}

async function readPackageJsonDirs(
  gateway: WorkspaceSourceDiscoveryGateway,
  rootPath: string,
  relativePaths: readonly string[],
  isCurrent: () => boolean,
): Promise<{
  readonly authorityDirectories: readonly string[];
  readonly dirs: readonly ExpressRoutePackageJsonDir[];
  readonly incompleteDirectories: readonly string[];
  readonly truncated: boolean;
  readonly unscopedAuthorityUncertain: boolean;
} | null> {
  const authorityDirectories = new Set<string>();
  const dirs: ExpressRoutePackageJsonDir[] = [];
  const incompleteDirectories = new Set<string>();
  const candidates: { readonly relativeDirPath: string; readonly relativePath: string }[] = [];
  const seenPaths = new Set<string>();
  let truncated = relativePaths.length > MAX_ROOTS;
  let unscopedAuthorityUncertain = relativePaths.length > MAX_ROOTS;
  let totalBytes = 0;

  for (const relativePath of relativePaths.slice(0, MAX_ROOTS)) {
    if (seenPaths.has(relativePath)) continue;
    seenPaths.add(relativePath);
    const relativeDirPath = packageJsonDirPath(relativePath);
    if (relativeDirPath === null) {
      truncated = true;
      unscopedAuthorityUncertain = true;
      continue;
    }
    if (relativeDirPath) authorityDirectories.add(relativeDirPath);
    candidates.push({ relativeDirPath, relativePath });
  }

  let stoppedByBudget = false;
  let start = 0;
  while (start < candidates.length && !stoppedByBudget) {
    const remainingBytes = MAX_TOTAL_PACKAGE_JSON_BYTES - totalBytes;
    const reservedReadCount = Math.min(
      READ_CONCURRENCY,
      Math.floor(remainingBytes / MAX_PACKAGE_JSON_BYTES),
    );
    if (reservedReadCount === 0) {
      stoppedByBudget = true;
      truncated = true;
      break;
    }
    const batch = candidates.slice(start, start + reservedReadCount);
    start += batch.length;
    const reads = await Promise.all(
      batch.map(({ relativePath }) =>
        readPackageJsonSource(gateway, rootPath, relativePath, isCurrent),
      ),
    );
    if (!isCurrent()) return null;
    for (let index = 0; index < batch.length; index += 1) {
      const candidate = batch[index];
      const read = reads[index];
      if (!candidate || !read) continue;
      if (read.status === "stale") return null;
      if (read.status === "incomplete") {
        truncated = true;
        if (candidate.relativeDirPath) incompleteDirectories.add(candidate.relativeDirPath);
      } else {
        const sourceBytes = utf8ByteLengthBounded(read.source, MAX_PACKAGE_JSON_BYTES);
        if (sourceBytes === null || totalBytes + sourceBytes > MAX_TOTAL_PACKAGE_JSON_BYTES) {
          stoppedByBudget = true;
          truncated = true;
          if (candidate.relativeDirPath) incompleteDirectories.add(candidate.relativeDirPath);
        } else {
          totalBytes += sourceBytes;
          const manifest = packageManifestFromJson(read.source);
          if (manifest.valid) {
            dirs.push({
              packageName: manifest.packageName,
              relativeDirPath: candidate.relativeDirPath,
            });
          } else {
            truncated = true;
            if (candidate.relativeDirPath) incompleteDirectories.add(candidate.relativeDirPath);
          }
        }
      }
      if (stoppedByBudget) break;
    }
    await yieldToMainThread();
    if (!isCurrent()) return null;
  }

  if (stoppedByBudget) {
    for (const { relativeDirPath } of candidates) {
      if (!dirs.some((dir) => dir.relativeDirPath === relativeDirPath)) {
        if (relativeDirPath) incompleteDirectories.add(relativeDirPath);
      }
    }
  }

  return {
    authorityDirectories: [...authorityDirectories].sort(compareText),
    dirs,
    incompleteDirectories: [...incompleteDirectories].sort(compareText),
    truncated,
    unscopedAuthorityUncertain,
  };
}

type PackageJsonSourceRead =
  | { readonly source: string; readonly status: "ok" }
  | { readonly status: "incomplete" }
  | { readonly status: "stale" };

async function readPackageJsonSource(
  gateway: WorkspaceSourceDiscoveryGateway,
  rootPath: string,
  relativePath: string,
  isCurrent: () => boolean,
): Promise<PackageJsonSourceRead> {
  try {
    let read = await gateway.readSourceTextBounded(rootPath, relativePath, MAX_PACKAGE_JSON_BYTES);
    if (!isCurrent()) return { status: "stale" };
    if (read.status === "changed") {
      read = await gateway.readSourceTextBounded(rootPath, relativePath, MAX_PACKAGE_JSON_BYTES);
    }
    if (!isCurrent()) return { status: "stale" };
    if (read.status !== "ok") return { status: "incomplete" };
    return { source: read.content, status: "ok" };
  } catch {
    return { status: "incomplete" };
  }
}

function packageJsonDirPath(relativePath: string): string | null {
  if (relativePath === "package.json") return "";
  if (
    relativePath.length > 4_096 ||
    relativePath.includes("\\") ||
    !relativePath.endsWith("/package.json")
  ) {
    return null;
  }
  const relativeDirPath = relativePath.slice(0, -"/package.json".length);
  const segments = relativeDirPath.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    segments.includes("node_modules")
  ) {
    return null;
  }
  return relativeDirPath;
}

function packageManifestFromJson(
  source: string,
): { readonly packageName: unknown; readonly valid: true } | { readonly valid: false } {
  try {
    const parsed: unknown = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { valid: false };
    return { packageName: (parsed as Record<string, unknown>).name, valid: true };
  } catch {
    return { valid: false };
  }
}

function utf8ByteLengthBounded(value: string, maxBytes: number): number | null {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 0x80) bytes += 1;
    else if (codeUnit < 0x800) bytes += 2;
    else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > maxBytes) return null;
  }
  return bytes;
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function snapshotIdentity(packageLabel: string | undefined, relativeFilePath: string): string {
  return JSON.stringify([normalizeExpressPackageLabel(packageLabel) ?? null, relativeFilePath]);
}

function withBoundedWorkspaceCache(
  current: Record<string, WorkspaceExpressRoutesCache>,
  workspaceKey: string,
  cache: WorkspaceExpressRoutesCache,
): Record<string, WorkspaceExpressRoutesCache> {
  const next = { ...current };
  delete next[workspaceKey];
  next[workspaceKey] = cache;
  while (Object.keys(next).length > MAX_WORKSPACE_CACHE_ENTRIES) {
    const oldest = Object.keys(next)[0];
    if (oldest === undefined) break;
    delete next[oldest];
  }
  return next;
}

function withoutWorkspaceCache(
  current: Record<string, WorkspaceExpressRoutesCache>,
  workspaceKey: string,
): Record<string, WorkspaceExpressRoutesCache> {
  if (!(workspaceKey in current)) return current;
  const next = { ...current };
  delete next[workspaceKey];
  return next;
}

function touchBoundedMap<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_WORKSPACE_CACHE_ENTRIES) {
    const oldest = map.keys().next().value as Key | undefined;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function touchExistingBoundedMap<Key, Value>(map: Map<Key, Value>, key: Key): void {
  if (!map.has(key)) return;
  touchBoundedMap(map, key, map.get(key) as Value);
}
