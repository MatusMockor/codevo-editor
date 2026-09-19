import "./agentRemoteDraftProjectChooser.css";
import { Plus } from "lucide-react";
import { useId } from "react";
import type { AgentProjectDescriptor } from "../../domain/agentProject";

export function AgentRemoteDraftProjectChooser({
  projects,
  onSelect,
  onOpenSettings,
  onAddProject,
  cloneRunning = false,
}: {
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly onSelect: (project: AgentProjectDescriptor) => void;
  readonly onOpenSettings?: () => void;
  readonly onAddProject?: () => void;
  readonly cloneRunning?: boolean;
}) {
  const id = useId();
  const available = projects.filter(
    (project) => project.trust === "trusted" && project.origin !== "closed-tab-live-tasks",
  );
  return (
    <section
      className="agent-session__body agent-session__body--empty agent-remote-project-choice"
      aria-label="Choose server project"
    >
      <h2 className="agent-empty__title">Choose a project on this server</h2>
      <p className="agent-empty__text">
        Choose where this thread should run. Then add your images and send your message.
      </p>
      {available.length > 0 ? (
        <>
          <label htmlFor={id}>Server project</label>
          <select
            id={id}
            value=""
            onChange={(event) => {
              const project = available.find((entry) => entry.rootKey === event.target.value);
              if (project !== undefined) onSelect(project);
            }}
          >
            <option value="" disabled>
              Choose a project…
            </option>
            {available.map((project) => (
              <option key={project.rootKey} value={project.rootKey}>
                {project.label}
                {available.filter((candidate) => candidate.label === project.label).length > 1
                  ? ` · ${project.rootPath}`
                  : ""}
              </option>
            ))}
          </select>
        </>
      ) : (
        <p className="agent-empty__text">No available projects were found on this server.</p>
      )}
      {onAddProject !== undefined && (
        <button className="agent-remote-project-choice__add" onClick={onAddProject} type="button">
          <Plus aria-hidden="true" size={15} />
          Add project or clone repository
        </button>
      )}
      {cloneRunning && (
        <p className="agent-empty__text" role="status">
          Clone running. Thread unlocks when ready.
        </p>
      )}
      {onOpenSettings !== undefined && (
        <button type="button" className="agent-linkbutton" onClick={onOpenSettings}>
          Manage server projects
        </button>
      )}
    </section>
  );
}
