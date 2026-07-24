import { useCallback, useState } from "react";
import { useWorkspaceExpressRoutes } from "../application/useWorkspaceExpressRoutes";
import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import type {
  WorkspaceExpressRoute,
  WorkspaceExpressRouteSourceSnapshot,
} from "../domain/workspaceExpressRoutes";
import type { ExpressRoutesPanelProps } from "./ExpressRoutesPanel";

export interface UseWorkspaceExpressRoutesPanelControllerOptions {
  readonly dirtySnapshots?: readonly WorkspaceExpressRouteSourceSnapshot[];
  readonly discoveryGateway: WorkspaceSourceDiscoveryGateway;
  readonly discoveryVersion: number;
  readonly isOpen: boolean;
  readonly onOpenRoute: (route: WorkspaceExpressRoute) => Promise<unknown> | unknown;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
}

export function useWorkspaceExpressRoutesPanelController({
  dirtySnapshots = [],
  discoveryGateway,
  discoveryVersion,
  isOpen,
  onOpenRoute,
  rootPath,
  workspaceId,
}: UseWorkspaceExpressRoutesPanelControllerOptions): ExpressRoutesPanelProps {
  const [queries, setQueries] = useState<Record<string, string>>({});
  const workspaceKey = workspaceId && rootPath ? `${workspaceId}\u0000${rootPath}` : null;
  const { error, loading, refresh, routes, truncated } = useWorkspaceExpressRoutes({
    dirtySnapshots,
    discoveryVersion,
    gateway: discoveryGateway,
    isOpen,
    rootPath,
    workspaceId,
  });
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
    void refresh();
  }, [refresh]);

  return {
    error,
    loading,
    onOpenRoute,
    onQueryChange,
    onRefresh,
    query: workspaceKey ? (queries[workspaceKey] ?? "") : "",
    routes,
    truncated,
  };
}
