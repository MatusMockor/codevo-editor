import { PanelBottomClose, ShieldCheck, X } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import type { PointerEvent } from "react";
import type { WorkbenchNotice } from "../application/workbenchNotice";
import {
  bottomPanelLabel,
  type BottomPanelView,
} from "../domain/bottomPanel";
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
import type { GitHistoryGateway } from "../domain/git";
import type { RuntimeObservabilityGateway } from "../domain/runtimeObservability";
import type { LatencySnapshotEntry } from "../domain/latencyTracker";

interface BottomPanelProps {
  activeView: BottomPanelView;
  indexHealthLogs: IndexHealthLogEntry[];
  indexProgress: IndexProgressState;
  notices: WorkbenchNotice[];
  onClearProblems(): void;
  onClose(): void;
  onHardReindex(): void;
  onOpenProblem(notice: WorkbenchNotice): void;
  onPhpReindex(): void;
  onResizeStart(event: PointerEvent<HTMLDivElement>): void;
  onSelectView(view: BottomPanelView): void;
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
  ): Promise<void> | void;
  terminalGateway: TerminalGateway;
  terminalTheme: TerminalTheme;
  workspaceTrusted: boolean;
  workspaceRoot: string | null;
}

const bottomPanelViews: BottomPanelView[] = [
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
  indexHealthLogs,
  indexProgress,
  notices,
  onClearProblems,
  onClose,
  onHardReindex,
  onOpenProblem,
  onPhpReindex,
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
  terminalTheme,
  workspaceTrusted,
  workspaceRoot,
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

  useEffect(() => {
    if (activeView !== "terminal") {
      return;
    }

    setTerminalMounted(true);
  }, [activeView]);

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
    indexHealthLogs,
    indexProgress,
    notices,
    onHardReindex,
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
          {bottomPanelViews.map((view) => (
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
              {bottomPanelLabel(view)}
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
              onSessionReady={onTerminalSessionReady}
              profileId={selectedTerminalProfileId}
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
  activeView: BottomPanelView;
  indexHealthLogs: IndexHealthLogEntry[];
  indexProgress: IndexProgressState;
  notices: WorkbenchNotice[];
  onHardReindex(): void;
  onOpenProblem(notice: WorkbenchNotice): void;
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
  indexHealthLogs,
  indexProgress,
  notices,
  onHardReindex,
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
  if (activeView === "problems") {
    return (
      <ProblemsPanel
        isActive
        notices={notices}
        onOpenNotice={onOpenProblem}
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
