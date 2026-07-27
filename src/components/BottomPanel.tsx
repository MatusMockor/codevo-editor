import { PanelBottomClose, ShieldCheck, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import type { WorkbenchNotice } from "../application/workbenchNotice";
import type { WorkspacePackageDiscovery } from "../application/useWorkspacePackageGraph";
import { bottomPanelLabel } from "../domain/bottomPanel";
import { hasExpressWorkspaceSignal } from "../domain/expressWorkspaceSignal";
import type {
  ArtisanControllerAction,
  ArtisanRoute,
  WorkbenchBottomPanelView,
} from "../domain/artisanRoutes";
import type { IndexHealthLogEntry, IndexProgressState } from "../domain/indexProgress";
import type { TerminalTheme } from "../domain/settings";
import type { TerminalGateway, TerminalProfile } from "../domain/terminal";
import { IndexHealthPanel } from "./IndexHealthPanel";
import { ProblemsPanel } from "./ProblemsPanel";
import { GitHistoryPanel } from "./GitHistoryPanel";
import { RuntimeObservabilityPanel } from "./RuntimeObservabilityPanel";
import type { FileChange, GitHistoryGateway } from "../domain/git";
import type { RuntimeObservabilityGateway } from "../domain/runtimeObservability";
import type { LatencySnapshotEntry } from "../domain/latencyTracker";
import { workspaceRelativePath } from "../domain/pathDerivation";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
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

interface ProblemsExpressRoutesPanelProps extends ExpressRoutesPanelProps {
  readonly hasJavaScriptTypeScriptWorkspace?: boolean;
  readonly workspacePackageDiscovery?: ProblemsWorkspacePackageDiscovery;
}

type ProblemsWorkspacePackageDiscovery = Pick<
  WorkspacePackageDiscovery,
  | "authority"
  | "incompleteDirectories"
  | "packageManifests"
  | "unscopedAuthorityUncertain"
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

interface BottomPanelProps {
  activeView: WorkbenchBottomPanelView;
  debug?: ReactNode;
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

const bottomPanelViews: WorkbenchBottomPanelView[] = [
  "problems",
  "index",
  "runtime",
  "history",
  "terminal",
  "debug",
];
const LazyTerminalTabsPanel = lazy(() =>
  import("./TerminalTabsPanel").then((module) => ({
    default: module.TerminalTabsPanel,
  })),
);

export function BottomPanel({
  activeView,
  debug,
  artisanRoutes = [],
  artisanRoutesError = null,
  artisanRoutesLoading = false,
  artisanRoutesQuery = "",
  artisanRoutesTotal = 0,
  artisanRoutesUnavailable = null,
  expressRoutesPanel,
  packageDependenciesPanel,
  netteWorkspacePanel,
  symfonyWorkspacePanel,
  hasArtisan = false,
  hasJsWorkspace = expressRoutesPanel?.hasJavaScriptTypeScriptWorkspace ?? false,
  hasExpressRoutes = hasJsWorkspace,
  hasNette = false,
  hasPhpWorkspace = false,
  hasSymfony = false,
  indexHealthLogs,
  indexProgress,
  notices,
  onClearProblems,
  onClose,
  onHardReindex,
  onArtisanRoutesQueryChange = () => undefined,
  onOpenArtisanController = () => undefined,
  onRefreshArtisanRoutes = () => undefined,
  onOpenPhpTestCase = () => undefined,
  onRunPhpTestCase = () => undefined,
  onRunPhpTests = () => undefined,
  onRunPhpTestCoverage = () => undefined,
  onClearPhpTestCoverage = () => undefined,
  jsTestExplorer,
  onOpenProblem,
  onPhpReindex,
  onRevealDirectoryInTree,
  onResizeStart,
  onSelectView,
  onSoftReindex,
  onOpenCommitFileDiff,
  gitHistoryGateway,
  runtimeObservabilityGateway,
  runtimeMode,
  getLatencySnapshot,
  onTerminalSessionReady,
  onTrustWorkspace,
  terminalGateway,
  terminalOwnerKey = null,
  terminalShellIntegrationEnabled,
  terminalTheme,
  workspaceTrusted,
  workspacePackageDiscovery,
  workspaceRoot,
  phpTestError = null,
  phpTestFilter = null,
  phpTestIsRunning = false,
  phpTestResult = null,
  phpTestUnavailable = null,
  phpTestCanRunCoverage = false,
  phpTestCoverageError = null,
  phpTestCoverageRunning = false,
  phpTestCoverageSummary = null,
  phpTestCoverageUnavailable = null,
}: BottomPanelProps) {
  const showExpressRoutes =
    hasExpressWorkspaceSignal({ routes: expressRoutesPanel?.routes ?? [] }) ||
    (activeView === "expressRoutes" && hasExpressRoutes);
  const effectiveActiveView =
    (activeView === "expressRoutes" && !showExpressRoutes) ||
    (activeView === "packages" && !hasJsWorkspace) ||
    (activeView === "nette" && !hasNette) ||
    (activeView === "symfony" && !hasSymfony)
      ? "problems"
      : activeView;
  const [terminalMounted, setTerminalMounted] = useState(effectiveActiveView === "terminal");
  const [terminalProfiles, setTerminalProfiles] = useState<TerminalProfile[]>([]);
  const [selectedTerminalProfileId, setSelectedTerminalProfileId] = useState<string | null>(null);
  const [terminalCwd, setTerminalCwd] = useState<string | null>(null);
  const workspaceRootRef = useRef(workspaceRoot);
  workspaceRootRef.current = workspaceRoot;

  useEffect(() => {
    if (effectiveActiveView !== "terminal") {
      return;
    }

    setTerminalMounted(true);
  }, [effectiveActiveView]);

  useEffect(() => {
    setTerminalCwd(null);
  }, [selectedTerminalProfileId, workspaceRoot]);

  useEffect(() => {
    if (!terminalMounted) {
      return;
    }

    let cancelled = false;

    terminalGateway
      .listProfiles()
      .then((profiles) => {
        if (cancelled) {
          return;
        }

        setTerminalProfiles(profiles);
        setSelectedTerminalProfileId((current) => {
          if (profiles.some((profile) => profile.id === current)) {
            return current;
          }

          return profiles[0]?.id ?? null;
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setTerminalProfiles([]);
        setSelectedTerminalProfileId(null);
      });

    return () => {
      cancelled = true;
    };
  }, [terminalGateway, terminalMounted]);

  const activePanel = renderActivePanel({
    activeView: effectiveActiveView,
    debug,
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
    hasExpressRoutes: showExpressRoutes,
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
    gitHistoryGateway,
    runtimeObservabilityGateway,
    runtimeMode,
    getLatencySnapshot,
    onSoftReindex,
    workspacePackageDiscovery:
      hasJsWorkspace
        ? (workspacePackageDiscovery ?? expressRoutesPanel?.workspacePackageDiscovery)
        : undefined,
    workspaceRoot,
  });

  return (
    <section aria-label="Panel" className="bottom-panel">
      <div
        aria-label="Resize panel"
        aria-orientation="horizontal"
        className="bottom-panel-resize-handle"
        onPointerDown={onResizeStart}
        role="separator"
      />
      <header className="bottom-panel-header">
        <div aria-label="Panel views" className="bottom-panel-tabs" role="tablist">
          {[
            ...bottomPanelViews,
            ...(hasArtisan ? (["routes"] as const) : []),
            ...(showExpressRoutes ? (["expressRoutes"] as const) : []),
            ...(hasJsWorkspace ? (["packages"] as const) : []),
            ...(hasNette ? (["nette"] as const) : []),
            ...(hasSymfony ? (["symfony"] as const) : []),
            ...(hasArtisan || hasPhpWorkspace || hasJsWorkspace ? (["testResults"] as const) : []),
          ].map((view) => (
            <button
              aria-selected={effectiveActiveView === view}
              className={
                effectiveActiveView === view ? "bottom-panel-tab active" : "bottom-panel-tab"
              }
              key={view}
              onClick={() => onSelectView(view)}
              role="tab"
              type="button"
            >
              {view === "routes"
                ? "Routes"
                : view === "expressRoutes"
                  ? "Express Routes"
                  : view === "packages"
                    ? "Packages"
                    : view === "nette"
                      ? "Nette"
                      : view === "symfony"
                        ? "Symfony"
                        : view === "testResults"
                          ? "Tests"
                          : bottomPanelLabel(view)}
            </button>
          ))}
        </div>
        {effectiveActiveView === "problems" && notices.length > 0 ? (
          <button
            className="bottom-panel-action"
            onClick={onClearProblems}
            title="Clear problems"
            type="button"
          >
            <X aria-hidden="true" size={14} />
          </button>
        ) : null}
        {effectiveActiveView === "terminal" && workspaceRoot && !workspaceTrusted ? (
          <button
            className="bottom-panel-text-action"
            onClick={onTrustWorkspace}
            title="Trust workspace"
            type="button"
          >
            <ShieldCheck aria-hidden="true" size={14} />
            Trust
          </button>
        ) : null}
        {effectiveActiveView === "symfony" && workspaceRoot && !workspaceTrusted ? (
          <button
            className="bottom-panel-text-action"
            onClick={onTrustWorkspace}
            title="Trust workspace"
            type="button"
          >
            <ShieldCheck aria-hidden="true" size={14} />
            Trust
          </button>
        ) : null}
        {effectiveActiveView === "terminal" && terminalProfiles.length > 0 ? (
          <select
            aria-label="Terminal profile"
            className="terminal-profile-select"
            onChange={(event) => setSelectedTerminalProfileId(event.target.value)}
            value={selectedTerminalProfileId ?? ""}
          >
            {terminalProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
        ) : null}
        {effectiveActiveView === "terminal" &&
        terminalCwd &&
        workspaceRoot &&
        onRevealDirectoryInTree &&
        workspaceRelativePath(workspaceRoot, terminalCwd) !== null ? (
          <button
            aria-label={`Reveal ${terminalCwd} in file tree`}
            className="bottom-panel-text-action"
            onClick={() => onRevealDirectoryInTree(terminalCwd)}
            title={terminalCwd}
            type="button"
          >
            {terminalCwd}
          </button>
        ) : effectiveActiveView === "terminal" && terminalCwd ? (
          <span className="bottom-panel-subtitle" title={terminalCwd}>
            {terminalCwd}
          </span>
        ) : null}
        <button className="bottom-panel-action" onClick={onClose} title="Hide panel" type="button">
          <PanelBottomClose aria-hidden="true" size={14} />
        </button>
      </header>
      <div className="bottom-panel-body">
        {activePanel}
        {terminalMounted ? (
          <Suspense
            fallback={
              <div
                aria-label="Terminal"
                className="terminal-panel"
                hidden={effectiveActiveView !== "terminal"}
                role="tabpanel"
              />
            }
          >
            <LazyTerminalTabsPanel
              isActive={effectiveActiveView === "terminal"}
              key={terminalTabsOwnerKey(terminalOwnerKey, workspaceRoot)}
              onActiveCwdChange={setTerminalCwd}
              onActiveProfileChange={(profileId) =>
                setSelectedTerminalProfileId(profileId ?? terminalProfiles[0]?.id ?? null)
              }
              onOpenLink={(path, line, column) => {
                const requestedRoot = workspaceRoot;

                if (!requestedRoot) {
                  return;
                }

                if (!workspaceRootKeysEqual(workspaceRootRef.current, requestedRoot)) {
                  return;
                }

                const position = {
                  column: column ?? 1,
                  lineNumber: line ?? 1,
                };
                return onOpenProblem({
                  id: `terminal:${path}:${position.lineNumber}:${position.column}`,
                  message: path,
                  navigationTarget: {
                    path,
                    range: { end: position, start: position },
                  },
                  severity: "info",
                  source: "Terminal",
                });
              }}
              onActiveSessionReady={onTerminalSessionReady}
              ownerKey={terminalTabsOwnerKey(terminalOwnerKey, workspaceRoot)}
              profileId={selectedTerminalProfileId}
              profileLabel={
                terminalProfiles.find(({ id }) => id === selectedTerminalProfileId)?.label ?? null
              }
              shellIntegrationEnabled={terminalShellIntegrationEnabled}
              rootPath={workspaceRoot}
              terminalGateway={terminalGateway}
              terminalTheme={terminalTheme}
            />
          </Suspense>
        ) : null}
      </div>
    </section>
  );
}

function terminalTabsOwnerKey(ownerKey: string | null, rootPath: string | null): string {
  return ownerKey && rootPath ? JSON.stringify([ownerKey, rootPath]) : "no-workspace";
}

interface RenderActivePanelOptions {
  activeView: WorkbenchBottomPanelView;
  debug?: ReactNode;
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

function renderActivePanel({
  activeView,
  debug,
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
}: RenderActivePanelOptions) {
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
