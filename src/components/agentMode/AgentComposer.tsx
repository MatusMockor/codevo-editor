import { type FormEvent, type KeyboardEvent } from "react";
import { Play, TriangleAlert } from "lucide-react";
import {
  MAX_AGENT_TASK_PROMPT_BYTES,
  type AgentTaskIsolation,
  type InPlaceDispatchGuard,
} from "../../domain/agentTask";
import { inPlaceGuardReasonLabel } from "../../application/useAgentTasks";

export interface AgentComposerRepositoryOption {
  readonly repositoryRoot: string;
  readonly label: string;
}

export interface AgentComposerProjectOption {
  readonly projectRootKey: string;
  readonly label: string;
  readonly repositories: ReadonlyArray<AgentComposerRepositoryOption>;
}

export interface AgentComposerProps {
  readonly projects: ReadonlyArray<AgentComposerProjectOption>;
  readonly selectedProjectRootKey: string | null;
  readonly selectedRepositoryRoot: string | null;
  readonly prompt: string;
  readonly promptBytes: number;
  readonly isolation: AgentTaskIsolation;
  readonly isolationReason: string | null;
  readonly worktreeOnly: boolean;
  readonly worktreeOnlyReason: string | null;
  readonly guard: InPlaceDispatchGuard;
  readonly unsafeConfirmed: boolean;
  readonly dispatching: boolean;
  readonly submitBlocked: boolean;
  onSelectProject(projectRootKey: string): void;
  onSelectRepository(repositoryRoot: string): void;
  onPromptChange(prompt: string): void;
  onIsolationChange(isolation: AgentTaskIsolation): void;
  onUnsafeConfirmedChange(confirmed: boolean): void;
  onSubmit(): void;
}

