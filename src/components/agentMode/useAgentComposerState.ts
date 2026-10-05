import { useRemoteComposerGit } from "../../application/useRemoteDraftGitBase";
import {
  carryAgentDraftIntoRecovery,
  useAgentComposerRecovery,
  type AgentComposerRecovery,
} from "./useAgentComposerRecovery";
import { useAgentComposerLaunchChoices } from "./useAgentComposerLaunchChoices";
import { useAgentNewThreadDefaults } from "./useAgentNewThreadDefaults";
import {
  useAgentSessionRestartDismissal,
  useAgentSessionRestartGate,
  type AgentSessionRestartSurface,
} from "./useAgentSessionRestartConsent";
import {
  useAgentComposerStop,
  type AgentComposerSessionStopPort,
  type AgentComposerStopSurface,
} from "./useAgentComposerStop";
import type { AgentPendingSend } from "./agentPendingSend";
import {
  agentPendingSendSelection,
  holdComposerAttachments,
  pendingSendOutcome,
  useAgentPendingSends,
} from "./useAgentPendingSends";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  createAgentComposerDraftStore,
  MAX_AGENT_COMPOSER_DRAFT_BYTES,
  type AgentComposerDraftStore,
} from "../../application/agentComposerDrafts";
import { agentDraftDispatchKey } from "../../application/agentDispatchKeys";
import { mergeRestoredPrompt } from "../../application/agentQueuedMessageEdit";
import type { AgentComposerQueuedEdit } from "./agentComposerQueuedEdit";
import { useAgentComposerQueuedEditPrompt } from "./useAgentComposerQueuedEditPrompt";
import {
  agentThreadAcceptsQueuedMessage,
  agentThreadIsSteerable,
} from "../../application/agentTurnAdmission";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { useAgentComposerRepositoryInteraction } from "./useAgentComposerRepositoryInteraction";
import {
  useAgentComposerPreviousWorktree,
  type AgentComposerPreviousWorktreeScope,
} from "./useAgentComposerPreviousWorktree";
import type { AgentComposerPreviousWorktreeChoice } from "./agentComposerPreviousWorktree";
import {
  useAgentComposerRepositoryPreference,
  type ComposerRepositoryPreferenceStorage,
} from "./useAgentComposerRepositoryPreference";
import { HEAD_WORKTREE_BASE, type AgentWorktreeBase } from "../../domain/agentWorktreeBase";
import {
  MAX_AGENT_TASK_PROMPT_BYTES,
  type AgentCliKind,
  type AgentIsolationDefault,
  type AgentTaskIsolation,
} from "../../domain/agentTask";
import type {
  AgentSteerOutcome,
  AgentThreadsSurface,
  AgentThreadView,
  AgentTurnAttachmentRequest,
  AgentThreadStartResult,
} from "../../application/agentThreadPorts";
import type {
  AgentComposerAttachmentDraft,
  AgentComposerAttachmentsSurface,
} from "../../application/useAgentComposerAttachments";
import type {
  AgentComposerMode,
  AgentComposerProps,
  AgentComposerSubmission,
  AgentComposerSubmitSource,
} from "./AgentComposer";
import {
  launchScopeExecutionTarget,
  resolveComposerLaunch,
  resolveLaunchScope,
  type IsolationChoice,
} from "./agentComposerLaunch";
import {
  composerProjectOwnsRoot,
  composerTargetLabel,
  composerTargetView,
  resolveComposerTarget,
  type AgentComposerProjectOption,
  type ComposerScope,
  type ComposerSelection,
  type ComposerTarget,
} from "./agentComposerTarget";
import {
  agentFollowUpBlockedReason,
  agentIsolationReasonLabel,
  agentProjectWorktreeOnly,
  agentProjectWorktreeOnlyReason,
  agentPromptByteLength,
  type AgentProjectGroup,
} from "./agentModePresentation";

export const NOT_REPOSITORY_COMPOSER_CAPTION = "Not a Git repository · Local checkout only";
export const NOT_REPOSITORY_WORKTREE_ONLY_CAPTION =
  "This folder is not a Git repository, so it cannot run in an isolated worktree. Choose a repository from the checkout menu.";

export type AgentComposerSurface = Pick<
  AgentThreadsSurface,
  | "attachments"
  | "agentCliConfigured"
  | "agentCliKind"
  | "dispatching"
  | "dispatchingKeys"
  | "isolationPreview"
  | "lastUsedLaunch"
  | "liveTaskCount"
  | "maxConcurrentAgentTasks"
  | "refreshIsolationStatus"
  | "remoteGit"
  | "sendFollowUp"
  | "startThread"
  | "steer"
> &
  Partial<Pick<AgentThreadsSurface, "threads">> &
  AgentComposerStopSurface &
  AgentSessionRestartSurface;

export interface AgentComposerStateOptions {
  readonly agents: AgentComposerSurface;
  readonly queuedEdit?: AgentComposerQueuedEdit | null;
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly groups: ReadonlyArray<AgentProjectGroup>;
  readonly selectedThread: AgentThreadView | null;
  readonly railScope: ComposerScope | null;
  readonly repositoryPreferenceStorage?: ComposerRepositoryPreferenceStorage;
  readonly drafts?: AgentComposerDraftStore;
  readonly sessionStop?: AgentComposerSessionStopPort;
  onClearSelectedThread(): void;
  onThreadStarted(threadId: string): void;
  onSelectProjectEnvironment?(projectRootKey: string): void;
}

