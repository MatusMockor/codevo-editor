import { X } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
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

interface BottomPanelProps {
  activeView: BottomPanelView;
  indexHealthLogs: IndexHealthLogEntry[];
  indexProgress: IndexProgressState;
  notices: WorkbenchNotice[];
  onClearProblems(): void;
  onHardReindex(): void;
  onPhpReindex(): void;
  onSelectView(view: BottomPanelView): void;
  onSoftReindex(): void;
  terminalGateway: TerminalGateway;
  terminalTheme: TerminalTheme;
  workspaceRoot: string | null;
}

const bottomPanelViews: BottomPanelView[] = ["problems", "index", "terminal"];
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
  onHardReindex,
  onPhpReindex,
  onSelectView,
  onSoftReindex,
  terminalGateway,
  terminalTheme,
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

  return (
    <section aria-label="Panel" className="bottom-panel">
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
      </header>
      <div className="bottom-panel-body">
        <ProblemsPanel isActive={activeView === "problems"} notices={notices} />
        <IndexHealthPanel
          isActive={activeView === "index"}
          logs={indexHealthLogs}
          onHardReindex={onHardReindex}
          onPhpReindex={onPhpReindex}
          onSoftReindex={onSoftReindex}
          progress={indexProgress}
          rootPath={workspaceRoot}
        />
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
