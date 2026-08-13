import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import {
  MAX_AGENT_TASK_PROMPT_BYTES,
  agentTasksReducer,
  defaultAgentTaskIsolation,
  emptyAgentTasksState,
  inPlaceDispatchGuard,
  isTerminalAgentTaskStatus,
  mintAgentTaskId,
  type AgentCliKind,
  type AgentIsolationDefault,
  type AgentTaskGateway,
  type AgentTaskIsolation,
  type AgentTaskIsolationContext,
  type AgentTaskRecord,
  type AgentTaskStatusEvent,
  type AgentTasksAction,
  type InPlaceDispatchGuard,
  type InPlaceDispatchUnsafeReason,
} from "../domain/agentTask";
import {
  normalizeAgentCliKind,
  normalizeAgentCliPath,
  normalizeAgentIsolationPolicy,
  normalizeMaxConcurrentAgentTasks,
} from "../domain/agentSettings";
import type { GitChangedFile, GitGateway, GitStatus } from "../domain/git";
import {
  MAX_WORKTREES_PER_REPOSITORY,
  WORKTREE_BASE_DIR_NAME,
  type AgentWorktreeReceipt,
  type GitWorktreeGateway,
} from "../domain/gitWorktree";
import type { ResolvedGitRepository } from "../domain/gitRepositoryMapping";
import type { WorkbenchPrompter } from "./workbenchPrompter";

export const MAX_AGENT_TASK_CHANGE_ROWS = 500;
export const MAX_AGENT_TASK_DIFF_SIDE_BYTES = 128 * 1_024;

export type AgentTasksNoticeAction = "configure-agent-cli" | null;

export interface AgentTasksNotice {
  readonly kind: "info" | "warning" | "error";
  readonly message: string;
  readonly action: AgentTasksNoticeAction;
}

export interface AgentRepositoryStatusSnapshot {
  readonly known: boolean;
  readonly dirty: boolean;
}

export interface AgentTaskDiffSide {
  readonly text: string;
  readonly truncated: boolean;
}

export interface AgentTaskFileDiff {
  readonly relativePath: string;
  readonly loading: boolean;
  readonly error: string | null;
  readonly original: AgentTaskDiffSide;
  readonly modified: AgentTaskDiffSide;
  readonly unavailableReason: "binary" | "large" | null;
}

export interface AgentTaskChangeSummary {
  readonly loading: boolean;
  readonly error: string | null;
  readonly files: ReadonlyArray<GitChangedFile>;
  readonly truncated: boolean;
  readonly removing: boolean;
  readonly diff: AgentTaskFileDiff | null;
}

export interface AgentTaskView {
  readonly record: AgentTaskRecord;
  readonly repositoryLabel: string;
  readonly terminal: boolean;
  readonly worktreeRemoved: boolean;
  readonly changeSummary: AgentTaskChangeSummary | null;
}

export interface OrphanedWorktreeView {
  readonly repositoryRoot: string;
  readonly worktreePath: string;
  readonly branch: string | null;
  readonly prunable: boolean;
  readonly removing: boolean;
}

export interface AgentIsolationPreview {
  readonly repositoryRoot: string;
  readonly recommended: AgentIsolationDefault;
  readonly inPlaceGuard: InPlaceDispatchGuard;
  readonly inPlaceAllowed: boolean;
  readonly confirmationKey: string | null;
}

export interface AgentTaskDispatchRequest {
  readonly projectRootKey: string;
  readonly repositoryRoot: string;
  readonly prompt: string;
  readonly isolation: AgentTaskIsolation;
  readonly unsafeInPlaceConfirmationKey: string | null;
}

export interface AgentTaskDispatchResult {
  readonly taskId: string;
}

export interface AgentTasksDependencies {
  readonly agentTaskGateway: AgentTaskGateway;
  readonly gitWorktreeGateway: GitWorktreeGateway;
  readonly gitGateway: Pick<GitGateway, "getStatus" | "getDiff">;
  readonly prompter: WorkbenchPrompter;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly getAgentCliPath: () => string | null;
  readonly getAgentCliKind: () => AgentCliKind;
  readonly getMaxConcurrentAgentTasks: () => number;
  readonly getRepositoryStatus: (repositoryRoot: string) => AgentRepositoryStatusSnapshot;
  readonly getDirtyEditorDocumentCount: (repositoryRoot: string) => number;
  readonly onProjectDispatchTrustRejected?: (projectRootKey: string) => void;
  readonly ensureProjectLease?: (projectRootKey: string) => Promise<boolean>;
  readonly reportError: (source: string, error: unknown) => void;
  readonly openAgentSettings: () => void;
  readonly now?: () => number;
  readonly createEntropyHex4?: () => string;
}

export interface AgentTasksSurface {
  readonly tasks: ReadonlyArray<AgentTaskView>;
  readonly repositories: ReadonlyArray<ResolvedGitRepository>;
  readonly orphanedWorktrees: ReadonlyArray<OrphanedWorktreeView>;
  readonly notice: AgentTasksNotice | null;
  readonly dispatching: boolean;
  readonly agentCliConfigured: boolean;
  readonly liveTaskCount: number;
  readonly maxConcurrentAgentTasks: number;
  isolationPreview(repositoryRoot: string): AgentIsolationPreview;
  refreshIsolationStatus(repositoryRoot: string): Promise<void>;
  dispatch(request: AgentTaskDispatchRequest): Promise<AgentTaskDispatchResult | null>;
  stop(taskId: string): Promise<void>;
  dismiss(taskId: string): void;
  hasLiveTasksForOwner(ownerId: string): boolean;
  stopProjectTasks(ownerId: string, repositoryRoots: ReadonlyArray<string>): Promise<void>;
  releaseProjectTasks(ownerId: string): void;
  removeOrphanedWorktree(worktreePath: string): Promise<void>;
  pruneOrphanedWorktrees(repositoryRoot: string): Promise<void>;
  showChanges(taskId: string): Promise<void>;
  hideChanges(taskId: string): void;
  showFileDiff(taskId: string, change: GitChangedFile): Promise<void>;
  hideFileDiff(taskId: string): void;
  removeWorktree(taskId: string): Promise<void>;
  configureAgentCli(): void;
  dismissNotice(): void;
}

const AGENT_TASKS_SOURCE = "Agents";
const UNTRUSTED_REPOSITORY_ERROR_MARKER = "Agent tasks require a trusted repository.";
const LEASE_REFUSED_NOTICE =
  "This project could not be protected from tab close, so the agent was not started.";
