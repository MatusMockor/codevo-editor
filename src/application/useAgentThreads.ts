import { useCallback, useMemo, useState } from "react";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentCliKind, AgentTaskGateway, AgentTaskStatusEvent } from "../domain/agentTask";
import { agentThreadLifecycle, runningTurn, type AgentThread } from "../domain/agentThread";
import {
  normalizeAgentCliKind,
  normalizeAgentCliPath,
  normalizeMaxConcurrentAgentTasks,
} from "../domain/agentSettings";
import type { GitGateway } from "../domain/git";
import type { GitWorktreeGateway } from "../domain/gitWorktree";
import type { ResolvedGitRepository } from "../domain/gitRepositoryMapping";
import type {
  AgentRepositoryStatusSnapshot,
  AgentTaskChangeSummary,
  AgentTasksNotice,
  AgentThreadStoreGateway,
  AgentThreadView,
  AgentThreadsSurface,
} from "./agentThreadPorts";
import { countRunningTurns, countRunningTurnsInRepository } from "./agentTurnAdmission";
import { useAgentChangeSummary } from "./useAgentChangeSummary";
import { useAgentIsolationPreview } from "./useAgentIsolationPreview";
import { useAgentThreadStore } from "./useAgentThreadStore";
import { useAgentTurnDispatch } from "./useAgentTurnDispatch";
import { useAgentWorktreeLifecycle } from "./useAgentWorktreeLifecycle";
import type { WorkbenchPrompter } from "./workbenchPrompter";

