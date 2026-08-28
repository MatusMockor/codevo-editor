import type { ComponentProps, PointerEvent, ReactNode } from "react";
import type { useArtisanRoutes } from "../application/useArtisanRoutes";
import type { useAppFrameworkBottomPanels } from "../application/useAppFrameworkBottomPanels";
import type { useWorkbenchController } from "../application/useWorkbenchController";
import type { BottomPanelView } from "../domain/bottomPanel";
import type { TerminalTheme } from "../domain/settings";
import type { BottomPanel } from "./BottomPanel";
import type { phpTestBottomPanelProps } from "./phpTestBottomPanelProps";
import type { useAppTestDebugPanels } from "./useAppTestDebugPanels";

export type BottomPanelHostProps = ComponentProps<typeof BottomPanel>;

type Workbench = ReturnType<typeof useWorkbenchController>;
type TestDebugPanels = ReturnType<typeof useAppTestDebugPanels>;

export type BottomPanelHostWorkbench = Pick<
  Workbench,
  | "appSettings"
  | "bottomPanelView"
  | "clearNotices"
  | "getLatencySnapshot"
  | "hasArtisan"
  | "hideBottomPanel"
  | "indexHealthLogs"
  | "indexProgress"
  | "intelligenceMode"
  | "notices"
  | "openArtisanController"
  | "openProblemNotice"
  | "registerActiveTerminalSession"
  | "revealDirectoryInTree"
  | "startHardReindex"
  | "startIndexScan"
  | "startPhpReindex"
  | "workspaceDescriptor"
  | "workspacePackageDiscovery"
  | "workspaceRoot"
> & { readonly agents?: Pick<Workbench["agents"], "providerSignIn"> };

export interface BottomPanelHostGateways {
  readonly gitHistoryGateway: BottomPanelHostProps["gitHistoryGateway"];
  readonly runtimeObservabilityGateway: BottomPanelHostProps["runtimeObservabilityGateway"];
  readonly terminalGateway: BottomPanelHostProps["terminalGateway"];
}

export interface BottomPanelHostInput {
  readonly artisanRoutes: ReturnType<typeof useArtisanRoutes>;
  readonly debugPanel: TestDebugPanels["debugPanel"];
  readonly expressRoutesPanel: BottomPanelHostProps["expressRoutesPanel"];
  readonly frameworkBottomPanels: ReturnType<typeof useAppFrameworkBottomPanels>;
  readonly gateways: BottomPanelHostGateways;
  readonly jsTestExplorerPanel: TestDebugPanels["jsTestExplorerPanel"];
  readonly phpTestPanel: ReturnType<typeof phpTestBottomPanelProps>;
  readonly phpTestResults: TestDebugPanels["phpTestResults"];
  readonly search: ReactNode;
  readonly terminalOwnerKey: string | null;
  readonly terminalTheme: TerminalTheme;
  readonly workbench: BottomPanelHostWorkbench;
  readonly workspaceTrusted: boolean;
  onCloseSearch(): void;
  onOpenCommitFileDiff: BottomPanelHostProps["onOpenCommitFileDiff"];
  onResizeStart(event: PointerEvent<HTMLDivElement>): void;
  onSelectView(view: BottomPanelView | "routes" | "testResults" | "expressRoutes"): void;
  onTrustWorkspace(): void;
}

export function workbenchBottomPanelHostProps(input: BottomPanelHostInput): BottomPanelHostProps {
  const { artisanRoutes, gateways, phpTestResults, workbench } = input;

  return {
    ...input.frameworkBottomPanels,
    ...input.phpTestPanel,
    activeView: workbench.bottomPanelView,
    artisanRoutes: artisanRoutes.filteredRoutes,
    artisanRoutesError: artisanRoutes.error,
    artisanRoutesLoading: artisanRoutes.loading,
    artisanRoutesQuery: artisanRoutes.query,
    artisanRoutesTotal: artisanRoutes.total,
    artisanRoutesUnavailable: artisanRoutes.unavailable,
    debug: input.debugPanel,
    expressRoutesPanel: input.expressRoutesPanel,
    getLatencySnapshot: workbench.getLatencySnapshot,
    gitHistoryGateway: gateways.gitHistoryGateway,
    hasArtisan: workbench.hasArtisan,
    hasPhpWorkspace: !!workbench.workspaceDescriptor?.php,
    indexHealthLogs: workbench.indexHealthLogs,
    indexProgress: workbench.indexProgress,
    jsTestExplorer: input.jsTestExplorerPanel,
    notices: workbench.notices,
    onArtisanRoutesQueryChange: artisanRoutes.setQuery,
    onClearProblems: workbench.clearNotices,
    onClose: () => {
      artisanRoutes.clear();
      phpTestResults.clear();
      if (workbench.bottomPanelView === "search") {
        input.onCloseSearch();
        return;
      }
      workbench.hideBottomPanel();
    },
    onHardReindex: workbench.startHardReindex,
    onOpenArtisanController: (action) => {
      void workbench.openArtisanController(action);
    },
    onOpenCommitFileDiff: input.onOpenCommitFileDiff,
    onOpenProblem: workbench.openProblemNotice,
    onPhpReindex: workbench.startPhpReindex,
    onRefreshArtisanRoutes: artisanRoutes.refresh,
    onResizeStart: input.onResizeStart,
    onRevealDirectoryInTree: workbench.revealDirectoryInTree,
    onSelectView: input.onSelectView,
    onSoftReindex: workbench.startIndexScan,
    onTerminalSessionReady: workbench.registerActiveTerminalSession,
    onTrustWorkspace: input.onTrustWorkspace,
    runtimeMode: workbench.intelligenceMode,
    runtimeObservabilityGateway: gateways.runtimeObservabilityGateway,
    search: input.search,
    terminalGateway: gateways.terminalGateway,
    terminalOwnerKey: input.terminalOwnerKey,
    terminalShellIntegrationEnabled: workbench.appSettings.terminalShellIntegrationEnabled,
    terminalTheme: input.terminalTheme,
    providerSignIn: workbench.agents?.providerSignIn,
    workspacePackageDiscovery: workbench.workspacePackageDiscovery,
    workspaceRoot: workbench.workspaceRoot,
    workspaceTrusted: input.workspaceTrusted,
  };
}
