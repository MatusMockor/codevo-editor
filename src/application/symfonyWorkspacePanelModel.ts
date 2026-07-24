import type {
  SymfonyConsoleCommand,
  SymfonyConsoleCommandsResult,
  SymfonyRoute,
  SymfonyRoutesResult,
  SymfonyService,
  SymfonyServicesResult,
} from "../domain/symfonyWorkspaceIntelligence";

export const SYMFONY_WORKSPACE_PANEL_TABS = ["commands", "routes", "services"] as const;
export type SymfonyWorkspacePanelTab = (typeof SYMFONY_WORKSPACE_PANEL_TABS)[number];

export interface SymfonyWorkspacePanelModel {
  readonly activeTab: SymfonyWorkspacePanelTab;
  readonly busy: boolean;
  readonly commands: SymfonyConsoleCommandsResult;
  readonly error: string | null;
  readonly filteredCommands: readonly SymfonyConsoleCommand[];
  readonly filteredRoutes: readonly SymfonyRoute[];
  readonly filteredServices: readonly SymfonyService[];
  readonly onOpenRouteController: (route: SymfonyRoute) => Promise<boolean>;
  readonly onOpenService: (service: SymfonyService) => Promise<boolean>;
  readonly onQueryChange: (query: string) => void;
  readonly onRefresh: () => Promise<boolean>;
  readonly onTabChange: (tab: SymfonyWorkspacePanelTab) => void;
  readonly query: string;
  readonly routes: SymfonyRoutesResult;
  readonly services: SymfonyServicesResult;
}

export type SymfonyRouteControllerNavigation = (
  route: SymfonyRoute,
  shouldCommit: () => boolean,
) => Promise<boolean> | boolean;

export type SymfonyServiceNavigation = (
  service: SymfonyService,
  shouldCommit: () => boolean,
) => Promise<boolean> | boolean;
