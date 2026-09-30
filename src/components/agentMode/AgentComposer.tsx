import { useAgentClaudeModelCatalog } from "./useAgentClaudeModelCatalog";
import { useAgentCodexModelCatalog } from "./useAgentCodexModelCatalog";
import { codexUnavailableModelNotice } from "./codexLaunchPresentation";
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
  type MouseEvent,
  type ReactNode,
} from "react";
import { AlertTriangle, Paperclip } from "lucide-react";
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
import type { AgentComposerTarget } from "./agentComposerCheckout";
import type { AgentComposerPreviousWorktreeChoice } from "./agentComposerPreviousWorktree";
import type { AgentWorkspaceLocation } from "../../domain/agentWorkspaceLocation";
import { AgentComposerAttachments } from "./AgentComposerAttachments";
import {
  AGENT_COMPOSER_SAVE_QUEUED_LABEL,
  AgentComposerQueuedEditAttachments,
  AgentComposerQueuedEditBar,
} from "./AgentComposerQueuedEditBar";
import type { AgentComposerQueuedEdit } from "./agentComposerQueuedEdit";
import { agentComposerPopoverOpen } from "./agentConversationEscape";
import {
  AGENT_ATTACHMENT_DROP_UNAVAILABLE,
  agentClipboardFiles,
  openAgentAttachmentPicker,
  openAgentImageAttachmentPicker,
  subscribeAgentAttachmentDragDrop,
  type AgentComposerDragDropSubscribe,
  type AgentComposerFilePicker,
} from "./agentComposerAttachmentPorts";
import { useAgentTextPaste } from "./useAgentTextPaste";
import { useAgentAttachmentIntake } from "./useAgentAttachmentIntake";
import { useAgentComposerDragDrop } from "./useAgentComposerDragDrop";
import { defaultAgentComposerLaunch, normalizeAgentComposerLaunch } from "./agentComposerLaunch";
import { AgentComposerCommands } from "./AgentComposerCommands";
import { useAgentComposerCommands } from "./useAgentComposerCommands";
import type { AgentComposerCommandId } from "../../domain/agentComposerCommand";
import { HEAD_WORKTREE_BASE, type AgentWorktreeBase } from "../../domain/agentWorktreeBase";
import { AgentLaunchControls, type AgentLaunchControlRequest } from "./AgentLaunchControls";
import { agentLaunchForDispatch } from "./agentLaunchPresentation";
import { formatAgentPromptBytes } from "./agentModePresentation";
import { agentSubmitShortcut } from "./agentSubmitShortcut";
import { useCompactComposerControls } from "./useCompactComposerControls";
import { AgentComposerSubmitControls } from "./AgentComposerSubmitControls";
import { useAgentComposerAutosize } from "./useAgentComposerAutosize";
import { AgentComposerCompactionBanner } from "./AgentComposerCompactionBanner";
import {
  AgentStopConfirmationAnnouncer,
  AgentStopConfirmationBanner,
  type AgentStopConfirmationView,
} from "./AgentStopConfirmationBanner";
import { AgentComposerDrawerStart } from "./AgentComposerDrawerStart";
import { ComposerBanner } from "../../ui/foundation/ComposerBanner";
import { AgentSessionRestartBanner } from "./AgentSessionRestartBanner";
import type { AgentSessionRestartConfirmation } from "./useAgentSessionRestartConsent";
import { IconButton } from "../../ui/foundation/IconButton";
import { AgentComposerApprovalPanel } from "./composer/AgentComposerApprovalPanel";
import type { AgentComposerInteraction } from "./composer/agentComposerInteraction";
import { AgentComposerQuestionPanel } from "./composer/AgentComposerQuestionPanel";
import { useAgentComposerFocusReturn } from "./composer/useAgentComposerInteractionFocus";
import {
  AgentComposerFrame,
  type AgentComposerDrawerContext,
  type AgentComposerLayout,
} from "./composer/AgentComposerFrame";

