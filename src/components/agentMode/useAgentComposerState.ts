import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import {
  MAX_AGENT_TASK_PROMPT_BYTES,
  type AgentCliKind,
  type AgentTaskIsolation,
} from "../../domain/agentTask";
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
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly groups: ReadonlyArray<AgentProjectGroup>;
  readonly selectedThread: AgentThreadView | null;
  readonly railScope: ComposerScope;
  onClearSelectedThread(): void;
  onThreadStarted(threadId: string): void;
}

export interface AgentComposerState {
  readonly target: ComposerTarget | null;
  readonly composerLabel: string | null;
  readonly composerProps: AgentComposerPromptProps;
  startNewThread(projectRootKey: string, repositoryRoot: string): void;
  clearSelection(): void;
}

export type AgentComposerControllerProps = Omit<
  AgentComposerProps,
  | "onOpenProviderSettings"
  | "onPromptChange"
  | "onSubmit"
  | "prompt"
  | "promptBytes"
  | "providerEnabled"
  | "submitBlocked"
>;

export type AgentComposerPromptProps = Omit<
  AgentComposerProps,
  "onOpenProviderSettings" | "providerEnabled"
>;

export interface AgentComposerControllerState {
  readonly target: ComposerTarget | null;
  readonly composerLabel: string | null;
  readonly composerProps: AgentComposerControllerProps;
  readonly submissionBlocked: boolean;
  submit(prompt: string, submission: AgentComposerSubmission): Promise<boolean>;
  startNewThread(projectRootKey: string, repositoryRoot: string): void;
  clearSelection(): void;
}

export type AgentComposerPromptController = Pick<
  AgentComposerControllerState,
  "composerProps" | "submissionBlocked" | "submit"
>;

export function useAgentComposerState({
  ...options
}: AgentComposerStateOptions): AgentComposerState {
  const controller = useAgentComposerControllerState(options);
  const composerProps = useAgentComposerPromptState(controller);
  return {
    target: controller.target,
    composerLabel: controller.composerLabel,
    composerProps,
    startNewThread: controller.startNewThread,
    clearSelection: controller.clearSelection,
  };
}