const SUMMARY_AUTHORITY_DROPPED_ERROR =
  "This project no longer owns the repository, so its changes could not be read.";
const DIFF_AUTHORITY_DROPPED_ERROR =
  "This project no longer owns the repository, so the file diff could not be read.";
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8");
const EMPTY_SUMMARY: AgentTaskChangeSummary = Object.freeze({
  loading: true,
  error: null,
  files: Object.freeze([]),
  truncated: false,
  removing: false,
  diff: null,
});

export function agentPromptByteLength(prompt: string): number {
  return UTF8_ENCODER.encode(prompt).byteLength;
}

export function useAgentTasks(dependencies: AgentTasksDependencies): AgentTasksSurface {
  const [state, dispatchAction] = useReducer(agentTasksReducer, undefined, emptyAgentTasksState);
  const [notice, setNotice] = useState<AgentTasksNotice | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [summaries, setSummaries] = useState<ReadonlyMap<string, AgentTaskChangeSummary>>(
    () => new Map(),
  );
  const [removedWorktrees, setRemovedWorktrees] = useState<ReadonlySet<string>>(() => new Set());
  const [orphanCandidates, setOrphanCandidates] = useState<
    ReadonlyMap<string, OrphanedWorktreeCandidate>
  >(() => new Map());
  const [removingOrphans, setRemovingOrphans] = useState<ReadonlySet<string>>(() => new Set());

  const dependenciesRef = useRef(dependencies);
  const stateRef = useRef(state);
  stateRef.current = state;
  const summariesRef = useRef(summaries);
  summariesRef.current = summaries;
  const orphanCandidatesRef = useRef(orphanCandidates);
  orphanCandidatesRef.current = orphanCandidates;
  const uncertainWorktreePathsRef = useRef<ReadonlySet<string>>(new Set());
  const mountedRef = useRef(true);
  const dispatchingRef = useRef(false);
  const isolationStatusesRef = useRef<ReadonlyMap<string, FreshIsolationStatus>>(new Map());
  const isolationStatusRequestGenerationRef = useRef<ReadonlyMap<string, number>>(new Map());
  const [, publishIsolationStatusGeneration] = useReducer(
    (generation: number) => generation + 1,
    0,
  );

  const maxConcurrentAgentTasks = normalizeMaxConcurrentAgentTasks(
    dependencies.getMaxConcurrentAgentTasks(),
  );
  const agentCliConfigured = normalizeAgentCliPath(dependencies.getAgentCliPath()) !== null;

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshOrphanedWorktrees = useCallback(async (): Promise<void> => {
    const projects = dependenciesRef.current.projects;
    if (projects.length === 0) {
      if (mountedRef.current) setOrphanCandidates(new Map());
      return;
    }
    const collected = new Map<string, OrphanedWorktreeCandidate>();
    for (const project of projects) {
      if (project.trust !== "trusted") continue;
      const authority = projectAuthority(project);
      for (const repository of project.repositories) {
        if (
          !isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repository.repositoryRoot)
        ) {
          break;
        }
        const listed = await tryOrReport(
          () => dependenciesRef.current.gitWorktreeGateway.listWorktrees(repository.repositoryRoot),
          dependenciesRef,
        );
        if (
          !isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repository.repositoryRoot)
        ) {
          break;
        }
        if (!listed.ok) continue;
        for (const descriptor of listed.value) {
          if (descriptor.isPrimary) continue;
          if (!isAgentWorktreePath(repository.repositoryRoot, descriptor.worktreePath)) continue;
          collected.set(descriptor.worktreePath, {
            repositoryRoot: repository.repositoryRoot,
            worktreePath: descriptor.worktreePath,
            branch: descriptor.branch,
            prunable: descriptor.prunable,
          });
        }
      }
    }
    if (!mountedRef.current) return;
    setOrphanCandidates(collected);
  }, []);

  const projectsSignature = useMemo(
    () =>
      dependencies.projects
        .map((project) =>
          [
            project.rootKey,
            project.generation,
            project.ownerId,
            project.trust,
            project.repositories.map((repository) => repository.repositoryRoot).join(","),
          ].join("#"),
        )
        .join(";"),
    [dependencies.projects],
  );

  useEffect(() => {
    void refreshOrphanedWorktrees();
  }, [refreshOrphanedWorktrees, projectsSignature]);

  const dropSummaryAuthority = useCallback((taskId: string): void => {
    if (!mountedRef.current) return;
    setSummaries((current) => {
      const summary = current.get(taskId);
      if (summary === undefined || !summary.loading) return current;
      return withSummary(current, taskId, {
        ...summary,
        loading: false,
        error: SUMMARY_AUTHORITY_DROPPED_ERROR,
      });
    });
  }, []);

  const refreshChangeSummary = useCallback(
    async (taskId: string): Promise<void> => {
      const deps = dependenciesRef.current;
      const task = stateRef.current.tasks.get(taskId);
      if (task === undefined || task.worktreePath === null) return;
      const project = projectByOwnerId(deps.projects, task.owner.workspaceId);
      if (project === undefined) {
        dropSummaryAuthority(taskId);
        return;
      }
      const authority = projectAuthority(project);
      const owner = task.owner;
      const worktreePath = task.worktreePath;

      setSummaries((current) =>
        withSummary(current, taskId, { ...summaryOf(current, taskId), loading: true, error: null }),
      );

      try {
        const status = await deps.gitGateway.getStatus(worktreePath);
        if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, owner.repositoryRoot)) {
          dropSummaryAuthority(taskId);
          return;
        }
        const files = status.changes.slice(0, MAX_AGENT_TASK_CHANGE_ROWS);
        setSummaries((current) =>
          withSummary(current, taskId, {
            ...summaryOf(current, taskId),
            loading: false,
            error: null,
            files,
            truncated: status.changes.length > MAX_AGENT_TASK_CHANGE_ROWS,
          }),
        );
      } catch (error) {
        dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error);
        if (!mountedRef.current) return;
        setSummaries((current) =>
          withSummary(current, taskId, {
            ...summaryOf(current, taskId),
            loading: false,
            error: "The worktree changes could not be read.",
          }),
        );
      }
    },
    [dropSummaryAuthority],
  );

  const handleStatusEvent = useCallback(
    (event: AgentTaskStatusEvent): void => {
      dispatchAction({ kind: "statusEvent", event });
      if (!isTerminalAgentTaskStatus(event.status)) return;
      if (event.isolation !== "worktree") return;
      void refreshOrphanedWorktrees();
      if (!summariesRef.current.has(event.taskId)) return;
      void refreshChangeSummary(event.taskId);
    },
    [refreshChangeSummary, refreshOrphanedWorktrees],
  );

  useEffect(() => {
    let disposed = false;
    const unsubscribers: Array<() => void> = [];
    const gateway = dependenciesRef.current.agentTaskGateway;
    const report = dependenciesRef.current.reportError;

    const retain = (unsubscribe: () => void): void => {
      if (disposed) {
        unsubscribe();
        return;
      }
      unsubscribers.push(unsubscribe);
    };

    gateway
      .subscribeAgentTaskStatus(handleStatusEvent)
      .then(retain)
      .catch((error: unknown) => report(AGENT_TASKS_SOURCE, error));
    gateway
      .subscribeAgentTaskOutput((event) => dispatchAction({ kind: "outputEvent", event }))
      .then(retain)
      .catch((error: unknown) => report(AGENT_TASKS_SOURCE, error));

    return () => {
      disposed = true;
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
    };
  }, [handleStatusEvent]);

  const isolationContext = useCallback((repositoryRoot: string): AgentTaskIsolationContext => {
    const deps = dependenciesRef.current;
    const project = owningProjectForRepository(deps.projects, repositoryRoot);
    const authority = project === undefined ? null : projectAuthority(project);
    const fresh = isolationStatusesRef.current.get(repositoryRoot);
    const status =
      fresh && authority !== null && sameProjectAuthority(fresh.authority, authority)
        ? fresh.snapshot
        : deps.getRepositoryStatus(repositoryRoot);
    return {
      workspacePolicy: normalizeAgentIsolationPolicy(project?.isolationPolicy ?? "auto"),
      repositoryStatusKnown: status.known,
      repositoryDirty: status.dirty,
      dirtyEditorDocumentsInRepository:
        project?.origin === "active-tab"
          ? Math.max(0, Math.trunc(deps.getDirtyEditorDocumentCount(repositoryRoot)))
          : 0,
      liveAgentTasksInRepository: liveTasksInRepository(stateRef.current.tasks, repositoryRoot),
      plannedParallelDispatch: false,
    };
  }, []);

  const refreshIsolationStatus = useCallback(async (repositoryRoot: string): Promise<void> => {
    const deps = dependenciesRef.current;
    const project = owningProjectForRepository(deps.projects, repositoryRoot);
    if (project === undefined) return;
    const authority = projectAuthority(project);

    const requestGeneration =
      (isolationStatusRequestGenerationRef.current.get(repositoryRoot) ?? 0) + 1;
    isolationStatusRequestGenerationRef.current = new Map(
      isolationStatusRequestGenerationRef.current,
    ).set(repositoryRoot, requestGeneration);

    if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) return;
    const result = await attempt(() => deps.gitGateway.getStatus(repositoryRoot));
    if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) return;
    if (isolationStatusRequestGenerationRef.current.get(repositoryRoot) !== requestGeneration) {
      return;
    }
    if (!result.ok) deps.reportError(AGENT_TASKS_SOURCE, result.error);

    const next = new Map(isolationStatusesRef.current);
    next.set(
      repositoryRoot,
      result.ok
        ? freshIsolationStatus(authority, repositoryRoot, result.value)
        : unknownIsolationStatus(authority),
    );
    isolationStatusesRef.current = next;
    publishIsolationStatusGeneration();
  }, []);

  const isolationPreview = useCallback(
    (repositoryRoot: string): AgentIsolationPreview => {
      const deps = dependenciesRef.current;
      const project = owningProjectForRepository(deps.projects, repositoryRoot);
      const inPlaceAllowed = project?.origin === "active-tab";
      const context = isolationContext(repositoryRoot);
      const authority = project === undefined ? null : projectAuthority(project);
      return {
        repositoryRoot,
        recommended: inPlaceAllowed
          ? defaultAgentTaskIsolation(context)
          : { kind: "worktree", reason: "policy" },
        inPlaceGuard: inPlaceDispatchGuard(context),
        inPlaceAllowed,
        confirmationKey:
          authority !== null &&
          sameOptionalProjectAuthority(
            isolationStatusesRef.current.get(repositoryRoot)?.authority,
            authority,
          )
            ? isolationConfirmationKey(repositoryRoot, context, authority)
            : null,
      };
    },
    [isolationContext],
  );

  const dispatch = useCallback(
    async (request: AgentTaskDispatchRequest): Promise<AgentTaskDispatchResult | null> => {
      const deps = dependenciesRef.current;
      if (dispatchingRef.current) {
        setNotice(warning("A dispatch is already in progress."));
        return null;
      }
      if (deps.projects.length === 0) {
        setNotice(warning("Open a workspace before starting an agent."));
        return null;
      }
      const project = projectByRootKey(deps.projects, request.projectRootKey);
      if (
        project === undefined ||
        !project.repositories.some(
          (repository) => repository.repositoryRoot === request.repositoryRoot,
        )
      ) {
        setNotice(warning("Select a repository from this workspace."));
        return null;
      }
      if (project.origin === "closed-tab-live-tasks") {
        setNotice(warning("This project is being released, so a new agent cannot start in it."));
        return null;
      }
      if (project.origin !== "active-tab" && request.isolation === "in-place") {
        setNotice(warning("In-place agents can run only in the active project. Use a worktree."));
        return null;
      }
      const authority = projectAuthority(project);
      const repositoryRoot = request.repositoryRoot;
      const prompt = request.prompt.trim();
      if (prompt === "") {
        setNotice(warning("Write a prompt before starting an agent."));
        return null;
      }
      if (agentPromptByteLength(prompt) > MAX_AGENT_TASK_PROMPT_BYTES) {
        setNotice(warning("The prompt is too long. Shorten it and try again."));
        return null;
      }
      const liveTasks = countLiveTasks(stateRef.current.tasks);
      if (liveTasks >= normalizeMaxConcurrentAgentTasks(deps.getMaxConcurrentAgentTasks())) {
        setNotice(
          warning(
            "The concurrent agent limit is reached. Stop a running agent or raise the limit.",
          ),
        );
        return null;
      }
      const agentCliPath = normalizeAgentCliPath(deps.getAgentCliPath());
      if (agentCliPath === null) {
        setNotice({
          kind: "warning",
          message: "No agent CLI is configured. Set the agent CLI path in settings.",
          action: "configure-agent-cli",
        });
        return null;
      }
      const taskId = mintUnusedAgentTaskId(stateRef.current.tasks, deps);
      if (taskId === null) {
        setNotice(warning("A task id could not be minted. Try again."));
        return null;
      }

      dispatchingRef.current = true;
      setDispatching(true);
      try {
        const ensureProjectLease = deps.ensureProjectLease;
        if (project.leaseToken === null && ensureProjectLease !== undefined) {
          const leased = await attempt(() => ensureProjectLease(request.projectRootKey));
          if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
            return null;
          }
          if (!leased.ok) {
            deps.reportError(AGENT_TASKS_SOURCE, leased.error);
            setNotice(failure(LEASE_REFUSED_NOTICE));
            return null;
          }
          if (!leased.value) {
            setNotice(failure(LEASE_REFUSED_NOTICE));
            return null;
          }
        }
        if (request.isolation === "in-place") {
          const requestGeneration =
            (isolationStatusRequestGenerationRef.current.get(repositoryRoot) ?? 0) + 1;
          isolationStatusRequestGenerationRef.current = new Map(
            isolationStatusRequestGenerationRef.current,
          ).set(repositoryRoot, requestGeneration);
          if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
            return null;
          }
          const freshStatus = await attempt(() => deps.gitGateway.getStatus(repositoryRoot));
          if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
            return null;
          }
          if (
            isolationStatusRequestGenerationRef.current.get(repositoryRoot) !== requestGeneration
          ) {
            return null;
          }
          if (!freshStatus.ok) {
            deps.reportError(AGENT_TASKS_SOURCE, freshStatus.error);
            setNotice(
              warning(
                "The repository status could not be refreshed, so an in-place agent was not started.",
              ),
            );
            return null;
          }
          const fresh = freshIsolationStatus(authority, repositoryRoot, freshStatus.value);
          const next = new Map(isolationStatusesRef.current);
          next.set(repositoryRoot, fresh);
          isolationStatusesRef.current = next;
          if (mountedRef.current) publishIsolationStatusGeneration();

          const context = isolationContext(repositoryRoot);
          const guard = inPlaceDispatchGuard(context);
          const confirmationKey = isolationConfirmationKey(repositoryRoot, context, authority);
          if (
            guard.kind === "unsafe" &&
            (confirmationKey === null || request.unsafeInPlaceConfirmationKey !== confirmationKey)
          ) {
            setNotice(warning(`Running in place is unsafe: ${guardReasonsLabel(guard.reasons)}.`));
            return null;
          }
          if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
            return null;
          }
        }
        const dispatched = await runDispatch({
          agentCliKind: normalizeAgentCliKind(deps.getAgentCliKind()),
          agentCliPath,
          dependenciesRef,
          dispatchAction,
          isolation: request.isolation,
          mountedRef,
          prompt,
          repositoryRoot,
          setNotice,
          taskId,
          authority,
          uncertainWorktreePathsRef,
        });
        if (!dispatched && request.isolation === "worktree" && mountedRef.current) {
          void refreshOrphanedWorktrees();
        }
        return dispatched ? { taskId } : null;
      } finally {
        dispatchingRef.current = false;
        if (mountedRef.current) setDispatching(false);
      }
    },
    [isolationContext, refreshOrphanedWorktrees],
  );

  const stop = useCallback(async (taskId: string): Promise<void> => {
    const deps = dependenciesRef.current;
    const task = stateRef.current.tasks.get(taskId);
    if (task === undefined) return;
    if (isTerminalAgentTaskStatus(task.status)) return;
    try {
      await deps.agentTaskGateway.stopAgentTask({
        taskId,
        workspaceId: task.owner.workspaceId,
      });
    } catch (error) {
      dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error);
      if (!mountedRef.current) return;
      setNotice(failure("The agent could not be stopped."));
    }
  }, []);

  const dismiss = useCallback(
    (taskId: string): void => {
      dispatchAction({ kind: "dismissed", taskId });
      setSummaries((current) => withoutSummary(current, taskId));
      void refreshOrphanedWorktrees();
    },
    [refreshOrphanedWorktrees],
  );

  const hasLiveTasksForOwner = useCallback((ownerId: string): boolean => {
    for (const task of stateRef.current.tasks.values()) {
      if (task.owner.workspaceId !== ownerId) continue;
      if (!isTerminalAgentTaskStatus(task.status)) return true;
    }
    return false;
  }, []);

  const stopProjectTasks = useCallback(
    async (ownerId: string, repositoryRoots: ReadonlyArray<string>): Promise<void> => {
      const roots = new Set(repositoryRoots);
      for (const task of stateRef.current.tasks.values()) {
        if (task.owner.workspaceId !== ownerId) continue;
        if (isTerminalAgentTaskStatus(task.status)) continue;
        roots.add(task.owner.repositoryRoot);
      }
      for (const repositoryRoot of roots) {
        const stopped = await attempt(() =>
          dependenciesRef.current.agentTaskGateway.stopAgentTasksForRoot({
            workspaceId: ownerId,
            repositoryRoot,
          }),
        );
        if (!stopped.ok) {
          dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, stopped.error);
        }
      }
    },
    [],
  );

  const releaseProjectTasks = useCallback(
    (ownerId: string): void => {
      dispatchAction({ kind: "projectReleased", ownerId });
      void refreshOrphanedWorktrees();
    },
    [refreshOrphanedWorktrees],
  );

  const removeOrphanedWorktree = useCallback(
    async (worktreePath: string): Promise<void> => {
      const deps = dependenciesRef.current;
      const candidate = orphanCandidatesRef.current.get(worktreePath);
      if (candidate === undefined) return;
      const project = owningProjectForRepository(deps.projects, candidate.repositoryRoot);
      if (project === undefined) return;
      const authority = projectAuthority(project);
      setRemovingOrphans((current) => new Set(current).add(worktreePath));

      try {
        const status = await deps.gitGateway.getStatus(worktreePath);
        if (
          !isCurrentProjectOwner(dependenciesRef, mountedRef, authority, candidate.repositoryRoot)
        ) {
          return;
        }
        const dirty = status.changes.length > 0;
        if (
          dirty &&
          !dependenciesRef.current.prompter.confirm(
            "This worktree has uncommitted changes. Remove it and discard them?",
          )
        ) {
          return;
        }
        await dependenciesRef.current.gitWorktreeGateway.removeWorktree(
          candidate.repositoryRoot,
          worktreePath,
          dirty,
        );
        if (!mountedRef.current) return;
        setNotice(info("The orphaned worktree was removed. Its branch was kept."));
      } catch (error) {
        dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error);
        if (!mountedRef.current) return;
        setNotice(failure("The orphaned worktree could not be removed."));
      } finally {
        if (mountedRef.current) {
          setRemovingOrphans((current) => {
            const next = new Set(current);
            next.delete(worktreePath);
            return next;
          });
          void refreshOrphanedWorktrees();
        }
      }
    },
    [refreshOrphanedWorktrees],
  );

  const pruneOrphanedWorktrees = useCallback(
    async (repositoryRoot: string): Promise<void> => {
      if (
        [...uncertainWorktreePathsRef.current].some((path) =>
          isAgentWorktreePath(repositoryRoot, path),
        )
      ) {
        setNotice(
          warning(
            "Worktrees with uncertain live agents cannot be pruned until terminal cleanup is proven.",
          ),
        );
        return;
      }
      const pruned = await tryOrReport(
        () => dependenciesRef.current.gitWorktreeGateway.pruneWorktrees(repositoryRoot),
        dependenciesRef,
      );
      if (!mountedRef.current) return;
      if (!pruned.ok) {
        setNotice(failure("The stale worktrees could not be pruned."));
        return;
      }
      setNotice(info("Stale worktree registrations were pruned."));
      void refreshOrphanedWorktrees();
    },
    [refreshOrphanedWorktrees],
  );

  const hideChanges = useCallback((taskId: string): void => {
    setSummaries((current) => withoutSummary(current, taskId));
  }, []);

  const showChanges = useCallback(
    async (taskId: string): Promise<void> => {
      const task = stateRef.current.tasks.get(taskId);
      if (task === undefined || task.worktreePath === null) return;
      setSummaries((current) => withSummary(current, taskId, EMPTY_SUMMARY));
      await refreshChangeSummary(taskId);
    },
    [refreshChangeSummary],
  );

  const hideFileDiff = useCallback((taskId: string): void => {
    setSummaries((current) => {
      const summary = current.get(taskId);
      if (summary === undefined || summary.diff === null) return current;
      return withSummary(current, taskId, { ...summary, diff: null });
    });
  }, []);

  const showFileDiff = useCallback(
    async (taskId: string, change: GitChangedFile): Promise<void> => {
      const deps = dependenciesRef.current;
      const task = stateRef.current.tasks.get(taskId);
      if (task === undefined || task.worktreePath === null) return;
      const project = projectByOwnerId(deps.projects, task.owner.workspaceId);
      if (project === undefined) return;
      const authority = projectAuthority(project);
      const owner = task.owner;
      const worktreePath = task.worktreePath;
      setSummaries((current) =>
        withSummary(current, taskId, {
          ...summaryOf(current, taskId),
          diff: loadingFileDiff(change.relativePath),
        }),
      );

      try {
        const diff = await deps.gitGateway.getDiff(worktreePath, change);
        if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, owner.repositoryRoot)) {
          dropFileDiffAuthority(taskId, change.relativePath, mountedRef, setSummaries);
          return;
        }
        setSummaries((current) =>
          withSummary(current, taskId, {
            ...summaryOf(current, taskId),
            diff: {
              relativePath: change.relativePath,
              loading: false,
              error: null,
              original: clipDiffSide(diff.originalContent),
              modified: clipDiffSide(diff.modifiedContent),
              unavailableReason: diff.previewUnavailableReason ?? null,
            },
          }),
        );
      } catch (error) {
        dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error);
        if (!mountedRef.current) return;
        setSummaries((current) =>
          withSummary(current, taskId, {
            ...summaryOf(current, taskId),
            diff: {
              ...loadingFileDiff(change.relativePath),
              loading: false,
              error: "The file diff could not be read.",
            },
          }),
        );
      }
    },
    [],
  );

  const removeWorktree = useCallback(
    async (taskId: string): Promise<void> => {
      const deps = dependenciesRef.current;
      const task = stateRef.current.tasks.get(taskId);
      if (task === undefined || task.worktreePath === null) return;
      if (!isTerminalAgentTaskStatus(task.status)) {
        setNotice(warning("Stop the agent before removing its worktree."));
        return;
      }
      const project = projectByOwnerId(deps.projects, task.owner.workspaceId);
      if (project === undefined) return;
      const authority = projectAuthority(project);
      const owner = task.owner;
      const worktreePath = task.worktreePath;
      setSummaries((current) =>
        withSummary(current, taskId, { ...summaryOf(current, taskId), removing: true }),
      );

      try {
        const status = await deps.gitGateway.getStatus(worktreePath);
        if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, owner.repositoryRoot)) {
          return;
        }
        const dirty = status.changes.length > 0;
        if (
          dirty &&
          !dependenciesRef.current.prompter.confirm(
            "This worktree has uncommitted changes. Remove it and discard them?",
          )
        ) {
          setSummaries((current) =>
            withSummary(current, taskId, { ...summaryOf(current, taskId), removing: false }),
          );
          return;
        }
        await dependenciesRef.current.gitWorktreeGateway.removeWorktree(
          owner.repositoryRoot,
          worktreePath,
          dirty,
        );
        if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, owner.repositoryRoot)) {
          return;
        }
        setSummaries((current) => withoutSummary(current, taskId));
        setRemovedWorktrees((current) => new Set(current).add(taskId));
        setNotice(info("The worktree was removed. Its branch was kept."));
        void refreshOrphanedWorktrees();
      } catch (error) {
        dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error);
        if (!mountedRef.current) return;
        setSummaries((current) =>
          withSummary(current, taskId, { ...summaryOf(current, taskId), removing: false }),
        );
        setNotice(failure("The worktree could not be removed."));
      }
    },
    [refreshOrphanedWorktrees],
  );

  const configureAgentCli = useCallback((): void => {
    dependenciesRef.current.openAgentSettings();
  }, []);

  const dismissNotice = useCallback((): void => setNotice(null), []);

  const tasks = useMemo(
    () => agentTaskViews(state.tasks, summaries, removedWorktrees, dependencies.projects),
    [dependencies.projects, removedWorktrees, state.tasks, summaries],
  );

  const repositories = useMemo(
    () => flattenProjectRepositories(dependencies.projects),
    [dependencies.projects],
  );

  const orphanedWorktrees = useMemo(
    () =>
      orphanedWorktreeViews(
        orphanCandidates,
        state.tasks,
        removingOrphans,
        uncertainWorktreePathsRef.current,
      ),
    [orphanCandidates, removingOrphans, state.tasks],
  );

  return {
    tasks,
    repositories,
    orphanedWorktrees,
    notice,
    dispatching,
    agentCliConfigured,
    liveTaskCount: countLiveTasks(state.tasks),
    maxConcurrentAgentTasks,
    isolationPreview,
    refreshIsolationStatus,
    dispatch,
    stop,
    dismiss,
    hasLiveTasksForOwner,
    stopProjectTasks,
    releaseProjectTasks,
    removeOrphanedWorktree,
    pruneOrphanedWorktrees,
    showChanges,
    hideChanges,
    showFileDiff,
    hideFileDiff,
    removeWorktree,
    configureAgentCli,
    dismissNotice,
  };
}

