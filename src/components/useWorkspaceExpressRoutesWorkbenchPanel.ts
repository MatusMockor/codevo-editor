import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ExpressRouteNavigationGeneration } from "../application/expressRouteNavigationReceipt";
import { useDirtyExpressRoutesDocumentSnapshots } from "../application/useDirtyExpressRoutesDocumentSnapshots";
import { useWorkspaceExpressRoutes } from "../application/useWorkspaceExpressRoutes";
import { useWorkspaceExpressRouteOpener } from "../application/useWorkspaceExpressRouteOpener";
import type { WorkspacePackageDiscovery } from "../application/useWorkspacePackageGraph";
import { hasExpressWorkspaceSignal } from "../domain/expressWorkspaceSignal";
import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import type { WorkspaceExpressRouteSourceSnapshot } from "../domain/workspaceExpressRoutes";
import type { ExpressRoutesPanelProps } from "./ExpressRoutesPanel";

interface WorkspaceExpressRoutesWorkbenchPanelOptions {
  readonly dirtySnapshots?: readonly WorkspaceExpressRouteSourceSnapshot[];
  readonly discoveryGateway: WorkspaceSourceDiscoveryGateway;
  readonly discoveryVersion: number;
  readonly hasJavaScriptTypeScriptWorkspace?: boolean;
  readonly isOpen: boolean;
  readonly onOpenLocation: (
    path: string,
    line: number,
    column: number,
    shouldCommit: () => boolean,
  ) => Promise<boolean>;
  readonly packageDiscovery: WorkspacePackageDiscovery | undefined;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
}

export interface WorkspaceExpressRoutesWorkbenchPanel extends ExpressRoutesPanelProps {
  readonly hasJavaScriptTypeScriptWorkspace: boolean;
  readonly workspacePackageDiscovery?: WorkspacePackageDiscovery;
}

type DirtySnapshotsArguments = Parameters<typeof useDirtyExpressRoutesDocumentSnapshots>;

interface OwnedWorkspaceExpressRoutesWorkbenchPanelOptions extends Omit<
  WorkspaceExpressRoutesWorkbenchPanelOptions,
  "dirtySnapshots" | "isOpen" | "packageDiscovery"
> {
  readonly activeDocument: DirtySnapshotsArguments[1];
  readonly isPanelOpen: boolean;
  readonly openDocuments: DirtySnapshotsArguments[0];
  readonly packageDiscovery: WorkspacePackageDiscovery;
}

export function useOwnedWorkspaceExpressRoutesWorkbenchPanel({
  activeDocument,
  discoveryGateway,
  discoveryVersion,
  hasJavaScriptTypeScriptWorkspace,
  isPanelOpen,
  onOpenLocation,
  openDocuments,
  packageDiscovery,
  rootPath,
  workspaceId,
}: OwnedWorkspaceExpressRoutesWorkbenchPanelOptions): WorkspaceExpressRoutesWorkbenchPanel {
  const dirtySnapshots = useDirtyExpressRoutesDocumentSnapshots(
    openDocuments,
    activeDocument,
    rootPath,
  );
  const manifestSignal =
    packageDiscovery.loaded &&
    hasExpressWorkspaceSignal({
      manifest: packageDiscovery.rootPackageJson,
      routes: [],
    });
  return useWorkspaceExpressRoutesWorkbenchPanel({
    dirtySnapshots,
    discoveryGateway,
    discoveryVersion,
    hasJavaScriptTypeScriptWorkspace,
    isOpen: isPanelOpen || manifestSignal,
    onOpenLocation,
    packageDiscovery: hasJavaScriptTypeScriptWorkspace ? packageDiscovery : undefined,
    rootPath,
    workspaceId,
  });
}

export function useWorkspaceExpressRoutesWorkbenchPanel({
  dirtySnapshots = [],
  discoveryGateway,
  discoveryVersion,
  hasJavaScriptTypeScriptWorkspace,
  isOpen,
  onOpenLocation,
  packageDiscovery,
  rootPath,
  workspaceId,
}: WorkspaceExpressRoutesWorkbenchPanelOptions): WorkspaceExpressRoutesWorkbenchPanel {
  const [queries, setQueries] = useState<Record<string, string>>({});
  const refreshRef = useRef<() => void>(() => undefined);
  const navigationGenerationRef = useRef<ExpressRouteNavigationGeneration | null>(null);
  const refreshStaleRoute = useCallback(() => refreshRef.current(), []);
  const currentNavigationGeneration = useCallback(() => navigationGenerationRef.current, []);
  const openRoute = useWorkspaceExpressRouteOpener({
    currentNavigationGeneration,
    dirtySnapshots,
    gateway: discoveryGateway,
    onOpenLocation,
    onStale: refreshStaleRoute,
    rootPath,
    workspaceId,
  });
  const panel = useWorkspaceExpressRoutes({
    dirtySnapshots,
    discoveryVersion,
    gateway: discoveryGateway,
    isOpen,
    packageDiscovery,
    rootPath,
    workspaceId,
  });
  const workspaceKey = workspaceId && rootPath ? `${workspaceId}\u0000${rootPath}` : null;
  const onQueryChange = useCallback(
    (query: string) => {
      if (!workspaceKey) return;
      setQueries((current) =>
        current[workspaceKey] === query ? current : { ...current, [workspaceKey]: query },
      );
    },
    [workspaceKey],
  );
  const onRefresh = useCallback(() => {
    void panel.refresh();
  }, [panel]);
  refreshRef.current = onRefresh;
  useLayoutEffect(() => {
    navigationGenerationRef.current = panel.navigationGeneration;
    return () => {
      if (navigationGenerationRef.current === panel.navigationGeneration) {
        navigationGenerationRef.current = null;
      }
    };
  }, [panel.navigationGeneration]);
  return {
    error: panel.error,
    hasJavaScriptTypeScriptWorkspace: hasJavaScriptTypeScriptWorkspace === true,
    loading: panel.loading,
    onOpenRoute: openRoute,
    onQueryChange,
    onRefresh,
    query: workspaceKey ? (queries[workspaceKey] ?? "") : "",
    routes: panel.routes,
    truncated: panel.truncated,
    workspacePackageDiscovery: packageDiscovery,
  };
}