export function useAgentComposerControllerState({
  agents,
  groups,
  onClearSelectedThread,
  onThreadStarted,
  projects,
  providerEnabled,
  railScope,
  selectedThread,
}: AgentComposerStateOptions): AgentComposerControllerState {
  const [selection, setSelection] = useState<ComposerSelection | null>(null);
  const [isolationChoice, setIsolationChoice] = useState<IsolationChoice | null>(null);
  const [unsafeConfirmed, setUnsafeConfirmed] = useState<string | null>(null);
  const [launchChoice, setLaunchChoice] = useState<LaunchChoice | null>(null);
  const [dangerousConfirmed, setDangerousConfirmed] = useState(false);

  const composerProjects = useMemo(
    () => composerProjectOptions(groups, projects),
    [groups, projects],
  );
  useLayoutEffect(() => {
    if (railScope.kind !== "repository") return;
    setSelection((current) => {
      if (current === null) return null;
      if (
        current.projectRootKey === railScope.projectRootKey &&
        current.repositoryRoot === railScope.repositoryRoot
      ) {
        return current;
      }
      return null;
    });
  }, [railScope]);
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
  const targetRootKey = target?.projectRootKey ?? null;
  const launchScope = useMemo(
    () => resolveLaunchScope(selectedThread, targetRootKey),
    [selectedThread, targetRootKey],
  );
  const agentCliKind = composerProviderKind(selectedThread, agents.agentCliKind, providerEnabled);
  const composerMode = useComposerMode(selectedThread, agents, agentCliKind);
  const lastUsedLaunch = agents.lastUsedLaunch;
  const composerLaunch = useMemo(
    () => resolveComposerLaunch(launchChoice, launchScope, agentCliKind, lastUsedLaunch),
    [agentCliKind, lastUsedLaunch, launchChoice, launchScope],
  );
  const launchKey = `${launchScope?.key ?? ""}|${agentLaunchKey(composerLaunch)}`;
  useEffect(() => {
    setDangerousConfirmed(false);
  }, [launchKey]);

  const submissionBlocked =
    agents.dispatching ||
    (selectedThread === null &&
      (target === null || (isolation === "in-place" && guard.kind === "unsafe" && !confirmed)));

  const startNewThread = useCallback(
    (projectRootKey: string, repositoryRoot: string) => {
      onClearSelectedThread();
      const project =
        composerProjects.find((candidate) => candidate.projectRootKey === projectRootKey) ?? null;
      const repository =
        project?.repositories.find((candidate) => candidate.repositoryRoot === repositoryRoot) ??
        null;
      setSelection(
        project === null || repository === null
          ? { kind: "missing", projectRootKey, repositoryRoot }
          : {
              kind: "bound",
              projectRootKey,
              repositoryRoot,
              ownerId: project.ownerId,
              generation: project.generation,
            },
      );
      setUnsafeConfirmed(null);
    },
    [composerProjects, onClearSelectedThread],
  );

  const clearSelection = useCallback(() => {
    onClearSelectedThread();
    setSelection(null);
    setUnsafeConfirmed(null);
  }, [onClearSelectedThread]);

  const sendFollowUp = agents.sendFollowUp;
  const startThread = agents.startThread;
  const submissionAuthority = composerSubmissionAuthority(selectedThread, target, composerProject);
  const submissionAuthorityRef = useRef(submissionAuthority);
  submissionAuthorityRef.current = submissionAuthority;

  const submit = useCallback(
    async (prompt: string, submission: AgentComposerSubmission) => {
      setDangerousConfirmed(false);
      const authority = submissionAuthority;
      if (authority === null) return false;
      switch (authority.kind) {
        case "followUp": {
          const sent = await sendFollowUp({
            threadId: authority.threadId,
            prompt,
            launch: submission.launch,
            dangerousLaunchConfirmed: submission.dangerousLaunchConfirmed,
          });
          if (!sent) return false;
          return composerSubmissionAuthorityEqual(submissionAuthorityRef.current, authority);
        }
        case "new": {
          const started = await startThread({
            projectRootKey: authority.projectRootKey,
            repositoryRoot: authority.repositoryRoot,
            prompt,
            isolation,
            unsafeInPlaceConfirmationKey: confirmed ? confirmationKey : null,
            launch: submission.launch,
            dangerousLaunchConfirmed: submission.dangerousLaunchConfirmed,
          });
          if (started === null) return false;
          if (!composerSubmissionAuthorityEqual(submissionAuthorityRef.current, authority)) {
            return false;
          }
          setUnsafeConfirmed(null);
          onThreadStarted(started.threadId);
          return true;
        }
      }
    },
    [
      confirmationKey,
      confirmed,
      isolation,
      onThreadStarted,
      sendFollowUp,
      startThread,
      submissionAuthority,
    ],
  );

  const selectRepository = useCallback(
    (repositoryRoot: string) => {
      if (target === null) return;
      const project =
        composerProjects.find((candidate) => candidate.projectRootKey === target.projectRootKey) ??
        null;
      if (project === null) return;
      if (!project.repositories.some((candidate) => candidate.repositoryRoot === repositoryRoot)) {
        return;
      }
      setSelection({
        kind: "bound",
        projectRootKey: target.projectRootKey,
        repositoryRoot,
        ownerId: project.ownerId,
        generation: project.generation,
      });
      setUnsafeConfirmed(null);
    },
    [composerProjects, target],
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

  const composerProps: AgentComposerControllerProps = {
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
    onSelectRepository: selectRepository,
    onUnsafeConfirmedChange: changeUnsafeConfirmed,
    target: composerTargetView(composerProjects, target),
    unsafeConfirmed: confirmed,
    worktreeOnly,
    worktreeOnlyReason,
  };

  return {
    target,
    composerLabel,
    composerProps,
    submissionBlocked,
    submit,
    startNewThread,
    clearSelection,
  };
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

export function useAgentComposerPromptState(
  controller: AgentComposerPromptController,
): AgentComposerPromptProps {
  const [prompt, setPrompt] = useState("");
  const promptRevisionRef = useRef(0);
  const changePrompt = useCallback((next: string) => {
    promptRevisionRef.current += 1;
    setPrompt(next);
  }, []);
  const submit = useCallback(
    (submission: AgentComposerSubmission) => {
      const submittedPrompt = prompt;
      const submittedRevision = promptRevisionRef.current;
      void controller.submit(submittedPrompt, submission).then((submitted) => {
        if (!submitted) return;
        if (promptRevisionRef.current !== submittedRevision) return;
        promptRevisionRef.current += 1;
        setPrompt("");
      });
    },
    [controller, prompt],
  );
  const promptBytes = agentPromptByteLength(prompt);
  const promptInvalid = prompt.trim() === "" || promptBytes > MAX_AGENT_TASK_PROMPT_BYTES;
  return {
    ...controller.composerProps,
    onPromptChange: changePrompt,
    onSubmit: submit,
    prompt,
    promptBytes,
    submitBlocked: controller.submissionBlocked || promptInvalid,
  };
}

type ComposerSubmissionAuthority =
  | {
      readonly kind: "followUp";
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
): ComposerSubmissionAuthority | null {
  if (selectedThread !== null) {
    return {
      kind: "followUp",
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
          repositories: group.repos
            .filter((repo) => repo.repositoryResolved)
            .map((repo) => ({
              repositoryRoot: repo.repositoryRoot,
              label: repo.label,
            })),
        },
      ];
    })
    .filter((option) => option.repositories.length > 0);
}

function useComposerMode(
  selectedThread: AgentThreadView | null,
  agents: AgentComposerSurface,
  agentCliKind: AgentCliKind,
): AgentComposerMode {
  const { agentCliConfigured, liveTaskCount, maxConcurrentAgentTasks } = agents;
  const providerConfigured = selectedThread === null ? agentCliConfigured : true;
  return useMemo<AgentComposerMode>(() => {
    if (selectedThread === null) return { kind: "new" };
    return {
      kind: "followUp",
      threadTitle: agentThreadDisplayTitle(selectedThread.thread),
      blockedReason: agentFollowUpBlockedReason(selectedThread, {
        agentCliConfigured: providerConfigured,
        agentCliKind,
        liveTaskCount,
        maxConcurrentAgentTasks,
      }),
    };
  }, [agentCliKind, liveTaskCount, maxConcurrentAgentTasks, providerConfigured, selectedThread]);
}
