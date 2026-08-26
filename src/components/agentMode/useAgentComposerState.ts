import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { MAX_AGENT_TASK_PROMPT_BYTES, type AgentTaskIsolation } from "../../domain/agentTask";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import type {
  AgentComposerMode,
  AgentComposerProps,
  AgentComposerSubmission,
} from "./AgentComposer";
import {
  agentLaunchKey,
  resolveComposerLaunch,
  resolveLaunchScope,
  type IsolationChoice,
  type LaunchChoice,
} from "./agentComposerLaunch";
import {
  composerTargetView,
  resolveComposerTarget,
  type AgentComposerProjectOption,
  type ComposerTarget,
} from "./agentComposerTarget";
import type { AgentRailScope } from "./agentSidebarPresentation";
import {
  agentFollowUpBlockedReason,
  agentIsolationReasonLabel,
  agentProjectWorktreeOnly,
  agentProjectWorktreeOnlyReason,
  agentPromptByteLength,
  agentThreadDisplayTitle,
  type AgentProjectGroup,
} from "./agentModePresentation";

export type AgentComposerSurface = Pick<
  AgentThreadsSurface,
  | "agentCliConfigured"
  | "agentCliKind"
  | "dispatching"
  | "isolationPreview"
  | "lastUsedLaunch"
  | "liveTaskCount"
  | "maxConcurrentAgentTasks"
  | "refreshIsolationStatus"
  | "sendFollowUp"
  | "startThread"
>;

export interface AgentComposerStateOptions {
  readonly agents: AgentComposerSurface;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly groups: ReadonlyArray<AgentProjectGroup>;
  readonly selectedThread: AgentThreadView | null;
  readonly railScope: AgentRailScope;
  onClearSelectedThread(): void;
  onThreadStarted(threadId: string): void;
}

export interface AgentComposerState {
  readonly target: ComposerTarget | null;
  readonly composerLabel: string | null;
  readonly composerProps: AgentComposerProps;
  startNewThread(projectRootKey: string, repositoryRoot: string): void;
  clearSelection(): void;
}