interface DispatchRun {
  readonly agentCliKind: AgentCliKind;
  readonly agentCliPath: string;
  readonly dependenciesRef: { current: AgentTasksDependencies };
  readonly dispatchAction: (action: AgentTasksAction) => void;
  readonly isolation: AgentTaskIsolation;
  readonly mountedRef: { current: boolean };
  readonly prompt: string;
  readonly repositoryRoot: string;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
  readonly taskId: string;
  readonly authority: AgentProjectAuthority;
  readonly uncertainWorktreePathsRef: { current: ReadonlySet<string> };
}

async function runDispatch(run: DispatchRun): Promise<boolean> {
  const { authority, dependenciesRef, mountedRef, repositoryRoot, taskId } = run;
  const workspaceId = authority.ownerId;
  const agentTaskGateway = dependenciesRef.current.agentTaskGateway;
  let worktreePath: string | null = null;
  let createdWorktree: CreatedAgentWorktree | null = null;

  if (run.isolation === "worktree") {
    if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
      return false;
    }
    const gateway = dependenciesRef.current.gitWorktreeGateway;
    const receipt = await attempt(() => gateway.addAgentWorktree(repositoryRoot, taskId));
    if (!receipt.ok) {
      noteDispatchTrustRejection(run, receipt.error);
      if (isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
        dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, receipt.error);
        run.setNotice(failure(worktreeCreationFailureNotice(receipt.error)));
      }
      return false;
    }
    createdWorktree = { gateway, receipt: receipt.value, repositoryRoot };
    if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
      await compensateCreatedWorktree(run, createdWorktree);
      return false;
    }
    if (!receipt.value.trusted) {
      const cleaned = await compensateCreatedWorktree(run, createdWorktree);
      if (mountedRef.current) {
        run.setNotice(
          failure(
            cleaned
              ? "The agent worktree was not trusted, so the agent was not started."
              : orphanedWorktreeNotice(
                  "The agent worktree was not trusted, so the agent was not started.",
                ),
          ),
        );
      }
      return false;
    }
    worktreePath = receipt.value.worktreePath;
  }

  if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
    if (createdWorktree !== null) await compensateCreatedWorktree(run, createdWorktree);
    return false;
  }
  const started = await attempt(() =>
    agentTaskGateway.startAgentTask({
      taskId,
      workspaceId,
      repositoryRoot,
      cwd: worktreePath ?? repositoryRoot,
      isolation: run.isolation,
      prompt: run.prompt,
      agentCliPath: run.agentCliPath,
      agentCliKind: run.agentCliKind,
    }),
  );
  if (!started.ok) {
    noteDispatchTrustRejection(run, started.error);
    if (createdWorktree !== null) retainUncertainWorktree(run, createdWorktree);
    if (isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
      dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, started.error);
      run.setNotice(
        failure(
          createdWorktree === null
            ? "The agent start result was uncertain, so a task may still be running."
            : "The agent start result was uncertain, so a task or its worktree may remain orphaned.",
        ),
      );
    }
    return false;
  }
  if (started.value.taskId !== taskId) {
    const stopped = await attempt(() => agentTaskGateway.stopAgentTask({ taskId, workspaceId }));
    if (createdWorktree !== null) retainUncertainWorktree(run, createdWorktree);
    if (isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
      if (!stopped.ok) dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, stopped.error);
      run.setNotice(
        failure(
          stopped.ok
            ? "The agent returned an unexpected task id. Stop was requested, but terminal cleanup is unconfirmed, so the agent or its worktree may remain."
            : "The agent returned an unexpected task id. Cleanup could not be confirmed, so the agent or its worktree may remain.",
        ),
      );
    }
    return false;
  }
  if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
    const stopped = await attempt(() => agentTaskGateway.stopAgentTask({ taskId, workspaceId }));
    if (createdWorktree !== null) retainUncertainWorktree(run, createdWorktree);
    void stopped;
    return false;
  }

  const now = dependenciesRef.current.now ?? Date.now;
  run.dispatchAction({
    kind: "started",
    record: {
      owner: { taskId, workspaceId, repositoryRoot },
      isolation: run.isolation,
      worktreePath,
      prompt: run.prompt,
      status: { kind: "pending" },
      outputTail: "",
      outputTruncated: false,
      lastStatusSequence: 0,
      lastOutputSequence: 0,
      startedAtEpochMs: now(),
    },
  });

  const acknowledged = await attempt(() =>
    agentTaskGateway.acknowledgeAgentTaskStart({ taskId, workspaceId }),
  );
  if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
    const stopped = await attempt(() => agentTaskGateway.stopAgentTask({ taskId, workspaceId }));
    if (createdWorktree !== null) retainUncertainWorktree(run, createdWorktree);
    void stopped;
    return false;
  }
  if (!acknowledged.ok) {
    dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, acknowledged.error);
    run.setNotice(warning("The agent started but its live output could not be attached."));
    return true;
  }

  run.setNotice(null);
  return true;
}