const NO_TARGET_REASON = "Choose a project in the rail to start a thread.";
const ignoreWorktreeBase = (): void => undefined;
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
  readonly sessionRestartConfirmed?: boolean;
}

export type AgentComposerSubmitSource = "draft" | "compaction";

type SessionRestartConsent = Pick<AgentComposerSubmission, "sessionRestartConfirmed">;

const SESSION_RESTART_CONFIRMED: SessionRestartConsent = { sessionRestartConfirmed: true };

export interface AgentComposerProps {
  readonly followUpBehavior?: AgentFollowUpBehavior;
  readonly immediateBlockedReason?: string | null;
  readonly executionServerId?: string | null;
  readonly attachments?: AgentComposerAttachmentsSurface | null;
  readonly queuedEdit?: AgentComposerQueuedEdit | null;
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
  readonly sessionTasksStoppable?: boolean;
  readonly submitBlocked: boolean;
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly providerManagement?: AgentProviderManagementSurface | null;
  onSelectRepository(repositoryRoot: string): void;
  onPromptChange(prompt: string): void;
  onIsolationChange(isolation: AgentTaskIsolation): void;
  readonly worktreeBase?: AgentWorktreeBase;
  onWorktreeBaseChange?(base: AgentWorktreeBase): void;
  onRefreshIsolation?(): void;
  onLaunchChange(launch: AgentLaunchOptions): void;
  onNewThread(): void;
  onOpenProviderSettings(): void;
  onOpenEnvironmentSettings?(): void;
  onShowUsageLimits?(): void;
  onStop?(): void;
  onStopNow?(): void;
  readonly stopConfirmation?: AgentStopConfirmationView | null;
  readonly sessionRestartConfirmation?: AgentSessionRestartConfirmation | null;
  onRecoverDraft?(): "started" | "unavailable" | "draftTooLarge";
  onSubmit(submission: AgentComposerSubmission): void;
  onCompactContext?(submission: AgentComposerSubmission): void | Promise<boolean>;
  readonly banners?: ReactNode;
  readonly placeholder?: string;
  readonly layout?: AgentComposerLayout;
  readonly renderDrawerEnd?: (context: AgentComposerDrawerContext) => ReactNode;
  readonly interaction?: AgentComposerInteraction | null;
  readonly previousWorktree?: AgentComposerPreviousWorktreeChoice | null;
  readonly threadLocation?: AgentWorkspaceLocation | null;
}