export interface AgentComposerState {
  readonly target: ComposerTarget | null;
  readonly composerLabel: string | null;
  readonly composerProps: AgentComposerPromptProps;
  readonly pendingSend: AgentPendingSend | null;
  dismissPendingSend(): void;
  startNewThread(projectRootKey: string, repositoryRoot: string): void;
  clearSelection(): void;
  clearDraftTarget(): void;
}

export type AgentComposerControllerProps = Omit<
  AgentComposerProps,
  | "onOpenProviderSettings"
  | "onOpenEnvironmentSettings"
  | "onRecoverDraft"
  | "recoveryReason"
  | "onPromptChange"
  | "onSubmit"
  | "prompt"
  | "promptBytes"
  | "providerEnabled"
  | "submitBlocked"
> & {
  readonly recovery?: AgentComposerRecovery | null;
  readonly draftKey: string | null;
  readonly previousWorktree?: AgentComposerPreviousWorktreeChoice | null;
};

export type AgentComposerPromptProps = Omit<
  AgentComposerProps,
  "onOpenProviderSettings" | "onOpenEnvironmentSettings" | "providerEnabled"
> & { readonly previousWorktree?: AgentComposerPreviousWorktreeChoice | null };

export interface AgentComposerControllerState {
  readonly target: ComposerTarget | null;
  readonly composerLabel: string | null;
  readonly composerProps: AgentComposerControllerProps;
  readonly pendingSend: AgentPendingSend | null;
  dismissPendingSend(): void;
  readonly submissionBlocked: boolean;
  submit(
    prompt: string,
    submission: AgentComposerSubmission,
    source?: AgentComposerSubmitSource,
  ): Promise<boolean>;
  startNewThread(projectRootKey: string, repositoryRoot: string): void;
  clearSelection(): void;
  clearDraftTarget(): void;
}

export type AgentComposerPromptController = Pick<
  AgentComposerControllerState,
  "composerProps" | "submissionBlocked" | "submit"
> & { readonly drafts?: AgentComposerDraftStore };

export function useAgentComposerState({
  ...options
}: AgentComposerStateOptions): AgentComposerState {
  const controller = useAgentComposerControllerState(options);
  const composerProps = useAgentComposerPromptState({ ...controller, drafts: options.drafts });
  return {
    target: controller.target,
    composerLabel: controller.composerLabel,
    composerProps,
    pendingSend: controller.pendingSend,
    dismissPendingSend: controller.dismissPendingSend,
    startNewThread: controller.startNewThread,
    clearSelection: controller.clearSelection,
    clearDraftTarget: controller.clearDraftTarget,
  };
}

