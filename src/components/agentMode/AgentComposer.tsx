import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Folder, FolderGit2, Loader2, Plus, X } from "lucide-react";
import {
  useAgentModelFavorites,
  type AgentModelFavoritesPersistence,
} from "../../application/useAgentModelFavorites";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AgentContextCompactionOffer } from "../../domain/agentContextCompaction";
import { agentLaunchIsDangerous, type AgentLaunchOptions } from "../../domain/agentLaunch";
import {
  MAX_AGENT_TASK_PROMPT_BYTES,
  type AgentCliKind,
  type AgentTaskIsolation,
  type InPlaceDispatchGuard,
} from "../../domain/agentTask";
import {
  agentComposerCheckoutChoice,
  agentComposerCheckoutOptions,
  agentComposerNestedTargetLabel,
  type AgentComposerTarget,
} from "./agentComposerCheckout";
import { AgentComposerCompactMenu } from "./AgentComposerCompactMenu";
import { defaultAgentComposerLaunch, normalizeAgentComposerLaunch } from "./agentComposerLaunch";
import { AgentLaunchControls } from "./AgentLaunchControls";
import { agentLaunchForDispatch, agentLaunchSummaryLabel } from "./agentLaunchPresentation";
import { formatAgentPromptBytes } from "./agentModePresentation";
import { AgentPickerMenu } from "./AgentPickerMenu";
import type { AgentPickerOption } from "./agentPickerOption";
import { agentSubmitShortcut } from "./agentSubmitShortcut";
import { agentControlTooltip } from "./agentThreadHeaderPresentation";
import { useCompactComposerControls } from "./useCompactComposerControls";

const CHECKOUT_ID = "agent-checkout";
const NO_TARGET_REASON = "Choose a project in the rail to start a thread.";

export type { AgentComposerRepositoryOption, AgentComposerTarget } from "./agentComposerCheckout";

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
  readonly worktreeAvailable: boolean;
  readonly worktreeOnly: boolean;
  readonly worktreeOnlyReason: string | null;
  readonly guard: InPlaceDispatchGuard;
  readonly launch: AgentLaunchOptions;
  readonly launchProvider: AgentCliKind;
  readonly dispatching: boolean;
  readonly submitBlocked: boolean;
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly providerManagement?: AgentProviderManagementSurface | null;
  onSelectRepository(repositoryRoot: string): void;
  onPromptChange(prompt: string): void;
  onIsolationChange(isolation: AgentTaskIsolation): void;
  onRefreshIsolation?(): void;
  onLaunchChange(launch: AgentLaunchOptions): void;
  onNewThread(): void;
  onOpenProviderSettings(): void;
  onSubmit(submission: AgentComposerSubmission): void;
  onCompactContext?(submission: AgentComposerSubmission): void;
}

