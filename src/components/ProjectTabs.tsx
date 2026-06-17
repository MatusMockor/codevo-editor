import { X } from "lucide-react";

interface ProjectTabsProps {
  activeRoot: string | null;
  onActivate(path: string): void;
  onClose(path: string): void;
  workspaceTabs: string[];
}

export function ProjectTabs({
  activeRoot,
  onActivate,
  onClose,
  workspaceTabs,
}: ProjectTabsProps) {
  if (workspaceTabs.length <= 1) {
    return null;
  }

  return (
    <nav aria-label="Open projects" className="project-tabs">
      {workspaceTabs.map((path) => {
        const active = path === activeRoot;
        const label = workspaceTabLabel(path);

        return (
          <div
            className={active ? "project-tab active" : "project-tab"}
            key={path}
          >
            <button
              aria-current={active ? "page" : undefined}
              className="project-tab-main"
              onClick={() => onActivate(path)}
              title={path}
              type="button"
            >
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

function workspaceTabLabel(path: string): string {
  const normalized = path.trim().split("\\").join("/");
  const parts = normalized.split("/").filter(Boolean);

  return parts[parts.length - 1] || normalized || "Workspace";
}
