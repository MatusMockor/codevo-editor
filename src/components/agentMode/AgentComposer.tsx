import type { AgentFollowUpBehavior } from "../../domain/agentFollowUpBehavior";
import {
  useCallback,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Paperclip, X } from "lucide-react";
import type { AgentComposerAttachmentsSurface } from "../../application/useAgentComposerAttachments";
import {
  useAgentModelFavorites,
  type AgentModelFavoritesPersistence,
} from "../../application/useAgentModelFavorites";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AgentContextCompactionOffer } from "../../domain/agentContextCompaction";
import {
  agentLaunchIsDangerous,
  agentLaunchWithoutBrowser,
  type AgentExecutionTarget,
  type AgentLaunchOptions,
} from "../../domain/agentLaunch";
import {
  MAX_AGENT_TASK_PROMPT_BYTES,
  type AgentCliKind,
  type AgentTaskIsolation,
  type InPlaceDispatchGuard,
} from "../../domain/agentTask";
import { agentComposerNestedTargetLabel, type AgentComposerTarget } from "./agentComposerCheckout";
import { AgentComposerAttachments } from "./AgentComposerAttachments";
import {
  AGENT_ATTACHMENT_DROP_UNAVAILABLE,
  openAgentAttachmentPicker,
  openAgentImageAttachmentPicker,
  subscribeAgentAttachmentDragDrop,
  type AgentComposerDragDropSubscribe,
  type AgentComposerFilePicker,
} from "./agentComposerAttachmentPorts";
import { useAgentAttachmentIntake } from "./useAgentAttachmentIntake";
import { useAgentComposerDragDrop } from "./useAgentComposerDragDrop";
import { defaultAgentComposerLaunch, normalizeAgentComposerLaunch } from "./agentComposerLaunch";
import { AgentComposerCommands } from "./AgentComposerCommands";
import { useAgentComposerCommands } from "./useAgentComposerCommands";
import type { AgentComposerCommandId } from "../../domain/agentComposerCommand";
import { AgentLaunchControls, type AgentLaunchControlRequest } from "./AgentLaunchControls";
import { agentLaunchForDispatch } from "./agentLaunchPresentation";
import { formatAgentPromptBytes } from "./agentModePresentation";
import { AgentComposerCheckout, AgentComposerLockedCheckout } from "./AgentComposerControls";
import { agentSubmitShortcut } from "./agentSubmitShortcut";
import { useCompactComposerControls } from "./useCompactComposerControls";
import { AgentComposerSubmitControls } from "./AgentComposerSubmitControls";
import { useAgentComposerAutosize } from "./useAgentComposerAutosize";
import { AgentExecutionEnvironmentPicker } from "./AgentExecutionEnvironmentPicker";
import { AgentContextWindowMeter, type AgentContextWindowUsage } from "./AgentContextWindowMeter";

const NO_TARGET_REASON = "Choose a project in the rail to start a thread.";
const NO_SERVER_TARGET_REASON =
  "Choose a project on this server to add attachments and start a thread.";

export type { AgentComposerRepositoryOption, AgentComposerTarget } from "./agentComposerCheckout";

export type AgentComposerMode =
  | { readonly kind: "new" }
  | {
      readonly kind: "followUp";
      readonly blockedReason: string | null;
    }
  | { readonly kind: "steer"; readonly threadId: string };

export interface AgentComposerSubmission {
  readonly delivery?: "queued" | "immediate";
  readonly launch: AgentLaunchOptions;
  readonly dangerousLaunchConfirmed: boolean;
}

export interface AgentComposerProps {
  readonly followUpBehavior?: AgentFollowUpBehavior;
  readonly immediateBlockedReason?: string | null;
  readonly contextUsage?: AgentContextWindowUsage | null;
  readonly executionServerId?: string | null;
  readonly attachments?: AgentComposerAttachmentsSurface | null;
  readonly attachmentTargetKey?: string | null;
  readonly attachmentPicker?: AgentComposerFilePicker;
  readonly attachmentImageReader?: (path: string) => Promise<ArrayBuffer>;
  readonly attachmentDragDrop?: AgentComposerDragDropSubscribe;
  readonly compactionOffer?: AgentContextCompactionOffer | null;
  readonly modelFavoritesPersistence?: AgentModelFavoritesPersistence | null;
  readonly mode: AgentComposerMode;
  readonly target: AgentComposerTarget | null;
  readonly promptOwnerKey?: string;
  readonly promptRevision?: number;
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
  readonly running?: boolean;
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
  onOpenEnvironmentSettings?(): void;
  onStop?(): void;
  onRecoverDraft?(): "started" | "unavailable" | "draftTooLarge";
  onSubmit(submission: AgentComposerSubmission): void;
  onCompactContext?(submission: AgentComposerSubmission): void | Promise<boolean>;
}

