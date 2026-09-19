import { FolderOpen } from "lucide-react";
import type { RemoteAddProjectServerProject } from "../../../application/useRemoteAddProject";
import { remoteAddProjectRowClassName } from "./remoteAddProjectPresentation";

export interface RemoteAddProjectServerProjectsProps {
  readonly projects: readonly RemoteAddProjectServerProject[];
  readonly hiddenCount: number;
  readonly activeIndex: number;
  readonly listboxId: string;
  readonly optionPrefix: string;
  onActivate(key: string): void;
  onHighlight(index: number): void;
}

export function RemoteAddProjectServerProjects({
  activeIndex,
  hiddenCount,
  listboxId,
  onActivate,
  onHighlight,
  optionPrefix,
  projects,
}: RemoteAddProjectServerProjectsProps) {
  return (
    <>
      <div className="search-everywhere-section-label">Server projects</div>
      <div
        aria-label="Server projects"
        className="agent-remote-add-project__list"
        id={listboxId}
        role="listbox"
      >
        {projects.map((project, index) => (
          <button
            aria-selected={index === activeIndex}
            className={remoteAddProjectRowClassName(index === activeIndex)}
            id={`${optionPrefix}${index}`}
            key={project.key}
            onClick={() => onActivate(project.key)}
            onMouseEnter={() => onHighlight(index)}
            role="option"
            type="button"
          >
            <FolderOpen aria-hidden="true" size={15} />
            <span>
              <strong>{project.label}</strong>
            </span>
          </button>
        ))}
      </div>
      {projects.length === 0 && (
        <p className="quick-open-state">No matching project on this server.</p>
      )}
      {hiddenCount > 0 && (
        <p className="agent-remote-add-project__note">
          {hiddenCount} more not shown, refine the filter
        </p>
      )}
    </>
  );
}
