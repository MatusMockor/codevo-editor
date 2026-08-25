import { type FormEvent, type KeyboardEvent } from "react";
import { Play, Plus, Send, TriangleAlert } from "lucide-react";
import {
  agentLaunchIsDangerous,
  defaultAgentLaunchOptions,
  type AgentLaunchOptions,
} from "../../domain/agentLaunch";
import {
  MAX_AGENT_TASK_PROMPT_BYTES,
  type AgentCliKind,
  type AgentTaskIsolation,
  type InPlaceDispatchGuard,
} from "../../domain/agentTask";
import { AgentLaunchControls, AgentLaunchWarning } from "./AgentLaunchControls";
import { formatAgentPromptBytes, inPlaceGuardReasonLabel } from "./agentModePresentation";
import { agentSubmitShortcut } from "./agentSubmitShortcut";

export interface AgentComposerRepositoryOption {
  readonly repositoryRoot: string;
  readonly label: string;
}

export interface AgentComposerProjectOption {
  readonly projectRootKey: string;
  readonly label: string;
  readonly repositories: ReadonlyArray<AgentComposerRepositoryOption>;
}

export type AgentComposerMode =
  | { readonly kind: "new" }
  | {
      readonly kind: "followUp";
      readonly threadTitle: string;
      readonly blockedReason: string | null;
    };

export interface AgentComposerSubmission {
  readonly launch: AgentLaunchOptions;
  readonly dangerousLaunchConfirmed: boolean;
}

export interface AgentComposerProps {
  readonly mode: AgentComposerMode;
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
  readonly launch: AgentLaunchOptions;
  readonly launchProvider: AgentCliKind;
  readonly dangerousConfirmed: boolean;
  readonly dispatching: boolean;
  readonly submitBlocked: boolean;
  onSelectProject(projectRootKey: string): void;
  onSelectRepository(repositoryRoot: string): void;
  onPromptChange(prompt: string): void;
  onIsolationChange(isolation: AgentTaskIsolation): void;
  onUnsafeConfirmedChange(confirmed: boolean): void;
  onLaunchChange(launch: AgentLaunchOptions): void;
  onDangerousConfirmedChange(confirmed: boolean): void;
  onNewThread(): void;
  onSubmit(submission: AgentComposerSubmission): void;
}

export function AgentComposer({
  dangerousConfirmed,
  dispatching,
  guard,
  isolation,
  isolationReason,
  launch,
  launchProvider,
  mode,
  onDangerousConfirmedChange,
  onIsolationChange,
  onLaunchChange,
  onNewThread,
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
  const followUp = mode.kind === "followUp";
  const blockedReason = mode.kind === "followUp" ? mode.blockedReason : null;
  const unsafeInPlace = !followUp && isolation === "in-place" && guard.kind === "unsafe";
  const selectedProject =
    projects.find((project) => project.projectRootKey === selectedProjectRootKey) ?? null;
  const repositories = selectedProject?.repositories ?? [];
  const selectedRepository =
    repositories.find((repository) => repository.repositoryRoot === selectedRepositoryRoot) ?? null;
  const effectiveLaunch =
    launch.provider === launchProvider ? launch : defaultAgentLaunchOptions(launchProvider);
  const dangerousLaunch = agentLaunchIsDangerous(effectiveLaunch);
  const dangerousLaunchConfirmed = dangerousLaunch && dangerousConfirmed;
  const blocked =
    submitBlocked || blockedReason !== null || (dangerousLaunch && !dangerousLaunchConfirmed);
  const shortcut = agentSubmitShortcut();
  const caption = composerCaption({
    blockedReason,
    isolationReason,
    worktreeOnly,
    worktreeOnlyReason,
  });

  const dispatch = (): void => {
    onSubmit({ launch: effectiveLaunch, dangerousLaunchConfirmed });
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (blocked) return;
    dispatch();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter") return;
    if (!event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    if (blocked) return;
    dispatch();
  };

  return (
    <form
      aria-label={followUp ? "Follow up on agent thread" : "New agent thread"}
      className="agent-composer"
      onSubmit={submit}
    >
      <div className="agent-composer__box">
        <div className="agent-composer__context">
          {followUp && (
            <>
              <span className="agent-composer__context-label">Replying in</span>
              <span className="agent-composer__chip agent-composer__chip--thread">
                {mode.threadTitle}
              </span>
              <span className="agent-composer__spacer" />
              <button className="agent-composer__new" onClick={onNewThread} type="button">
                <Plus aria-hidden="true" size={12} /> New thread
              </button>
            </>
          )}

          {!followUp && (
            <>
              <span className="agent-composer__context-label">Starting in</span>
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
              <span className="agent-composer__spacer" />
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
            </>
          )}
        </div>

        <label className="agent-visually-hidden" htmlFor="agent-prompt">
          Prompt
        </label>
        <textarea
          className="agent-composer__textarea"
          id="agent-prompt"
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            followUp
              ? "Reply to the agent in this thread"
              : "Describe the change you want the agent to make"
          }
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

        <AgentLaunchWarning
          confirmed={dangerousConfirmed}
          launch={effectiveLaunch}
          onConfirmedChange={onDangerousConfirmedChange}
        />

        <div className="agent-composer__row">
          <AgentLaunchControls
            disabled={dispatching}
            launch={effectiveLaunch}
            onLaunchChange={onLaunchChange}
          />

          <span className="agent-composer__spacer" />

          <AgentComposerBytes promptBytes={promptBytes} />

          <button
            aria-keyshortcuts={shortcut.keys}
            className="agent-composer__send"
            disabled={blocked}
            type="submit"
          >
            {followUp ? (
              <Send aria-hidden="true" size={12} />
            ) : (
              <Play aria-hidden="true" size={12} />
            )}
            {submitLabel(dispatching, followUp)}
            <kbd aria-hidden="true" className="agent-composer__kbd">
              {shortcut.glyphs}
            </kbd>
          </button>
        </div>

        {caption && <p className="agent-composer__reason">{caption}</p>}
      </div>
    </form>
  );
}

const BYTES_WARN_RATIO = 0.8;

function AgentComposerBytes({ promptBytes }: { readonly promptBytes: number }) {
  if (promptBytes < MAX_AGENT_TASK_PROMPT_BYTES * BYTES_WARN_RATIO) return null;
  const over = promptBytes > MAX_AGENT_TASK_PROMPT_BYTES;
  return (
    <span
      aria-label={`${promptBytes} of ${MAX_AGENT_TASK_PROMPT_BYTES} bytes`}
      className={
        over
          ? "agent-composer__bytes agent-composer__bytes--over agent-num"
          : "agent-composer__bytes agent-num"
      }
    >
      {formatAgentPromptBytes(promptBytes)} / {formatAgentPromptBytes(MAX_AGENT_TASK_PROMPT_BYTES)}
    </span>
  );
}

function submitLabel(dispatching: boolean, followUp: boolean): string {
  if (followUp) return dispatching ? "Sending…" : "Send";
  return dispatching ? "Starting…" : "Start agent";
}

function composerCaption({
  blockedReason,
  isolationReason,
  worktreeOnly,
  worktreeOnlyReason,
}: {
  readonly blockedReason: string | null;
  readonly isolationReason: string | null;
  readonly worktreeOnly: boolean;
  readonly worktreeOnlyReason: string | null;
}): string | null {
  if (blockedReason !== null) return blockedReason;
  if (worktreeOnly) return worktreeOnlyReason;
  return isolationReason;
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