export function AgentComposer({
  followUpBehavior = "queue",
  immediateBlockedReason = null,
  contextUsage = null,
  executionServerId = null,
  attachments = null,
  attachmentTargetKey = null,
  attachmentPicker = executionServerId === null
    ? openAgentAttachmentPicker
    : openAgentImageAttachmentPicker,
  attachmentImageReader,
  attachmentDragDrop = subscribeAgentAttachmentDragDrop,
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
  onOpenEnvironmentSettings,
  onPromptChange,
  onSelectRepository,
  onStop,
  onRecoverDraft,
  onSubmit,
  onCompactContext,
  prompt,
  promptOwnerKey,
  promptRevision,
  promptBytes,
  providerEnabled,
  providerManagement = null,
  running = false,
  submitBlocked,
  target,
  worktreeAvailable,
  worktreeOnly,
  worktreeOnlyReason,
}: AgentComposerProps) {
  // Replace the lease whenever the draft or its owner changes, including A → B → A.
  // The application revision also catches edits batched into the same render.
  const promptAuthorityRef = useRef<object | null>(null);
  useLayoutEffect(() => {
    promptAuthorityRef.current = {};
    return () => {
      promptAuthorityRef.current = null;
    };
  }, [promptOwnerKey, promptRevision, prompt, executionServerId]);
  const changePrompt = (next: string): void => {
    promptAuthorityRef.current = {};
    onPromptChange(next);
  };
  const [recoveryRefusal, setRecoveryRefusal] = useState<{
    readonly action: NonNullable<AgentComposerProps["onRecoverDraft"]>;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useAgentComposerAutosize(textareaRef, prompt);
  const [controlRequest, setControlRequest] = useState<
    | (AgentLaunchControlRequest & {
        readonly ownerMode: AgentComposerMode;
        readonly ownerTarget: AgentComposerTarget | null;
        readonly ownerProvider: AgentCliKind;
      })
    | null
  >(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const compact = useCompactComposerControls(composerRef);
  const favorites = useAgentModelFavorites(modelFavoritesPersistence);
  const [dismissedCompactionKey, setDismissedCompactionKey] = useState<string | null>(null);
  const followUp = mode.kind !== "new";
  const steering = mode.kind === "steer";
  const blockedReason = mode.kind === "followUp" ? mode.blockedReason : null;
  const targetReason =
    !followUp && target === null && executionServerId !== null
      ? NO_SERVER_TARGET_REASON
      : composerTargetReason(followUp, target);
  const [unavailableAttachmentNotice, setUnavailableAttachmentNotice] = useState<string | null>(
    null,
  );
  useLayoutEffect(() => {
    setUnavailableAttachmentNotice(null);
  }, [promptOwnerKey, executionServerId, attachmentTargetKey]);
  const normalizedLaunch = useMemo(
    () =>
      normalizeAgentComposerLaunch(
        launch.provider === launchProvider ? launch : defaultAgentComposerLaunch(launchProvider),
      ),
    [launch, launchProvider],
  );
  const discovery =
    executionServerId === null
      ? providerManagement?.cliDiscovery[normalizedLaunch.provider]
      : undefined;
  const configuredModel =
    discovery?.kind === "detected" ? (discovery.configuredModel ?? null) : null;
  const executionTarget: AgentExecutionTarget = executionServerId === null ? "local" : "server";
  const effectiveLaunch = useMemo(() => {
    const dispatched = agentLaunchForDispatch(normalizedLaunch, configuredModel);
    if (executionTarget === "local") return dispatched;
    return agentLaunchWithoutBrowser(dispatched);
  }, [normalizedLaunch, configuredModel, executionTarget]);
  const dangerousLaunch = agentLaunchIsDangerous(effectiveLaunch);
  const providerReason =
    providerEnabled[effectiveLaunch.provider] === false
      ? "Enable an agent provider in Settings before starting a turn."
      : null;
  const allProvidersDisabled = !providerEnabled.claudeCode && !providerEnabled.codex;
  const blocked =
    submitBlocked || providerReason !== null || blockedReason !== null || targetReason !== null;
  const compactionBlocked =
    dispatching ||
    steering ||
    running ||
    executionServerId !== null ||
    (attachments?.blocked ?? false) ||
    providerReason !== null ||
    blockedReason !== null ||
    targetReason !== null;
  const shortcut = agentSubmitShortcut();
  const effectiveFollowUpBehavior = immediateBlockedReason === null ? followUpBehavior : "queue";
  const submitName = submitAccessibleName(dispatching, mode, effectiveFollowUpBehavior);
  const caption = composerCaption({
    blockedReason,
    isolationReason,
    providerReason,
    targetReason,
    worktreeOnly,
    worktreeOnlyReason,
  });

  const attachmentIntake = useAgentAttachmentIntake({
    attachments,
    target: attachmentTargetKey,
    serverId: executionServerId,
    promptOwnerKey,
    dispatching,
    picker: attachmentPicker,
    readImagePath: attachmentImageReader,
  });
  const attachmentsEnabled = attachments !== null && attachmentTargetKey !== null;
  const dropPaths = useCallback(
    (paths: ReadonlyArray<string>): void => {
      void attachmentIntake.drop(paths);
    },
    [attachmentIntake],
  );
  const refuseAttachments = useCallback(
    (reason: string): void => {
      attachments?.refuse(reason);
    },
    [attachments],
  );
  const dropUnavailable = useCallback(
    (): void => refuseAttachments(AGENT_ATTACHMENT_DROP_UNAVAILABLE),
    [refuseAttachments],
  );
  const dropActive = useAgentComposerDragDrop({
    enabled: attachmentsEnabled && !dispatching,
    onDropPaths: dropPaths,
    onUnavailable: dropUnavailable,
    subscribe: attachmentDragDrop,
    targetRef: composerRef,
  });
  const pasteAttachments = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (dispatching) return;
    const data = event.clipboardData;
    if (data === null || data === undefined) return;
    const files = Array.from(data.files);
    if (files.length === 0) {
      for (const item of Array.from(data.items ?? [])) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file !== null) files.push(file);
      }
    }
    if (attachments === null || attachmentTargetKey === null) {
      if (files.length > 0) {
        event.preventDefault();
        setUnavailableAttachmentNotice(
          targetReason === NO_SERVER_TARGET_REASON
            ? "Attachment was not added. Choose a project on this server, then paste it again."
            : "Attachment was not added. Choose an available project, then paste it again.",
        );
      }
      return;
    }
    const claim = attachments.claimPaste(
      files.map((file) => ({
        name: file.name,
        mime: file.type,
        hasPath: false,
        bytes: file.size,
      })),
      data.getData("text/plain").length,
    );
    if (claim !== "claim") return;
    event.preventDefault();
    void attachmentIntake.paste(files);
  };
  const pickAttachments = (): void => {
    void attachmentIntake.open();
  };

  const nestedTargetLabel = agentComposerNestedTargetLabel(target);
  const targetControls = useMemo(
    () =>
      followUp ? null : (
        <>
          <AgentComposerCheckout
            remote={executionTarget === "server"}
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
      ),
    [
      followUp,
      dispatching,
      allProvidersDisabled,
      isolation,
      onIsolationChange,
      onRefreshIsolation,
      onSelectRepository,
      target,
      worktreeAvailable,
      worktreeOnly,
      nestedTargetLabel,
      executionTarget,
    ],
  );

  const launchControls = useMemo(
    () => (
      <AgentLaunchControls
        disabled={dispatching || allProvidersDisabled || steering}
        openRequest={
          controlRequest?.ownerMode === mode &&
          controlRequest.ownerTarget === target &&
          controlRequest.ownerProvider === effectiveLaunch.provider
            ? controlRequest
            : null
        }
        onOpenRequestHandled={() => setControlRequest(null)}
        executionTarget={executionTarget}
        favorites={favorites}
        launch={effectiveLaunch}
        onLaunchChange={onLaunchChange}
        presentation={compact ? { kind: "compact", checkout: null } : { kind: "inline" }}
        providerEnabled={providerEnabled}
        providerManagement={executionServerId === null ? providerManagement : null}
        providerSwitchable={!followUp}
      />
    ),
    [
      dispatching,
      allProvidersDisabled,
      steering,
      controlRequest,
      mode,
      target,
      favorites,
      effectiveLaunch,
      onLaunchChange,
      compact,
      providerEnabled,
      providerManagement,
      executionServerId,
      executionTarget,
      followUp,
    ],
  );

  const footer = followUp ? (
    <AgentComposerLockedCheckout isolation={isolation} remote={executionTarget === "server"} />
  ) : (
    targetControls
  );

  const chooseCommand = (command: AgentComposerCommandId, submitCommand: boolean): void => {
    if (command === "compact") {
      if (!submitCommand) {
        changePrompt("/compact ");
        return;
      }
      if (compactionBlocked || onCompactContext === undefined) return;
      const submittedAuthority = promptAuthorityRef.current;
      const submittedPrompt = prompt;
      const compaction = onCompactContext({
        launch: effectiveLaunch,
        dangerousLaunchConfirmed: dangerousLaunch,
      });
      void Promise.resolve(compaction).then((accepted) => {
        if (accepted === false || submittedAuthority === null) return;
        if (promptAuthorityRef.current !== submittedAuthority) return;
        // A suggestion can compact while an unrelated draft is already being written.
        if (submittedPrompt.trim() !== "/compact") return;
        changePrompt("");
      });
      return;
    }
    if (command === "settings") {
      changePrompt("");
      onOpenProviderSettings();
      return;
    }
    if (dispatching) return;
    if (command === "new") {
      changePrompt("");
      onNewThread();
      return;
    }
    if (allProvidersDisabled) return;
    changePrompt("");
    if (command === "plan") {
      if (effectiveLaunch.provider === "claudeCode") {
        onLaunchChange({ ...effectiveLaunch, mode: "plan" });
      }
      return;
    }
    setControlRequest({
      kind: command,
      ownerMode: mode,
      ownerTarget: target,
      ownerProvider: effectiveLaunch.provider,
    });
  };
  const commands = useAgentComposerCommands({
    prompt,
    provider: effectiveLaunch.provider,
    followUp,
    onChoose: chooseCommand,
  });

  const localCommandAvailable =
    commands.exactCommand === "settings" ||
    (!dispatching &&
      commands.exactCommand !== null &&
      commands.exactCommand !== "compact" &&
      (commands.exactCommand === "new" || !allProvidersDisabled));

  const dispatch = (alternate = false): void => {
    const queue = (effectiveFollowUpBehavior === "queue") !== alternate;
    if (steering && !queue && immediateBlockedReason !== null) return;
    onSubmit({
      launch: effectiveLaunch,
      dangerousLaunchConfirmed: dangerousLaunch,
      ...(steering ? { delivery: queue ? ("queued" as const) : ("immediate" as const) } : {}),
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (commands.interceptSubmit()) return;
    if (blocked) return;
    dispatch();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (commands.onKeyDown(event)) return;
    if (event.key === "Escape") {
      if (!running) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) onStop?.();
      return;
    }
    if (event.key !== "Enter") return;
    if (event.shiftKey || event.altKey) return;
    if (event.repeat) {
      event.preventDefault();
      return;
    }
    if (commands.open) {
      if (commands.interceptSubmit()) event.preventDefault();
      return;
    }
    event.preventDefault();
    if (commands.interceptSubmit()) return;
    if (blocked) return;
    dispatch(event.metaKey || event.ctrlKey);
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
              disabled={compactionBlocked}
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
      <div
        className={
          dropActive ? "agent-composer__box agent-composer__box--drop" : "agent-composer__box"
        }
        data-agent-composer-drop={dropActive ? "active" : undefined}
      >
        {attachments !== null && (
          <AgentComposerAttachments
            key={JSON.stringify([attachmentTargetKey, executionServerId, promptOwnerKey])}
            drafts={attachments.drafts}
            onDismissRefusal={attachments.dismissRefusal}
            onRemove={attachments.remove}
            refusal={attachments.refusal}
          />
        )}

        <label className="agent-visually-hidden" htmlFor="agent-prompt">
          Prompt
        </label>
        <textarea
          className="agent-composer__textarea"
          id="agent-prompt"
          disabled={targetReason !== null}
          ref={textareaRef}
          aria-autocomplete="list"
          aria-controls={commands.open ? "agent-composer-commands" : undefined}
          aria-expanded={commands.open}
          aria-activedescendant={
            commands.open
              ? `agent-composer-command-${commands.rows[commands.activeIndex]?.id}`
              : undefined
          }
          onFocus={commands.onFocus}
          onBlur={commands.onBlur}
          onSelect={(event) => commands.onSelect(event.currentTarget)}
          onChange={(event) => {
            commands.onEdit();
            changePrompt(event.target.value);
          }}
          onKeyDown={onKeyDown}
          onPaste={pasteAttachments}
          placeholder={targetReason ?? composerPlaceholder(mode, effectiveFollowUpBehavior)}
          value={prompt}
        />

        {commands.open && (
          <AgentComposerCommands
            anchor={textareaRef}
            rows={commands.rows}
            activeIndex={commands.activeIndex}
            onChoose={commands.choose}
            onClose={commands.close}
          />
        )}

        <div className="agent-composer__row" data-presentation={compact ? "compact" : "inline"}>
          {(attachmentsEnabled || targetReason !== null) && (
            <button
              aria-label="Attach files"
              className="agent-composer__attach"
              disabled={dispatching || !attachmentsEnabled}
              onClick={pickAttachments}
              title={attachmentsEnabled ? "Attach files" : (targetReason ?? "Choose a project")}
              type="button"
            >
              <Paperclip aria-hidden="true" size={15} strokeWidth={2} />
            </button>
          )}

          {launchControls}

          <span className="agent-composer__spacer" />

          <AgentComposerBytes promptBytes={promptBytes} />

          <AgentContextWindowMeter ownerKey={promptOwnerKey ?? "composer"} usage={contextUsage} />

          <AgentComposerSubmitControls
            running={running}
            steering={steering}
            dispatching={dispatching}
            disabled={blocked && !localCommandAvailable}
            submitName={submitName}
            followUpBehavior={effectiveFollowUpBehavior}
            immediateBlockedReason={immediateBlockedReason}
            shortcut={shortcut}
            onStop={onStop}
            onAlternate={() => {
              if (commands.interceptSubmit() || blocked) return;
              dispatch(true);
            }}
          />
        </div>

        {onRecoverDraft !== undefined && (
          <div className="agent-composer__caption">
            <p>
              This session cannot be resumed. Start a new thread to keep writing. Your unsent text
              will be copied; the previous conversation is not carried over.
            </p>
            <button
              className="agent-composer__alternate"
              type="button"
              onClick={() => {
                if (onRecoverDraft() === "draftTooLarge")
                  setRecoveryRefusal({ action: onRecoverDraft });
              }}
            >
              Start new thread with this draft
            </button>
            {recoveryRefusal?.action === onRecoverDraft && (
              <p role="alert">
                The combined draft is too large. Shorten either draft and try again. Both drafts are
                unchanged.
              </p>
            )}
          </div>
        )}

        {unavailableAttachmentNotice !== null && (
          <p className="agent-composer__caption" role="alert">
            {unavailableAttachmentNotice}
          </p>
        )}
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
      </div>
      <div className="agent-composer__footer">
        {onOpenEnvironmentSettings !== undefined && (
          <>
            <AgentExecutionEnvironmentPicker
              disabled={dispatching}
              locked={followUp}
              executionServerId={executionServerId}
              onOpenEnvironmentSettings={onOpenEnvironmentSettings}
            />
            <span aria-hidden="true" className="agent-composer__divider" />
          </>
        )}
        {footer}
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

function submitAccessibleName(
  dispatching: boolean,
  mode: AgentComposerMode,
  followUpBehavior: AgentFollowUpBehavior,
): string {
  if (mode.kind === "steer") return followUpBehavior === "queue" ? "Queue message" : "Send now";
  if (dispatching) return "Starting…";
  if (mode.kind === "followUp") return "Send follow-up";
  return "Start agent";
}

function composerPlaceholder(
  mode: AgentComposerMode,
  followUpBehavior: AgentFollowUpBehavior,
): string {
  if (mode.kind === "steer")
    return followUpBehavior === "queue"
      ? "Queue a message for the next turn"
      : "Send a message to the running agent";
  if (mode.kind === "followUp") return "Reply to the agent in this thread";
  return "Ask anything or describe the change you want";
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
