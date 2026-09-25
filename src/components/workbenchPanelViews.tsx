import type { PointerEvent, ReactNode } from "react";
import type { WorkbenchNotice } from "../application/workbenchNotice";
import type { WorkspacePackageDiscovery } from "../application/useWorkspacePackageGraph";
import type {
  ArtisanControllerAction,
  ArtisanRoute,
  WorkbenchBottomPanelView,
} from "../domain/artisanRoutes";
import type { IndexHealthLogEntry, IndexProgressState } from "../domain/indexProgress";
import type { TerminalTheme } from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import type { AgentProviderSignInSurface } from "../application/useAgentProviderSignIn";
import { IndexHealthPanel } from "./IndexHealthPanel";
import { ProblemsPanel } from "./ProblemsPanel";
import { GitHistoryPanel } from "./GitHistoryPanel";
import { RuntimeObservabilityPanel } from "./RuntimeObservabilityPanel";
import type { FileChange, GitHistoryGateway } from "../domain/git";
import type { RuntimeObservabilityGateway } from "../domain/runtimeObservability";
import type { LatencySnapshotEntry } from "../domain/latencyTracker";
import { ArtisanRoutesPanel } from "./ArtisanRoutesPanel";
import type { PhpTestCase, PhpTestRunOk } from "../domain/phpTestResults";
import type { PhpCoverageMetric } from "../domain/phpCloverCoverage";
import { PhpTestResultsPanel } from "./PhpTestResultsPanel";
import { JsTestExplorerPanel, type JsTestExplorerPanelProps } from "./JsTestExplorerPanel";
import { ExpressRoutesPanel, type ExpressRoutesPanelProps } from "./ExpressRoutesPanel";
import {
  PackageDependenciesPanel,
  type PackageDependenciesPanelProps,
} from "./PackageDependenciesPanel";
import { SymfonyWorkspacePanel, type SymfonyWorkspacePanelProps } from "./SymfonyWorkspacePanel";
import {
  NetteOperationalWorkspacePanel,
  type NetteOperationalWorkspacePanelProps,
} from "./NetteOperationalWorkspacePanel";

export interface ProblemsExpressRoutesPanelProps extends ExpressRoutesPanelProps {
  readonly hasJavaScriptTypeScriptWorkspace?: boolean;
  readonly workspacePackageDiscovery?: ProblemsWorkspacePackageDiscovery;
}

export type ProblemsWorkspacePackageDiscovery = Pick<
  WorkspacePackageDiscovery,
  "authority" | "incompleteDirectories" | "packageManifests" | "unscopedAuthorityUncertain"
>;

function problemsPackageAuthority(
  discovery: ProblemsWorkspacePackageDiscovery | undefined,
): WorkspacePackageDiscovery["authority"] | undefined {
  if (!discovery) return undefined;
  if (discovery.authority === "loading") return "loading";
  if (discovery.unscopedAuthorityUncertain) return "bounded";
  if (discovery.incompleteDirectories.length > 0) return "bounded";
  return "complete";
}

