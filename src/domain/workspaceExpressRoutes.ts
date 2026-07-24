import {
  normalizeExpressPackageLabel,
  resolveExpressRouteMountsBounded,
} from "./expressRouteMounts";
import type { ExpressRoute } from "./expressRoutes";

export interface WorkspaceExpressRouteSourceSnapshot {
  readonly packageLabel?: string;
  readonly relativeFilePath: string;
  readonly source: string;
}

export interface WorkspaceExpressRoute extends ExpressRoute {
  readonly id: string;
  readonly occurrence: number;
  readonly packageLabel?: string;
  readonly relativeFilePath: string;
}

export interface BoundedWorkspaceExpressRoutes {
  readonly routes: WorkspaceExpressRoute[];
  readonly truncated: boolean;
}

/** Builds a deterministic workspace route list from independently read source snapshots. */
export function workspaceExpressRoutesFromSnapshots(
  snapshots: readonly WorkspaceExpressRouteSourceSnapshot[],
): WorkspaceExpressRoute[] {
  return workspaceExpressRoutesFromSnapshotsBounded(snapshots, Number.POSITIVE_INFINITY).routes;
}

/** Builds at most `maxRoutes` in deterministic file/source order. */
export function workspaceExpressRoutesFromSnapshotsBounded(
  snapshots: readonly WorkspaceExpressRouteSourceSnapshot[],
  maxRoutes: number,
): BoundedWorkspaceExpressRoutes {
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
  const resolved = resolveExpressRouteMountsBounded(normalizedSnapshots, limit);
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
      id: workspaceExpressRouteId(route.relativeFilePath, route, occurrence),
      occurrence,
    };
  });
  return { routes: routes.sort(compareWorkspaceExpressRoutes), truncated: resolved.truncated };
}

/** Replaces, rather than appends to, the indexed routes for one dirty editor document. */
export function overlayDirtyWorkspaceExpressRoutes(
  diskRoutes: readonly WorkspaceExpressRoute[],
  dirtySnapshot: WorkspaceExpressRouteSourceSnapshot,
): WorkspaceExpressRoute[] {
  return overlayDirtyWorkspaceExpressRoutesBounded(
    diskRoutes,
    [dirtySnapshot],
    Number.POSITIVE_INFINITY,
  ).routes;
}

export function overlayDirtyWorkspaceExpressRoutesBounded(
  diskRoutes: readonly WorkspaceExpressRoute[],
  dirtySnapshots: readonly WorkspaceExpressRouteSourceSnapshot[],
  maxRoutes: number,
): BoundedWorkspaceExpressRoutes {
  const snapshotsByPath = new Map<string, WorkspaceExpressRouteSourceSnapshot>();
  for (const snapshot of dirtySnapshots) {
    const relativeFilePath = normalizeWorkspaceExpressRouteFilePath(snapshot.relativeFilePath);
    if (relativeFilePath) {
      const packageLabel = normalizeExpressPackageLabel(snapshot.packageLabel);
      snapshotsByPath.set(snapshotIdentity(packageLabel, relativeFilePath), {
        ...snapshot,
        relativeFilePath,
        ...(packageLabel ? { packageLabel } : { packageLabel: undefined }),
      });
    }
  }
  const normalizedSnapshots = [...snapshotsByPath.values()];
  const dirtyPaths = new Set(
    normalizedSnapshots.map((snapshot) =>
      snapshotIdentity(snapshot.packageLabel, snapshot.relativeFilePath),
    ),
  );
  const dirty = workspaceExpressRoutesFromSnapshotsBounded(normalizedSnapshots, maxRoutes);
  const combined = [
    ...diskRoutes.filter(
      (route) => !dirtyPaths.has(snapshotIdentity(route.packageLabel, route.relativeFilePath)),
    ),
    ...dirty.routes,
  ].sort(compareWorkspaceExpressRoutes);
  const limit = Number.isFinite(maxRoutes) ? Math.max(0, Math.floor(maxRoutes)) : Infinity;
  return combined.length > limit
    ? { routes: combined.slice(0, limit), truncated: true }
    : { routes: combined, truncated: dirty.truncated };
}

export function filterWorkspaceExpressRoutes(
  routes: readonly WorkspaceExpressRoute[],
  query: string,
): WorkspaceExpressRoute[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...routes];

  return routes.filter((route) => {
    const line = String(route.line);
    const haystack = [
      route.method,
      route.path,
      route.receiver,
      route.relativeFilePath,
      route.packageLabel ?? "",
      line,
      `:${line}`,
      `${route.relativeFilePath}:${line}`,
    ]
      .join("\n")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function normalizeWorkspaceExpressRouteFilePath(path: string): string | null {
  const normalized = path
    .trim()
    .split("\\")
    .join("/")
    .replace(/\/{2,}/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return null;
  }
  return normalized;
}

function workspaceExpressRouteId(
  relativeFilePath: string,
  route: ExpressRoute & { readonly packageLabel?: string },
  occurrence: number,
): string {
  return [
    "express-route",
    normalizeExpressPackageLabel(route.packageLabel) ?? "",
    relativeFilePath,
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

function snapshotIdentity(packageLabel: string | undefined, relativeFilePath: string): string {
  return JSON.stringify([normalizeExpressPackageLabel(packageLabel) ?? null, relativeFilePath]);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