interface CreatedAgentWorktree {
  readonly gateway: GitWorktreeGateway;
  readonly receipt: AgentWorktreeReceipt;
  readonly repositoryRoot: string;
}

function noteDispatchTrustRejection(run: DispatchRun, error: unknown): void {
  if (!errorMessageOf(error).includes(UNTRUSTED_REPOSITORY_ERROR_MARKER)) return;
  run.dependenciesRef.current.onProjectDispatchTrustRejected?.(run.authority.rootKey);
}

function retainUncertainWorktree(run: DispatchRun, created: CreatedAgentWorktree): void {
  run.uncertainWorktreePathsRef.current = new Set(run.uncertainWorktreePathsRef.current).add(
    created.receipt.worktreePath,
  );
}

async function compensateCreatedWorktree(
  run: DispatchRun,
  created: CreatedAgentWorktree,
): Promise<boolean> {
  const removed = await attempt(() =>
    created.gateway.removeWorktree(created.repositoryRoot, created.receipt.worktreePath, false),
  );
  if (
    !removed.ok &&
    isCurrentProjectOwner(
      run.dependenciesRef,
      run.mountedRef,
      run.authority,
      created.repositoryRoot,
    )
  ) {
    run.dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, removed.error);
    run.setNotice(failure(orphanedWorktreeNotice("The agent was not started.")));
  }
  return removed.ok;
}