export function AgentComposer({
  followUpBehavior = "queue",
  immediateBlockedReason = null,
  executionServerId = null,
  attachments = null,
  queuedEdit = null,
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
  worktreeBase = HEAD_WORKTREE_BASE,
  onWorktreeBaseChange = ignoreWorktreeBase,
  onRefreshIsolation,
  onLaunchChange,
  onNewThread,
  onOpenProviderSettings,
  onOpenEnvironmentSettings,
  onShowUsageLimits,
  onPromptChange,
  onSelectRepository,
  onStop,
  onStopNow,
  stopConfirmation = null,
  sessionRestartConfirmation = null,
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
  sessionTasksStoppable = false,
  submitBlocked,
  target,
  worktreeAvailable,
  worktreeOnly,
  worktreeOnlyReason,
  banners = null,
  placeholder,
  layout,
  renderDrawerEnd,
  interaction = null,
  previousWorktree = null,
  threadLocation = null,
}: AgentComposerProps) {
  const catalog = useAgentClaudeModelCatalog();
  const codexCatalog = useAgentCodexModelCatalog();
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
  const followUp = mode.kind !== "new";
  const interactionActive = interaction !== null && interaction.kind !== "notice";
  const slabRef = useRef<HTMLDivElement>(null);
  useAgentComposerFocusReturn(interactionActive, slabRef, textareaRef);
  const focusPrompt = (): void => textareaRef.current?.focus({ preventScroll: true });
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
    const dispatched = agentLaunchForDispatch(
      normalizedLaunch,
      configuredModel,
      catalog,
      codexCatalog,
    );
    if (executionTarget === "local") return dispatched;
    return agentLaunchWithoutBrowser(dispatched);
  }, [normalizedLaunch, configuredModel, executionTarget, catalog, codexCatalog]);
  const modelFallbackNotice =
    normalizedLaunch.provider === "codex"
      ? codexUnavailableModelNotice(normalizedLaunch, codexCatalog)
      : null;
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
  const editingQueued = queuedEdit !== null;
  const submitName = editingQueued
    ? AGENT_COMPOSER_SAVE_QUEUED_LABEL
    : submitAccessibleName(dispatching, mode, effectiveFollowUpBehavior);
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
  const textPaste = useAgentTextPaste({
    ownerKey: JSON.stringify([attachmentTargetKey, executionServerId, promptOwnerKey]),
    prompt,
    promptBytes,
    attachments,
    available: attachmentsEnabled,
    pasteText: attachmentIntake.pasteText,
    refuse: setUnavailableAttachmentNotice,
    onPromptChange: changePrompt,
    currentAuthority: () => promptAuthorityRef.current,
  });
  const pasteAttachments = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (dispatching) return;
    const data = event.clipboardData;
    if (data === null || data === undefined) return;
    const files = agentClipboardFiles(data);
    if (attachments === null || attachmentTargetKey === null) {
      if (files.length === 0 && textPaste.paste(event)) return;
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
    if (claim !== "claim") {
      textPaste.paste(event);
      return;
    }
    event.preventDefault();
    void attachmentIntake.paste(files);
  };
  const pickAttachments = (): void => {
    void attachmentIntake.open();
  };

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

  const selectedPreviousWorktree =
    !followUp && previousWorktree?.selected === true ? previousWorktree.available : null;
  const drawerContext = useMemo<AgentComposerDrawerContext>(
    () => ({
      repositoryRoot: target?.selectedRepositoryRoot ?? null,
      isolation,
      locked: followUp,
      disabled: dispatching || allProvidersDisabled,
      remote: executionServerId !== null,
      worktreeBase,
      previousWorktree: selectedPreviousWorktree,
      onWorktreeBaseChange,
    }),
    [
      target,
      isolation,
      followUp,
      dispatching,
      allProvidersDisabled,
      executionServerId,
      worktreeBase,
      selectedPreviousWorktree,
      onWorktreeBaseChange,
    ],
  );
  const compactContext = (submission: AgentComposerSubmission): void => {
    if (compactionBlocked || onCompactContext === undefined) return;
    const submittedAuthority = promptAuthorityRef.current;
    const submittedPrompt = prompt;
    const compaction = onCompactContext(submission);
    void Promise.resolve(compaction).then((accepted) => {
      if (accepted === false || submittedAuthority === null) return;
      if (promptAuthorityRef.current !== submittedAuthority) return;
      // A suggestion can compact while an unrelated draft is already being written.
      if (submittedPrompt.trim() !== "/compact") return;
      changePrompt("");
    });
  };
  const chooseCommand = (command: AgentComposerCommandId, submitCommand: boolean): void => {
    if (command === "compact") {
      if (!submitCommand) {
        changePrompt("/compact ");
        return;
      }
      compactContext({ launch: effectiveLaunch, dangerousLaunchConfirmed: dangerousLaunch });
      return;
    }
    if (command === "settings") {
      changePrompt("");
      onOpenProviderSettings();
      return;
    }
    if (command === "usage") {
      changePrompt("");
      onShowUsageLimits?.();
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
    commands.exactCommand === "usage" ||
    (!dispatching &&
      commands.exactCommand !== null &&
      commands.exactCommand !== "compact" &&
      (commands.exactCommand === "new" || !allProvidersDisabled));

  const dispatch = (alternate = false, consent: SessionRestartConsent = {}): void => {
    if (editingQueued) {
      if (alternate) return;
      onSubmit({ launch: effectiveLaunch, dangerousLaunchConfirmed: dangerousLaunch });
      return;
    }
    const queue = (effectiveFollowUpBehavior === "queue") !== alternate;
    if (steering && !queue && immediateBlockedReason !== null) return;
    onSubmit({
      launch: effectiveLaunch,
      dangerousLaunchConfirmed: dangerousLaunch,
      ...(steering ? { delivery: queue ? ("queued" as const) : ("immediate" as const) } : {}),
      ...consent,
    });
  };

  const submitGated = (consent: SessionRestartConsent = {}): void => {
    if (interactionActive) return;
    if (commands.interceptSubmit()) return;
    if (blocked) return;
    dispatch(false, consent);
  };

  const confirmSessionRestart = (): void => {
    const resend = sessionRestartConfirmation?.resend;
    if (resend === undefined) return;
    if (resend.kind === "compaction") {
      compactContext({ ...resend.submission, ...SESSION_RESTART_CONFIRMED });
      return;
    }
    submitGated(SESSION_RESTART_CONFIRMED);
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    submitGated();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (interactionActive) return;
    textPaste.keyDown(event);
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (commands.onKeyDown(event)) return;
    if (event.key === "Escape" && agentComposerPopoverOpen(composerRef.current)) return;
    if (event.key === "Escape" && queuedEdit !== null) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) queuedEdit.onCancel();
      return;
    }
    if (event.key === "Escape") {
      if (!running && !sessionTasksStoppable) return;
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

  const slab = (
    <div className="cv-composer__slab" ref={slabRef}>
      <AgentStopConfirmationAnnouncer confirmation={stopConfirmation} />
      {interaction?.kind === "approval" && (
        <AgentComposerApprovalPanel interaction={interaction} key={interaction.key} />
      )}
      {interaction?.kind === "question" && (
        <AgentComposerQuestionPanel interaction={interaction} key={interaction.key} />
      )}
      <form
        aria-label={followUp ? "Follow up on agent thread" : "New agent thread"}
        className="agent-composer"
        onSubmit={submit}
        ref={composerRef}
      >
        <div
          className={
            dropActive ? "agent-composer__box agent-composer__box--drop" : "agent-composer__box"
          }
          data-agent-composer-drop={dropActive ? "active" : undefined}
          hidden={interactionActive}
        >
          {queuedEdit !== null && <AgentComposerQueuedEditAttachments edit={queuedEdit} />}
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
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
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
            placeholder={
              targetReason ??
              (editingQueued
                ? "Edit the queued message"
                : (placeholder ?? composerPlaceholder(mode, effectiveFollowUpBehavior)))
            }
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
        </div>
        <div className="cv-composer__notes" hidden={interactionActive}>
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
                  The combined draft is too large. Shorten either draft and try again. Both drafts
                  are unchanged.
                </p>
              )}
            </div>
          )}

          {promptBytes > MAX_AGENT_TASK_PROMPT_BYTES && (
            <div className="agent-composer__caption" role="status">
              <p>
                This text exceeds the message limit. Attach it as a text file to send the full
                content.
              </p>
              <button
                type="button"
                className="agent-composer__alternate"
                disabled={dispatching || !attachmentsEnabled || textPaste.converting}
                onClick={textPaste.convertDraft}
              >
                {textPaste.converting ? "Attaching text…" : "Attach draft as text file"}
              </button>
            </div>
          )}
          {unavailableAttachmentNotice !== null && (
            <p className="agent-composer__caption" role="alert">
              {unavailableAttachmentNotice}
            </p>
          )}
          {modelFallbackNotice !== null && (
            <p className="agent-composer__caption" role="status">
              {modelFallbackNotice}
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
        <div
          className="cv-composer__foot"
          data-presentation={compact ? "compact" : "inline"}
          hidden={interactionActive}
        >
          <div className="cv-composer__controls">{launchControls}</div>
          <div className="cv-composer__actions" onMouseDown={keepPromptFocus}>
            <AgentComposerBytes promptBytes={promptBytes} />
            {(attachmentsEnabled || targetReason !== null) && (
              <IconButton
                className="agent-composer__attach"
                disabled={dispatching || !attachmentsEnabled}
                icon={<Paperclip size={16} strokeWidth={1.5} />}
                label="Attach files"
                onClick={pickAttachments}
                size="round"
                title={attachmentsEnabled ? "Attach files" : (targetReason ?? "Choose a project")}
              />
            )}
            <AgentComposerSubmitControls
              running={running}
              steering={steering}
              editingQueued={editingQueued}
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
        </div>
      </form>
    </div>
  );

  return (
    <AgentComposerFrame
      banners={
        <>
          {banners}
          <AgentStopConfirmationBanner
            confirmation={stopConfirmation}
            onConfirm={onStopNow}
            onFocusReturn={focusPrompt}
          />
          <AgentSessionRestartBanner
            confirmation={sessionRestartConfirmation}
            onConfirm={confirmSessionRestart}
          />
          <AgentComposerCompactionBanner
            available={
              !running &&
              !steering &&
              effectiveLaunch.provider === "claudeCode" &&
              executionServerId === null &&
              onCompactContext !== undefined
            }
            blocked={compactionBlocked}
            offer={compactionOffer}
            onCompact={() =>
              onCompactContext?.({
                launch: effectiveLaunch,
                dangerousLaunchConfirmed: dangerousLaunch,
              })
            }
          />
          {queuedEdit !== null && <AgentComposerQueuedEditBar edit={queuedEdit} />}
          {interaction?.kind === "notice" && (
            <ComposerBanner icon={<AlertTriangle size={12} strokeWidth={1.5} />} tone="warn">
              {interaction.text}
            </ComposerBanner>
          )}
        </>
      }
      drawerEnd={renderDrawerEnd === undefined ? null : renderDrawerEnd(drawerContext)}
      drawerStart={
        <AgentComposerDrawerStart
          checkoutDisabled={dispatching || allProvidersDisabled}
          dispatching={dispatching}
          executionServerId={executionServerId}
          followUp={followUp}
          isolation={isolation}
          onIsolationChange={onIsolationChange}
          onOpenEnvironmentSettings={onOpenEnvironmentSettings}
          onRefreshIsolation={onRefreshIsolation}
          onSelectRepository={onSelectRepository}
          previousWorktree={followUp ? null : previousWorktree}
          remote={executionTarget === "server"}
          target={target}
          threadLocation={threadLocation}
          worktreeAvailable={worktreeAvailable}
          worktreeOnly={worktreeOnly}
        />
      }
      layout={layout ?? (mode.kind === "new" ? "hero" : "dock")}
      slab={slab}
    />
  );
}

const BYTES_WARN_RATIO = 0.8;

function keepPromptFocus(event: MouseEvent<HTMLElement>): void {
  if (event.button !== 0) return;
  event.preventDefault();
}

function AgentComposerBytes({ promptBytes }: { readonly promptBytes: number }) {
  if (promptBytes < MAX_AGENT_TASK_PROMPT_BYTES * BYTES_WARN_RATIO) return null;
  const over = promptBytes > MAX_AGENT_TASK_PROMPT_BYTES;
  return (
    <span
      title="Large pasted text is attached as a file. Use Shift+Command/Ctrl+V to paste inline."
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
      ? "Queue a follow-up"
      : "Send a message to the running agent";
  if (mode.kind === "followUp") return "Ask anything, or / for commands";
  return "Ask for changes, send follow-ups, or attach images";
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
