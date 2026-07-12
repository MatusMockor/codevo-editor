import { PanelBottomClose, ShieldCheck, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { WorkbenchNotice } from "../application/workbenchNotice";
import { bottomPanelLabel } from "../domain/bottomPanel";
import type {
  ArtisanControllerAction,
  ArtisanRoute,
  WorkbenchBottomPanelView,
} from "../domain/artisanRoutes";
import type {
  IndexHealthLogEntry,
  IndexProgressState,
} from "../domain/indexProgress";
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
import { PhpTestResultsPanel } from "./PhpTestResultsPanel";

interface BottomPanelProps {
  activeView: WorkbenchBottomPanelView;
  artisanRoutes?: ArtisanRoute[];
  artisanRoutesError?: string | null;
  artisanRoutesLoading?: boolean;
  artisanRoutesQuery?: string;
  artisanRoutesTotal?: number;
  artisanRoutesUnavailable?: string | null;
  hasArtisan?: boolean;
  hasPhpWorkspace?: boolean;
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
  terminalShellIntegrationEnabled: boolean;
  terminalTheme: TerminalTheme;
  workspaceTrusted: boolean;
  workspaceRoot: string | null;
  phpTestError?: string | null;
  phpTestFilter?: string | null;
  phpTestIsRunning?: boolean;
  phpTestResult?: PhpTestRunOk | null;
  phpTestUnavailable?: string | null;
}

const bottomPanelViews: WorkbenchBottomPanelView[] = [
  "problems",
  "index",
  "runtime",
  "history",
  "terminal",
];
const LazyTerminalPanel = lazy(() =>
  import("./TerminalPanel").then((module) => ({
    default: module.TerminalPanel,
  })),
);

export function BottomPanel({
  activeView,
  artisanRoutes = [],
  artisanRoutesError = null,
  artisanRoutesLoading = false,
  artisanRoutesQuery = "",
  artisanRoutesTotal = 0,
  artisanRoutesUnavailable = null,
  hasArtisan = false,
  hasPhpWorkspace = false,
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
  terminalShellIntegrationEnabled,
  terminalTheme,
  workspaceTrusted,
  workspaceRoot,
  phpTestError = null,
  phpTestFilter = null,
  phpTestIsRunning = false,
  phpTestResult = null,
  phpTestUnavailable = null,
}: BottomPanelProps) {
  const [terminalMounted, setTerminalMounted] = useState(
    activeView === "terminal",
  );
  const [terminalProfiles, setTerminalProfiles] = useState<TerminalProfile[]>(
    [],
  );
  const [selectedTerminalProfileId, setSelectedTerminalProfileId] = useState<
    string | null
  >(null);
  const [terminalCwd, setTerminalCwd] = useState<string | null>(null);
  const workspaceRootRef = useRef(workspaceRoot);
  workspaceRootRef.current = workspaceRoot;

  useEffect(() => {
    if (activeView !== "terminal") {
      return;
    }

    setTerminalMounted(true);
  }, [activeView]);

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
    activeView,
    artisanRoutes,
    artisanRoutesError,
    artisanRoutesLoading,
    artisanRoutesQuery,
    artisanRoutesTotal,
    artisanRoutesUnavailable,
    phpTestError,
    phpTestFilter,
    phpTestIsRunning,
    phpTestResult,
    phpTestUnavailable,
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
    onOpenProblem,
    onPhpReindex,
    onOpenCommitFileDiff,
    gitHistoryGateway,
    runtimeObservabilityGateway,
    runtimeMode,
    getLatencySnapshot,
    onSoftReindex,
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
        <div
          aria-label="Panel views"
          className="bottom-panel-tabs"
          role="tablist"
        >
          {[
            ...bottomPanelViews,
            ...(hasArtisan ? (["routes"] as const) : []),
            ...(hasArtisan || hasPhpWorkspace
              ? (["testResults"] as const)
              : []),
          ].map((view) => (
            <button
              aria-selected={activeView === view}
              className={
                activeView === view
                  ? "bottom-panel-tab active"
                  : "bottom-panel-tab"
              }
              key={view}
              onClick={() => onSelectView(view)}
              role="tab"
              type="button"
            >
              {view === "routes"
                ? "Routes"
                : view === "testResults"
                  ? "Tests"
                  : bottomPanelLabel(view)}
            </button>
          ))}
        </div>
        {activeView === "problems" && notices.length > 0 ? (
          <button
            className="bottom-panel-action"
            onClick={onClearProblems}
            title="Clear problems"
            type="button"
          >
            <X aria-hidden="true" size={14} />
          </button>
        ) : null}
        {activeView === "terminal" && workspaceRoot && !workspaceTrusted ? (
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
        {activeView === "terminal" && terminalProfiles.length > 0 ? (
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
        {activeView === "terminal" &&
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
        ) : activeView === "terminal" && terminalCwd ? (
          <span className="bottom-panel-subtitle" title={terminalCwd}>
            {terminalCwd}
          </span>
        ) : null}
        <button
          className="bottom-panel-action"
          onClick={onClose}
          title="Hide panel"
          type="button"
        >
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
                hidden={activeView !== "terminal"}
                role="tabpanel"
              />
            }
          >
            <LazyTerminalPanel
              isActive={activeView === "terminal"}
              onCwdChange={setTerminalCwd}
              onOpenLink={(path, line, column) => {
                const requestedRoot = workspaceRoot;

                if (!requestedRoot) {
                  return;
                }

                if (
                  !workspaceRootKeysEqual(
                    workspaceRootRef.current,
                    requestedRoot,
                  )
                ) {
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
              onSessionReady={onTerminalSessionReady}
              profileId={selectedTerminalProfileId}
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

interface RenderActivePanelOptions {
  activeView: WorkbenchBottomPanelView;
  artisanRoutes: ArtisanRoute[];
  artisanRoutesError: string | null;
  artisanRoutesLoading: boolean;
  artisanRoutesQuery: string;
  artisanRoutesTotal: number;
  artisanRoutesUnavailable: string | null;
  phpTestError: string | null;
  phpTestFilter: string | null;
  phpTestIsRunning: boolean;
  phpTestResult: PhpTestRunOk | null;
  phpTestUnavailable: string | null;
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
  workspaceRoot: string | null;
}

function renderActivePanel({
  activeView,
  artisanRoutes,
  artisanRoutesError,
  artisanRoutesLoading,
  artisanRoutesQuery,
  artisanRoutesTotal,
  artisanRoutesUnavailable,
  phpTestError,
  phpTestFilter,
  phpTestIsRunning,
  phpTestResult,
  phpTestUnavailable,
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
  onOpenProblem,
  onPhpReindex,
  onOpenCommitFileDiff,
  onSoftReindex,
  gitHistoryGateway,
  runtimeObservabilityGateway,
  runtimeMode,
  getLatencySnapshot,
  workspaceRoot,
}: RenderActivePanelOptions) {
  if (activeView === "testResults") {
    return (
      <PhpTestResultsPanel
        error={phpTestError}
        filter={phpTestFilter}
        isRunning={phpTestIsRunning}
        onOpenCase={onOpenPhpTestCase}
        onRun={onRunPhpTests}
        onRunCase={onRunPhpTestCase}
        result={phpTestResult}
        rootPath={workspaceRoot}
        unavailable={phpTestUnavailable}
      />
    );
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