function orphanedWorktreeNotice(prefix: string): string {
  return `${prefix} Cleanup could not be confirmed, so its worktree may remain orphaned.`;
}

function dropFileDiffAuthority(
  taskId: string,
  relativePath: string,
  mountedRef: { current: boolean },
  setSummaries: (
    update: (
      current: ReadonlyMap<string, AgentTaskChangeSummary>,
    ) => ReadonlyMap<string, AgentTaskChangeSummary>,
  ) => void,
): void {
  if (!mountedRef.current) return;
  setSummaries((current) => {
    const summary = current.get(taskId);
    if (summary === undefined || summary.diff === null || !summary.diff.loading) return current;
    return withSummary(current, taskId, {
      ...summary,
      diff: {
        ...loadingFileDiff(relativePath),
        loading: false,
        error: DIFF_AUTHORITY_DROPPED_ERROR,
      },
    });
  });
}

type Attempt<TValue> =
  { readonly ok: true; readonly value: TValue } | { readonly ok: false; readonly error: unknown };

async function tryOrReport<TValue>(
  operation: () => Promise<TValue>,
  dependenciesRef: { current: AgentTasksDependencies },
): Promise<Attempt<TValue>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error);
    return { ok: false, error };
  }
}

async function attempt<TValue>(operation: () => Promise<TValue>): Promise<Attempt<TValue>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error };
  }
}

