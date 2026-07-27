import {
  expressRoutesForReceiversInSourceBounded,
  staticJavaScriptStringArgumentAt,
} from "../domain/expressRoutes";
import {
  normalizeWorkspaceExpressRouteFilePath,
  type WorkspaceExpressRoute,
  type WorkspaceExpressRouteSourceSnapshot,
} from "../domain/workspaceExpressRoutes";

const RECEIPT = Symbol("express-route-navigation-receipt");
const CACHE_STATE = Symbol("express-route-navigation-cache-state");
const MAX_NAVIGABLE_ROUTES = 20_000;

declare const generationBrand: unique symbol;

/** Opaque identity for one exact rendered route projection. */
export type ExpressRouteNavigationGeneration = Readonly<{
  readonly [generationBrand]: true;
}>;

export interface NavigableWorkspaceExpressRoute extends WorkspaceExpressRoute {
  readonly [RECEIPT]: ExpressRouteNavigationReceipt;
}

interface ExpressRouteNavigationCacheState {
  readonly declarations: Map<
    string,
    {
      readonly lineStarts: readonly number[];
      readonly localPaths: Map<string, string>;
      readonly source: string;
    }
  >;
  readonly rows: Map<
    string,
    {
      readonly lease: { active: boolean };
      readonly route: NavigableWorkspaceExpressRoute;
      readonly source: string;
    }
  >;
  generation: ExpressRouteNavigationGeneration | null;
  ownerKey: string | null;
}

export interface ExpressRouteNavigationBindingCache {
  readonly [CACHE_STATE]: ExpressRouteNavigationCacheState;
}

interface ExpressRouteNavigationReceipt {
  readonly column: number;
  readonly generation: ExpressRouteNavigationGeneration;
  readonly line: number;
  readonly localPath: string;
  readonly method: string;
  readonly packageLabel?: string;
  readonly presentationId: string;
  readonly receiver: string;
  readonly relativeFilePath: string;
  readonly rootPath: string;
  readonly runtimePath: string;
  /** Exact immutable projection authority; kept behind the non-enumerable receipt symbol. */
  readonly source: string;
  readonly workspaceId: string;
  /** Revoked synchronously when this exact row leaves the current projection. */
  readonly lease: { active: boolean };
}

export function createExpressRouteNavigationGeneration(): ExpressRouteNavigationGeneration {
  return Object.freeze({}) as ExpressRouteNavigationGeneration;
}

export function createExpressRouteNavigationBindingCache(): ExpressRouteNavigationBindingCache {
  return {
    [CACHE_STATE]: {
      declarations: new Map(),
      generation: null,
      rows: new Map(),
      ownerKey: null,
    },
  };
}

