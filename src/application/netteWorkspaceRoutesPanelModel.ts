import type {
  NetteWorkspaceRoute,
  NetteWorkspaceRoutesResult,
} from "../domain/netteWorkspaceRoutes";

export interface NetteWorkspaceRoutesPanelModel {
  readonly busy: boolean;
  readonly error: string | null;
  readonly filteredRoutes: readonly NetteWorkspaceRoute[];
  readonly onOpenDefinition: (route: NetteWorkspaceRoute) => Promise<boolean>;
  readonly onOpenTarget: (route: NetteWorkspaceRoute) => Promise<boolean>;
  readonly onQueryChange: (query: string) => void;
  readonly onRefresh: () => Promise<boolean>;
  readonly query: string;
  readonly routes: NetteWorkspaceRoutesResult;
}

export type NetteRouteDefinitionNavigation = (
  source: NetteWorkspaceRoute["source"],
  shouldCommit: () => boolean,
) => Promise<boolean> | boolean;

export type NetteRouteTargetNavigation = (
  target: NonNullable<NetteWorkspaceRoute["target"]>,
  shouldCommit: () => boolean,
) => Promise<boolean> | boolean;