export interface WorkbenchPanelProps {
  activeView: WorkbenchBottomPanelView;
  debug?: ReactNode;
  search?: ReactNode;
  artisanRoutes?: ArtisanRoute[];
  artisanRoutesError?: string | null;
  artisanRoutesLoading?: boolean;
  artisanRoutesQuery?: string;
  artisanRoutesTotal?: number;
  artisanRoutesUnavailable?: string | null;
  expressRoutesPanel?: ProblemsExpressRoutesPanelProps;
  packageDependenciesPanel?: PackageDependenciesPanelProps;
  netteWorkspacePanel?: NetteOperationalWorkspacePanelProps;
  symfonyWorkspacePanel?: SymfonyWorkspacePanelProps;
  hasArtisan?: boolean;
  hasExpressRoutes?: boolean;
  hasJsWorkspace?: boolean;
  hasNette?: boolean;
  hasPhpWorkspace?: boolean;
  hasSymfony?: boolean;
  indexHealthLogs: IndexHealthLogEntry[];
  indexProgress: IndexProgressState;
  notices: WorkbenchNotice[];
  onClearProblems(): void;
  onClose(): void;
  onHardReindex(): void;
  onArtisanRoutesQueryChange?(query: string): void;
  onOpenArtisanController?(action: ArtisanControllerAction): void;
  onRefreshArtisanRoutes?(): void;
  onOpenPhpTestCase?(testCase: PhpTestCase): void;
  onRunPhpTestCase?(testCase: PhpTestCase): void;
  onRunPhpTests?(): void;
  onRunPhpTestCoverage?(): void;
  onClearPhpTestCoverage?(): void;
  jsTestExplorer?: JsTestExplorerPanelProps;
  onOpenProblem(notice: WorkbenchNotice): Promise<boolean>;
  onPhpReindex(): void;
  onRevealDirectoryInTree?(path: string): void;
  onResizeStart(event: PointerEvent<HTMLDivElement>): void;
  onSelectView(view: WorkbenchBottomPanelView): void;
  onSoftReindex(): void;
  onTerminalSessionReady?(sessionId: number | null): void;
  onTrustWorkspace(): void;
  gitHistoryGateway: GitHistoryGateway;
  runtimeObservabilityGateway: RuntimeObservabilityGateway;
  runtimeMode?: string;
  getLatencySnapshot?(): LatencySnapshotEntry[];
  onOpenCommitFileDiff(
    commitHash: string,
    path: string,
    oldPath: string | null,
    files?: FileChange[],
  ): Promise<void> | void;
  terminalGateway: TerminalGateway;
  terminalOwnerKey?: string | null;
  terminalShellIntegrationEnabled: boolean;
  terminalTheme: TerminalTheme;
  providerSignIn?: AgentProviderSignInSurface;
  workspaceTrusted: boolean;
  workspacePackageDiscovery?: ProblemsWorkspacePackageDiscovery;
  workspaceRoot: string | null;
  phpTestError?: string | null;
  phpTestFilter?: string | null;
  phpTestIsRunning?: boolean;
  phpTestResult?: PhpTestRunOk | null;
  phpTestUnavailable?: string | null;
  phpTestCanRunCoverage?: boolean;
  phpTestCoverageError?: string | null;
  phpTestCoverageRunning?: boolean;
  phpTestCoverageSummary?: PhpCoverageMetric | null;
  phpTestCoverageUnavailable?: string | null;
}

export interface WorkbenchPanelViewContentProps {
  activeView: WorkbenchBottomPanelView;
  debug?: ReactNode;
  search?: ReactNode;
  phpTree?: ReactNode;
  artisanRoutes: ArtisanRoute[];
  artisanRoutesError: string | null;
  artisanRoutesLoading: boolean;
  artisanRoutesQuery: string;
  artisanRoutesTotal: number;
  artisanRoutesUnavailable: string | null;
  expressRoutesPanel?: ProblemsExpressRoutesPanelProps;
  packageDependenciesPanel?: PackageDependenciesPanelProps;
  netteWorkspacePanel?: NetteOperationalWorkspacePanelProps;
  symfonyWorkspacePanel?: SymfonyWorkspacePanelProps;
  hasArtisan: boolean;
  hasExpressRoutes: boolean;
  hasJsWorkspace: boolean;
  hasNette: boolean;
  hasPhpWorkspace: boolean;
  hasSymfony: boolean;
  phpTestError: string | null;
  phpTestFilter: string | null;
  phpTestIsRunning: boolean;
  phpTestResult: PhpTestRunOk | null;
  phpTestUnavailable: string | null;
  phpTestCanRunCoverage: boolean;
  phpTestCoverageError: string | null;
  phpTestCoverageRunning: boolean;
  phpTestCoverageSummary: PhpCoverageMetric | null;
  phpTestCoverageUnavailable: string | null;
  jsTestExplorer?: JsTestExplorerPanelProps;
  indexHealthLogs: IndexHealthLogEntry[];
  indexProgress: IndexProgressState;
  notices: WorkbenchNotice[];
  onHardReindex(): void;
  onArtisanRoutesQueryChange(query: string): void;
  onOpenArtisanController(action: ArtisanControllerAction): void;
  onRefreshArtisanRoutes(): void;
  onOpenPhpTestCase(testCase: PhpTestCase): void;
  onRunPhpTestCase(testCase: PhpTestCase): void;
  onRunPhpTests(): void;
  onRunPhpTestCoverage(): void;
  onClearPhpTestCoverage(): void;
  onOpenProblem(notice: WorkbenchNotice): Promise<boolean>;
  onPhpReindex(): void;
  onSoftReindex(): void;
  onOpenCommitFileDiff(
    commitHash: string,
    path: string,
    oldPath: string | null,
  ): Promise<void> | void;
  gitHistoryGateway: GitHistoryGateway;
  runtimeObservabilityGateway: RuntimeObservabilityGateway;
  runtimeMode?: string;
  getLatencySnapshot?(): LatencySnapshotEntry[];
  workspacePackageDiscovery?: ProblemsWorkspacePackageDiscovery;
  workspaceRoot: string | null;
}

