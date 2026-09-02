import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentCliKind, AgentTaskGateway, AgentTaskStatusEvent } from "../domain/agentTask";
import type { AgentLaunchOptions } from "../domain/agentLaunch";
import {
  agentThreadAttention,
  agentThreadLifecycle,
  agentThreadTitle,
  agentThreadUnread,
  lastUsedAgentLaunch,
  normalizeAgentThreadTitle,
  runningTurn,
  type AgentThread,
  type AgentThreadsState,
} from "../domain/agentThread";
import { isExternalAgentSessionId } from "../domain/externalAgentSession";
import {
  agentShipStatus,
  initialAgentShipState,
  type AgentShipAvailability,
  type AgentShipState,
} from "../domain/agentShip";
import { normalizeAgentCliKind, normalizeMaxConcurrentAgentTasks } from "../domain/agentSettings";
import type { GitGateway } from "../domain/git";
import type { GitIntegrationGateway } from "../domain/gitIntegration";
import type { GitWorktreeGateway } from "../domain/gitWorktree";
import type { ResolvedGitRepository } from "../domain/gitRepositoryMapping";
import type {
  AgentRepositoryStatusSnapshot,
  AgentTaskChangeSummary,
  AgentTasksNotice,
  AgentThreadCopyDetail,
  AgentThreadStoreGateway,
  AgentThreadView,
  AgentThreadsSurface,
  ExternalSessionGateway,
  ExternalSessionImportRequest,
  ExternalSessionImportResult,
  ExternalSessionsSurface,
} from "./agentThreadPorts";
import { info, projectByOwnerId, projectByRootKey, warning } from "./agentProjectAuthority";
import {
  countRunningTurns,
  countRunningTurnsInRepository,
  mintUnusedId,
  usedTurnIds,
  type AgentTurnAdmissionDependencies,
} from "./agentTurnAdmission";
import { useExternalSessions } from "./useExternalSessions";
import { useAgentChangeSummary } from "./useAgentChangeSummary";
import {
  useAgentEditorBridge,
  type AgentEditorBridgePort,
  type AgentEditorBridgeSurface,
} from "./useAgentEditorBridge";
import { useAgentIsolationPreview } from "./useAgentIsolationPreview";
import { useAgentShipFlow, type ExternalUrlOpenerPort } from "./useAgentShipFlow";
import { useAgentThreadStore } from "./useAgentThreadStore";
import { useAgentTurnDispatch } from "./useAgentTurnDispatch";
import { useAgentWorktreeLifecycle } from "./useAgentWorktreeLifecycle";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import type { AgentProviderAdmissionAuthorityReader } from "./agentProviderAdmissionAuthority";

export type AgentThreadsGitGateway = Pick<
  GitGateway,
  "getStatus" | "getDiff" | "stageFiles" | "commit" | "deleteBranch"
>;

export interface AgentThreadsDependencies {
  readonly agentTaskGateway: AgentTaskGateway;
  readonly agentThreadStoreGateway: AgentThreadStoreGateway;
  readonly externalSessionGateway?: ExternalSessionGateway;
  readonly gitWorktreeGateway: GitWorktreeGateway;
  readonly gitGateway: AgentThreadsGitGateway;
  readonly gitIntegrationGateway: GitIntegrationGateway;
  readonly externalUrlOpener: ExternalUrlOpenerPort | null;
  readonly editorBridge: AgentEditorBridgePort | null;
  readonly prompter: WorkbenchPrompter;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly agentModeActive: boolean;
  readonly getAgentCliKind: () => AgentCliKind;
  readonly currentCliVersion: (provider: AgentCliKind) => string | null;
  readonly getAgentProviderAdmissionAuthority: AgentProviderAdmissionAuthorityReader;
  readonly getMaxConcurrentAgentTasks: () => number;
  readonly getRepositoryStatus: (repositoryRoot: string) => AgentRepositoryStatusSnapshot;
  readonly getDirtyEditorDocumentCount: (repositoryRoot: string) => number;
  readonly onProjectDispatchTrustRejected?: (projectRootKey: string) => void;
  readonly ensureProjectLease?: (projectRootKey: string) => Promise<boolean>;
  readonly ensureProjectLaunchIdentity?:
    AgentTurnAdmissionDependencies["ensureProjectLaunchIdentity"];
  readonly launchIdentityForProject: AgentTurnAdmissionDependencies["launchIdentityForProject"];
  readonly reportError: (source: string, error: unknown) => void;
  readonly openAgentSettings: () => void;
  readonly now?: () => number;
  readonly createEntropyHex4?: () => string;
}

