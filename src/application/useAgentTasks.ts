import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
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
  type AgentIsolationPolicy,
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
  readonly confirmationKey: string | null;
}

export interface AgentTaskDispatchRequest {
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
  readonly resolvedRepositories: ReadonlyArray<ResolvedGitRepository>;
  readonly getWorkspaceId: () => string | null;
  readonly getWorkspaceRoot: () => string | null;
  readonly getAgentCliPath: () => string | null;
  readonly getAgentCliKind: () => AgentCliKind;
  readonly getMaxConcurrentAgentTasks: () => number;
  readonly getAgentIsolationPolicy: () => AgentIsolationPolicy;
  readonly getRepositoryStatus: (repositoryRoot: string) => AgentRepositoryStatusSnapshot;
  readonly getDirtyEditorDocumentCount: (repositoryRoot: string) => number;
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
  const workspaceId = dependencies.getWorkspaceId();
  const workspaceRoot = dependencies.getWorkspaceRoot();
  const mountedRef = useRef(true);
  const dispatchingRef = useRef(false);
  const isolationStatusesRef = useRef<ReadonlyMap<string, FreshIsolationStatus>>(new Map());
  const isolationStatusRequestGenerationRef = useRef<ReadonlyMap<string, number>>(new Map());
  const workspaceAuthorityRef = useRef<WorkspaceAuthority>({
    generation: 1,
    workspaceId,
    workspaceRoot,
  });
  const [, publishIsolationStatusGeneration] = useReducer(
    (generation: number) => generation + 1,
    0,
  );

  const maxConcurrentAgentTasks = normalizeMaxConcurrentAgentTasks(
    dependencies.getMaxConcurrentAgentTasks(),
  );
  const agentCliConfigured = normalizeAgentCliPath(dependencies.getAgentCliPath()) !== null;

