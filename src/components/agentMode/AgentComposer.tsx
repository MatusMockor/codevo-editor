import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Folder, FolderGit2, Play, Plus, Send, X } from "lucide-react";
import {
  useAgentModelFavorites,
  type AgentModelFavoritesPersistence,
} from "../../application/useAgentModelFavorites";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AgentContextCompactionOffer } from "../../domain/agentContextCompaction";
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
import { AgentLaunchControls } from "./AgentLaunchControls";
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
  readonly compactionOffer?: AgentContextCompactionOffer | null;
  readonly modelFavoritesPersistence?: AgentModelFavoritesPersistence | null;
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
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly providerManagement?: AgentProviderManagementSurface | null;
  onSelectRepository(repositoryRoot: string): void;
  onPromptChange(prompt: string): void;
  onIsolationChange(isolation: AgentTaskIsolation): void;
  onUnsafeConfirmedChange(confirmed: boolean): void;
  onLaunchChange(launch: AgentLaunchOptions): void;
  onDangerousConfirmedChange(confirmed: boolean): void;
  onNewThread(): void;
  onOpenProviderSettings(): void;
  onSubmit(submission: AgentComposerSubmission): void;
  onCompactContext?(submission: AgentComposerSubmission): void;
}

export function AgentComposer({
  compactionOffer = null,
  dangerousConfirmed,
  dispatching,
  guard,
  isolation,
  isolationReason,
  launch,
  launchProvider,
  modelFavoritesPersistence = null,
  mode,
  onDangerousConfirmedChange,
  onIsolationChange,
  onLaunchChange,
  onNewThread,
  onOpenProviderSettings,
  onPromptChange,
  onSelectRepository,
  onSubmit,
  onCompactContext,
  onUnsafeConfirmedChange,
  prompt,
  promptBytes,
  providerEnabled,
  providerManagement = null,
  submitBlocked,
  target,
  unsafeConfirmed,
  worktreeOnly,
  worktreeOnlyReason,
}: AgentComposerProps) {
  const composerRef = useRef<HTMLFormElement>(null);
  const compact = useCompactComposerControls(composerRef);
  const favorites = useAgentModelFavorites(modelFavoritesPersistence);
  const [dismissedCompactionKey, setDismissedCompactionKey] = useState<string | null>(null);
  const followUp = mode.kind === "followUp";
  const blockedReason = mode.kind === "followUp" ? mode.blockedReason : null;
  const targetReason = composerTargetReason(followUp, target);
  const effectiveLaunch =
    launch.provider === launchProvider ? launch : defaultAgentLaunchOptions(launchProvider);
  const dangerousLaunch = agentLaunchIsDangerous(effectiveLaunch);
  const dangerousLaunchConfirmed = dangerousLaunch && dangerousConfirmed;
  const providerReason =
    providerEnabled[effectiveLaunch.provider] === false
      ? "Enable an agent provider in Settings before starting a turn."
      : null;
  const allProvidersDisabled = !providerEnabled.claudeCode && !providerEnabled.codex;
  const blocked =
    submitBlocked ||
    providerReason !== null ||
    blockedReason !== null ||
    targetReason !== null ||
    (dangerousLaunch && !dangerousLaunchConfirmed);
  const shortcut = agentSubmitShortcut();
  const caption = composerCaption({
    blockedReason,
    isolationReason,
    providerReason,
    targetReason,
    worktreeOnly,
    worktreeOnlyReason,
  });

  const launchControls = (
    <AgentLaunchControls
      dangerousConfirmed={dangerousConfirmed}
      disabled={dispatching || allProvidersDisabled}
      favorites={favorites}
      launch={effectiveLaunch}
      onLaunchChange={onLaunchChange}
      onDangerousConfirmedChange={onDangerousConfirmedChange}
      providerEnabled={providerEnabled}
      providerManagement={providerManagement}
    />
  );

  const targetControls = followUp ? null : (
    <>
      <AgentComposerCheckout
        disabled={dispatching || worktreeOnly || allProvidersDisabled}
        guard={guard}
        isolation={isolation}
        onIsolationChange={onIsolationChange}
        onUnsafeConfirmedChange={onUnsafeConfirmedChange}
        unsafeConfirmed={unsafeConfirmed}
      />
      <AgentComposerRepository
        disabled={dispatching || allProvidersDisabled}
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
      ref={composerRef}
    >
      {compactionOffer !== null &&
        compactionOffer.key !== dismissedCompactionKey &&
        onCompactContext !== undefined && (
          <div className="agent-compaction-offer">
            <div className="agent-compaction-offer__copy">
              <strong>Resume with less context</strong>
              <span>
                {formatContextTokens(compactionOffer.contextTokens)} tokens from an older session
              </span>
            </div>
            <button
              className="agent-compaction-offer__action"
              disabled={blocked}
              onClick={() =>
                onCompactContext({ launch: effectiveLaunch, dangerousLaunchConfirmed })
              }
              type="button"
            >
              Compact
            </button>
            <button
              aria-label="Dismiss context compaction suggestion"
              className="agent-compaction-offer__dismiss"
              onClick={() => setDismissedCompactionKey(compactionOffer.key)}
              type="button"
            >
              <X aria-hidden="true" size={14} />
            </button>
          </div>
        )}
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
          disabled={allProvidersDisabled}
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

        <div className="agent-composer__row">
          {compact ? (
            <AgentComposerCompactMenu
              disabled={dispatching || allProvidersDisabled}
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

        {caption && (
          <p className="agent-composer__reason">
            <span>{caption}</span>
            {providerReason === null ? null : (
              <button onClick={onOpenProviderSettings} type="button">
                Open provider settings
              </button>
            )}
          </p>
        )}

        {(followUp || !compact) && <div className="agent-composer__footer">{footer}</div>}
      </div>
    </form>
  );
}

function formatContextTokens(tokens: number): string {
  return tokens >= 1_000 ? `${Math.round(tokens / 1_000)}k` : String(tokens);
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
  guard,
  isolation,
  onIsolationChange,
  onUnsafeConfirmedChange,
  unsafeConfirmed,
}: {
  readonly isolation: AgentTaskIsolation;
  readonly disabled: boolean;
  readonly guard: InPlaceDispatchGuard;
  readonly unsafeConfirmed: boolean;
  onIsolationChange(isolation: AgentTaskIsolation): void;
  onUnsafeConfirmedChange(confirmed: boolean): void;
}) {
  const unsafeGuard = guard.kind === "unsafe";
  const unsafeSelected = isolation === "in-place" && unsafeGuard;
  const options = unsafeGuard
    ? CHECKOUT_OPTIONS.map((option) =>
        option.value === "in-place"
          ? agentPickerOption(
              option.value,
              option.label,
              `Runs in the project's own checkout; ${guard.reasons
                .map(inPlaceGuardReasonLabel)
                .join(", ")}.`,
              "danger",
            )
          : option,
      )
    : CHECKOUT_OPTIONS;
  return (
    <AgentPickerMenu
      align="start"
      confirmation={
        unsafeGuard
          ? {
              id: "agent-unsafe-confirm",
              value: "in-place",
              checked: unsafeConfirmed,
              disabled,
              label: "Accept the risk and run locally",
              description: "The agent can overwrite uncommitted or unsaved work.",
              onChange: onUnsafeConfirmedChange,
            }
          : null
      }
      describedBy={null}
      disabled={disabled}
      icon={isolationGlyph(isolation)}
      id={CHECKOUT_ID}
      label="Checkout for this thread"
      onChange={(value) => changeIsolation(value, onIsolationChange)}
      options={options}
      prefix={null}
      tone={unsafeSelected ? "danger" : null}
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
  providerReason,
  targetReason,
  worktreeOnly,
  worktreeOnlyReason,
}: {
  readonly blockedReason: string | null;
  readonly isolationReason: string | null;
  readonly providerReason: string | null;
  readonly targetReason: string | null;
  readonly worktreeOnly: boolean;
  readonly worktreeOnlyReason: string | null;
}): string | null {
  if (blockedReason !== null) return blockedReason;
  if (providerReason !== null) return providerReason;
  if (targetReason !== null) return targetReason;
  if (worktreeOnly) return worktreeOnlyReason;
  return isolationReason;
}