const NO_PENDING_SHIP_RECONCILE: ReadonlySet<string> = Object.freeze(new Set<string>());

export const IMPORT_INVALID_SESSION_NOTICE =
  "This terminal session id is not valid, so it cannot be imported.";
export const IMPORT_PROVIDER_MISMATCH_NOTICE =
  "This session was recorded by a different agent CLI, so it cannot be imported here.";
export const IMPORT_CLI_NOT_CONFIGURED_NOTICE =
  "Configure the agent CLI before importing a terminal session.";
export const IMPORT_PROJECT_UNAVAILABLE_NOTICE =
  "This project is not available, so the session cannot be imported.";
export const IMPORT_DUPLICATE_NOTICE = "This session is already imported.";
export const IMPORT_STORE_NOT_READY_NOTICE =
  "Saved threads are still loading for this project, so the session was not imported. Try again.";
const IMPORT_ID_MINT_FAILED_NOTICE = "A thread id could not be minted. Try again.";

const UNWIRED_EXTERNAL_SESSION_GATEWAY: ExternalSessionGateway = {
  listExternalSessions: () =>
    Promise.reject(new Error("The external session gateway is not wired.")),
  previewExternalSession: () =>
    Promise.reject(new Error("The external session gateway is not wired.")),
};

export interface AgentThreadsHookSurface extends AgentThreadsSurface {
  readonly externalSessions: ExternalSessionsSurface;
}

