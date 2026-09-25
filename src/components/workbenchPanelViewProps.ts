import type { ReactNode } from "react";
import type { WorkbenchBottomPanelView } from "../domain/artisanRoutes";
import { hasExpressWorkspaceSignal } from "../domain/expressWorkspaceSignal";
import type { WorkbenchPanelProps, WorkbenchPanelViewContentProps } from "./workbenchPanelViews";

export interface WorkbenchPanelFlags {
  readonly hasArtisan: boolean;
  readonly hasJsWorkspace: boolean;
  readonly hasExpressRoutes: boolean;
  readonly showExpressRoutes: boolean;
  readonly hasNette: boolean;
  readonly hasPhpWorkspace: boolean;
  readonly hasSymfony: boolean;
}

export type WorkbenchPanelFlagsInput = Pick<
  WorkbenchPanelProps,
  | "expressRoutesPanel"
  | "hasArtisan"
  | "hasExpressRoutes"
  | "hasJsWorkspace"
  | "hasNette"
  | "hasPhpWorkspace"
  | "hasSymfony"
>;

export function workbenchPanelFlags(
  panel: WorkbenchPanelFlagsInput,
  view: WorkbenchBottomPanelView,
): WorkbenchPanelFlags {
  const hasJsWorkspace =
    panel.hasJsWorkspace ?? panel.expressRoutesPanel?.hasJavaScriptTypeScriptWorkspace ?? false;
  const hasExpressRoutes = panel.hasExpressRoutes ?? hasJsWorkspace;
  return {
    hasArtisan: panel.hasArtisan ?? false,
    hasJsWorkspace,
    hasExpressRoutes,
    showExpressRoutes:
      hasExpressWorkspaceSignal({ routes: panel.expressRoutesPanel?.routes ?? [] }) ||
      (view === "expressRoutes" && hasExpressRoutes),
    hasNette: panel.hasNette ?? false,
    hasPhpWorkspace: panel.hasPhpWorkspace ?? false,
    hasSymfony: panel.hasSymfony ?? false,
  };
}

export function workbenchPanelViewContentProps(
  panel: WorkbenchPanelProps,
  view: WorkbenchBottomPanelView,
  phpTree: ReactNode,
): WorkbenchPanelViewContentProps {
  const flags = workbenchPanelFlags(panel, view);
  return {
    activeView: view,
    debug: panel.debug,
    phpTree,
    artisanRoutes: panel.artisanRoutes ?? [],
    artisanRoutesError: panel.artisanRoutesError ?? null,
    artisanRoutesLoading: panel.artisanRoutesLoading ?? false,
    artisanRoutesQuery: panel.artisanRoutesQuery ?? "",
    artisanRoutesTotal: panel.artisanRoutesTotal ?? 0,
    artisanRoutesUnavailable: panel.artisanRoutesUnavailable ?? null,
    expressRoutesPanel: panel.expressRoutesPanel,
    packageDependenciesPanel: panel.packageDependenciesPanel,
    netteWorkspacePanel: panel.netteWorkspacePanel,
    symfonyWorkspacePanel: panel.symfonyWorkspacePanel,
    hasArtisan: flags.hasArtisan,
    hasExpressRoutes: flags.showExpressRoutes,
    hasJsWorkspace: flags.hasJsWorkspace,
    hasNette: flags.hasNette,
    hasPhpWorkspace: flags.hasPhpWorkspace,
    hasSymfony: flags.hasSymfony,
    phpTestError: panel.phpTestError ?? null,
    phpTestFilter: panel.phpTestFilter ?? null,
    phpTestIsRunning: panel.phpTestIsRunning ?? false,
    phpTestResult: panel.phpTestResult ?? null,
    phpTestUnavailable: panel.phpTestUnavailable ?? null,
    phpTestCanRunCoverage: panel.phpTestCanRunCoverage ?? false,
    phpTestCoverageError: panel.phpTestCoverageError ?? null,
    phpTestCoverageRunning: panel.phpTestCoverageRunning ?? false,
    phpTestCoverageSummary: panel.phpTestCoverageSummary ?? null,
    phpTestCoverageUnavailable: panel.phpTestCoverageUnavailable ?? null,
    jsTestExplorer: panel.jsTestExplorer,
    indexHealthLogs: panel.indexHealthLogs,
    indexProgress: panel.indexProgress,
    notices: panel.notices,
    onHardReindex: panel.onHardReindex,
    onArtisanRoutesQueryChange: panel.onArtisanRoutesQueryChange ?? noop,
    onOpenArtisanController: panel.onOpenArtisanController ?? noop,
    onRefreshArtisanRoutes: panel.onRefreshArtisanRoutes ?? noop,
    onOpenPhpTestCase: panel.onOpenPhpTestCase ?? noop,
    onRunPhpTestCase: panel.onRunPhpTestCase ?? noop,
    onRunPhpTests: panel.onRunPhpTests ?? noop,
    onRunPhpTestCoverage: panel.onRunPhpTestCoverage ?? noop,
    onClearPhpTestCoverage: panel.onClearPhpTestCoverage ?? noop,
    onOpenProblem: panel.onOpenProblem,
    onPhpReindex: panel.onPhpReindex,
    onOpenCommitFileDiff: panel.onOpenCommitFileDiff,
    onSoftReindex: panel.onSoftReindex,
    gitHistoryGateway: panel.gitHistoryGateway,
    runtimeObservabilityGateway: panel.runtimeObservabilityGateway,
    runtimeMode: panel.runtimeMode,
    getLatencySnapshot: panel.getLatencySnapshot,
    workspacePackageDiscovery: flags.hasJsWorkspace
      ? (panel.workspacePackageDiscovery ?? panel.expressRoutesPanel?.workspacePackageDiscovery)
      : undefined,
    workspaceRoot: panel.workspaceRoot,
  };
}

function noop(): void {}