function worktreeCreationFailureNotice(error: unknown): string {
  const capMarker = `maximum of ${MAX_WORKTREES_PER_REPOSITORY} worktrees`;
  if (errorMessageOf(error).includes(capMarker)) {
    return `The repository already holds the maximum of ${MAX_WORKTREES_PER_REPOSITORY} worktrees. Remove orphaned worktrees listed in the Agents panel first.`;
  }
  return "The agent worktree could not be created.";
}

function errorMessageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}

function isAgentWorktreePath(repositoryRoot: string, worktreePath: string): boolean {
  return worktreePath.startsWith(`${repositoryRoot}/${WORKTREE_BASE_DIR_NAME}/`);
}

interface AgentProjectAuthority {
  readonly rootKey: string;
  readonly ownerId: string;
  readonly generation: number;
}

function projectAuthority(project: AgentProjectDescriptor): AgentProjectAuthority {
  return {
    rootKey: project.rootKey,
    ownerId: project.ownerId,
    generation: project.generation,
  };
}

function projectByRootKey(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  rootKey: string,
): AgentProjectDescriptor | undefined {
  return projects.find((project) => project.rootKey === rootKey);
}

function projectByOwnerId(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  ownerId: string,
): AgentProjectDescriptor | undefined {
  return projects.find((project) => project.ownerId === ownerId);
}

