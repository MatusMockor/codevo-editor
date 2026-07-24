import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import { normalizeExpressPackageLabel } from "../domain/expressRouteMounts";
import {
  normalizeWorkspaceExpressRouteFilePath,
  workspaceExpressRoutesFromSnapshotsBounded,
  type WorkspaceExpressRoute,
  type WorkspaceExpressRouteSourceSnapshot,
} from "../domain/workspaceExpressRoutes";

const DISCOVERY_LIMITS = { maxFiles: 2_000, maxVisited: 50_000 } as const;
const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_ROUTES = 20_000;
const READ_CONCURRENCY = 8;
const INVALIDATION_DEBOUNCE_MS = 75;
// Each entry may retain up to 32 MiB of source. Four entries cap retained
// cache source at 128 MiB while still covering short workspace switch-back flows.
const MAX_WORKSPACE_CACHE_ENTRIES = 4;

interface WorkspaceExpressRoutesCache {
  readonly error: string | null;
  readonly loaded: boolean;
  readonly loading: boolean;
  readonly routes: readonly WorkspaceExpressRoute[];
  readonly snapshots: readonly WorkspaceExpressRouteSourceSnapshot[];
  readonly sourceBytesByFile: Readonly<Record<string, number>>;
  readonly totalSourceBytes: number;
  readonly truncated: boolean;
}

export interface UseWorkspaceExpressRoutesOptions {
  readonly dirtySnapshots?: readonly WorkspaceExpressRouteSourceSnapshot[];
  readonly discoveryVersion: number;
  readonly gateway: WorkspaceSourceDiscoveryGateway;
  readonly isOpen: boolean;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
}

export interface WorkspaceExpressRoutesState {
  readonly error: string | null;
  readonly loading: boolean;
  readonly routes: readonly WorkspaceExpressRoute[];
  readonly truncated: boolean;
  refresh(): Promise<void>;
}

const EMPTY_CACHE: WorkspaceExpressRoutesCache = {
  error: null,
  loaded: false,
  loading: false,
  routes: [],
  snapshots: [],
  sourceBytesByFile: {},
  totalSourceBytes: 0,
  truncated: false,
};

export function useWorkspaceExpressRoutes({
  dirtySnapshots = [],
  discoveryVersion,
  gateway,
  isOpen,
  rootPath,
  workspaceId,
}: UseWorkspaceExpressRoutesOptions): WorkspaceExpressRoutesState {
  const [caches, setCaches] = useState<Record<string, WorkspaceExpressRoutesCache>>({});
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
      const enumeration = await gateway.enumerateJavaScriptSourceFiles(rootPath, DISCOVERY_LIMITS);
      if (!isCurrent()) return;

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
        const paths = enumeration.files.slice(start, start + READ_CONCURRENCY);
        const reads = await Promise.all(
          paths.map(async (relativeFilePath) => {
            let read = await gateway.readSourceTextBounded(
              rootPath,
              relativeFilePath,
              MAX_SOURCE_FILE_BYTES,
            );
            if (read.status === "changed" && isCurrent()) {
              read = await gateway.readSourceTextBounded(
                rootPath,
                relativeFilePath,
                MAX_SOURCE_FILE_BYTES,
              );
            }
            return { read, relativeFilePath };
          }),
        );
        if (!isCurrent()) return;

        for (const { read, relativeFilePath } of reads) {
          if (read.status !== "ok") {
            omittedSource = true;
            continue;
          }
          const sourceBytes = byteLength(read.content);
          if (
            sourceBytes > MAX_SOURCE_FILE_BYTES ||
            totalSourceBytes + sourceBytes > MAX_TOTAL_SOURCE_BYTES
          ) {
            stoppedByBudget = true;
            omittedSource = true;
            break;
          }
          totalSourceBytes += sourceBytes;
          snapshots.push({ relativeFilePath, source: read.content });
          sourceBytesByFile[snapshotIdentity(undefined, relativeFilePath)] = sourceBytes;
        }
      }
      if (!isCurrent()) return;
      const discovered = workspaceExpressRoutesFromSnapshotsBounded(snapshots, MAX_ROUTES);
      if (!isCurrent()) return;

      setCaches((current) =>
        withBoundedWorkspaceCache(current, workspaceKey, {
          error: null,
          loaded: true,
          loading: false,
          routes: discovered.routes,
          snapshots,
          sourceBytesByFile,
          totalSourceBytes,
          truncated: enumeration.truncated || omittedSource || discovered.truncated,
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

  const overlay = useMemo(() => {
    if (dirtySnapshots.length === 0) return { routes: cache.routes, truncated: false };

    let truncated = false;
    const snapshotsByPath = new Map<string, WorkspaceExpressRouteSourceSnapshot>();
    for (const snapshot of dirtySnapshots) {
      const relativeFilePath = normalizeWorkspaceExpressRouteFilePath(snapshot.relativeFilePath);
      if (!relativeFilePath) {
        truncated = true;
        continue;
      }
      const packageLabel = normalizeExpressPackageLabel(snapshot.packageLabel);
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
    let totalSourceBytes = cache.totalSourceBytes;
    for (const snapshotIdentityKey of dirtyPaths) {
      totalSourceBytes -= cache.sourceBytesByFile[snapshotIdentityKey] ?? 0;
    }

    const acceptedSnapshots: WorkspaceExpressRouteSourceSnapshot[] = [];
    for (const snapshot of normalizedSnapshots) {
      const sourceBytes = byteLength(snapshot.source);
      if (
        sourceBytes > MAX_SOURCE_FILE_BYTES ||
        totalSourceBytes + sourceBytes > MAX_TOTAL_SOURCE_BYTES
      ) {
        truncated = true;
        continue;
      }
      totalSourceBytes += sourceBytes;
      acceptedSnapshots.push(snapshot);
    }
    const overlay = workspaceExpressRoutesFromSnapshotsBounded(
      [
        ...cache.snapshots.filter(
          (snapshot) =>
            !dirtyPaths.has(snapshotIdentity(snapshot.packageLabel, snapshot.relativeFilePath)),
        ),
        ...acceptedSnapshots,
      ],
      MAX_ROUTES,
    );
    return { routes: overlay.routes, truncated: truncated || overlay.truncated };
  }, [
    cache.routes,
    cache.snapshots,
    cache.sourceBytesByFile,
    cache.totalSourceBytes,
    dirtySnapshots,
  ]);

  return {
    error: cache.error,
    loading: cache.loading,
    refresh,
    routes: overlay.routes,
    truncated: cache.truncated || overlay.truncated,
  };
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

function byteLength(value: string): number {
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
  }
  return bytes;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