export function useAgentThreads(dependencies: AgentThreadsDependencies): AgentThreadsHookSurface {
  const [notice, setNotice] = useState<AgentTasksNotice | null>(null);
  const [pendingShipReconcile, setPendingShipReconcile] = useState<ReadonlySet<string>>(
    () => NO_PENDING_SHIP_RECONCILE,
  );
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

  const { refreshOrphanedWorktrees, missingWorktreeThreadIds, markWorktreeRemoved } = worktrees;
  const { refreshVisibleChanges } = changes;
  const { dispatchAction, remove: removeFromStore } = store;

  const ship = useAgentShipFlow({
    gitGateway,
    gitIntegrationGateway: dependencies.gitIntegrationGateway,
    gitWorktreeGateway: dependencies.gitWorktreeGateway,
    externalUrlOpener: dependencies.externalUrlOpener,
    prompter: dependencies.prompter,
    projects,
    threads,
    missingWorktreeThreadIds,
    dispatchThreadAction: dispatchAction,
    reportError,
    setNotice,
    onWorktreeRemoved: markWorktreeRemoved,
    onShipStepCompleted: (threadId) => void refreshVisibleChanges(threadId),
    now: dependencies.now,
  });

  const editor = useAgentEditorBridge({
    projects,
    threads,
    editor: dependencies.editorBridge,
    reportError,
  });

  const isWorktreeMissing = useCallback(
    (threadId: string): boolean => missingWorktreeThreadIds.has(threadId),
    [missingWorktreeThreadIds],
  );

  const { states: shipStates, refreshShipStatus, clear: clearShip } = ship;

  const onTurnTerminal = useCallback(
    (event: AgentTaskStatusEvent): void => {
      if (event.isolation !== "worktree") return;
      void refreshOrphanedWorktrees();
      const threadId = threadIdForTurn(threads, event.taskId);
      void refreshVisibleChanges(threadId);
      setPendingShipReconcile((current) => {
        if (current.has(threadId)) return current;
        return new Set(current).add(threadId);
      });
    },
    [refreshOrphanedWorktrees, refreshVisibleChanges, threads],
  );

  useEffect(() => {
    if (pendingShipReconcile.size === 0) return;
    for (const threadId of pendingShipReconcile) {
      void refreshShipStatus(threadId);
    }
    setPendingShipReconcile(NO_PENDING_SHIP_RECONCILE);
  }, [pendingShipReconcile, refreshShipStatus]);

  const onWorktreeDispatchFailed = useCallback((): void => {
    void refreshOrphanedWorktrees();
  }, [refreshOrphanedWorktrees]);

  const agentCliKind = normalizeAgentCliKind(dependencies.getAgentCliKind());
  const agentCliVersion = dependencies.currentCliVersion(agentCliKind);
  const agentCliConfigured =
    dependencies.getAgentProviderAdmissionAuthority(agentCliKind).disposition.kind === "ready";

  const dispatch = useAgentTurnDispatch({
    agentTaskGateway: dependencies.agentTaskGateway,
    gitWorktreeGateway: dependencies.gitWorktreeGateway,
    projects,
    store,
    getAgentCliKind: dependencies.getAgentCliKind,
    getAgentProviderAdmissionAuthority: dependencies.getAgentProviderAdmissionAuthority,
    getMaxConcurrentAgentTasks: dependencies.getMaxConcurrentAgentTasks,
    preflightInPlace: isolation.preflightInPlace,
    isWorktreeMissing,
    retainUncertainWorktree: worktrees.retainUncertainWorktree,
    onWorktreeCreated: worktrees.noteCreatedWorktree,
    currentCliVersion: dependencies.currentCliVersion,
    onWorktreeDispatchFailed,
    onTurnTerminal,
    onProjectDispatchTrustRejected: dependencies.onProjectDispatchTrustRejected,
    ensureProjectLease: dependencies.ensureProjectLease,
    ensureProjectLaunchIdentity: dependencies.ensureProjectLaunchIdentity,
    launchIdentityForProject: dependencies.launchIdentityForProject,
    reportError,
    setNotice,
    now: dependencies.now,
    createEntropyHex4: dependencies.createEntropyHex4,
  });

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
      clearShip(threadId);
      void refreshOrphanedWorktrees();
    },
    [clearShip, clearSummary, refreshOrphanedWorktrees, removeFromStore, threads],
  );

  const releaseProjectTasks = useCallback(
    (ownerId: string): void => {
      dispatchAction({ kind: "ownerReleased", ownerId });
      void refreshOrphanedWorktrees();
    },
    [dispatchAction, refreshOrphanedWorktrees],
  );

  const now = dependencies.now ?? Date.now;
  const { currentState } = store;
  const markThreadViewed = useCallback(
    (threadId: string): void => {
      const thread = currentState().threads.get(threadId);
      if (thread === undefined) return;
      if (!agentThreadUnread(thread)) return;
      if (!ownsThread(projects, thread)) return;
      dispatchAction({ kind: "threadViewed", threadId, atEpochMs: now() });
    },
    [currentState, dispatchAction, now, projects],
  );

  const { markUnread: markUnreadInStore, rename: renameInStore } = store;
  const markThreadUnread = useCallback(
    (threadId: string): void => {
      const thread = currentState().threads.get(threadId);
      if (thread === undefined) return;
      if (!ownsThread(projects, thread)) return;
      markUnreadInStore(threadId);
    },
    [currentState, markUnreadInStore, projects],
  );

  const renameThread = useCallback(
    (threadId: string, title: string): void => {
      const thread = currentState().threads.get(threadId);
      if (thread === undefined) return;
      if (!ownsThread(projects, thread)) return;
      renameInStore(threadId, title);
    },
    [currentState, projects, renameInStore],
  );

  const {
    getAgentCliKind,
    getAgentProviderAdmissionAuthority,
    launchIdentityForProject,
    now: clock,
    createEntropyHex4,
  } = dependencies;
  const { loadedRootKeys } = store;
  const importExternalSession = useCallback(
    async (request: ExternalSessionImportRequest): Promise<ExternalSessionImportResult | null> => {
      if (!isExternalAgentSessionId(request.sessionId)) {
        setNotice(warning(IMPORT_INVALID_SESSION_NOTICE));
        return null;
      }
      if (request.provider !== normalizeAgentCliKind(getAgentCliKind())) {
        setNotice({
          kind: "warning",
          message: IMPORT_PROVIDER_MISMATCH_NOTICE,
          action: "configure-agent-cli",
        });
        return null;
      }
      if (getAgentProviderAdmissionAuthority(request.provider).disposition.kind !== "ready") {
        setNotice({
          kind: "warning",
          message: IMPORT_CLI_NOT_CONFIGURED_NOTICE,
          action: "configure-agent-cli",
        });
        return null;
      }
      const project = projectByRootKey(projects, request.projectRootKey);
      if (
        project === undefined ||
        project.origin === "closed-tab-live-tasks" ||
        !project.repositories.some(
          (repository) => repository.repositoryRoot === request.repositoryRoot,
        )
      ) {
        setNotice(warning(IMPORT_PROJECT_UNAVAILABLE_NOTICE));
        return null;
      }
      const identity = launchIdentityForProject(project.rootKey);
      if (identity === null) {
        setNotice(warning(IMPORT_PROJECT_UNAVAILABLE_NOTICE));
        return null;
      }
      if (!loadedRootKeys.has(project.rootKey)) {
        setNotice(warning(IMPORT_STORE_NOT_READY_NOTICE));
        return null;
      }
      const state = currentState();
      const existing = importedThreadFor(state, request);
      if (existing !== null) {
        setNotice(info(IMPORT_DUPLICATE_NOTICE));
        return { threadId: existing.threadId, alreadyImported: true };
      }
      const usedIds = new Set([...state.threads.keys(), ...usedTurnIds(state)]);
      const threadId = mintUnusedId({ now: clock, createEntropyHex4 }, usedIds);
      if (threadId === null) {
        setNotice(warning(IMPORT_ID_MINT_FAILED_NOTICE));
        return null;
      }
      const createdAt = (clock ?? Date.now)();
      const thread: AgentThread = {
        threadId,
        owner: {
          rootKey: project.rootKey,
          ownerId: identity.workspaceId,
          repositoryRoot: request.repositoryRoot,
        },
        target: { isolation: "in-place", worktreePath: null },
        provider: { kind: request.provider, sessionId: request.sessionId },
        title: normalizeAgentThreadTitle(request.title) ?? agentThreadTitle(request.firstPrompt),
        pinned: false,
        archived: false,
        createdAtEpochMs: createdAt,
        updatedAtEpochMs: createdAt,
        turns: [],
        turnsTruncated: false,
        integration: null,
        viewedAtEpochMs: createdAt,
        externalOrigin: {
          provider: request.provider,
          sessionId: request.sessionId,
          importedAtEpochMs: createdAt,
        },
      };
      dispatchAction({ kind: "threadCreated", thread });
      setNotice(null);
      return { threadId, alreadyImported: false };
    },
    [
      clock,
      createEntropyHex4,
      currentState,
      dispatchAction,
      getAgentCliKind,
      getAgentProviderAdmissionAuthority,
      launchIdentityForProject,
      loadedRootKeys,
      projects,
    ],
  );

  const externalSessions = useExternalSessions({
    externalSessionGateway: dependencies.externalSessionGateway ?? UNWIRED_EXTERNAL_SESSION_GATEWAY,
    threads,
    projects,
    reportError,
    setNotice,
  });

  const threadCopyDetail = useCallback(
    (threadId: string, detail: AgentThreadCopyDetail): string | null => {
      const thread = currentState().threads.get(threadId);
      if (thread === undefined) return null;
      if (!ownsThread(projects, thread)) return null;
      return copyDetailOf(thread, shipStates.get(threadId) ?? fallbackShipState(thread), detail);
    },
    [currentState, projects, shipStates],
  );

  const lastUsedLaunch = useCallback(
    (projectRootKey: string): AgentLaunchOptions | null =>
      lastUsedAgentLaunch(threads.values(), projectRootKey, agentCliKind),
    [agentCliKind, threads],
  );

  const { openAgentSettings } = dependencies;
  const configureAgentCli = useCallback((): void => openAgentSettings(), [openAgentSettings]);
  const dismissNotice = useCallback((): void => setNotice(null), []);

  const viewCacheRef = useRef<ReadonlyMap<string, AgentThreadView>>(new Map());
  const threadViews = useMemo(() => {
    const views = agentThreadViews(
      viewCacheRef.current,
      threads,
      changes.summaries,
      worktrees.removedWorktreeThreadIds,
      missingWorktreeThreadIds,
      shipStates,
      editor,
      projects,
    );
    viewCacheRef.current = new Map(views.map((view) => [view.thread.threadId, view]));
    return views;
  }, [
    changes.summaries,
    editor,
    missingWorktreeThreadIds,
    projects,
    shipStates,
    threads,
    worktrees.removedWorktreeThreadIds,
  ]);

  const repositories = useMemo(() => flattenProjectRepositories(projects), [projects]);
  const maxConcurrentAgentTasks = normalizeMaxConcurrentAgentTasks(
    dependencies.getMaxConcurrentAgentTasks(),
  );
  return {
    threads: threadViews,
    repositories,
    orphanedWorktrees: worktrees.orphanedWorktrees,
    notice,
    dispatching: dispatch.dispatching,
    agentCliConfigured,
    agentCliKind,
    agentCliVersion,
    liveTaskCount: countRunningTurns(store.state),
    maxConcurrentAgentTasks,
    pendingTurnCount: dispatch.pendingTurnCount,
    markThreadViewed,
    markThreadUnread,
    renameThread,
    threadCopyDetail,
    lastUsedLaunch,
    isolationPreview: isolation.isolationPreview,
    refreshIsolationStatus: isolation.refreshIsolationStatus,
    startThread: dispatch.startThread,
    sendFollowUp: dispatch.sendFollowUp,
    importExternalSession,
    externalSessions,
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
    refreshShipStatus,
    commitThreadChanges: ship.commit,
    pushThreadBranch: ship.push,
    openThreadCompareUrl: ship.openCompareUrl,
    integrateThreadBranch: ship.integrate,
    removeThreadWorktree: ship.removeWorktree,
    resetThreadShip: ship.resetShip,
    openChangedFile: editor.openChangedFile,
    openChangedFileDiff: editor.openChangedFileDiff,
    configureAgentCli,
    dismissNotice,
  };
}