function owningProjectForRepository(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  repositoryRoot: string,
): AgentProjectDescriptor | undefined {
  return projects.find((project) =>
    project.repositories.some((repository) => repository.repositoryRoot === repositoryRoot),
  );
}

function sameProjectAuthority(left: AgentProjectAuthority, right: AgentProjectAuthority): boolean {
  return (
    left.rootKey === right.rootKey &&
    left.ownerId === right.ownerId &&
    left.generation === right.generation
  );
}

function sameOptionalProjectAuthority(
  left: AgentProjectAuthority | undefined,
  right: AgentProjectAuthority,
): boolean {
  return left !== undefined && sameProjectAuthority(left, right);
}

function isCurrentProjectOwner(
  dependenciesRef: { current: AgentTasksDependencies },
  mountedRef: { current: boolean },
  authority: AgentProjectAuthority,
  repositoryRoot: string,
): boolean {
  if (!mountedRef.current) return false;
  const project = projectByRootKey(dependenciesRef.current.projects, authority.rootKey);
  if (project === undefined) return false;
  if (project.generation !== authority.generation) return false;
  if (project.ownerId !== authority.ownerId) return false;
  return project.repositories.some((repository) => repository.repositoryRoot === repositoryRoot);
}

function mintUnusedAgentTaskId(
  tasks: ReadonlyMap<string, AgentTaskRecord>,
  dependencies: AgentTasksDependencies,
): string | null {
  const now = dependencies.now ?? Date.now;
  const entropy = dependencies.createEntropyHex4 ?? defaultEntropyHex4;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const taskId = mintAgentTaskId(now(), entropy());
    if (!tasks.has(taskId)) return taskId;
  }
  return null;
}

function defaultEntropyHex4(): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface OrphanedWorktreeCandidate {
  readonly repositoryRoot: string;
  readonly worktreePath: string;
  readonly branch: string | null;
  readonly prunable: boolean;
}

interface FreshIsolationStatus {
  readonly authority: AgentProjectAuthority;
  readonly snapshot: AgentRepositoryStatusSnapshot;
}

function freshIsolationStatus(
  authority: AgentProjectAuthority,
  repositoryRoot: string,
  status: GitStatus,
): FreshIsolationStatus {
  if (!status.isRepository || status.rootPath !== repositoryRoot) {
    return unknownIsolationStatus(authority);
  }

  const snapshot = { known: true, dirty: status.changes.length > 0 } as const;
  return {
    authority,
    snapshot,
  };
}

function unknownIsolationStatus(authority: AgentProjectAuthority): FreshIsolationStatus {
  return {
    authority,
    snapshot: { known: false, dirty: false },
  };
}

function isolationConfirmationKey(
  repositoryRoot: string,
  context: AgentTaskIsolationContext,
  authority: AgentProjectAuthority,
): string | null {
  if (!context.repositoryStatusKnown) return null;
  return JSON.stringify({ authority, repositoryRoot, ...context });
}

function orphanedWorktreeViews(
  candidates: ReadonlyMap<string, OrphanedWorktreeCandidate>,
  tasks: ReadonlyMap<string, AgentTaskRecord>,
  removing: ReadonlySet<string>,
  uncertainWorktreePaths: ReadonlySet<string>,
): ReadonlyArray<OrphanedWorktreeView> {
  const ownedWorktreePaths = new Set<string>();
  for (const task of tasks.values()) {
    if (task.worktreePath !== null) ownedWorktreePaths.add(task.worktreePath);
  }
  return [...candidates.values()]
    .filter(
      (candidate) =>
        !ownedWorktreePaths.has(candidate.worktreePath) &&
        !uncertainWorktreePaths.has(candidate.worktreePath),
    )
    .sort((left, right) => left.worktreePath.localeCompare(right.worktreePath))
    .map((candidate) => ({ ...candidate, removing: removing.has(candidate.worktreePath) }));
}

