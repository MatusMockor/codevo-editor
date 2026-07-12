import { Circle, X } from "lucide-react";
import { memo } from "react";
import type { MouseEvent } from "react";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

interface ProjectTabsProps {
  activeRoot: string | null;
  dirtyCount: number;
  onActivate(path: string): void;
  onClose(path: string): void;
  workspaceTabs: string[];
}

function ProjectTabsComponent({
  activeRoot,
  dirtyCount,
  onActivate,
  onClose,
  workspaceTabs,
}: ProjectTabsProps) {
  if (workspaceTabs.length <= 1) {
    return null;
  }

  function handleAuxClick(path: string, event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onClose(path);
  }

  return (
    <nav aria-label="Open projects" className="project-tabs">
      {workspaceTabs.map((path) => {
        const active = workspaceRootKeysEqual(path, activeRoot);
        const dirty = active && dirtyCount > 0;
        const label = workspaceTabLabel(path);

        return (
          <div
            className={active ? "project-tab active" : "project-tab"}
            key={path}
            onAuxClick={(event) => handleAuxClick(path, event)}
          >
            <button
              aria-current={active ? "page" : undefined}
              aria-label={dirty ? `${label} (unsaved changes)` : undefined}
              className="project-tab-main"
              onClick={() => onActivate(path)}
              title={path}
              type="button"
            >
              {dirty ? (
                <Circle aria-hidden="true" className="dirty-dot" size={8} />
              ) : null}
              <span>{label}</span>
            </button>
            <button
              aria-label={`Close ${label}`}
              className="project-tab-close"
              onClick={() => onClose(path)}
              title="Close project"
              type="button"
            >
              <X aria-hidden="true" size={13} />
            </button>
          </div>
        );
      })}
    </nav>
  );
}

export const ProjectTabs = memo(ProjectTabsComponent);

function workspaceTabLabel(path: string): string {
  const normalized = path.trim().split("\\").join("/");
  const parts = normalized.split("/").filter(Boolean);

  return parts[parts.length - 1] || normalized || "Workspace";
}
