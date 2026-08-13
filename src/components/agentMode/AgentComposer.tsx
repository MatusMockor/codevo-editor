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

export interface AgentComposerProps {
  readonly repositories: ReadonlyArray<AgentComposerRepositoryOption>;
  readonly selectedRepositoryRoot: string | null;
  readonly prompt: string;
  readonly promptBytes: number;
  readonly isolation: AgentTaskIsolation;
  readonly isolationReason: string | null;
  readonly guard: InPlaceDispatchGuard;
  readonly unsafeConfirmed: boolean;
  readonly dispatching: boolean;
  readonly submitBlocked: boolean;
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
  onSelectRepository,
  onSubmit,
  onUnsafeConfirmedChange,
  prompt,
  promptBytes,
  repositories,
  selectedRepositoryRoot,
  submitBlocked,
  unsafeConfirmed,
}: AgentComposerProps) {
  const promptTooLong = promptBytes > MAX_AGENT_TASK_PROMPT_BYTES;
  const unsafeInPlace = isolation === "in-place" && guard.kind === "unsafe";

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
          <label className="agent-visually-hidden" htmlFor="agent-repository">
            Repository
          </label>
          <select
            className="agent-composer__repo"
            id="agent-repository"
            onChange={(event) => onSelectRepository(event.target.value)}
            value={selectedRepositoryRoot ?? ""}
          >
            {repositories.length === 0 && <option value="">No Git repository detected</option>}
            {repositories.map((repository) => (
              <option key={repository.repositoryRoot} value={repository.repositoryRoot}>
                {repository.label}
              </option>
            ))}
          </select>

          <span aria-hidden="true" className="agent-composer__vsep" />

          <label className="agent-composer__isolation" htmlFor="agent-isolation">
            <input
              checked={isolation === "worktree"}
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

        {isolationReason && <p className="agent-composer__reason">{isolationReason}</p>}
      </div>
    </form>
  );
}
