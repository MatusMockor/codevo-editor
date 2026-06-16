import { X } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import type { WorkbenchNotice } from "../application/workbenchNotice";
import {
  bottomPanelLabel,
  type BottomPanelView,
} from "../domain/bottomPanel";
import { ProblemsPanel } from "./ProblemsPanel";

interface BottomPanelProps {
  activeView: BottomPanelView;
  notices: WorkbenchNotice[];
  onClearProblems(): void;
  onSelectView(view: BottomPanelView): void;
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
}: BottomPanelProps) {
  const [terminalMounted, setTerminalMounted] = useState(
    activeView === "terminal",
  );

  useEffect(() => {
    if (activeView !== "terminal") {
      return;
    }

    setTerminalMounted(true);
  }, [activeView]);

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
            <LazyTerminalPanel isActive={activeView === "terminal"} />
          </Suspense>
        ) : null}
      </div>
    </section>
  );
}
