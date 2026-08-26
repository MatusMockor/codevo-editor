import { type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Folder, FolderGit2, Play, Plus, Send, TriangleAlert } from "lucide-react";
import { useAgentModelFavorites } from "../../application/useAgentModelFavorites";
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
import { AgentComposerCompactMenu } from "./AgentComposerCompactMenu";
import { AgentLaunchControls, AgentLaunchWarning } from "./AgentLaunchControls";
import { agentLaunchMetaLabel } from "./agentLaunchPresentation";
import { formatAgentPromptBytes, inPlaceGuardReasonLabel } from "./agentModePresentation";
import { AgentPickerMenu } from "./AgentPickerMenu";
import { agentPickerOption, type AgentPickerOption } from "./agentPickerOption";
import { agentSubmitShortcut } from "./agentSubmitShortcut";
import { useCompactComposerControls } from "./useCompactComposerControls";

const CHECKOUT_ID = "agent-checkout";
const REPOSITORY_ID = "agent-repository";
const NO_TARGET_REASON = "Choose a project in the rail to start a thread.";

const CHECKOUT_OPTIONS: ReadonlyArray<AgentPickerOption> = [
  agentPickerOption("in-place", "Local checkout", "Runs in the project's own checkout."),
  agentPickerOption("worktree", "Isolated worktree", "Runs in a new git worktree."),
];

export interface AgentComposerRepositoryOption {
  readonly repositoryRoot: string;
  readonly label: string;
}