export function useAgentComposerState({
  agents,
  groups,
  onClearSelectedThread,
  onThreadStarted,
  projects,
  railScope,
  selectedThread,
}: AgentComposerStateOptions): AgentComposerState {
  const [selection, setSelection] = useState<ComposerTarget | null>(null);
  const [prompt, setPrompt] = useState("");
  const [isolationChoice, setIsolationChoice] = useState<IsolationChoice | null>(null);
  const [unsafeConfirmed, setUnsafeConfirmed] = useState<string | null>(null);
  const [launchChoice, setLaunchChoice] = useState<LaunchChoice | null>(null);
  const [dangerousConfirmed, setDangerousConfirmed] = useState(false);

  const composerProjects = useMemo(() => composerProjectOptions(groups), [groups]);
  const target = resolveComposerTarget(composerProjects, selection, selectedThread, railScope);
  const composerRoot = target?.repositoryRoot ?? null;
  const composerProject =
    projects.find((project) => project.rootKey === target?.projectRootKey) ?? null;
  const composerLabel =
    groups.flatMap((group) => group.repos).find((repo) => repo.repositoryRoot === composerRoot)
      ?.label ?? null;
  const worktreeOnly = composerProject !== null && agentProjectWorktreeOnly(composerProject.origin);
  const worktreeOnlyReason =
    composerProject === null ? null : agentProjectWorktreeOnlyReason(composerProject.origin);

  const preview = composerRoot === null ? null : agents.isolationPreview(composerRoot);
  const refreshIsolationStatus = agents.refreshIsolationStatus;
  useEffect(() => {
    if (composerRoot === null) return;
    void refreshIsolationStatus(composerRoot);
  }, [composerRoot, refreshIsolationStatus]);
  const recommended: AgentTaskIsolation =
    preview === null || preview.recommended.kind === "in-place" ? "in-place" : "worktree";
  const chosen: AgentTaskIsolation =
    isolationChoice !== null && isolationChoice.repositoryRoot === composerRoot
      ? isolationChoice.isolation
      : recommended;
  const isolation: AgentTaskIsolation = worktreeOnly ? "worktree" : chosen;
  const guard = preview?.inPlaceGuard ?? { kind: "safe" as const };
  const confirmationKey = preview?.confirmationKey ?? null;
  const confirmed = confirmationKey !== null && unsafeConfirmed === confirmationKey;
  const promptBytes = agentPromptByteLength(prompt);
  const promptEmpty = prompt.trim() === "" || promptBytes > MAX_AGENT_TASK_PROMPT_BYTES;
  const composerMode = useComposerMode(selectedThread, agents);

  const targetRootKey = target?.projectRootKey ?? null;
  const launchScope = useMemo(
    () => resolveLaunchScope(selectedThread, targetRootKey),
    [selectedThread, targetRootKey],
  );
  const agentCliKind = agents.agentCliKind;
  const lastUsedLaunch = agents.lastUsedLaunch;
  const composerLaunch = useMemo(
    () => resolveComposerLaunch(launchChoice, launchScope, agentCliKind, lastUsedLaunch),
    [agentCliKind, lastUsedLaunch, launchChoice, launchScope],
  );
  const launchKey = `${launchScope?.key ?? ""}|${agentLaunchKey(composerLaunch)}`;
  useEffect(() => {
    setDangerousConfirmed(false);
  }, [launchKey]);

  const submitBlocked =
    agents.dispatching ||
    promptEmpty ||
    (selectedThread === null &&
      (target === null || (isolation === "in-place" && guard.kind === "unsafe" && !confirmed)));

  const startNewThread = useCallback(
    (projectRootKey: string, repositoryRoot: string) => {
      onClearSelectedThread();
      setSelection({ projectRootKey, repositoryRoot });
      setUnsafeConfirmed(null);
    },
    [onClearSelectedThread],
  );

  const clearSelection = useCallback(() => {
    onClearSelectedThread();
    setUnsafeConfirmed(null);
  }, [onClearSelectedThread]);

  const sendFollowUp = agents.sendFollowUp;
  const startThread = agents.startThread;
  const followUpThreadId = selectedThread?.thread.threadId ?? null;

  const submit = useCallback(
    (submission: AgentComposerSubmission) => {
      setDangerousConfirmed(false);
      if (followUpThreadId !== null) {
        void sendFollowUp({
          threadId: followUpThreadId,
          prompt,
          launch: submission.launch,
          dangerousLaunchConfirmed: submission.dangerousLaunchConfirmed,
        }).then((sent) => {
          if (!sent) return;
          setPrompt("");
        });
        return;
      }
      if (target === null) return;
      void startThread({
        projectRootKey: target.projectRootKey,
        repositoryRoot: target.repositoryRoot,
        prompt,
        isolation,
        unsafeInPlaceConfirmationKey: confirmed ? confirmationKey : null,
        launch: submission.launch,
        dangerousLaunchConfirmed: submission.dangerousLaunchConfirmed,
      }).then((started) => {
        if (started === null) return;
        setPrompt("");
        setUnsafeConfirmed(null);
        onThreadStarted(started.threadId);
      });
    },
    [
      confirmationKey,
      confirmed,
      followUpThreadId,
      isolation,
      onThreadStarted,
      prompt,
      sendFollowUp,
      startThread,
      target,
    ],
  );

  const selectRepository = useCallback(
    (repositoryRoot: string) => {
      if (target === null) return;
      setSelection({ projectRootKey: target.projectRootKey, repositoryRoot });
      setUnsafeConfirmed(null);
    },
    [target],
  );

  const changeIsolation = useCallback(
    (next: AgentTaskIsolation) => {
      if (composerRoot === null) return;
      setIsolationChoice({ repositoryRoot: composerRoot, isolation: next });
      setUnsafeConfirmed(null);
    },
    [composerRoot],
  );

  const changeLaunch = useCallback(
    (next: AgentComposerSubmission["launch"]) => {
      if (launchScope === null) return;
      setLaunchChoice({ key: launchScope.key, launch: next });
    },
    [launchScope],
  );

  const changeUnsafeConfirmed = useCallback(
    (next: boolean) => setUnsafeConfirmed(next ? confirmationKey : null),
    [confirmationKey],
  );

  const composerProps: AgentComposerProps = {
    dangerousConfirmed,
    dispatching: agents.dispatching,
    guard,
    isolation,
    isolationReason: preview === null ? null : agentIsolationReasonLabel(preview.recommended),
    launch: composerLaunch,
    launchProvider: agentCliKind,
    mode: composerMode,
    onDangerousConfirmedChange: setDangerousConfirmed,
    onIsolationChange: changeIsolation,
    onLaunchChange: changeLaunch,
    onNewThread: clearSelection,
    onPromptChange: setPrompt,
    onSelectRepository: selectRepository,
    onSubmit: submit,
    onUnsafeConfirmedChange: changeUnsafeConfirmed,
    prompt,
    promptBytes,
    submitBlocked,
    target: composerTargetView(composerProjects, target),
    unsafeConfirmed: confirmed,
    worktreeOnly,
    worktreeOnlyReason,
  };

  return { target, composerLabel, composerProps, startNewThread, clearSelection };
}

function composerProjectOptions(
  groups: ReadonlyArray<AgentProjectGroup>,
): ReadonlyArray<AgentComposerProjectOption> {
  return groups
    .filter(
      (group) =>
        group.kind === "project" &&
        group.trust === "trusted" &&
        group.origin !== "closed-tab-live-tasks",
    )
    .map((group) => ({
      projectRootKey: group.projectRootKey,
      label: group.label,
      origin: group.origin,
      repositories: group.repos
        .filter((repo) => repo.repositoryResolved)
        .map((repo) => ({
          repositoryRoot: repo.repositoryRoot,
          label: repo.label,
        })),
    }))
    .filter((option) => option.repositories.length > 0);
}

function useComposerMode(
  selectedThread: AgentThreadView | null,
  agents: AgentComposerSurface,
): AgentComposerMode {
  const { agentCliConfigured, agentCliKind, liveTaskCount, maxConcurrentAgentTasks } = agents;
  return useMemo<AgentComposerMode>(() => {
    if (selectedThread === null) return { kind: "new" };
    return {
      kind: "followUp",
      threadTitle: agentThreadDisplayTitle(selectedThread.thread),
      blockedReason: agentFollowUpBlockedReason(selectedThread, {
        agentCliConfigured,
        agentCliKind,
        liveTaskCount,
        maxConcurrentAgentTasks,
      }),
    };
  }, [agentCliConfigured, agentCliKind, liveTaskCount, maxConcurrentAgentTasks, selectedThread]);
}