function importedThreadFor(
  state: AgentThreadsState,
  request: ExternalSessionImportRequest,
): AgentThread | null {
  for (const thread of state.threads.values()) {
    if (thread.owner.repositoryRoot !== request.repositoryRoot) continue;
    if (
      thread.provider.kind === request.provider &&
      thread.provider.sessionId === request.sessionId
    ) {
      return thread;
    }
    const origin = thread.externalOrigin;
    if (origin === null) continue;
    if (origin.provider === request.provider && origin.sessionId === request.sessionId) {
      return thread;
    }
  }
  return null;
}

function threadIdForTurn(threads: ReadonlyMap<string, AgentThread>, turnId: string): string {
  for (const thread of threads.values()) {
    if (thread.turns.some((turn) => turn.turnId === turnId)) return thread.threadId;
  }
  return turnId;
}

function ownsThread(projects: ReadonlyArray<AgentProjectDescriptor>, thread: AgentThread): boolean {
  const project = projectByOwnerId(projects, thread.owner.ownerId);
  if (project === undefined) return false;
  return project.rootKey === thread.owner.rootKey;
}

function copyDetailOf(
  thread: AgentThread,
  ship: AgentShipState,
  detail: AgentThreadCopyDetail,
): string | null {
  switch (detail) {
    case "threadId":
      return thread.threadId;
    case "path":
      return thread.target.worktreePath ?? thread.owner.repositoryRoot;
    case "branch":
      return threadBranch(thread, ship);
    default:
      return unsupportedCopyDetail(detail);
  }
}