export function AgentComposer({
  compactionOffer = null,
  dispatching,
  isolation,
  isolationReason,
  launch,
  launchProvider,
  modelFavoritesPersistence = null,
  mode,
  onIsolationChange,
  onRefreshIsolation,
  onLaunchChange,
  onNewThread,
  onOpenProviderSettings,
  onPromptChange,
  onSelectRepository,
  onSubmit,
  onCompactContext,
  prompt,
  promptBytes,
  providerEnabled,
  providerManagement = null,
  submitBlocked,
  target,
  worktreeAvailable,
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
  const selectedLaunch =
    launch.provider === launchProvider ? launch : defaultAgentComposerLaunch(launchProvider);
  const normalizedLaunch = normalizeAgentComposerLaunch(selectedLaunch);
  const discovery = providerManagement?.cliDiscovery[normalizedLaunch.provider];
  const configuredModel =
    discovery?.kind === "detected" ? (discovery.configuredModel ?? null) : null;
  const effectiveLaunch = agentLaunchForDispatch(normalizedLaunch, configuredModel);
  const dangerousLaunch = agentLaunchIsDangerous(effectiveLaunch);
  const providerReason =
    providerEnabled[effectiveLaunch.provider] === false
      ? "Enable an agent provider in Settings before starting a turn."
      : null;
  const allProvidersDisabled = !providerEnabled.claudeCode && !providerEnabled.codex;
  const blocked =
    submitBlocked || providerReason !== null || blockedReason !== null || targetReason !== null;
  const shortcut = agentSubmitShortcut();
  const submitName = submitAccessibleName(dispatching, followUp);
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
      disabled={dispatching || allProvidersDisabled}
      favorites={favorites}
      launch={effectiveLaunch}
      onLaunchChange={onLaunchChange}
      providerEnabled={providerEnabled}
      providerManagement={providerManagement}
      providerSwitchable={!followUp}
    />
  );

  const nestedTargetLabel = agentComposerNestedTargetLabel(target);
  const targetControls = followUp ? null : (
    <>
      <AgentComposerCheckout
        disabled={dispatching || allProvidersDisabled}
        isolation={isolation}
        onIsolationChange={onIsolationChange}
        onRefreshIsolation={onRefreshIsolation}
        onSelectRepository={onSelectRepository}
        target={target}
        worktreeAvailable={worktreeAvailable && !worktreeOnly}
        worktreeOnly={worktreeOnly}
      />
      {nestedTargetLabel !== null && (
        <span className="agent-composer__target" data-agent-composer-target>
          <span className="agent-visually-hidden">Repository:</span>
          in {nestedTargetLabel}
        </span>
      )}
    </>
  );

  const footer = followUp ? <AgentComposerLockedCheckout isolation={isolation} /> : targetControls;

  const dispatch = (): void => {
    onSubmit({ launch: effectiveLaunch, dangerousLaunchConfirmed: dangerousLaunch });
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
                onCompactContext({
                  launch: effectiveLaunch,
                  dangerousLaunchConfirmed: dangerousLaunch,
                })
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
              summary={agentLaunchSummaryLabel(effectiveLaunch, configuredModel)}
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
            aria-busy={dispatching || undefined}
            aria-keyshortcuts={shortcut.keys}
            aria-label={submitName}
            className={
              dispatching
                ? "agent-composer__send agent-composer__send--busy"
                : "agent-composer__send"
            }
            disabled={blocked}
            title={agentControlTooltip(submitName, shortcut.keys)}
            type="submit"
          >
            {dispatching ? (
              <Loader2
                aria-hidden="true"
                className="agent-composer__send-spinner"
                size={16}
                strokeWidth={2.5}
              />
            ) : (
              <ArrowUp aria-hidden="true" size={16} strokeWidth={2.5} />
            )}
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
  isolation,
  onIsolationChange,
  onRefreshIsolation,
  onSelectRepository,
  target,
  worktreeAvailable,
  worktreeOnly,
}: {
  readonly isolation: AgentTaskIsolation;
  readonly disabled: boolean;
  readonly target: AgentComposerTarget | null;
  readonly worktreeAvailable: boolean;
  readonly worktreeOnly: boolean;
  onIsolationChange(isolation: AgentTaskIsolation): void;
  onRefreshIsolation?(): void;
  onSelectRepository(repositoryRoot: string): void;
}) {
  const options = worktreeOnly
    ? lockedWorktreeOptions(target)
    : agentComposerCheckoutOptions(target, worktreeAvailable);
  const lockedWithoutChoice =
    worktreeOnly && options.length < 2 && onRefreshIsolation === undefined;
  const choose = (value: string): void => {
    const choice = agentComposerCheckoutChoice(value);
    if (choice === null) return;
    if (choice.kind === "root") {
      onSelectRepository(choice.repositoryRoot);
      return;
    }
    if (worktreeOnly) return;
    onIsolationChange(choice.isolation);
  };
  return (
    <AgentPickerMenu
      align="start"
      confirmation={null}
      describedBy={null}
      disabled={disabled || lockedWithoutChoice}
      icon={isolationGlyph(isolation)}
      id={CHECKOUT_ID}
      label="Checkout for this thread"
      menuLayout="checkout"
      onChange={choose}
      onOpen={onRefreshIsolation}
      options={options}
      prefix={null}
      tone={null}
      value={isolation}
      variant="ghost"
    />
  );
}

function lockedWorktreeOptions(
  target: AgentComposerTarget | null,
): ReadonlyArray<AgentPickerOption> {
  return agentComposerCheckoutOptions(target, true).filter((option) => option.value !== "in-place");
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

function isolationGlyph(isolation: AgentTaskIsolation): ReactNode {
  if (isolation === "worktree") return <FolderGit2 size={12} />;
  return <Folder size={12} />;
}

function isolationLabel(isolation: AgentTaskIsolation): string {
  if (isolation === "worktree") return "Isolated worktree";
  return "Local checkout";
}

function submitAccessibleName(dispatching: boolean, followUp: boolean): string {
  if (dispatching) return "Starting…";
  if (followUp) return "Send follow-up";
  return "Start agent";
}

function composerTargetReason(
  followUp: boolean,
  target: AgentComposerTarget | null,
): string | null {
  if (followUp) return null;
  if (target === null) return NO_TARGET_REASON;
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