export function bindExpressRouteNavigationReceipts(
  routes: readonly WorkspaceExpressRoute[],
  snapshots: readonly WorkspaceExpressRouteSourceSnapshot[],
  owner: {
    readonly generation: ExpressRouteNavigationGeneration;
    readonly rootPath: string;
    readonly workspaceId: string;
  },
  cache: ExpressRouteNavigationBindingCache = createExpressRouteNavigationBindingCache(),
): {
  readonly routes: readonly NavigableWorkspaceExpressRoute[];
  readonly truncated: boolean;
} {
  const cacheState = cache[CACHE_STATE];
  const ownerKey = JSON.stringify([owner.workspaceId, owner.rootPath]);
  if (cacheState.ownerKey !== ownerKey || cacheState.generation !== owner.generation) {
    revokeExpressRouteNavigationBindingCache(cache);
    cacheState.declarations.clear();
    cacheState.rows.clear();
    cacheState.generation = owner.generation;
    cacheState.ownerKey = ownerKey;
  }
  for (const cached of cacheState.rows.values()) cached.lease.active = false;
  const retainedSnapshotKeys = new Set<string>();
  const routesBySnapshot = new Map<string, WorkspaceExpressRoute[]>();
  for (const route of routes) {
    const relativeFilePath = normalizeWorkspaceExpressRouteFilePath(route.relativeFilePath);
    if (!relativeFilePath) continue;
    const key = snapshotKey(route.packageLabel, relativeFilePath);
    const entries = routesBySnapshot.get(key) ?? [];
    entries.push(route);
    routesBySnapshot.set(key, entries);
  }

  const localDeclarations = new Map<
    WorkspaceExpressRoute,
    { readonly localPath: string; readonly source: string }
  >();
  let truncated = false;
  for (const snapshot of snapshots) {
    const relativeFilePath = normalizeWorkspaceExpressRouteFilePath(snapshot.relativeFilePath);
    if (!relativeFilePath) {
      truncated = true;
      continue;
    }
    const matchingRoutes = routesBySnapshot.get(
      snapshotKey(snapshot.packageLabel, relativeFilePath),
    );
    if (!matchingRoutes || matchingRoutes.length === 0) continue;
    const key = snapshotKey(snapshot.packageLabel, relativeFilePath);
    retainedSnapshotKeys.add(key);
    let cached = cacheState.declarations.get(key);
    if (!cached || cached.source !== snapshot.source) {
      cached = {
        lineStarts: sourceLineStarts(snapshot.source),
        localPaths: new Map(),
        source: snapshot.source,
      };
      cacheState.declarations.set(key, cached);
    }
    const unresolved = matchingRoutes.filter(
      (route) => !cached.localPaths.has(declarationKey(route)),
    );
    const unresolvedAfterDirect: WorkspaceExpressRoute[] = [];
    for (const route of unresolved) {
      const key = declarationKey(route);
      const localPath = directLocalPathAt(snapshot.source, cached.lineStarts, route);
      if (localPath !== null) {
        cached.localPaths.set(key, localPath);
      } else {
        unresolvedAfterDirect.push(route);
      }
    }
    if (unresolvedAfterDirect.length > 0) {
      const receivers = [...new Set(unresolvedAfterDirect.map(({ receiver }) => receiver))];
      const parsed = expressRoutesForReceiversInSourceBounded(
        snapshot.source,
        receivers,
        MAX_NAVIGABLE_ROUTES + 1,
      );
      truncated ||= parsed.truncated;
      const candidatesByDeclaration = new Map<string, string | null>();
      for (const candidate of parsed.routes) {
        const key = declarationKey(candidate);
        if (!candidatesByDeclaration.has(key)) {
          candidatesByDeclaration.set(key, candidate.path);
        } else {
          candidatesByDeclaration.set(key, null);
        }
      }
      for (const route of unresolvedAfterDirect) {
        const key = declarationKey(route);
        const localPath = candidatesByDeclaration.get(key);
        if (localPath !== undefined && localPath !== null) {
          cached.localPaths.set(key, localPath);
        } else {
          truncated = true;
        }
      }
    }
    for (const route of matchingRoutes) {
      const localPath = cached.localPaths.get(declarationKey(route));
      if (localPath !== undefined) {
        localDeclarations.set(route, { localPath, source: snapshot.source });
      } else {
        truncated = true;
      }
    }
  }
  for (const key of cacheState.declarations.keys()) {
    if (!retainedSnapshotKeys.has(key)) cacheState.declarations.delete(key);
  }

  const navigable: NavigableWorkspaceExpressRoute[] = [];
  const retainedRowKeys = new Set<string>();
  for (const route of routes) {
    const relativeFilePath = normalizeWorkspaceExpressRouteFilePath(route.relativeFilePath);
    const declaration = localDeclarations.get(route);
    if (!relativeFilePath || !declaration) {
      truncated = true;
      continue;
    }
    const rowKey = navigationRowKey(route, declaration.localPath);
    retainedRowKeys.add(rowKey);
    const retained = cacheState.rows.get(rowKey);
    if (retained?.source === declaration.source) {
      retained.lease.active = true;
      navigable.push(retained.route);
      continue;
    }
    const lease = { active: true };
    const receipt = Object.freeze({
      column: route.column,
      generation: owner.generation,
      line: route.line,
      localPath: declaration.localPath,
      method: route.method,
      ...(route.packageLabel ? { packageLabel: route.packageLabel } : {}),
      presentationId: route.id,
      receiver: route.receiver,
      relativeFilePath,
      rootPath: owner.rootPath,
      runtimePath: route.path,
      source: declaration.source,
      workspaceId: owner.workspaceId,
      lease,
    });
    const row = { ...route } as NavigableWorkspaceExpressRoute;
    Object.defineProperty(row, RECEIPT, {
      configurable: false,
      enumerable: false,
      value: receipt,
      writable: false,
    });
    const frozenRow = Object.freeze(row);
    cacheState.rows.set(rowKey, { lease, route: frozenRow, source: declaration.source });
    navigable.push(frozenRow);
  }
  for (const [key, cached] of cacheState.rows) {
    if (!retainedRowKeys.has(key)) {
      cached.lease.active = false;
      cacheState.rows.delete(key);
    }
  }
  return { routes: Object.freeze(navigable), truncated };
}