function threadBranch(thread: AgentThread, ship: AgentShipState): string | null {
  const status = agentShipStatus(ship);
  if (status !== null) return status.worktree.branch;
  if (ship.kind === "pushed") return ship.receipt.branch;
  return thread.integration?.pushed?.branch ?? null;
}

function unsupportedCopyDetail(detail: never): never {
  throw new TypeError(`Unsupported agent thread copy detail: ${JSON.stringify(detail)}.`);
}

function agentThreadViews(
  previous: ReadonlyMap<string, AgentThreadView>,
  threads: ReadonlyMap<string, AgentThread>,
  summaries: ReadonlyMap<string, AgentTaskChangeSummary>,
  removedWorktrees: ReadonlySet<string>,
  missingWorktrees: ReadonlySet<string>,
  shipStates: ReadonlyMap<string, AgentShipState>,
  editor: AgentEditorBridgeSurface,
  projects: ReadonlyArray<AgentProjectDescriptor>,
): ReadonlyArray<AgentThreadView> {
  const projectsByOwnerId = new Map<string, AgentProjectDescriptor>();
  for (const project of projects) {
    for (const ownerId of project.runtimeOwnerIds ?? [project.ownerId]) {
      if (projectsByOwnerId.has(ownerId)) continue;
      projectsByOwnerId.set(ownerId, project);
    }
  }
  const views: AgentThreadView[] = [];
  for (const thread of threads.values()) {
    const project = projectsByOwnerId.get(thread.owner.ownerId);
    if (project === undefined) continue;
    const next: AgentThreadView = {
      thread,
      lifecycle: agentThreadLifecycle(thread),
      repositoryLabel: repositoryLabel(thread.owner.repositoryRoot, project.rootPath),
      projectOrigin: project.origin,
      worktreeRemoved: removedWorktrees.has(thread.threadId),
      worktreeMissing: missingWorktrees.has(thread.threadId),
      changeSummary: summaries.get(thread.threadId) ?? null,
      ship: shipStates.get(thread.threadId) ?? fallbackShipState(thread),
      editorAvailability: editor.canOpenInEditor(thread.threadId),
      attention: agentThreadAttention(thread),
      unread: agentThreadUnread(thread),
    };
    const cached = previous.get(thread.threadId);
    views.push(cached !== undefined && sameThreadView(cached, next) ? cached : next);
  }
  return views.sort(compareThreadViews);
}

const fallbackShipStates = new WeakMap<AgentThread, AgentShipState>();

function fallbackShipState(thread: AgentThread): AgentShipState {
  const memoized = fallbackShipStates.get(thread);
  if (memoized !== undefined) return memoized;
  const initial = initialAgentShipState(thread.integration);
  fallbackShipStates.set(thread, initial);
  return initial;
}

function sameThreadView(cached: AgentThreadView, next: AgentThreadView): boolean {
  if (cached.thread !== next.thread) return false;
  if (cached.changeSummary !== next.changeSummary) return false;
  if (cached.ship !== next.ship) return false;
  if (cached.worktreeRemoved !== next.worktreeRemoved) return false;
  if (cached.worktreeMissing !== next.worktreeMissing) return false;
  if (cached.projectOrigin !== next.projectOrigin) return false;
  if (cached.repositoryLabel !== next.repositoryLabel) return false;
  return sameAvailability(cached.editorAvailability, next.editorAvailability);
}

function sameAvailability(left: AgentShipAvailability, right: AgentShipAvailability): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "blocked" && right.kind === "blocked") return left.reason === right.reason;
  return true;
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
