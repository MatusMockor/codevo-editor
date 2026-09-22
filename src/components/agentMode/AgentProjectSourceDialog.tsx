import { useEffect, useRef, useState } from "react";
import { FolderOpen, GitBranch, Monitor, Server } from "lucide-react";
import "./remoteAddProject/remoteAddProject.css";
import type { RemoteRunnerServer } from "../../domain/remoteRunner";

interface Props {
  readonly selectedServerId: string | null;
  readonly servers: readonly RemoteRunnerServer[];
  readonly cloneBlocked?: boolean;
  readonly localCloneAvailable: boolean;
  onClose(): void;
  onChoose(serverId: string | null, action: "existing" | "clone"): void;
}

export function AgentProjectSourceDialog({
  selectedServerId,
  servers,
  localCloneAvailable,
  cloneBlocked = false,
  onClose,
  onChoose,
}: Props) {
  const [environment, setEnvironment] = useState(selectedServerId ?? "");
  const section = useRef<HTMLElement | null>(null);
  useEffect(() => {
    section.current?.focus();
  }, []);
  return (
    <div className="palette-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-label="Add project"
        ref={section}
        tabIndex={-1}
        className="quick-open agent-remote-add-project agent-project-source"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key === "Tab") {
            const controls = [
              ...event.currentTarget.querySelectorAll<HTMLElement>("button, select"),
            ].filter((control) => !control.hasAttribute("disabled"));
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (
              event.shiftKey &&
              (document.activeElement === first || document.activeElement === event.currentTarget)
            ) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="agent-remote-add-project__crumb">
          <strong>Add project</strong>
        </div>
        <label className="agent-project-source__environment">
          <span className="agent-project-source__environment-label">
            {environment === "" ? (
              <Monitor aria-hidden="true" size={15} />
            ) : (
              <Server aria-hidden="true" size={15} />
            )}
            Environment
          </span>
          <select
            aria-label="Project environment"
            value={environment}
            onChange={(event) => setEnvironment(event.currentTarget.value)}
          >
            <option value="">This computer</option>
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name}
              </option>
            ))}
          </select>
        </label>
        <div className="quick-open-results">
          <button
            className="quick-open-result"
            type="button"
            onClick={() => onChoose(environment || null, "existing")}
          >
            <FolderOpen aria-hidden="true" size={17} />
            <span>{environment === "" ? "Open existing folder" : "Open server project"}</span>
          </button>
          <button
            className="quick-open-result"
            type="button"
            disabled={cloneBlocked || (environment === "" && !localCloneAvailable)}
            onClick={() => onChoose(environment || null, "clone")}
          >
            <GitBranch aria-hidden="true" size={17} />
            <span>Clone repository</span>
          </button>
        </div>
        {cloneBlocked && (
          <p className="quick-open-state">
            Finish or dismiss the current clone before starting another.
          </p>
        )}
      </section>
    </div>
  );
}

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