function agentTaskViews(
  tasks: ReadonlyMap<string, AgentTaskRecord>,
  summaries: ReadonlyMap<string, AgentTaskChangeSummary>,
  removedWorktrees: ReadonlySet<string>,
  projects: ReadonlyArray<AgentProjectDescriptor>,
): ReadonlyArray<AgentTaskView> {
  const projectsByOwnerId = new Map<string, AgentProjectDescriptor>();
  for (const project of projects) {
    if (projectsByOwnerId.has(project.ownerId)) continue;
    projectsByOwnerId.set(project.ownerId, project);
  }
  const views: AgentTaskView[] = [];
  for (const record of tasks.values()) {
    const project = projectsByOwnerId.get(record.owner.workspaceId);
    if (project === undefined) continue;
    views.push({
      record,
      repositoryLabel: repositoryLabel(record.owner.repositoryRoot, project.rootPath),
      terminal: isTerminalAgentTaskStatus(record.status),
      worktreeRemoved: removedWorktrees.has(record.owner.taskId),
      changeSummary: summaries.get(record.owner.taskId) ?? null,
    });
  }
  return views.sort((left, right) => right.record.startedAtEpochMs - left.record.startedAtEpochMs);
}

function flattenProjectRepositories(
  projects: ReadonlyArray<AgentProjectDescriptor>,
): ReadonlyArray<ResolvedGitRepository> {
  const seen = new Set<string>();
  const repositories: ResolvedGitRepository[] = [];
  for (const project of projects) {
    for (const repository of project.repositories) {
      if (seen.has(repository.repositoryRoot)) continue;
      seen.add(repository.repositoryRoot);
      repositories.push(repository);
    }
  }
  return repositories;
}

function repositoryLabel(repositoryRoot: string, projectRootPath: string): string {
  if (repositoryRoot === projectRootPath) return lastSegment(projectRootPath);
  if (!repositoryRoot.startsWith(`${projectRootPath}/`)) return repositoryRoot;
  return repositoryRoot.slice(projectRootPath.length + 1);
}

function lastSegment(path: string): string {
  const segments = path.split("/").filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? path;
}

function countLiveTasks(tasks: ReadonlyMap<string, AgentTaskRecord>): number {
  let live = 0;
  for (const task of tasks.values()) {
    if (!isTerminalAgentTaskStatus(task.status)) live += 1;
  }
  return live;
}

function liveTasksInRepository(
  tasks: ReadonlyMap<string, AgentTaskRecord>,
  repositoryRoot: string,
): number {
  let live = 0;
  for (const task of tasks.values()) {
    if (task.owner.repositoryRoot !== repositoryRoot) continue;
    if (!isTerminalAgentTaskStatus(task.status)) live += 1;
  }
  return live;
}

function summaryOf(
  summaries: ReadonlyMap<string, AgentTaskChangeSummary>,
  taskId: string,
): AgentTaskChangeSummary {
  return summaries.get(taskId) ?? EMPTY_SUMMARY;
}

function withSummary(
  summaries: ReadonlyMap<string, AgentTaskChangeSummary>,
  taskId: string,
  summary: AgentTaskChangeSummary,
): ReadonlyMap<string, AgentTaskChangeSummary> {
  const next = new Map(summaries);
  next.set(taskId, summary);
  return next;
}

function withoutSummary(
  summaries: ReadonlyMap<string, AgentTaskChangeSummary>,
  taskId: string,
): ReadonlyMap<string, AgentTaskChangeSummary> {
  if (!summaries.has(taskId)) return summaries;
  const next = new Map(summaries);
  next.delete(taskId);
  return next;
}

function loadingFileDiff(relativePath: string): AgentTaskFileDiff {
  return {
    relativePath,
    loading: true,
    error: null,
    original: { text: "", truncated: false },
    modified: { text: "", truncated: false },
    unavailableReason: null,
  };
}

function clipDiffSide(content: string): AgentTaskDiffSide {
  const bytes = UTF8_ENCODER.encode(content);
  if (bytes.byteLength <= MAX_AGENT_TASK_DIFF_SIDE_BYTES) {
    return { text: content, truncated: false };
  }
  let end = MAX_AGENT_TASK_DIFF_SIDE_BYTES;
  while (end > 0 && (bytes[end] & 0b1100_0000) === 0b1000_0000) end -= 1;
  return { text: UTF8_DECODER.decode(bytes.subarray(0, end)), truncated: true };
}

function guardReasonsLabel(reasons: ReadonlyArray<InPlaceDispatchUnsafeReason>): string {
  return reasons.map(inPlaceGuardReasonLabel).join(", ");
}

export function inPlaceGuardReasonLabel(reason: InPlaceDispatchUnsafeReason): string {
  switch (reason) {
    case "agent-active":
      return "another agent is already running in this repository";
    case "dirty-tree":
      return "the working tree has uncommitted changes";
    case "dirty-editors":
      return "unsaved editors belong to this repository";
    case "status-unknown":
      return "the repository status is unknown";
    default:
      return unsupportedGuardReason(reason);
  }
}

export function agentIsolationReasonLabel(recommended: AgentIsolationDefault): string {
  if (recommended.kind === "in-place") {
    return "The repository is clean, so the agent can work directly in it.";
  }
  switch (recommended.reason) {
    case "policy":
      return "This workspace always isolates agents in a worktree.";
    case "agent-active":
      return "Another agent is already running in this repository.";
    case "parallel-dispatch":
      return "Several agents are being started at once.";
    case "status-unknown":
      return "The repository status is unknown.";
    case "dirty-tree":
      return "The working tree has uncommitted changes.";
    case "dirty-editors":
      return "This repository has unsaved editors.";
    default:
      return unsupportedIsolationReason(recommended.reason);
  }
}

function warning(message: string): AgentTasksNotice {
  return { kind: "warning", message, action: null };
}

function info(message: string): AgentTasksNotice {
  return { kind: "info", message, action: null };
}

function failure(message: string): AgentTasksNotice {
  return { kind: "error", message, action: null };
}

function unsupportedGuardReason(reason: never): never {
  throw new TypeError(`Unsupported in-place guard reason: ${String(reason)}.`);
}

function unsupportedIsolationReason(reason: never): never {
  throw new TypeError(`Unsupported agent isolation reason: ${String(reason)}.`);
}