export function AgentComposer({
  dispatching,
  guard,
  isolation,
  isolationReason,
  onIsolationChange,
  onPromptChange,
  onSelectProject,
  onSelectRepository,
  onSubmit,
  onUnsafeConfirmedChange,
  projects,
  prompt,
  promptBytes,
  selectedProjectRootKey,
  selectedRepositoryRoot,
  submitBlocked,
  unsafeConfirmed,
  worktreeOnly,
  worktreeOnlyReason,
}: AgentComposerProps) {
  const promptTooLong = promptBytes > MAX_AGENT_TASK_PROMPT_BYTES;
  const unsafeInPlace = isolation === "in-place" && guard.kind === "unsafe";
  const selectedProject =
    projects.find((project) => project.projectRootKey === selectedProjectRootKey) ?? null;
  const repositories = selectedProject?.repositories ?? [];
  const selectedRepository =
    repositories.find((repository) => repository.repositoryRoot === selectedRepositoryRoot) ?? null;
  const caption = worktreeOnly ? worktreeOnlyReason : isolationReason;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter") return;
    if (!event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    if (submitBlocked) return;
    onSubmit();
  };

  return (
    <form aria-label="New agent thread" className="agent-composer" onSubmit={submit}>
      <div className="agent-composer__box">
        <label className="agent-visually-hidden" htmlFor="agent-prompt">
          Prompt
        </label>
        <textarea
          className="agent-composer__textarea"
          id="agent-prompt"
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Describe the change you want the agent to make"
          value={prompt}
        />

        {unsafeInPlace && guard.kind === "unsafe" && (
          <div className="agent-composer__unsafe">
            <span className="agent-composer__unsafe-title">
              <TriangleAlert aria-hidden="true" size={12} />
              Running in place can overwrite your work
            </span>
            <ul className="agent-composer__unsafe-reasons">
              {guard.reasons.map((reason) => (
                <li key={reason}>{inPlaceGuardReasonLabel(reason)}</li>
              ))}
            </ul>
            <label className="agent-composer__checkbox" htmlFor="agent-unsafe-confirm">
              <input
                checked={unsafeConfirmed}
                id="agent-unsafe-confirm"
                onChange={(event) => onUnsafeConfirmedChange(event.target.checked)}
                type="checkbox"
              />
              Start in this repository anyway and accept the risk
            </label>
          </div>
        )}

        <div className="agent-composer__row">
          <AgentComposerTarget
            project={selectedProject}
            projectPicked={projects.length > 1}
            repositories={repositories}
            repository={selectedRepository}
            repositoryPicked={repositories.length > 1}
          />

          {projects.length > 1 && (
            <>
              <label className="agent-visually-hidden" htmlFor="agent-project">
                Project
              </label>
              <select
                className="agent-composer__repo"
                id="agent-project"
                onChange={(event) => onSelectProject(event.target.value)}
                value={selectedProject?.projectRootKey ?? ""}
              >
                {projects.map((project) => (
                  <option key={project.projectRootKey} value={project.projectRootKey}>
                    {project.label}
                  </option>
                ))}
              </select>
            </>
          )}

          {repositories.length > 1 && (
            <>
              <label className="agent-visually-hidden" htmlFor="agent-repository">
                Repository
              </label>
              <select
                className="agent-composer__repo"
                id="agent-repository"
                onChange={(event) => onSelectRepository(event.target.value)}
                value={selectedRepository?.repositoryRoot ?? ""}
              >
                {repositories.map((repository) => (
                  <option key={repository.repositoryRoot} value={repository.repositoryRoot}>
                    {repository.label}
                  </option>
                ))}
              </select>
            </>
          )}

          <span aria-hidden="true" className="agent-composer__vsep" />

          <label className="agent-composer__isolation" htmlFor="agent-isolation">
            <input
              checked={isolation === "worktree"}
              disabled={worktreeOnly}
              id="agent-isolation"
              onChange={(event) =>
                onIsolationChange(event.target.checked ? "worktree" : "in-place")
              }
              type="checkbox"
            />
            <span className="agent-composer__isolation-label">
              {isolation === "worktree" ? "Isolated worktree" : "In place"}
            </span>
          </label>

          <span className="agent-composer__spacer" />

          <span
            className={
              promptTooLong
                ? "agent-composer__bytes agent-composer__bytes--over agent-num"
                : "agent-composer__bytes agent-num"
            }
          >
            {promptBytes} / {MAX_AGENT_TASK_PROMPT_BYTES} bytes
          </span>

          <button className="agent-composer__send" disabled={submitBlocked} type="submit">
            <Play aria-hidden="true" size={12} />
            {dispatching ? "Starting…" : "Start agent"}
          </button>
        </div>

        {caption && <p className="agent-composer__reason">{caption}</p>}
      </div>
    </form>
  );
}

function AgentComposerTarget({
  project,
  projectPicked,
  repositories,
  repository,
  repositoryPicked,
}: {
  readonly project: AgentComposerProjectOption | null;
  readonly projectPicked: boolean;
  readonly repositories: ReadonlyArray<AgentComposerRepositoryOption>;
  readonly repository: AgentComposerRepositoryOption | null;
  readonly repositoryPicked: boolean;
}) {
  if (project === null) {
    return <span className="agent-composer__chip agent-composer__chip--empty">No project</span>;
  }

  if (repositories.length === 0) {
    return (
      <span className="agent-composer__chip agent-composer__chip--empty">
        No Git repository detected
      </span>
    );
  }

  const projectLabel = projectPicked ? null : project.label;
  const repositoryLabel =
    repositoryPicked || repository === null || repository.label === project.label
      ? null
      : repository.label;

  if (projectLabel === null && repositoryLabel === null) {
    return null;
  }

  return (
    <span className="agent-composer__chip">
      {projectLabel !== null && (
        <span className="agent-composer__chip-project">{projectLabel}</span>
      )}
      {projectLabel !== null && repositoryLabel !== null && (
        <span aria-hidden="true" className="agent-composer__chip-sep">
          /
        </span>
      )}
      {repositoryLabel !== null && (
        <span className="agent-composer__chip-repo">{repositoryLabel}</span>
      )}
    </span>
  );
}