export function useAgentComposerControllerState({
  agents,
  groups,
  onClearSelectedThread,
  onThreadStarted,
  onSelectProjectEnvironment,
  projects,
  queuedEdit = null,
  providerEnabled,
  railScope,
  repositoryPreferenceStorage,
  selectedThread,
  sessionStop,
}: AgentComposerStateOptions): AgentComposerControllerState {
  const [selection, setSelection] = useState<ComposerSelection | null>(null);
  const { preferences, rememberRepository } = useAgentComposerRepositoryPreference(
    repositoryPreferenceStorage,
  );
  const [isolationChoice, setIsolationChoice] = useState<IsolationChoice | null>(null);
  const [worktreeBaseChoice, setWorktreeBaseChoice] = useState<{
    readonly repositoryRoot: string;
    readonly base: AgentWorktreeBase;
  } | null>(null);

  const composerProjects = useMemo(
    () => composerProjectOptions(groups, projects),
    [groups, projects],
  );
  const scopedProjectRootKey =
    railScope !== null && railScope.kind !== "missing" ? railScope.projectRootKey : null;
  const scopedRepositoryRoot =
    railScope !== null && railScope.kind !== "missing" ? railScope.repositoryRoot : null;
  useLayoutEffect(() => {
    if (scopedProjectRootKey === null || scopedRepositoryRoot === null) return;
    setSelection((current) => {
      if (current === null) return null;
      if (
        current.projectRootKey === scopedProjectRootKey &&
        current.repositoryRoot === scopedRepositoryRoot
      ) {
        return current;
      }
      return null;
    });
  }, [railScope?.kind, scopedProjectRootKey, scopedRepositoryRoot]);
  const target = resolveComposerTarget(
    composerProjects,
    selection,
    selectedThread,
    railScope,
    preferences,
  );
  const composerRoot = target?.repositoryRoot ?? null;
  useLayoutEffect(() => {
    setWorktreeBaseChoice((current) => (current?.repositoryRoot === composerRoot ? current : null));
  }, [composerRoot]);
  const worktreeBase =
    worktreeBaseChoice !== null && worktreeBaseChoice.repositoryRoot === composerRoot
      ? worktreeBaseChoice.base
      : HEAD_WORKTREE_BASE;
  const repositorySelectionAuthorityRef = useRef({ projects: composerProjects, target });
  repositorySelectionAuthorityRef.current = { projects: composerProjects, target };
  const composerProjectRootKey = target?.projectRootKey ?? null;
  const composerProject =
    projects.find((project) => project.rootKey === target?.projectRootKey) ?? null;
  const repositoryInteractionIsCurrent = useAgentComposerRepositoryInteraction(
    composerProject,
    target,
    railScope,
    selection,
    selectedThread,
  );
  const composerLabel =
    composerTargetLabel(composerProjects, target) ??
    groups.flatMap((group) => group.repos).find((repo) => repo.repositoryRoot === composerRoot)
      ?.label ??
    null;
  const remoteExecution =
    selectedThread?.execution?.kind === "remote" ||
    composerProject?.rootKey.startsWith("remote:") === true;
  const worktreeOnly = remoteExecution
    ? composerProject?.isolationPolicy !== "in-place"
    : composerProject !== null && agentProjectWorktreeOnly(composerProject.origin);
  const worktreeOnlyReason = remoteExecution
    ? null
    : composerProject === null
      ? null
      : agentProjectWorktreeOnlyReason(composerProject.origin);

  const preview =
    composerRoot === null || composerProjectRootKey === null
      ? null
      : agents.isolationPreview(composerRoot, composerProjectRootKey);
  const refreshIsolationStatus = agents.refreshIsolationStatus;
  const composerProbeAuthorityKey =
    composerProject === null
      ? null
      : `${composerProject.rootKey}\u0000${composerProject.ownerId}\u0000${composerProject.generation}\u0000${composerProject.trust}`;
  useEffect(() => {
    if (composerRoot === null || composerProjectRootKey === null) return;
    void refreshIsolationStatus(composerRoot, composerProjectRootKey);
  }, [composerProbeAuthorityKey, composerProjectRootKey, composerRoot, refreshIsolationStatus]);
  const refreshIsolation = useCallback(() => {
    if (composerRoot === null || composerProjectRootKey === null) return;
    void refreshIsolationStatus(composerRoot, composerProjectRootKey);
  }, [composerProjectRootKey, composerRoot, refreshIsolationStatus]);
  // A new thread starts in the project's local checkout unless the workspace
  // explicitly requires isolation. Repository status still supplies the
  // in-place safety guard below, and background projects remain worktree-only.
  const recommended: AgentTaskIsolation =
    composerProject?.isolationPolicy === "worktree" ? "worktree" : "in-place";
  const chosen: AgentTaskIsolation =
    isolationChoice !== null && isolationChoice.repositoryRoot === composerRoot
      ? isolationChoice.isolation
      : recommended;
  const probeState = preview?.repositoryStatus ?? null;
  const notRepository = probeState?.kind === "notRepository";
  const probeSettled =
    probeState === null || probeState.kind === "ready" || probeState.kind === "notRepository";
  const worktreeAvailable = !notRepository;
  const isolation: AgentTaskIsolation =
    selectedThread !== null
      ? selectedThread.thread.target.isolation
      : worktreeOnly
        ? "worktree"
        : worktreeAvailable
          ? chosen
          : "in-place";
  const previousWorktreeScope = useMemo<AgentComposerPreviousWorktreeScope | null>(
    () =>
      selectedThread !== null ||
      remoteExecution ||
      !worktreeAvailable ||
      composerProject === null ||
      composerRoot === null
        ? null
        : { project: composerProject, repositoryRoot: composerRoot },
    [composerProject, composerRoot, remoteExecution, selectedThread, worktreeAvailable],
  );
  const selectPreviousWorktreeIsolation = useCallback(() => {
    if (composerRoot === null) return;
    setIsolationChoice({ repositoryRoot: composerRoot, isolation: "worktree" });
  }, [composerRoot]);
  const previousWorktree = useAgentComposerPreviousWorktree(
    agents.threads,
    previousWorktreeScope,
    selectPreviousWorktreeIsolation,
  );
  const reuseWorktree = isolation === "worktree" ? previousWorktree.reuse : null;
  const clearPreviousWorktree = previousWorktree.clear;
  const guard = probeSettled ? (preview?.inPlaceGuard ?? { kind: "safe" as const }) : SAFE_GUARD;
  const confirmationKey = preview?.confirmationKey ?? null;
  const unsafeInPlaceConfirmationKey =
    isolation === "in-place" && guard.kind === "unsafe" ? confirmationKey : null;
  const launchProjectRootKey =
    target?.projectRootKey ??
    selection?.projectRootKey ??
    railScope?.projectRootKey ??
    projects.find((project) => project.origin === "active-tab")?.rootKey ??
    null;
  const launchScope = useMemo(
    () => resolveLaunchScope(selectedThread, launchProjectRootKey),
    [selectedThread, launchProjectRootKey],
  );
  const newThreadDefaults = useAgentNewThreadDefaults(
    selectedThread?.execution?.kind === "remote"
      ? "server"
      : launchScopeExecutionTarget(launchScope),
  );
  const carriedDraftLaunch = useMemo(
    () =>
      newThreadDefaults.source === "lastUsed"
        ? resolveComposerLaunch(
            null,
            launchScope,
            composerProviderKind(selectedThread, agents.agentCliKind, providerEnabled),
            agents.lastUsedLaunch,
            newThreadDefaults,
          )
        : null,
    [
      launchScope,
      selectedThread,
      agents.agentCliKind,
      agents.lastUsedLaunch,
      providerEnabled,
      newThreadDefaults,
    ],
  );
  const { choice: launchChoice, change: changeLaunch } = useAgentComposerLaunchChoices(
    launchScope,
    carriedDraftLaunch,
  );
  const selectedLaunchProvider =
    launchChoice !== null && launchChoice.key === launchScope?.key
      ? launchChoice.launch.provider
      : agents.agentCliKind;
  const agentCliKind = composerProviderKind(
    selectedThread,
    selectedLaunchProvider,
    providerEnabled,
  );
  const composerMode = useComposerMode(selectedThread, agents, agentCliKind);
  const steerThreadId = composerMode.kind === "steer" ? composerMode.threadId : null;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [steering, setSteering] = useState(false);
  const dispatching =
    composerDispatching(agents, agentComposerDraftKey(selectedThread, target)) || steering;
  const stop = useAgentComposerStop(selectedThread, agents, sessionStop);
  const lastUsedLaunch = agents.lastUsedLaunch;
  const composerLaunch = useMemo(
    () =>
      resolveComposerLaunch(
        steerThreadId === null ? launchChoice : null,
        launchScope,
        agentCliKind,
        lastUsedLaunch,
        newThreadDefaults,
      ),
    [agentCliKind, lastUsedLaunch, launchChoice, launchScope, newThreadDefaults, steerThreadId],
  );
  const restart = useAgentSessionRestartGate(
    agents,
    selectedThread?.thread.threadId ?? null,
    composerLaunch,
  );

  const submissionBlocked =
    dispatching ||
    (composerMode.kind === "followUp" && composerMode.blockedReason !== null) ||
    (selectedThread === null &&
      (target === null ||
        !probeSettled ||
        (notRepository && worktreeOnly) ||
        (isolation === "in-place" && guard.kind === "unsafe" && confirmationKey === null)));

  const startNewThread = useCallback(
    (projectRootKey: string, repositoryRoot: string) => {
      onClearSelectedThread();
      const project =
        composerProjects.find((candidate) => candidate.projectRootKey === projectRootKey) ?? null;
      setSelection(
        project === null || !composerProjectOwnsRoot(project, repositoryRoot)
          ? { kind: "missing", projectRootKey, repositoryRoot }
          : {
              kind: "bound",
              projectRootKey,
              repositoryRoot,
              ownerId: project.ownerId,
              generation: project.generation,
            },
      );
    },
    [composerProjects, onClearSelectedThread],
  );

  const recovery = useAgentComposerRecovery({
    selectedThread,
    projects: composerProjects,
    startNewThread,
    selectEnvironment: onSelectProjectEnvironment,
  });

  const clearDraftTarget = useCallback(() => setSelection(null), []);
  const clearSelection = useCallback(() => {
    onClearSelectedThread();
    setSelection(null);
  }, [onClearSelectedThread]);

  const attachmentTargetKey =
    selectedThread !== null
      ? selectedThread.thread.owner.rootKey
      : (target?.projectRootKey ?? null);
  const attachmentDraftKey = agentComposerDraftKey(selectedThread, target);
  const attachmentsSurface =
    attachmentDraftKey === null
      ? agents.attachments
      : (agents.attachments.forDraft?.(attachmentDraftKey) ?? agents.attachments);
  const attachments = useMemo(
    () => composerAttachmentsForTarget(attachmentsSurface, attachmentTargetKey),
    [attachmentsSurface, attachmentTargetKey],
  );
  const sendFollowUp = agents.sendFollowUp;
  const startThread = agents.startThread;
  const steerThread = agents.steer;
  const submissionAuthority = composerSubmissionAuthority(
    selectedThread,
    target,
    composerProject,
    steerThreadId !== null,
  );
  const submissionAuthorityRef = useRef(submissionAuthority);
  submissionAuthorityRef.current = submissionAuthority;
  const threadQueuedEdit =
    queuedEdit !== null && selectedThread?.thread.threadId === queuedEdit.threadId
      ? queuedEdit
      : null;

  const selectedThreadId = selectedThread?.thread.threadId ?? null;
  const selectedTurns = selectedThread?.thread.turns ?? null;
  const selectedLastTurnId = selectedTurns?.[selectedTurns.length - 1]?.turnId ?? null;
  const pendingSelectionRootKey = target?.projectRootKey ?? null;
  const pendingSelection = useMemo(
    () => agentPendingSendSelection(selectedThreadId, selectedLastTurnId, pendingSelectionRootKey),
    [pendingSelectionRootKey, selectedLastTurnId, selectedThreadId],
  );
  const pendingSends = useAgentPendingSends(pendingSelection);
  const followUpNeedsSessionRestart = agents.followUpNeedsSessionRestart;

  const submit = useCallback(
    async (
      prompt: string,
      submission: AgentComposerSubmission,
      source: AgentComposerSubmitSource = "draft",
    ) => {
      if (submissionBlocked) return false;
      const authority = submissionAuthority;
      if (authority === null) return false;
      const isCurrent = () =>
        composerSubmissionAuthorityEqual(submissionAuthorityRef.current, authority);
      const pendingAttachments = source === "draft" && composerHasAttachments(attachments);
      const prepared = pendingAttachments
        ? await prepareComposerAttachments(attachments, attachmentTargetKey)
        : NO_PREPARED_ATTACHMENTS;
      if (prepared === null) return false;
      if (pendingAttachments && !isCurrent()) return false;
      const hold = holdComposerAttachments(attachments, prepared.draftIds);
      if (authority.kind === "followUp" && threadQueuedEdit?.threadId === authority.threadId) {
        let committed = false;
        try {
          committed = await threadQueuedEdit.commit(prompt, prepared.request);
          return committed;
        } finally {
          hold.settle(committed);
        }
      }
      switch (authority.kind) {
        case "followUp": {
          restart.clear();
          if (authority.steer) {
            setSteering(true);
            let delivered = false;
            try {
              const outcome = await steerThread({
                delivery: submission.delivery ?? "queued",
                ...prepared.request,
                threadId: authority.threadId,
                prompt,
                dangerousLaunchConfirmed: submission.dangerousLaunchConfirmed,
              });
              delivered = !steerKeptThePrompt(outcome);
              return delivered;
            } finally {
              hold.settle(delivered);
              if (mountedRef.current) setSteering(false);
            }
          }
          const pendingId = pendingSends.begin(
            { kind: "followUp", threadId: authority.threadId, baseTurnId: selectedLastTurnId },
            prompt,
            hold.drafts,
          );
          let sent = false;
          try {
            sent = await sendFollowUp(
              {
                ...prepared.request,
                threadId: authority.threadId,
                prompt,
                launch: submission.launch,
                dangerousLaunchConfirmed: submission.dangerousLaunchConfirmed,
                ...restart.followUpRestart(submission),
              },
              "caller",
            );
          } finally {
            hold.settle(sent);
            pendingSends.settle(
              pendingId,
              pendingSendOutcome(
                sent,
                !sent && followUpNeedsSessionRestart?.(authority.threadId) === true,
              ),
            );
          }
          restart.settleFollowUp(
            { threadId: authority.threadId, submission, source },
            sent,
            isCurrent,
          );
          return sent;
        }
        case "new": {
          const pendingId = pendingSends.begin(
            { kind: "new", projectRootKey: authority.projectRootKey },
            prompt,
            hold.drafts,
          );
          let started: AgentThreadStartResult | null = null;
          try {
            started = await startThread({
              ...prepared.request,
              projectRootKey: authority.projectRootKey,
              repositoryRoot: authority.repositoryRoot,
              prompt,
              isolation,
              worktreeBase,
              ...(reuseWorktree === null ? {} : { reuseWorktree }),
              unsafeInPlaceConfirmationKey,
              launch: submission.launch,
              dangerousLaunchConfirmed: submission.dangerousLaunchConfirmed,
            });
          } finally {
            hold.settle(started !== null);
            pendingSends.settle(pendingId, pendingSendOutcome(started !== null, false));
          }
          if (started === null) return false;
          if (!isCurrent()) return false;
          onThreadStarted(started.threadId);
          return true;
        }
      }
    },
    [
      attachments,
      attachmentTargetKey,
      followUpNeedsSessionRestart,
      pendingSends,
      restart,
      selectedLastTurnId,
      unsafeInPlaceConfirmationKey,
      isolation,
      worktreeBase,
      reuseWorktree,
      onThreadStarted,
      sendFollowUp,
      startThread,
      steerThread,
      submissionBlocked,
      submissionAuthority,
      threadQueuedEdit,
    ],
  );

  const selectRepository = useCallback(
    (repositoryRoot: string) => {
      if (!repositoryInteractionIsCurrent()) return;
      if (target === null) return;
      const project =
        composerProjects.find((candidate) => candidate.projectRootKey === target.projectRootKey) ??
        null;
      if (project === null) return;
      const current = repositorySelectionAuthorityRef.current;
      if (current.target?.projectRootKey !== target.projectRootKey) return;
      const liveProject = current.projects.find(
        (candidate) => candidate.projectRootKey === target.projectRootKey,
      );
      if (
        liveProject?.ownerId !== project.ownerId ||
        liveProject?.generation !== project.generation
      )
        return;
      if (!composerProjectOwnsRoot(liveProject, repositoryRoot)) return;
      if (!composerProjectOwnsRoot(project, repositoryRoot)) return;
      rememberRepository(target.projectRootKey, repositoryRoot);
      setSelection({
        kind: "bound",
        projectRootKey: target.projectRootKey,
        repositoryRoot,
        ownerId: project.ownerId,
        generation: project.generation,
      });
    },
    [composerProjects, rememberRepository, repositoryInteractionIsCurrent, target],
  );

  const changeIsolation = useCallback(
    (next: AgentTaskIsolation) => {
      if (composerRoot === null) return;
      if (next === "worktree" && !worktreeAvailable) return;
      clearPreviousWorktree();
      setIsolationChoice({ repositoryRoot: composerRoot, isolation: next });
    },
    [clearPreviousWorktree, composerRoot, worktreeAvailable],
  );

  const changeWorktreeBase = useCallback(
    (base: AgentWorktreeBase) => {
      if (composerRoot === null) return;
      setWorktreeBaseChoice({ repositoryRoot: composerRoot, base });
    },
    [composerRoot],
  );

  const remoteGit = useRemoteComposerGit(agents.remoteGit, composerProjectRootKey, selectedThread);
  const composerProps: AgentComposerControllerProps = {
    recovery,
    attachments,
    attachmentTargetKey,
    immediateBlockedReason:
      selectedThread !== null &&
      selectedThread.execution?.kind !== "remote" &&
      composerMode.kind === "steer" &&
      !agentThreadIsSteerable(selectedThread.thread)
        ? "This session supports queued messages only. Use the Codex app-server transport to send now."
        : null,
    draftKey: agentComposerDraftKey(selectedThread, target),
    queuedEdit: threadQueuedEdit,
    promptOwnerKey: JSON.stringify([
      selectedThread?.thread.threadId ?? null,
      selectedThread?.thread.owner ?? target,
    ]),
    dispatching,
    guard,
    isolation,
    isolationReason: isolationStatusCaption(preview, isolation, worktreeOnly),
    launch: composerLaunch,
    launchProvider: agentCliKind,
    mode: composerMode,
    onIsolationChange: changeIsolation,
    onWorktreeBaseChange: changeWorktreeBase,
    previousWorktree: previousWorktree.choice,
    onRefreshIsolation: refreshIsolation,
    onLaunchChange: changeLaunch,
    onNewThread: clearSelection,
    onSelectRepository: selectRepository,
    onStop: stop.onStop,
    onStopNow: stop.onStopNow,
    stopConfirmation: stop.stopConfirmation,
    sessionRestartConfirmation: restart.confirmation,
    running: stop.running,
    sessionTasksStoppable: stop.sessionTasksStoppable,
    target: composerTargetView(composerProjects, target),
    worktreeAvailable,
    worktreeOnly,
    worktreeOnlyReason,
    worktreeBase,
    remoteGit,
  };

  return {
    target,
    composerLabel,
    composerProps,
    pendingSend: pendingSends.visible,
    dismissPendingSend: pendingSends.dismiss,
    submissionBlocked,
    submit,
    startNewThread,
    clearSelection,
    clearDraftTarget,
  };
}

