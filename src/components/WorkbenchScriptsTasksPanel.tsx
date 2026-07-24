import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  NodePackageScriptsPanel,
  type NodePackageScriptsPanelProps,
} from "./NodePackageScriptsPanel";
import {
  VscodeProcessTasksPanel,
  type VscodeProcessTasksPanelProps,
} from "./VscodeProcessTasksPanel";

export interface WorkbenchScriptsTasksPanelProps {
  readonly nodePackageScripts: NodePackageScriptsPanelProps;
  readonly vscodeProcessTasks: VscodeProcessTasksPanelProps;
}

export function WorkbenchScriptsTasksPanel({
  nodePackageScripts,
  vscodeProcessTasks,
}: WorkbenchScriptsTasksPanelProps) {
  const taskActive = vscodeProcessTasks.occupied || vscodeProcessTasks.running;
  const [activeView, setActiveView] = useState<"scripts" | "tasks">(() =>
    taskActive ? "tasks" : "scripts",
  );
  const previousTaskActiveRef = useRef(taskActive);

  useEffect(() => {
    const wasActive = previousTaskActiveRef.current;
    previousTaskActiveRef.current = taskActive;
    if (!wasActive && taskActive) setActiveView("tasks");
  }, [taskActive]);

  return (
    <>
      <div aria-label="Scripts sidebar views" className="sidebar-tabs" role="tablist">
        {(["scripts", "tasks"] as const).map((view) => (
          <button
            aria-controls={`sidebar-${view}-panel`}
            aria-selected={activeView === view}
            className={activeView === view ? "sidebar-tab active" : "sidebar-tab"}
            id={`sidebar-${view}-tab`}
            key={view}
            onKeyDown={(event) => {
              const nextView = keyboardTargetView(event, view);
              if (!nextView) return;
              event.preventDefault();
              setActiveView(nextView);
              event.currentTarget.parentElement
                ?.querySelector<HTMLButtonElement>(`#sidebar-${nextView}-tab`)
                ?.focus();
            }}
            onClick={() => setActiveView(view)}
            role="tab"
            tabIndex={activeView === view ? 0 : -1}
            type="button"
          >
            {view === "scripts" ? "Scripts" : "Tasks"}
          </button>
        ))}
      </div>
      <div
        aria-labelledby="sidebar-scripts-tab"
        className="sidebar-subview-panel"
        hidden={activeView !== "scripts"}
        id="sidebar-scripts-panel"
        role="tabpanel"
      >
        <NodePackageScriptsPanel {...nodePackageScripts} />
      </div>
      <div
        aria-labelledby="sidebar-tasks-tab"
        className="sidebar-subview-panel"
        hidden={activeView !== "tasks"}
        id="sidebar-tasks-panel"
        role="tabpanel"
      >
        <VscodeProcessTasksPanel {...vscodeProcessTasks} />
      </div>
    </>
  );
}

function keyboardTargetView(
  event: KeyboardEvent<HTMLButtonElement>,
  current: "scripts" | "tasks",
): "scripts" | "tasks" | null {
  if (event.key === "Home") return "scripts";
  if (event.key === "End") return "tasks";
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    return current === "scripts" ? "tasks" : "scripts";
  }
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    return current === "tasks" ? "scripts" : "tasks";
  }
  return null;
}