  useLayoutEffect(() => {
    const current = workspaceAuthorityRef.current;
    dependenciesRef.current = dependencies;
    if (current.workspaceId !== workspaceId || current.workspaceRoot !== workspaceRoot) {
      workspaceAuthorityRef.current = {
        generation: current.generation + 1,
        workspaceId,
        workspaceRoot,
      };
    }
  }, [dependencies, workspaceId, workspaceRoot]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (workspaceId === null) return;
    dispatchAction({ kind: "workspaceReplaced", workspaceId });
  }, [workspaceId]);

  const refreshOrphanedWorktrees = useCallback(async (): Promise<void> => {
    const authority = captureWorkspaceAuthority(workspaceAuthorityRef);
    if (authority === null) {
      if (mountedRef.current) setOrphanCandidates(new Map());
      return;
    }
    const repositories = dependenciesRef.current.resolvedRepositories;
    const collected = new Map<string, OrphanedWorktreeCandidate>();
    for (const repository of repositories) {
      if (
        !isCurrentWorkspaceAuthority(dependenciesRef, mountedRef, workspaceAuthorityRef, authority)
      )
        return;
      const listed = await tryOrReport(
        () => dependenciesRef.current.gitWorktreeGateway.listWorktrees(repository.repositoryRoot),
        dependenciesRef,
      );
      if (
        !isCurrentWorkspaceAuthority(dependenciesRef, mountedRef, workspaceAuthorityRef, authority)
      ) {
        return;
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
    setOrphanCandidates(collected);
  }, []);

  const resolvedRepositories = dependencies.resolvedRepositories;
  useEffect(() => {
    void refreshOrphanedWorktrees();
  }, [refreshOrphanedWorktrees, workspaceId, resolvedRepositories]);

  const refreshChangeSummary = useCallback(async (taskId: string): Promise<void> => {
    const deps = dependenciesRef.current;
    const authority = captureWorkspaceAuthority(workspaceAuthorityRef);
    const task = stateRef.current.tasks.get(taskId);
    if (authority === null || task === undefined || task.worktreePath === null) return;
    const owner = task.owner;
    const worktreePath = task.worktreePath;

    setSummaries((current) =>
      withSummary(current, taskId, { ...summaryOf(current, taskId), loading: true, error: null }),
    );

    try {
      const status = await deps.gitGateway.getStatus(worktreePath);
      if (
        !isCurrentOwner(
          dependenciesRef,
          mountedRef,
          workspaceAuthorityRef,
          authority,
          owner.repositoryRoot,
        )
      ) {
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
  }, []);

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
    const authority = workspaceAuthorityRef.current;
    const fresh = isolationStatusesRef.current.get(repositoryRoot);
    const status =
      fresh && sameWorkspaceAuthority(fresh.authority, authority)
        ? fresh.snapshot
        : deps.getRepositoryStatus(repositoryRoot);
    return {
      workspacePolicy: normalizeAgentIsolationPolicy(deps.getAgentIsolationPolicy()),
      repositoryStatusKnown: status.known,
      repositoryDirty: status.dirty,
      dirtyEditorDocumentsInRepository: Math.max(
        0,
        Math.trunc(deps.getDirtyEditorDocumentCount(repositoryRoot)),
      ),
      liveAgentTasksInRepository: liveTasksInRepository(stateRef.current.tasks, repositoryRoot),
      plannedParallelDispatch: false,
    };
  }, []);

  const refreshIsolationStatus = useCallback(async (repositoryRoot: string): Promise<void> => {
    const deps = dependenciesRef.current;
    const authority = captureWorkspaceAuthority(workspaceAuthorityRef);
    if (
      authority === null ||
      !deps.resolvedRepositories.some((repository) => repository.repositoryRoot === repositoryRoot)
    ) {
      return;
    }

    const requestGeneration =
      (isolationStatusRequestGenerationRef.current.get(repositoryRoot) ?? 0) + 1;
    isolationStatusRequestGenerationRef.current = new Map(
      isolationStatusRequestGenerationRef.current,
    ).set(repositoryRoot, requestGeneration);

    if (
      !isCurrentOwner(dependenciesRef, mountedRef, workspaceAuthorityRef, authority, repositoryRoot)
    )
      return;
    const result = await attempt(() => deps.gitGateway.getStatus(repositoryRoot));
    if (
      !isCurrentOwner(dependenciesRef, mountedRef, workspaceAuthorityRef, authority, repositoryRoot)
    )
      return;
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
      const context = isolationContext(repositoryRoot);
      return {
        repositoryRoot,
        recommended: defaultAgentTaskIsolation(context),
        inPlaceGuard: inPlaceDispatchGuard(context),
        confirmationKey: sameOptionalWorkspaceAuthority(
          isolationStatusesRef.current.get(repositoryRoot)?.authority,
          workspaceAuthorityRef.current,
        )
          ? isolationConfirmationKey(repositoryRoot, context, workspaceAuthorityRef.current)
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
      const authority = captureWorkspaceAuthority(workspaceAuthorityRef);
      if (authority === null) {
        setNotice(warning("Open a workspace before starting an agent."));
        return null;
      }
      const repository = deps.resolvedRepositories.find(
        (candidate) => candidate.repositoryRoot === request.repositoryRoot,
      );
      if (repository === undefined) {
        setNotice(warning("Select a repository from this workspace."));
        return null;
      }
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
        if (request.isolation === "in-place") {
          const requestGeneration =
            (isolationStatusRequestGenerationRef.current.get(repository.repositoryRoot) ?? 0) + 1;
          isolationStatusRequestGenerationRef.current = new Map(
            isolationStatusRequestGenerationRef.current,
          ).set(repository.repositoryRoot, requestGeneration);
          if (
            !isCurrentOwner(
              dependenciesRef,
              mountedRef,
              workspaceAuthorityRef,
              authority,
              repository.repositoryRoot,
            )
          )
            return null;
          const freshStatus = await attempt(() =>
            deps.gitGateway.getStatus(repository.repositoryRoot),
          );
          if (
            !isCurrentOwner(
              dependenciesRef,
              mountedRef,
              workspaceAuthorityRef,
              authority,
              repository.repositoryRoot,
            )
          ) {
            return null;
          }
          if (
            isolationStatusRequestGenerationRef.current.get(repository.repositoryRoot) !==
            requestGeneration
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
          const fresh = freshIsolationStatus(
            authority,
            repository.repositoryRoot,
            freshStatus.value,
          );
          const next = new Map(isolationStatusesRef.current);
          next.set(repository.repositoryRoot, fresh);
          isolationStatusesRef.current = next;
          if (mountedRef.current) publishIsolationStatusGeneration();

          const context = isolationContext(repository.repositoryRoot);
          const guard = inPlaceDispatchGuard(context);
          const confirmationKey = isolationConfirmationKey(
            repository.repositoryRoot,
            context,
            authority,
          );
          if (
            guard.kind === "unsafe" &&
            (confirmationKey === null || request.unsafeInPlaceConfirmationKey !== confirmationKey)
          ) {
            setNotice(warning(`Running in place is unsafe: ${guardReasonsLabel(guard.reasons)}.`));
            return null;
          }
          if (
            !isCurrentOwner(
              dependenciesRef,
              mountedRef,
              workspaceAuthorityRef,
              authority,
              repository.repositoryRoot,
            )
          ) {
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
          repositoryRoot: repository.repositoryRoot,
          setNotice,
          taskId,
          authority,
          workspaceAuthorityRef,
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

  const removeOrphanedWorktree = useCallback(
    async (worktreePath: string): Promise<void> => {
      const deps = dependenciesRef.current;
      const candidate = orphanCandidatesRef.current.get(worktreePath);
      if (candidate === undefined) return;
      const ownerWorkspaceId = deps.getWorkspaceId();
      if (ownerWorkspaceId === null) return;
      setRemovingOrphans((current) => new Set(current).add(worktreePath));

      try {
        const status = await deps.gitGateway.getStatus(worktreePath);
        if (!mountedRef.current) return;
        if (dependenciesRef.current.getWorkspaceId() !== ownerWorkspaceId) return;
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
      const authority = captureWorkspaceAuthority(workspaceAuthorityRef);
      const task = stateRef.current.tasks.get(taskId);
      if (authority === null || task === undefined || task.worktreePath === null) return;
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
        if (
          !isCurrentOwner(
            dependenciesRef,
            mountedRef,
            workspaceAuthorityRef,
            authority,
            owner.repositoryRoot,
          )
        ) {
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
      const authority = captureWorkspaceAuthority(workspaceAuthorityRef);
      const task = stateRef.current.tasks.get(taskId);
      if (authority === null || task === undefined || task.worktreePath === null) return;
      if (!isTerminalAgentTaskStatus(task.status)) {
        setNotice(warning("Stop the agent before removing its worktree."));
        return;
      }
      const owner = task.owner;
      const worktreePath = task.worktreePath;
      setSummaries((current) =>
        withSummary(current, taskId, { ...summaryOf(current, taskId), removing: true }),
      );

      try {
        const status = await deps.gitGateway.getStatus(worktreePath);
        if (
          !isCurrentOwner(
            dependenciesRef,
            mountedRef,
            workspaceAuthorityRef,
            authority,
            owner.repositoryRoot,
          )
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
        if (
          !isCurrentOwner(
            dependenciesRef,
            mountedRef,
            workspaceAuthorityRef,
            authority,
            owner.repositoryRoot,
          )
        ) {
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
    () => agentTaskViews(state.tasks, summaries, removedWorktrees, workspaceRoot, workspaceId),
    [removedWorktrees, state.tasks, summaries, workspaceId, workspaceRoot],
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
    repositories: dependencies.resolvedRepositories,
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
  readonly authority: WorkspaceAuthority & { readonly workspaceId: string };
  readonly workspaceAuthorityRef: { readonly current: WorkspaceAuthority };
  readonly uncertainWorktreePathsRef: { current: ReadonlySet<string> };
}

async function runDispatch(run: DispatchRun): Promise<boolean> {
  const { authority, dependenciesRef, mountedRef, repositoryRoot, taskId } = run;
  const workspaceId = authority.workspaceId;
  const agentTaskGateway = dependenciesRef.current.agentTaskGateway;
  let worktreePath: string | null = null;
  let createdWorktree: CreatedAgentWorktree | null = null;

  if (run.isolation === "worktree") {
    if (
      !isCurrentOwner(
        dependenciesRef,
        mountedRef,
        run.workspaceAuthorityRef,
        authority,
        repositoryRoot,
      )
    )
      return false;
    const gateway = dependenciesRef.current.gitWorktreeGateway;
    const receipt = await attempt(() => gateway.addAgentWorktree(repositoryRoot, taskId));
    if (!receipt.ok) {
      if (
        isCurrentOwner(
          dependenciesRef,
          mountedRef,
          run.workspaceAuthorityRef,
          authority,
          repositoryRoot,
        )
      ) {
        dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, receipt.error);
        run.setNotice(failure(worktreeCreationFailureNotice(receipt.error)));
      }
      return false;
    }
    createdWorktree = { gateway, receipt: receipt.value, repositoryRoot };
    if (
      !isCurrentOwner(
        dependenciesRef,
        mountedRef,
        run.workspaceAuthorityRef,
        authority,
        repositoryRoot,
      )
    ) {
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

  if (
    !isCurrentOwner(
      dependenciesRef,
      mountedRef,
      run.workspaceAuthorityRef,
      authority,
      repositoryRoot,
    )
  ) {
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
    if (createdWorktree !== null) retainUncertainWorktree(run, createdWorktree);
    if (
      isCurrentOwner(
        dependenciesRef,
        mountedRef,
        run.workspaceAuthorityRef,
        authority,
        repositoryRoot,
      )
    ) {
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
    if (
      isCurrentOwner(
        dependenciesRef,
        mountedRef,
        run.workspaceAuthorityRef,
        authority,
        repositoryRoot,
      )
    ) {
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
  if (
    !isCurrentOwner(
      dependenciesRef,
      mountedRef,
      run.workspaceAuthorityRef,
      authority,
      repositoryRoot,
    )
  ) {
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
  if (
    !isCurrentOwner(
      dependenciesRef,
      mountedRef,
      run.workspaceAuthorityRef,
      authority,
      repositoryRoot,
    )
  ) {
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
    isCurrentOwner(
      run.dependenciesRef,
      run.mountedRef,
      run.workspaceAuthorityRef,
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

interface WorkspaceAuthority {
  readonly generation: number;
  readonly workspaceId: string | null;
  readonly workspaceRoot: string | null;
}

function captureWorkspaceAuthority(workspaceAuthorityRef: {
  readonly current: WorkspaceAuthority;
}): (WorkspaceAuthority & { readonly workspaceId: string }) | null {
  const authority = workspaceAuthorityRef.current;
  return authority.workspaceId === null
    ? null
    : { ...authority, workspaceId: authority.workspaceId };
}

function sameWorkspaceAuthority(left: WorkspaceAuthority, right: WorkspaceAuthority): boolean {
  return (
    left.generation === right.generation &&
    left.workspaceId === right.workspaceId &&
    left.workspaceRoot === right.workspaceRoot
  );
}

function sameOptionalWorkspaceAuthority(
  left: WorkspaceAuthority | undefined,
  right: WorkspaceAuthority,
): boolean {
  return left !== undefined && sameWorkspaceAuthority(left, right);
}

function isCurrentWorkspaceAuthority(
  dependenciesRef: { current: AgentTasksDependencies },
  mountedRef: { current: boolean },
  workspaceAuthorityRef: { readonly current: WorkspaceAuthority },
  authority: WorkspaceAuthority,
): boolean {
  if (!mountedRef.current) return false;
  if (!sameWorkspaceAuthority(workspaceAuthorityRef.current, authority)) return false;
  const deps = dependenciesRef.current;
  if (deps.getWorkspaceId() !== authority.workspaceId) return false;
  return deps.getWorkspaceRoot() === authority.workspaceRoot;
}

function isCurrentOwner(
  dependenciesRef: { current: AgentTasksDependencies },
  mountedRef: { current: boolean },
  workspaceAuthorityRef: { readonly current: WorkspaceAuthority },
  authority: WorkspaceAuthority,
  repositoryRoot: string,
): boolean {
  if (!isCurrentWorkspaceAuthority(dependenciesRef, mountedRef, workspaceAuthorityRef, authority))
    return false;
  const deps = dependenciesRef.current;
  return deps.resolvedRepositories.some(
    (repository) => repository.repositoryRoot === repositoryRoot,
  );
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
  readonly authority: WorkspaceAuthority;
  readonly snapshot: AgentRepositoryStatusSnapshot;
}

function freshIsolationStatus(
  authority: WorkspaceAuthority,
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

function unknownIsolationStatus(authority: WorkspaceAuthority): FreshIsolationStatus {
  return {
    authority,
    snapshot: { known: false, dirty: false },
  };
}

function isolationConfirmationKey(
  repositoryRoot: string,
  context: AgentTaskIsolationContext,
  authority: WorkspaceAuthority,
): string | null {
  if (authority.workspaceId === null || !context.repositoryStatusKnown) return null;
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
  workspaceRoot: string | null,
  workspaceId: string | null,
): ReadonlyArray<AgentTaskView> {
  return [...tasks.values()]
    .filter((record) => record.owner.workspaceId === workspaceId)
    .sort((left, right) => right.startedAtEpochMs - left.startedAtEpochMs)
    .map((record) => ({
      record,
      repositoryLabel: repositoryLabel(record.owner.repositoryRoot, workspaceRoot),
      terminal: isTerminalAgentTaskStatus(record.status),
      worktreeRemoved: removedWorktrees.has(record.owner.taskId),
      changeSummary: summaries.get(record.owner.taskId) ?? null,
    }));
}

function repositoryLabel(repositoryRoot: string, workspaceRoot: string | null): string {
  if (workspaceRoot === null) return repositoryRoot;
  if (repositoryRoot === workspaceRoot) return lastSegment(workspaceRoot);
  if (!repositoryRoot.startsWith(`${workspaceRoot}/`)) return repositoryRoot;
  return repositoryRoot.slice(workspaceRoot.length + 1);
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