const SAFE_GUARD = { kind: "safe" } as const;

function steerKeptThePrompt(outcome: AgentSteerOutcome): boolean {
  return outcome === "kept";
}

function isolationStatusCaption(
  preview: ReturnType<AgentComposerSurface["isolationPreview"]> | null,
  isolation: AgentTaskIsolation,
  worktreeOnly: boolean,
): string | null {
  if (preview === null) return null;
  if (preview.repositoryStatus === undefined) {
    return recommendedIsolationCaption(preview.recommended, isolation);
  }
  switch (preview.repositoryStatus.kind) {
    case "checking":
      return "Checking repository...";
    case "failed":
    case "unavailable":
      return preview.repositoryStatus.message;
    case "notRepository":
      return worktreeOnly ? NOT_REPOSITORY_WORKTREE_ONLY_CAPTION : NOT_REPOSITORY_COMPOSER_CAPTION;
    case "ready":
      return recommendedIsolationCaption(preview.recommended, isolation);
  }
}

function recommendedIsolationCaption(
  recommended: AgentIsolationDefault,
  isolation: AgentTaskIsolation,
): string | null {
  if (recommended.kind !== isolation) return null;
  if (recommended.kind === "in-place") return null;
  return agentIsolationReasonLabel(recommended);
}

function composerProviderKind(
  selectedThread: AgentThreadView | null,
  selectedProvider: AgentCliKind,
  providerEnabled: Readonly<Record<AgentCliKind, boolean>>,
): AgentCliKind {
  if (selectedThread !== null) return selectedThread.thread.provider.kind;
  if (providerEnabled[selectedProvider]) return selectedProvider;
  if (providerEnabled.claudeCode) return "claudeCode";
  if (providerEnabled.codex) return "codex";
  return selectedProvider;
}

