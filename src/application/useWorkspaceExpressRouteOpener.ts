import { useCallback, useRef } from "react";
import { joinWorkspacePath } from "../domain/workspace";
import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import {
  normalizeWorkspaceExpressRouteFilePath,
  workspaceExpressRoutesFromSnapshots,
  type WorkspaceExpressRoute,
  type WorkspaceExpressRouteSourceSnapshot,
} from "../domain/workspaceExpressRoutes";

const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;

export interface UseWorkspaceExpressRouteOpenerOptions {
  readonly dirtySnapshots?: readonly WorkspaceExpressRouteSourceSnapshot[];
  readonly gateway: WorkspaceSourceDiscoveryGateway;
  readonly onOpenLocation: (
    path: string,
    line: number,
    column: number,
    shouldCommit: () => boolean,
  ) => Promise<boolean>;
  readonly onStale: (route: WorkspaceExpressRoute) => void;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
}

export function useWorkspaceExpressRouteOpener({
  dirtySnapshots = [],
  gateway,
  onOpenLocation,
  onStale,
  rootPath,
  workspaceId,
}: UseWorkspaceExpressRouteOpenerOptions) {
  const currentWorkspaceRef = useRef({ rootPath, workspaceId });
  currentWorkspaceRef.current = { rootPath, workspaceId };

  return useCallback(
    async (route: WorkspaceExpressRoute): Promise<boolean> => {
      const requestedRootPath = rootPath;
      const requestedWorkspaceId = workspaceId;
      const relativeFilePath = normalizeWorkspaceExpressRouteFilePath(route.relativeFilePath);
      const stale = () => {
        onStale(route);
        return false;
      };
      if (!requestedRootPath || !requestedWorkspaceId || !relativeFilePath) {
        return stale();
      }
      const isCurrent = () =>
        isCurrentWorkspace(currentWorkspaceRef.current, requestedRootPath, requestedWorkspaceId);
      if (!isCurrent()) return false;

      let source: string;
      let dirtySnapshot: WorkspaceExpressRouteSourceSnapshot | undefined;
      for (const snapshot of dirtySnapshots) {
        if (
          normalizeWorkspaceExpressRouteFilePath(snapshot.relativeFilePath) === relativeFilePath
        ) {
          dirtySnapshot = snapshot;
        }
      }
      if (dirtySnapshot) {
        source = dirtySnapshot.source;
        if (byteLength(source) > MAX_SOURCE_FILE_BYTES) return stale();
      } else {
        try {
          const read = await gateway.readSourceTextBounded(
            requestedRootPath,
            relativeFilePath,
            MAX_SOURCE_FILE_BYTES,
          );
          if (!isCurrent()) return false;
          if (read.status !== "ok") return stale();
          source = read.content;
        } catch {
          if (!isCurrent()) return false;
          return stale();
        }
      }

      if (!isCurrent()) return false;
      const currentRoute = workspaceExpressRoutesFromSnapshots([
        {
          ...(route.packageLabel ? { packageLabel: route.packageLabel } : {}),
          relativeFilePath,
          source,
        },
      ]).find((candidate) => candidate.id === route.id);
      if (!currentRoute) return stale();

      try {
        const opened = await onOpenLocation(
          joinWorkspacePath(requestedRootPath, relativeFilePath),
          currentRoute.line,
          currentRoute.column,
          isCurrent,
        );
        if (!isCurrent()) return false;
        return opened || stale();
      } catch {
        if (!isCurrent()) return false;
        return stale();
      }
    },
    [dirtySnapshots, gateway, onOpenLocation, onStale, rootPath, workspaceId],
  );
}

function isCurrentWorkspace(
  current: { readonly rootPath: string | null; readonly workspaceId: string | null },
  rootPath: string,
  workspaceId: string,
): boolean {
  return current.rootPath === rootPath && current.workspaceId === workspaceId;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
