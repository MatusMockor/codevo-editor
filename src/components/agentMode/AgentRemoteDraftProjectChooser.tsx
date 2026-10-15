import "./agentRemoteDraftProjectChooser.css";
import "../projects/projectBanners.css";
import { ChevronRight, Folder, Plus, Search, Server } from "lucide-react";
import { useState } from "react";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { Spinner } from "../../ui/foundation/Spinner";
import { useRemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import { AgentRemoteCounterpartRow } from "./AgentRemoteCounterpartRow";

const FILTER_PROJECT_THRESHOLD = 6;
const MAX_FILTER_CHARS = 120;
const MAX_PROJECT_ROWS = 64;

type Projects = ReadonlyArray<AgentProjectDescriptor>;

export function AgentRemoteDraftProjectChooser({
  projects,
  onSelect,
  onAddProject,
  counterpart = null,
  onAddCounterpart,
  cloneRunning = false,
}: {
  readonly projects: Projects;
  readonly onSelect: (project: AgentProjectDescriptor) => void;
  readonly onAddProject?: () => void;
  readonly counterpart?: AgentProjectDescriptor | null;
  readonly onAddCounterpart?: (initialPath: string | null) => void;
  readonly cloneRunning?: boolean;
}) {
  const serverName = useSelectedServerName();
  const [filter, setFilter] = useState("");
  const available = projects.filter(isAvailable);
  const filterable = available.length > FILTER_PROJECT_THRESHOLD;
  if (!filterable && filter !== "") setFilter("");
  const shared = sharedLabels(available);
  const matching = matchingProjects(available, filter, shared);
  const offered = onAddCounterpart === undefined ? null : counterpart;
  return (
    <section
      className="agent-session__body agent-session__body--empty cv-no-projects agent-remote-project-choice"
      aria-label="Choose server project"
    >
      <div className="agent-remote-project-choice__stack">
        {serverName !== null && (
          <p className="agent-remote-project-choice__server">
            <Server aria-hidden="true" size={12} />
            <span>{serverName}</span>
          </p>
        )}
        <h2 className="cv-no-projects__title">Choose a project</h2>
        <ChoiceIntro counterpart={offered} others={available.length > 0} />
        <div className="agent-remote-project-choice__card">
          {offered !== null && onAddCounterpart !== undefined && (
            <AgentRemoteCounterpartRow onAdd={onAddCounterpart} project={offered} />
          )}
          {filterable && <ProjectFilter value={filter} onChange={setFilter} />}
          <ProjectList
            emptyText={
              available.length === 0
                ? "No projects on this server yet."
                : "No matching project on this server."
            }
            onSelect={onSelect}
            projects={matching}
            sharedLabels={shared}
          />
          {onAddProject !== undefined && (
            <div className="agent-remote-project-choice__footer">
              <button
                className="agent-remote-project-choice__add"
                onClick={onAddProject}
                type="button"
              >
                <Plus aria-hidden="true" size={15} />
                <span>Add project or clone repository</span>
              </button>
            </div>
          )}
        </div>
        {cloneRunning && (
          <p className="agent-remote-project-choice__status" role="status">
            <Spinner />
            Clone running. Thread unlocks when ready.
          </p>
        )}
      </div>
    </section>
  );
}

function ChoiceIntro({
  counterpart,
  others,
}: {
  readonly counterpart: AgentProjectDescriptor | null;
  readonly others: boolean;
}) {
  if (counterpart === null)
    return (
      <p className="cv-no-projects__text">
        This thread will run on this server. Pick a project to start.
      </p>
    );
  return (
    <p className="cv-no-projects__text">
      <strong>{counterpart.label}</strong> isn’t added on this server yet.
      {others ? " Add it, or pick another project." : " Add it to start."}
    </p>
  );
}

function ProjectFilter({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="agent-remote-project-choice__filter">
      <Search aria-hidden="true" size={14} />
      <input
        aria-label="Filter server projects"
        autoComplete="off"
        maxLength={MAX_FILTER_CHARS}
        onChange={(event) => onChange(event.currentTarget.value.slice(0, MAX_FILTER_CHARS))}
        placeholder="Filter projects"
        spellCheck={false}
        type="text"
        value={value}
      />
    </label>
  );
}

function ProjectList({
  projects,
  sharedLabels,
  emptyText,
  onSelect,
}: {
  readonly projects: Projects;
  readonly sharedLabels: ReadonlySet<string>;
  readonly emptyText: string;
  readonly onSelect: (project: AgentProjectDescriptor) => void;
}) {
  if (projects.length === 0) {
    return <p className="agent-remote-project-choice__empty">{emptyText}</p>;
  }
  const hiddenCount = Math.max(0, projects.length - MAX_PROJECT_ROWS);
  return (
    <>
      <ul aria-label="Server projects" className="agent-remote-project-choice__list">
        {projects.slice(0, MAX_PROJECT_ROWS).map((project) => (
          <li key={project.rootKey}>
            <ProjectRow
              onSelect={onSelect}
              project={project}
              showRootPath={sharedLabels.has(project.label)}
            />
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <p className="agent-remote-project-choice__more">
          {hiddenCount} more not shown, refine the filter
        </p>
      )}
    </>
  );
}

function ProjectRow({
  project,
  showRootPath,
  onSelect,
}: {
  readonly project: AgentProjectDescriptor;
  readonly showRootPath: boolean;
  readonly onSelect: (project: AgentProjectDescriptor) => void;
}) {
  return (
    <button
      className="agent-remote-project-choice__row"
      data-project-root-key={project.rootKey}
      onClick={() => onSelect(project)}
      type="button"
    >
      <Folder aria-hidden="true" size={15} />
      <span className="agent-remote-project-choice__name">
        <strong>{project.label}</strong>
        {showRootPath && (
          <small title={project.rootPath}>
            <bdi>{project.rootPath}</bdi>
          </small>
        )}
      </span>
      <ChevronRight aria-hidden="true" className="agent-remote-project-choice__go" size={14} />
    </button>
  );
}

function useSelectedServerName(): string | null {
  const remote = useRemoteRunnerContext();
  if (remote === null) return null;
  return remote.servers.find((server) => server.id === remote.selectedServerId)?.name ?? null;
}

function isAvailable(project: AgentProjectDescriptor): boolean {
  return project.trust === "trusted" && project.origin !== "closed-tab-live-tasks";
}

function matchingProjects(
  projects: Projects,
  filter: string,
  shared: ReadonlySet<string>,
): Projects {
  const needle = filter.trim().toLowerCase();
  if (needle === "") return projects;
  return projects.filter((project) => searchText(project, shared).toLowerCase().includes(needle));
}

function searchText(project: AgentProjectDescriptor, shared: ReadonlySet<string>): string {
  if (!shared.has(project.label)) return project.label;
  return `${project.label} ${project.rootPath}`;
}

function sharedLabels(projects: Projects): ReadonlySet<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const { label } of projects) {
    if (seen.has(label)) shared.add(label);
    seen.add(label);
  }
  return shared;
}