const NO_COMPOSER_DRAFTS: ReadonlyArray<AgentComposerAttachmentDraft> = [];

export function composerAttachmentsForTarget(
  surface: AgentComposerAttachmentsSurface,
  targetKey: string | null,
): AgentComposerAttachmentsSurface | null {
  if (targetKey === null) return null;
  if (surface.projectRootKey === null || surface.projectRootKey === targetKey) return surface;
  return {
    ...surface,
    drafts: NO_COMPOSER_DRAFTS,
    staging: false,
    blocked: false,
    refusal: null,
    promptLineBytes: 0,
  };
}

function composerHasAttachments(attachments: AgentComposerAttachmentsSurface | null): boolean {
  if (attachments === null) return false;
  return attachments.drafts.some((draft) => draft.state === "ready");
}

interface PreparedComposerAttachments {
  readonly request: AgentTurnAttachmentRequest;
  readonly draftIds: ReadonlyArray<string>;
}

async function prepareComposerAttachments(
  attachments: AgentComposerAttachmentsSurface | null,
  projectRootKey: string | null,
): Promise<PreparedComposerAttachments | null> {
  if (attachments === null || projectRootKey === null) return null;
  const prepared = await attachments.prepareTurn(projectRootKey);
  if (prepared === null) return null;
  if (prepared.intents.length === 0) return NO_PREPARED_ATTACHMENTS;
  return {
    request: { attachments: prepared.intents, attachmentOwner: prepared.owner },
    draftIds: prepared.draftIds,
  };
}

