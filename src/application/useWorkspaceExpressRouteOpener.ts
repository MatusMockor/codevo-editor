import { useCallback, useRef } from "react";
import { joinWorkspacePath } from "../domain/workspace";
import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import {
  normalizeWorkspaceExpressRouteFilePath,
  type WorkspaceExpressRoute,
  type WorkspaceExpressRouteSourceSnapshot,
} from "../domain/workspaceExpressRoutes";
import {
  expressRouteNavigationReceipt,
  type ExpressRouteNavigationGeneration,
} from "./expressRouteNavigationReceipt";

const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;

export interface UseWorkspaceExpressRouteOpenerOptions {
  readonly dirtySnapshots?: readonly WorkspaceExpressRouteSourceSnapshot[];
  readonly gateway: WorkspaceSourceDiscoveryGateway;
  readonly currentNavigationGeneration: () => ExpressRouteNavigationGeneration | null;
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
  currentNavigationGeneration,
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
      const stale = () => {
        onStale(route);
        return false;
      };
      if (!requestedRootPath || !requestedWorkspaceId) return stale();
      const exactWorkspaceCurrent = () =>
        isCurrentWorkspace(currentWorkspaceRef.current, requestedRootPath, requestedWorkspaceId);
      if (!exactWorkspaceCurrent()) return false;
      const relativeFilePath = normalizeWorkspaceExpressRouteFilePath(route.relativeFilePath);
      const receipt = expressRouteNavigationReceipt(route);
      if (
        !relativeFilePath ||
        !receipt ||
        receipt.rootPath !== requestedRootPath ||
        receipt.workspaceId !== requestedWorkspaceId ||
        receipt.relativeFilePath !== relativeFilePath
      ) {
        return stale();
      }
      const isCurrent = () =>
        exactWorkspaceCurrent() &&
        safelyCurrentNavigationGeneration(currentNavigationGeneration) === receipt.generation;
      if (!isCurrent()) return stale();

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
      if (source !== receipt.source) return stale();

      try {
        const opened = await onOpenLocation(
          joinWorkspacePath(requestedRootPath, relativeFilePath),
          receipt.line,
          receipt.column,
          isCurrent,
        );
        if (!isCurrent()) return false;
        return opened || stale();
      } catch {
        if (!isCurrent()) return false;
        return stale();
      }
    },
    [
      currentNavigationGeneration,
      dirtySnapshots,
      gateway,
      onOpenLocation,
      onStale,
      rootPath,
      workspaceId,
    ],
  );
}

function safelyCurrentNavigationGeneration(
  current: () => ExpressRouteNavigationGeneration | null,
): ExpressRouteNavigationGeneration | null {
  try {
    return current();
  } catch {
    return null;
  }
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
