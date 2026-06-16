import { X } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import type { WorkbenchNotice } from "../application/workbenchNotice";
import {
  bottomPanelLabel,
  type BottomPanelView,
} from "../domain/bottomPanel";
import type { TerminalGateway, TerminalProfile } from "../domain/terminal";
import { ProblemsPanel } from "./ProblemsPanel";

interface BottomPanelProps {
  activeView: BottomPanelView;
  notices: WorkbenchNotice[];
  onClearProblems(): void;
  onSelectView(view: BottomPanelView): void;
  terminalGateway: TerminalGateway;
  terminalRootPath: string | null;
}

const bottomPanelViews: BottomPanelView[] = ["problems", "terminal"];
const LazyTerminalPanel = lazy(() =>
  import("./TerminalPanel").then((module) => ({
    default: module.TerminalPanel,
  })),
);

export function BottomPanel({
  activeView,
  notices,
  onClearProblems,
  onSelectView,
  terminalGateway,
  terminalRootPath,
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
              rootPath={terminalRootPath}
              terminalGateway={terminalGateway}
            />
          </Suspense>
        ) : null}
      </div>
    </section>
  );
}
