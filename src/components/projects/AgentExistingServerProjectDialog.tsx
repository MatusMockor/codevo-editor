import { FolderOpen } from "lucide-react";
import "../agentMode/remoteAddProject/remoteAddProject.css";

export function AgentExistingServerProjectDialog({
  projects,
  onClose,
  onSelect,
}: {
  readonly projects: readonly { readonly key: string; readonly label: string }[];
  onClose(): void;
  onSelect(key: string): void;
}) {
  return (
    <div className="palette-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-label="Open server project"
        className="quick-open agent-remote-add-project agent-project-source"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div className="agent-remote-add-project__crumb">
          <strong>Open server project</strong>
        </div>
        <div className="quick-open-results">
          {projects.length === 0 ? (
            <p className="quick-open-state">
              No projects available on this server. Check its connection or clone a repository.
            </p>
          ) : (
            projects.slice(0, 64).map((project) => (
              <button
                className="quick-open-result"
                type="button"
                key={project.key}
                onClick={() => onSelect(project.key)}
              >
                <FolderOpen aria-hidden="true" size={17} />
                <span>{project.label}</span>
              </button>
            ))
          )}
        </div>
        <button className="agent-linkbutton" type="button" onClick={onClose}>
          Close
        </button>
      </section>
    </div>
  );
}