export interface AgentComposerTarget {
  readonly projectLabel: string;
  readonly repositoryOptions: ReadonlyArray<AgentComposerRepositoryOption>;
  readonly selectedRepositoryRoot: string | null;
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
  readonly target: AgentComposerTarget | null;
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
  onSelectRepository,
  onSubmit,
  onUnsafeConfirmedChange,
  prompt,
  promptBytes,
  submitBlocked,
  target,
  unsafeConfirmed,
  worktreeOnly,
  worktreeOnlyReason,
}: AgentComposerProps) {
  const compact = useCompactComposerControls();
  const favorites = useAgentModelFavorites();
  const followUp = mode.kind === "followUp";
  const blockedReason = mode.kind === "followUp" ? mode.blockedReason : null;
  const targetReason = composerTargetReason(followUp, target);
  const unsafeInPlace = !followUp && isolation === "in-place" && guard.kind === "unsafe";
  const effectiveLaunch =
    launch.provider === launchProvider ? launch : defaultAgentLaunchOptions(launchProvider);
  const dangerousLaunch = agentLaunchIsDangerous(effectiveLaunch);
  const dangerousLaunchConfirmed = dangerousLaunch && dangerousConfirmed;
  const blocked =
    submitBlocked ||
    blockedReason !== null ||
    targetReason !== null ||
    (dangerousLaunch && !dangerousLaunchConfirmed);
  const shortcut = agentSubmitShortcut();
  const caption = composerCaption({
    blockedReason,
    isolationReason,
    targetReason,
    worktreeOnly,
    worktreeOnlyReason,
  });

  const launchControls = (
    <AgentLaunchControls
      disabled={dispatching}
      favorites={favorites}
      launch={effectiveLaunch}
      onLaunchChange={onLaunchChange}
    />
  );

  const targetControls = followUp ? null : (
    <>
      <AgentComposerCheckout
        disabled={dispatching || worktreeOnly}
        isolation={isolation}
        onIsolationChange={onIsolationChange}
      />
      <AgentComposerRepository
        disabled={dispatching}
        onSelectRepository={onSelectRepository}
        target={target}
      />
    </>
  );

  const footer = followUp ? <AgentComposerLockedCheckout isolation={isolation} /> : targetControls;

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
        {followUp && (
          <div className="agent-composer__context">
            <span className="agent-composer__context-label">Replying in</span>
            <span className="agent-composer__chip agent-composer__chip--thread">
              {mode.threadTitle}
            </span>
            <span className="agent-composer__spacer" />
            <button className="agent-composer__new" onClick={onNewThread} type="button">
              <Plus aria-hidden="true" size={12} /> New thread
            </button>
          </div>
        )}

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
              : "Ask anything or describe the change you want"
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
          {compact ? (
            <AgentComposerCompactMenu
              disabled={dispatching}
              summary={agentLaunchMetaLabel(effectiveLaunch)}
            >
              {launchControls}
              {targetControls}
            </AgentComposerCompactMenu>
          ) : (
            launchControls
          )}

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

        {(followUp || !compact) && <div className="agent-composer__footer">{footer}</div>}
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

function AgentComposerCheckout({
  disabled,
  isolation,
  onIsolationChange,
}: {
  readonly isolation: AgentTaskIsolation;
  readonly disabled: boolean;
  onIsolationChange(isolation: AgentTaskIsolation): void;
}) {
  return (
    <AgentPickerMenu
      align="start"
      describedBy={null}
      disabled={disabled}
      icon={isolationGlyph(isolation)}
      id={CHECKOUT_ID}
      label="Checkout for this thread"
      onChange={(value) => changeIsolation(value, onIsolationChange)}
      options={CHECKOUT_OPTIONS}
      prefix={null}
      tone={null}
      value={isolation}
      variant="ghost"
    />
  );
}

function AgentComposerLockedCheckout({ isolation }: { readonly isolation: AgentTaskIsolation }) {
  return (
    <span className="agent-composer__lock">
      <span aria-hidden="true" className="agent-composer__lock-glyph">
        {isolationGlyph(isolation)}
      </span>
      <span className="agent-visually-hidden">Checkout:</span>
      {isolationLabel(isolation)}
    </span>
  );
}

function AgentComposerRepository({
  disabled,
  onSelectRepository,
  target,
}: {
  readonly target: AgentComposerTarget | null;
  readonly disabled: boolean;
  onSelectRepository(repositoryRoot: string): void;
}) {
  if (target === null) return null;
  if (target.repositoryOptions.length < 2) return null;

  return (
    <AgentPickerMenu
      align="start"
      describedBy={null}
      disabled={disabled}
      id={REPOSITORY_ID}
      label={`Repository in ${target.projectLabel}`}
      onChange={onSelectRepository}
      options={target.repositoryOptions.map((option) =>
        agentPickerOption(option.repositoryRoot, option.label),
      )}
      prefix="Repo"
      tone={null}
      value={target.selectedRepositoryRoot ?? ""}
      variant="ghost"
    />
  );
}

function changeIsolation(
  value: string,
  onIsolationChange: (isolation: AgentTaskIsolation) => void,
): void {
  if (value !== "in-place" && value !== "worktree") return;
  onIsolationChange(value);
}

function isolationGlyph(isolation: AgentTaskIsolation): ReactNode {
  if (isolation === "worktree") return <FolderGit2 size={12} />;
  return <Folder size={12} />;
}

function isolationLabel(isolation: AgentTaskIsolation): string {
  if (isolation === "worktree") return "Isolated worktree";
  return "Local checkout";
}

function submitLabel(dispatching: boolean, followUp: boolean): string {
  if (followUp) return dispatching ? "Sending…" : "Send";
  return dispatching ? "Starting…" : "Start agent";
}

function composerTargetReason(
  followUp: boolean,
  target: AgentComposerTarget | null,
): string | null {
  if (followUp) return null;
  if (target === null) return NO_TARGET_REASON;
  if (target.repositoryOptions.length === 0) {
    return `No Git repository detected in ${target.projectLabel}.`;
  }
  return null;
}

function composerCaption({
  blockedReason,
  isolationReason,
  targetReason,
  worktreeOnly,
  worktreeOnlyReason,
}: {
  readonly blockedReason: string | null;
  readonly isolationReason: string | null;
  readonly targetReason: string | null;
  readonly worktreeOnly: boolean;
  readonly worktreeOnlyReason: string | null;
}): string | null {
  if (blockedReason !== null) return blockedReason;
  if (targetReason !== null) return targetReason;
  if (worktreeOnly) return worktreeOnlyReason;
  return isolationReason;
}