export function revokeExpressRouteNavigationBindingCache(
  cache: ExpressRouteNavigationBindingCache,
): void {
  for (const cached of cache[CACHE_STATE].rows.values()) cached.lease.active = false;
}

export function expressRouteNavigationReceipt(
  route: WorkspaceExpressRoute,
): ExpressRouteNavigationReceipt | null {
  const candidate = (route as Partial<NavigableWorkspaceExpressRoute>)[RECEIPT];
  if (
    !candidate ||
    !candidate.lease.active ||
    candidate.presentationId !== route.id ||
    candidate.relativeFilePath !== route.relativeFilePath ||
    candidate.runtimePath !== route.path ||
    candidate.method !== route.method ||
    candidate.receiver !== route.receiver ||
    candidate.line !== route.line ||
    candidate.column !== route.column ||
    candidate.packageLabel !== route.packageLabel
  ) {
    return null;
  }
  return candidate;
}

function navigationRowKey(route: WorkspaceExpressRoute, localPath: string): string {
  return JSON.stringify([
    route.id,
    route.relativeFilePath,
    route.packageLabel ?? null,
    route.receiver,
    route.method,
    route.path,
    route.line,
    route.column,
    route.occurrence,
    localPath,
  ]);
}

export function currentExpressRouteNavigationGeneration(
  route: WorkspaceExpressRoute,
): ExpressRouteNavigationGeneration | null {
  return expressRouteNavigationReceipt(route)?.generation ?? null;
}

function directLocalPathAt(
  source: string,
  lineStarts: readonly number[],
  route: WorkspaceExpressRoute,
): string | null {
  const lineStart = lineStarts[route.line - 1];
  if (lineStart === undefined) return null;
  let cursor = lineStart + route.column - 1;
  if (source.slice(cursor, cursor + route.receiver.length) !== route.receiver) return null;
  cursor += route.receiver.length;
  cursor = skipWhitespace(source, cursor);
  if (source[cursor] !== ".") return null;
  cursor = skipWhitespace(source, cursor + 1);
  if (
    source.slice(cursor, cursor + route.method.length).toLowerCase() !== route.method.toLowerCase()
  ) {
    return null;
  }
  cursor += route.method.length;
  cursor = skipWhitespace(source, cursor);
  if (source[cursor] !== "(") return null;
  return staticJavaScriptStringArgumentAt(source, cursor + 1)?.value ?? null;
}

function sourceLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function skipWhitespace(source: string, from: number): number {
  let cursor = from;
  while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}

function snapshotKey(packageLabel: string | undefined, relativeFilePath: string): string {
  return JSON.stringify([packageLabel ?? null, relativeFilePath]);
}

function declarationKey(
  route: Pick<WorkspaceExpressRoute, "column" | "line" | "method" | "receiver">,
): string {
  return JSON.stringify([route.line, route.column, route.method, route.receiver]);
}