export interface AgentThreadsDependencies {
  readonly agentTaskGateway: AgentTaskGateway;
  readonly agentThreadStoreGateway: AgentThreadStoreGateway;
  readonly gitWorktreeGateway: GitWorktreeGateway;
  readonly gitGateway: Pick<GitGateway, "getStatus" | "getDiff">;
  readonly prompter: WorkbenchPrompter;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly agentModeActive: boolean;
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

export function useAgentThreads(dependencies: AgentThreadsDependencies): AgentThreadsSurface {
  const [notice, setNotice] = useState<AgentTasksNotice | null>(null);
  const { projects, reportError, gitGateway } = dependencies;

  const store = useAgentThreadStore({
    agentThreadStoreGateway: dependencies.agentThreadStoreGateway,
    projects,
    agentModeActive: dependencies.agentModeActive,
    reportError,
    setNotice,
    now: dependencies.now,
  });
  const threads = store.state.threads;

  const changes = useAgentChangeSummary({ gitGateway, projects, threads, reportError });

  const worktrees = useAgentWorktreeLifecycle({
    gitWorktreeGateway: dependencies.gitWorktreeGateway,
    gitGateway,
    prompter: dependencies.prompter,
    projects,
    threads,
    loadedRootKeys: store.loadedRootKeys,
    reportError,
    setNotice,
    onWorktreeRemovalChanged: changes.setRemoving,
    onWorktreeRemoved: changes.clear,
  });

  const liveAgentTasksInRepository = useCallback(
    (repositoryRoot: string): number => countRunningTurnsInRepository(store.state, repositoryRoot),
    [store.state],
  );

  const isolation = useAgentIsolationPreview({
    projects,
    gitGateway,
    getRepositoryStatus: dependencies.getRepositoryStatus,
    getDirtyEditorDocumentCount: dependencies.getDirtyEditorDocumentCount,
    liveAgentTasksInRepository,
    reportError,
  });

  const { refreshOrphanedWorktrees, missingWorktreeThreadIds } = worktrees;
  const { refreshVisibleChanges } = changes;

  const isWorktreeMissing = useCallback(
    (threadId: string): boolean => missingWorktreeThreadIds.has(threadId),
    [missingWorktreeThreadIds],
  );

  const onTurnTerminal = useCallback(
    (event: AgentTaskStatusEvent): void => {
      if (event.isolation !== "worktree") return;
      void refreshOrphanedWorktrees();
      void refreshVisibleChanges(threadIdForTurn(threads, event.taskId));
    },
    [refreshOrphanedWorktrees, refreshVisibleChanges, threads],
  );

  const onWorktreeDispatchFailed = useCallback((): void => {
    void refreshOrphanedWorktrees();
  }, [refreshOrphanedWorktrees]);

  const dispatch = useAgentTurnDispatch({
    agentTaskGateway: dependencies.agentTaskGateway,
    gitWorktreeGateway: dependencies.gitWorktreeGateway,
    projects,
    store,
    getAgentCliPath: dependencies.getAgentCliPath,
    getAgentCliKind: dependencies.getAgentCliKind,
    getMaxConcurrentAgentTasks: dependencies.getMaxConcurrentAgentTasks,
    preflightInPlace: isolation.preflightInPlace,
    isWorktreeMissing,
    retainUncertainWorktree: worktrees.retainUncertainWorktree,
    onWorktreeDispatchFailed,
    onTurnTerminal,
    onProjectDispatchTrustRejected: dependencies.onProjectDispatchTrustRejected,
    ensureProjectLease: dependencies.ensureProjectLease,
    reportError,
    setNotice,
    now: dependencies.now,
    createEntropyHex4: dependencies.createEntropyHex4,
  });

  const { dispatchAction, remove: removeFromStore } = store;
  const { clear: clearSummary } = changes;

  const remove = useCallback(
    (threadId: string): void => {
      const thread = threads.get(threadId);
      if (thread === undefined) return;
      if (runningTurn(thread) !== null) {
        setNotice({
          kind: "warning",
          message: "Stop the agent before removing its thread.",
          action: null,
        });
        return;
      }
      removeFromStore(threadId);
      clearSummary(threadId);
      void refreshOrphanedWorktrees();
    },
    [clearSummary, refreshOrphanedWorktrees, removeFromStore, threads],
  );

  const releaseProjectTasks = useCallback(
    (ownerId: string): void => {
      dispatchAction({ kind: "ownerReleased", ownerId });
      void refreshOrphanedWorktrees();
    },
    [dispatchAction, refreshOrphanedWorktrees],
  );

  const { openAgentSettings } = dependencies;
  const configureAgentCli = useCallback((): void => openAgentSettings(), [openAgentSettings]);
  const dismissNotice = useCallback((): void => setNotice(null), []);

  const threadViews = useMemo(
    () =>
      agentThreadViews(
        threads,
        changes.summaries,
        worktrees.removedWorktreeThreadIds,
        missingWorktreeThreadIds,
        projects,
      ),
    [
      changes.summaries,
      missingWorktreeThreadIds,
      projects,
      threads,
      worktrees.removedWorktreeThreadIds,
    ],
  );

  const repositories = useMemo(() => flattenProjectRepositories(projects), [projects]);
  const maxConcurrentAgentTasks = normalizeMaxConcurrentAgentTasks(
    dependencies.getMaxConcurrentAgentTasks(),
  );
  const agentCliConfigured = normalizeAgentCliPath(dependencies.getAgentCliPath()) !== null;

  return {
    threads: threadViews,
    repositories,
    orphanedWorktrees: worktrees.orphanedWorktrees,
    notice,
    dispatching: dispatch.dispatching,
    agentCliConfigured,
    agentCliKind: normalizeAgentCliKind(dependencies.getAgentCliKind()),
    liveTaskCount: countRunningTurns(store.state),
    maxConcurrentAgentTasks,
    isolationPreview: isolation.isolationPreview,
    refreshIsolationStatus: isolation.refreshIsolationStatus,
    startThread: dispatch.startThread,
    sendFollowUp: dispatch.sendFollowUp,
    stop: dispatch.stop,
    togglePin: store.togglePin,
    archive: store.archive,
    remove,
    hasLiveTasksForOwner: dispatch.hasLiveTasksForOwner,
    stopProjectTasks: dispatch.stopProjectTasks,
    releaseProjectTasks,
    removeOrphanedWorktree: worktrees.removeOrphanedWorktree,
    pruneOrphanedWorktrees: worktrees.pruneOrphanedWorktrees,
    showChanges: changes.showChanges,
    hideChanges: changes.hideChanges,
    showFileDiff: changes.showFileDiff,
    hideFileDiff: changes.hideFileDiff,
    removeWorktree: worktrees.removeWorktree,
    configureAgentCli,
    dismissNotice,
  };
}

function threadIdForTurn(threads: ReadonlyMap<string, AgentThread>, turnId: string): string {
  for (const thread of threads.values()) {
    if (thread.turns.some((turn) => turn.turnId === turnId)) return thread.threadId;
  }
  return turnId;
}

function agentThreadViews(
  threads: ReadonlyMap<string, AgentThread>,
  summaries: ReadonlyMap<string, AgentTaskChangeSummary>,
  removedWorktrees: ReadonlySet<string>,
  missingWorktrees: ReadonlySet<string>,
  projects: ReadonlyArray<AgentProjectDescriptor>,
): ReadonlyArray<AgentThreadView> {
  const projectsByOwnerId = new Map<string, AgentProjectDescriptor>();
  for (const project of projects) {
    if (projectsByOwnerId.has(project.ownerId)) continue;
    projectsByOwnerId.set(project.ownerId, project);
  }
  const views: AgentThreadView[] = [];
  for (const thread of threads.values()) {
    const project = projectsByOwnerId.get(thread.owner.ownerId);
    if (project === undefined) continue;
    views.push({
      thread,
      lifecycle: agentThreadLifecycle(thread),
      repositoryLabel: repositoryLabel(thread.owner.repositoryRoot, project.rootPath),
      projectOrigin: project.origin,
      worktreeRemoved: removedWorktrees.has(thread.threadId),
      worktreeMissing: missingWorktrees.has(thread.threadId),
      changeSummary: summaries.get(thread.threadId) ?? null,
    });
  }
  return views.sort(compareThreadViews);
}

function compareThreadViews(left: AgentThreadView, right: AgentThreadView): number {
  if (left.thread.pinned !== right.thread.pinned) return left.thread.pinned ? -1 : 1;
  if (left.thread.updatedAtEpochMs !== right.thread.updatedAtEpochMs) {
    return right.thread.updatedAtEpochMs - left.thread.updatedAtEpochMs;
  }
  return left.thread.threadId.localeCompare(right.thread.threadId);
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
