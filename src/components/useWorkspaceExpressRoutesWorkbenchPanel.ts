import { useCallback, useRef } from "react";
import { useWorkspaceExpressRouteOpener } from "../application/useWorkspaceExpressRouteOpener";
import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import type { WorkspaceExpressRouteSourceSnapshot } from "../domain/workspaceExpressRoutes";
import type { ExpressRoutesPanelProps } from "./ExpressRoutesPanel";
import { useWorkspaceExpressRoutesPanelController } from "./useWorkspaceExpressRoutesPanelController";

interface WorkspaceExpressRoutesWorkbenchPanelOptions {
  readonly dirtySnapshots?: readonly WorkspaceExpressRouteSourceSnapshot[];
  readonly discoveryGateway: WorkspaceSourceDiscoveryGateway;
  readonly discoveryVersion: number;
  readonly isOpen: boolean;
  readonly onOpenLocation: (
    path: string,
    line: number,
    column: number,
    shouldCommit: () => boolean,
  ) => Promise<boolean>;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
}

export function useWorkspaceExpressRoutesWorkbenchPanel({
  dirtySnapshots = [],
  discoveryGateway,
  discoveryVersion,
  isOpen,
  onOpenLocation,
  rootPath,
  workspaceId,
}: WorkspaceExpressRoutesWorkbenchPanelOptions): ExpressRoutesPanelProps {
  const refreshRef = useRef<() => void>(() => undefined);
  const refreshStaleRoute = useCallback(() => refreshRef.current(), []);
  const openRoute = useWorkspaceExpressRouteOpener({
    dirtySnapshots,
    gateway: discoveryGateway,
    onOpenLocation,
    onStale: refreshStaleRoute,
    rootPath,
    workspaceId,
  });
  const panel = useWorkspaceExpressRoutesPanelController({
    dirtySnapshots,
    discoveryGateway,
    discoveryVersion,
    isOpen,
    onOpenRoute: openRoute,
    rootPath,
    workspaceId,
  });
  refreshRef.current = panel.onRefresh;
  return panel;
}