const NO_PREPARED_ATTACHMENTS: PreparedComposerAttachments = { request: {}, draftIds: [] };

const PROMPT_ATTACHMENT_SEPARATOR_BYTES = 2;

export function agentComposerPromptBytes(
  prompt: string,
  attachments: AgentComposerAttachmentsSurface | null,
): number {
  const textBytes = agentPromptByteLength(prompt);
  const lineBytes = attachments?.promptLineBytes ?? 0;
  if (lineBytes === 0) return textBytes;
  if (prompt === "") return lineBytes;
  return textBytes + PROMPT_ATTACHMENT_SEPARATOR_BYTES + lineBytes;
}

export function useAgentComposerPromptState(
  controller: AgentComposerPromptController,
): AgentComposerPromptProps {
  const { draftKey, recovery, ...composerProps } = controller.composerProps;
  const queuedEdit = composerProps.queuedEdit ?? null;
  const [ownDrafts] = useState(createAgentComposerDraftStore);
  const drafts = controller.drafts ?? ownDrafts;
  const [draft, setDraft] = useState(() => ({
    key: draftKey,
    text: readComposerDraft(drafts, draftKey),
  }));
  if (draft.key !== draftKey) {
    setDraft({ key: draftKey, text: seedComposerPrompt(drafts, draft.key, draftKey, draft.text) });
  }
  const prompt = draft.text;
  useEffect(() => {
    writeComposerDraft(drafts, draft.key, draft.text);
  }, [draft, drafts]);
  const ownerKey = composerProps.promptOwnerKey;
  const promptOwnerRef = useRef({ key: ownerKey, generation: 0 });
  if (promptOwnerRef.current.key !== ownerKey) {
    promptOwnerRef.current = { key: ownerKey, generation: promptOwnerRef.current.generation + 1 };
  }
  const promptRevisionRef = useRef(0);
  const dismissRestart = useAgentSessionRestartDismissal(
    composerProps.sessionRestartConfirmation ?? null,
  );
  const changePrompt = useCallback(
    (next: string) => {
      promptRevisionRef.current += 1;
      dismissRestart();
      setDraft((current) => ({ key: current.key, text: next }));
    },
    [dismissRestart],
  );
  const draftRef = useRef(draft);
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const replaceDraft = useCallback(
    (key: string, text: string, focus: boolean) => {
      promptRevisionRef.current += 1;
      dismissRestart();
      setDraft({ key, text });
      if (focus) focusAgentComposerPrompt(text.length);
    },
    [dismissRestart],
  );
  useAgentComposerQueuedEditPrompt(queuedEdit, draftKey, draftRef, replaceDraft);
  const attachments = composerProps.attachments ?? null;
  const readyAttachments =
    (attachments?.drafts.filter((draft) => draft.state === "ready").length ?? 0) +
    (queuedEdit?.attachments.length ?? 0);
  const promptBytes = agentComposerPromptBytes(prompt, attachments);
  const promptInvalid =
    (prompt.trim() === "" && readyAttachments === 0) || promptBytes > MAX_AGENT_TASK_PROMPT_BYTES;
  const submitBlocked =
    controller.submissionBlocked || promptInvalid || (attachments?.blocked ?? false);
  const submit = useCallback(
    (submission: AgentComposerSubmission) => {
      if (submitBlocked) return;
      const submittedPrompt = prompt;
      const submittedOwner = promptOwnerRef.current;
      const submittedDraftKey = draft.key;
      const clearedRevision = promptRevisionRef.current + 1;
      promptRevisionRef.current = clearedRevision;
      setDraft({ key: submittedDraftKey, text: "" });
      const restore = (): void => {
        if (promptOwnerRef.current !== submittedOwner) {
          retainForeignComposerDraft(drafts, submittedDraftKey, submittedPrompt);
          return;
        }
        const untouched = promptRevisionRef.current === clearedRevision;
        promptRevisionRef.current += 1;
        setDraft((current) =>
          current.key !== submittedDraftKey
            ? current
            : {
                key: current.key,
                text: untouched
                  ? submittedPrompt
                  : restoredDraftText(current.text, submittedPrompt),
              },
        );
      };
      void controller.submit(submittedPrompt, submission).then((submitted) => {
        if (!submitted) restore();
      }, restore);
    },
    [controller, draft.key, drafts, prompt, submitBlocked],
  );
  const recoveryRevision = promptRevisionRef.current;
  const recoveryOwner = promptOwnerRef.current;
  return {
    ...composerProps,
    recoveryReason: recovery?.reason,
    onRecoverDraft:
      recovery == null || recovery.reason === "conversationImagesTooLarge"
        ? undefined
        : () => {
            if (
              promptRevisionRef.current !== recoveryRevision ||
              promptOwnerRef.current !== recoveryOwner
            )
              return "unavailable";
            const outcome = carryAgentDraftIntoRecovery(drafts, recovery, prompt);
            if (outcome === "started") {
              focusAgentComposerPrompt(drafts.readDraft(recovery.draftKey).length);
            }
            return outcome;
          },
    promptRevision: promptRevisionRef.current,
    onPromptChange: changePrompt,
    onSubmit: submit,
    prompt,
    promptBytes,
    submitBlocked,
  };
}

