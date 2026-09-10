import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { useAgentComposerRepositoryInteraction } from "./useAgentComposerRepositoryInteraction";
import {
  useAgentComposerRepositoryPreference,
  type ComposerRepositoryPreferenceStorage,
} from "./useAgentComposerRepositoryPreference";
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
  resolveComposerLaunch,
  resolveLaunchScope,
  type IsolationChoice,
  type LaunchChoice,
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

export const IMPORTED_THREAD_COMPOSER_CAPTION =
  "Runs in the project checkout - imported sessions continue where the terminal session ran.";
export const NOT_REPOSITORY_COMPOSER_CAPTION = "Not a Git repository · runs in place";
export const NOT_REPOSITORY_WORKTREE_ONLY_CAPTION =
  "This folder is not a Git repository, so it cannot run in an isolated worktree. Choose a repository from the checkout menu.";

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
  readonly railScope: ComposerScope | null;
  readonly repositoryPreferenceStorage?: ComposerRepositoryPreferenceStorage;
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
  repositoryPreferenceStorage,
  selectedThread,
}: AgentComposerStateOptions): AgentComposerControllerState {
  const [selection, setSelection] = useState<ComposerSelection | null>(null);
  const { preferences, rememberRepository } = useAgentComposerRepositoryPreference(
    repositoryPreferenceStorage,
  );
  const [isolationChoice, setIsolationChoice] = useState<IsolationChoice | null>(null);
  const [launchChoice, setLaunchChoice] = useState<LaunchChoice | null>(null);

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
  const worktreeOnly = composerProject !== null && agentProjectWorktreeOnly(composerProject.origin);
  const worktreeOnlyReason =
    composerProject === null ? null : agentProjectWorktreeOnlyReason(composerProject.origin);

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
  const isolation: AgentTaskIsolation = worktreeOnly
    ? "worktree"
    : worktreeAvailable
      ? chosen
      : "in-place";
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
  const lastUsedLaunch = agents.lastUsedLaunch;
  const composerLaunch = useMemo(
    () => resolveComposerLaunch(launchChoice, launchScope, agentCliKind, lastUsedLaunch),
    [agentCliKind, lastUsedLaunch, launchChoice, launchScope],
  );

  const submissionBlocked =
    agents.dispatching ||
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

  const clearSelection = useCallback(() => {
    onClearSelectedThread();
    setSelection(null);
  }, [onClearSelectedThread]);

  const sendFollowUp = agents.sendFollowUp;
  const startThread = agents.startThread;
  const submissionAuthority = composerSubmissionAuthority(selectedThread, target, composerProject);
  const submissionAuthorityRef = useRef(submissionAuthority);
  submissionAuthorityRef.current = submissionAuthority;

  const submit = useCallback(
    async (prompt: string, submission: AgentComposerSubmission) => {
      if (submissionBlocked) return false;
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
          return sent;
        }
        case "new": {
          const started = await startThread({
            projectRootKey: authority.projectRootKey,
            repositoryRoot: authority.repositoryRoot,
            prompt,
            isolation,
            unsafeInPlaceConfirmationKey,
            launch: submission.launch,
            dangerousLaunchConfirmed: submission.dangerousLaunchConfirmed,
          });
          if (started === null) return false;
          if (!composerSubmissionAuthorityEqual(submissionAuthorityRef.current, authority)) {
            return false;
          }
          onThreadStarted(started.threadId);
          return true;
        }
      }
    },
    [
      unsafeInPlaceConfirmationKey,
      isolation,
      onThreadStarted,
      sendFollowUp,
      startThread,
      submissionBlocked,
      submissionAuthority,
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
      setIsolationChoice({ repositoryRoot: composerRoot, isolation: next });
    },
    [composerRoot, worktreeAvailable],
  );

  const changeLaunch = useCallback(
    (next: AgentComposerSubmission["launch"]) => {
      setLaunchChoice({ key: launchScope.key, launch: next });
    },
    [launchScope],
  );

  const composerProps: AgentComposerControllerProps = {
    dispatching: agents.dispatching,
    guard,
    isolation,
    isolationReason:
      importedThreadCaption(selectedThread) ??
      isolationStatusCaption(preview, isolation, worktreeOnly),
    launch: composerLaunch,
    launchProvider: agentCliKind,
    mode: composerMode,
    onIsolationChange: changeIsolation,
    onRefreshIsolation: refreshIsolation,
    onLaunchChange: changeLaunch,
    onNewThread: clearSelection,
    onSelectRepository: selectRepository,
    target: composerTargetView(composerProjects, target),
    worktreeAvailable,
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

const SAFE_GUARD = { kind: "safe" } as const;

function isolationStatusCaption(
  preview: ReturnType<AgentComposerSurface["isolationPreview"]> | null,
  isolation: AgentTaskIsolation,
  worktreeOnly: boolean,
): string | null {
  if (preview === null) return null;
  if (preview.repositoryStatus === undefined) {
    return preview.recommended.kind === isolation
      ? agentIsolationReasonLabel(preview.recommended)
      : null;
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
      return preview.recommended.kind === isolation
        ? agentIsolationReasonLabel(preview.recommended)
        : null;
  }
}

function importedThreadCaption(selectedThread: AgentThreadView | null): string | null {
  if (selectedThread === null) return null;
  if (selectedThread.thread.externalOrigin === null) return null;
  return IMPORTED_THREAD_COMPOSER_CAPTION;
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
      const clearedRevision = promptRevisionRef.current + 1;
      promptRevisionRef.current = clearedRevision;
      setPrompt("");
      void controller.submit(submittedPrompt, submission).then((submitted) => {
        if (submitted) return;
        if (promptRevisionRef.current !== clearedRevision) return;
        promptRevisionRef.current += 1;
        setPrompt(submittedPrompt);
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