const splitTestResultsStyles = {
  container: {
    display: "grid",
    gridTemplateRows: "1fr 1fr",
    height: "100%",
    minHeight: 0,
  },
  jsBlock: { minHeight: 0, overflow: "hidden" },
  phpBlock: {
    borderBottom: "1px solid var(--border-subtle)",
    minHeight: 0,
    overflow: "hidden",
  },
} as const;

export function WorkbenchPanelViewContent({
  activeView,
  debug,
  phpTree,
  artisanRoutes,
  artisanRoutesError,
  artisanRoutesLoading,
  artisanRoutesQuery,
  artisanRoutesTotal,
  artisanRoutesUnavailable,
  expressRoutesPanel,
  packageDependenciesPanel,
  netteWorkspacePanel,
  symfonyWorkspacePanel,
  hasArtisan,
  hasExpressRoutes,
  hasJsWorkspace,
  hasNette,
  hasPhpWorkspace,
  hasSymfony,
  phpTestError,
  phpTestFilter,
  phpTestIsRunning,
  phpTestResult,
  phpTestUnavailable,
  phpTestCanRunCoverage,
  phpTestCoverageError,
  phpTestCoverageRunning,
  phpTestCoverageSummary,
  phpTestCoverageUnavailable,
  jsTestExplorer,
  indexHealthLogs,
  indexProgress,
  notices,
  onHardReindex,
  onArtisanRoutesQueryChange,
  onOpenArtisanController,
  onRefreshArtisanRoutes,
  onOpenPhpTestCase,
  onRunPhpTestCase,
  onRunPhpTests,
  onRunPhpTestCoverage,
  onClearPhpTestCoverage,
  onOpenProblem,
  onPhpReindex,
  onOpenCommitFileDiff,
  onSoftReindex,
  gitHistoryGateway,
  runtimeObservabilityGateway,
  runtimeMode,
  getLatencySnapshot,
  workspacePackageDiscovery,
  workspaceRoot,
}: WorkbenchPanelViewContentProps) {
  if (activeView === "search") {
    return null;
  }

  if (activeView === "phpTree") {
    return phpTree ?? null;
  }

  if (activeView === "nette") {
    return hasNette && netteWorkspacePanel ? (
      <NetteOperationalWorkspacePanel {...netteWorkspacePanel} />
    ) : null;
  }

  if (activeView === "symfony") {
    return hasSymfony && symfonyWorkspacePanel ? (
      <SymfonyWorkspacePanel {...symfonyWorkspacePanel} />
    ) : null;
  }

  if (activeView === "packages") {
    return hasJsWorkspace && packageDependenciesPanel ? (
      <PackageDependenciesPanel {...packageDependenciesPanel} />
    ) : null;
  }

  if (activeView === "expressRoutes") {
    return hasExpressRoutes && expressRoutesPanel ? (
      <ExpressRoutesPanel {...expressRoutesPanel} />
    ) : null;
  }

  if (activeView === "debug") {
    if (!debug) {
      return null;
    }

    return debug;
  }

  if (activeView === "testResults") {
    const phpPanel = (
      <PhpTestResultsPanel
        canRunCoverage={phpTestCanRunCoverage}
        coverageError={phpTestCoverageError}
        coverageRunning={phpTestCoverageRunning}
        coverageSummary={phpTestCoverageSummary}
        coverageUnavailable={phpTestCoverageUnavailable}
        error={phpTestError}
        filter={phpTestFilter}
        isRunning={phpTestIsRunning}
        onOpenCase={onOpenPhpTestCase}
        onClearCoverage={onClearPhpTestCoverage}
        onRun={onRunPhpTests}
        onRunCoverage={onRunPhpTestCoverage}
        onRunCase={onRunPhpTestCase}
        result={phpTestResult}
        rootPath={workspaceRoot}
        unavailable={phpTestUnavailable}
      />
    );
    const jsPanel = jsTestExplorer ? <JsTestExplorerPanel {...jsTestExplorer} /> : null;
    const showJsBlock = hasJsWorkspace;
    const showPhpBlock = hasArtisan || hasPhpWorkspace || !showJsBlock;

    if (showPhpBlock && showJsBlock) {
      return (
        <div style={splitTestResultsStyles.container}>
          <div style={splitTestResultsStyles.phpBlock}>{phpPanel}</div>
          <div style={splitTestResultsStyles.jsBlock}>{jsPanel}</div>
        </div>
      );
    }

    if (showJsBlock) {
      return jsPanel;
    }

    return phpPanel;
  }

  if (activeView === "routes") {
    return (
      <ArtisanRoutesPanel
        error={artisanRoutesError}
        loading={artisanRoutesLoading}
        onChangeQuery={onArtisanRoutesQueryChange}
        onOpenController={onOpenArtisanController}
        onRefresh={onRefreshArtisanRoutes}
        query={artisanRoutesQuery}
        routes={artisanRoutes}
        total={artisanRoutesTotal}
        unavailable={artisanRoutesUnavailable}
      />
    );
  }

  if (activeView === "problems") {
    return (
      <ProblemsPanel
        isActive
        notices={notices}
        onOpenNotice={onOpenProblem}
        workspacePackageAuthority={problemsPackageAuthority(workspacePackageDiscovery)}
        workspacePackageIncompleteDirectories={workspacePackageDiscovery?.incompleteDirectories}
        workspacePackageManifests={workspacePackageDiscovery?.packageManifests}
        workspacePackageUnscopedAuthorityUncertain={
          workspacePackageDiscovery?.unscopedAuthorityUncertain
        }
        workspaceRoot={workspaceRoot}
      />
    );
  }

  if (activeView === "history") {
    return (
      <GitHistoryPanel
        gateway={gitHistoryGateway}
        onOpenCommitFileDiff={onOpenCommitFileDiff}
        rootPath={workspaceRoot}
      />
    );
  }

  if (activeView === "index") {
    return (
      <IndexHealthPanel
        isActive
        logs={indexHealthLogs}
        onHardReindex={onHardReindex}
        onPhpReindex={onPhpReindex}
        onSoftReindex={onSoftReindex}
        progress={indexProgress}
        rootPath={workspaceRoot}
      />
    );
  }

  if (activeView === "runtime") {
    return (
      <RuntimeObservabilityPanel
        gateway={runtimeObservabilityGateway}
        getLatencySnapshot={getLatencySnapshot}
        isActive
        mode={runtimeMode}
        rootPath={workspaceRoot}
      />
    );
  }

  return null;
}