function restoredDraftText(current: string, restored: string): string {
  const merged = mergeRestoredPrompt(current, restored);
  return agentPromptByteLength(merged) > MAX_AGENT_COMPOSER_DRAFT_BYTES ? current : merged;
}

export const AGENT_COMPOSER_PROMPT_ID = "agent-prompt";

export function focusAgentComposerPrompt(caret: number): void {
  if (typeof document === "undefined") return;
  const node = document.getElementById(AGENT_COMPOSER_PROMPT_ID);
  if (!(node instanceof HTMLTextAreaElement)) return;
  node.focus({ preventScroll: true });
  node.setSelectionRange(caret, caret);
}

function composerDispatching(
  agents: Pick<AgentComposerSurface, "dispatching" | "dispatchingKeys">,
  draftKey: string | null,
): boolean {
  if (agents.dispatchingKeys === undefined) return agents.dispatching;
  if (draftKey === null) return false;
  return agents.dispatchingKeys.has(draftKey);
}

export function agentComposerDraftKey(
  selectedThread: AgentThreadView | null,
  target: ComposerTarget | null,
): string | null {
  if (selectedThread !== null) return selectedThread.thread.threadId;
  if (target === null) return null;
  return agentDraftDispatchKey(target.projectRootKey);
}

function readComposerDraft(drafts: AgentComposerDraftStore, key: string | null): string {
  if (key === null) return "";
  return drafts.readDraft(key);
}

function seedComposerPrompt(
  drafts: AgentComposerDraftStore,
  previousKey: string | null,
  nextKey: string | null,
  current: string,
): string {
  if (nextKey === null) return current;
  const stored = drafts.readDraft(nextKey);
  if (stored !== "") return stored;
  if (previousKey === null) return current;
  return "";
}

function retainForeignComposerDraft(
  drafts: AgentComposerDraftStore,
  key: string | null,
  text: string,
): void {
  if (key === null) return;
  if (drafts.readDraft(key) !== "") return;
  drafts.writeDraft(key, text);
}

function writeComposerDraft(
  drafts: AgentComposerDraftStore,
  key: string | null,
  text: string,
): void {
  if (key === null) return;
  drafts.writeDraft(key, text);
}

type ComposerSubmissionAuthority =
  | {
      readonly kind: "followUp";
      readonly steer: boolean;
      readonly threadId: string;
      readonly rootKey: string;
      readonly ownerId: string;
      readonly repositoryRoot: string;
    }
  | {
      readonly kind: "new";
      readonly projectRootKey: string;
      readonly repositoryRoot: string;
      readonly ownerId: string;
      readonly generation: number;
    };

function composerSubmissionAuthority(
  selectedThread: AgentThreadView | null,
  target: ComposerTarget | null,
  project: AgentProjectDescriptor | null,
  steer: boolean,
): ComposerSubmissionAuthority | null {
  if (selectedThread !== null) {
    return {
      kind: "followUp",
      steer,
      threadId: selectedThread.thread.threadId,
      rootKey: selectedThread.thread.owner.rootKey,
      ownerId: selectedThread.thread.owner.ownerId,
      repositoryRoot: selectedThread.thread.owner.repositoryRoot,
    };
  }
  if (target === null || project === null) return null;
  return {
    kind: "new",
    projectRootKey: target.projectRootKey,
    repositoryRoot: target.repositoryRoot,
    ownerId: project.ownerId,
    generation: project.generation,
  };
}

function composerSubmissionAuthorityEqual(
  current: ComposerSubmissionAuthority | null,
  captured: ComposerSubmissionAuthority,
): boolean {
  if (current === null || current.kind !== captured.kind) return false;
  switch (captured.kind) {
    case "followUp":
      if (current.kind !== "followUp") return false;
      return (
        current.steer === captured.steer &&
        current.threadId === captured.threadId &&
        current.rootKey === captured.rootKey &&
        current.ownerId === captured.ownerId &&
        current.repositoryRoot === captured.repositoryRoot
      );
    case "new":
      if (current.kind !== "new") return false;
      return (
        current.projectRootKey === captured.projectRootKey &&
        current.repositoryRoot === captured.repositoryRoot &&
        current.ownerId === captured.ownerId &&
        current.generation === captured.generation
      );
  }
}

function composerProjectOptions(
  groups: ReadonlyArray<AgentProjectGroup>,
  projects: ReadonlyArray<AgentProjectDescriptor>,
): ReadonlyArray<AgentComposerProjectOption> {
  return groups
    .filter(
      (group) =>
        group.kind === "project" &&
        group.trust === "trusted" &&
        group.origin !== "closed-tab-live-tasks",
    )
    .flatMap((group) => {
      const project =
        projects.find((candidate) => candidate.rootKey === group.projectRootKey) ?? null;
      if (project === null) return [];
      return [
        {
          projectRootKey: group.projectRootKey,
          ownerId: project.ownerId,
          generation: project.generation,
          label: group.label,
          origin: group.origin,
          rootPath: project.rootPath,
          repositories: group.repos
            .filter((repo) => repo.repositoryResolved && repo.repositoryRoot !== project.rootPath)
            .map((repo) => ({
              repositoryRoot: repo.repositoryRoot,
              label: repo.label,
            })),
        },
      ];
    });
}

function useComposerMode(
  selectedThread: AgentThreadView | null,
  agents: AgentComposerSurface,
  agentCliKind: AgentCliKind,
): AgentComposerMode {
  const { agentCliConfigured, liveTaskCount, maxConcurrentAgentTasks } = agents;
  return useMemo<AgentComposerMode>(() => {
    if (selectedThread === null) return { kind: "new" };
    if (
      agentThreadAcceptsQueuedMessage(selectedThread.thread) &&
      (selectedThread.execution?.kind !== "remote" ||
        selectedThread.execution.pendingMessages === true)
    ) {
      return { kind: "steer", threadId: selectedThread.thread.threadId };
    }
    return {
      kind: "followUp",
      blockedReason: agentFollowUpBlockedReason(selectedThread, {
        agentCliConfigured,
        agentCliKind,
        liveTaskCount,
        maxConcurrentAgentTasks,
      }),
    };
  }, [agentCliConfigured, agentCliKind, liveTaskCount, maxConcurrentAgentTasks, selectedThread]);
}
