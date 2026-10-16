import { useCallback } from "react";
import { agentProjectOwnsOwner, type AgentProjectDescriptor } from "../../domain/agentProject";
import { agentShipStatus, type AgentShipState } from "../../domain/agentShip";
import { agentThreadUnread, runningTurn, type AgentThread } from "../../domain/agentThread";
import type {
  AgentThreadDropSection,
  AgentThreadOrganizationPatch,
  AgentThreadPlacement,
} from "../../domain/agentThreadOrganization";
import type {
  AgentTasksNotice,
  AgentThreadCopyDetail,
  AgentThreadStoreSurface,
} from "../agentThreadPorts";
import { fallbackShipState } from "../agentThreadViewProjection";

export interface AgentThreadCommandsInput {
  readonly store: AgentThreadStoreSurface;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly now: () => number;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
  readonly endThreadSession: (thread: AgentThread) => void;
  readonly clearSummary: (threadId: string) => void;
  readonly clearShip: (threadId: string) => void;
  readonly shipStates: ReadonlyMap<string, AgentShipState>;
  readonly refreshOrphanedWorktrees: () => Promise<unknown>;
  readonly ensureExternalHistory: (threadId: string) => Promise<unknown>;
  readonly clearDeferredForOwner: (ownerId: string) => void;
  readonly ownerHasRunningTurn: (ownerId: string) => boolean;
  readonly ownerHasLiveSession: (threads: Iterable<AgentThread>, ownerId: string) => boolean;
  readonly currentThreads: () => ReadonlyMap<string, AgentThread>;
}

export interface AgentThreadCommands {
  remove(threadId: string): boolean;
  togglePin(threadId: string): void;
  archive(threadId: string): boolean;
  unarchive(threadId: string): boolean;
  releaseProjectTasks(ownerId: string): void;
  hasLiveTasksForOwner(ownerId: string): boolean;
  markThreadViewed(threadId: string): void;
  markThreadUnread(threadId: string): void;
  updateThreadOrganization(threadId: string, patch: AgentThreadOrganizationPatch): void;
  reorderThread(
    threadId: string,
    targetThreadId: string,
    placement: AgentThreadPlacement,
    destination?: AgentThreadDropSection,
  ): void;
  renameThread(threadId: string, title: string): void;
  threadCopyDetail(threadId: string, detail: AgentThreadCopyDetail): string | null;
}

export function useAgentThreadCommands(input: AgentThreadCommandsInput): AgentThreadCommands {
  const {
    store,
    projects,
    now,
    setNotice,
    endThreadSession,
    clearSummary,
    clearShip,
    shipStates,
    refreshOrphanedWorktrees,
    ensureExternalHistory,
    clearDeferredForOwner,
    ownerHasRunningTurn,
    ownerHasLiveSession,
    currentThreads,
  } = input;
  const { dispatchAction, remove: removeFromStore } = store;

  const remove = useCallback(
    (threadId: string): boolean => {
      const thread = store.currentState().threads.get(threadId);
      if (thread === undefined) return false;
      if (!ownsThread(projects, thread)) return false;
      if (runningTurn(thread) !== null) {
        setNotice({
          kind: "warning",
          message: "Stop the agent before removing its thread.",
          action: null,
        });
        return false;
      }
      removeFromStore(threadId);
      if (store.currentState().threads.has(threadId)) return false;
      endThreadSession(thread);
      clearSummary(threadId);
      clearShip(threadId);
      void refreshOrphanedWorktrees();
      return true;
    },
    [
      clearShip,
      clearSummary,
      endThreadSession,
      projects,
      refreshOrphanedWorktrees,
      removeFromStore,
      setNotice,
      store,
    ],
  );

  const { togglePin: togglePinInStore, archive: archiveInStore } = store;
  const togglePin = useCallback(
    (threadId: string): void => {
      const thread = store.currentState().threads.get(threadId);
      if (thread === undefined || !ownsThread(projects, thread)) return;
      togglePinInStore(threadId);
    },
    [projects, store, togglePinInStore],
  );

  const archive = useCallback(
    (threadId: string): boolean => {
      const thread = store.currentState().threads.get(threadId);
      if (thread === undefined || !ownsThread(projects, thread)) return false;
      archiveInStore(threadId);
      const archived = store.currentState().threads.get(threadId)?.archived === true;
      if (archived && !thread.archived) endThreadSession(thread);
      return archived;
    },
    [archiveInStore, endThreadSession, projects, store],
  );

  const unarchive = useCallback(
    (threadId: string): boolean => {
      const thread = store.currentState().threads.get(threadId);
      if (thread === undefined || !ownsThread(projects, thread)) return false;
      dispatchAction({ kind: "unarchived", threadId });
      return store.currentState().threads.get(threadId)?.archived === false;
    },
    [dispatchAction, projects, store],
  );

  const releaseProjectTasks = useCallback(
    (ownerId: string): void => {
      clearDeferredForOwner(ownerId);
      dispatchAction({ kind: "ownerReleased", ownerId });
      void refreshOrphanedWorktrees();
    },
    [clearDeferredForOwner, dispatchAction, refreshOrphanedWorktrees],
  );

  const hasLiveTasksForOwner = useCallback(
    (ownerId: string): boolean =>
      ownerHasRunningTurn(ownerId) || ownerHasLiveSession(currentThreads().values(), ownerId),
    [currentThreads, ownerHasLiveSession, ownerHasRunningTurn],
  );

  const { currentState, hydrateThread } = store;
  const markThreadViewed = useCallback(
    (threadId: string): void => {
      void ensureExternalHistory(threadId);
      hydrateThread?.(threadId);
      const thread = currentState().threads.get(threadId);
      if (thread === undefined) return;
      if (!agentThreadUnread(thread)) return;
      if (!ownsThread(projects, thread)) return;
      dispatchAction({ kind: "threadViewed", threadId, atEpochMs: now() });
    },
    [currentState, dispatchAction, ensureExternalHistory, hydrateThread, now, projects],
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

  const updateThreadOrganization = useCallback(
    (threadId: string, patch: AgentThreadOrganizationPatch): void => {
      const thread = currentState().threads.get(threadId);
      if (thread === undefined || !ownsThread(projects, thread)) return;
      dispatchAction({ kind: "threadOrganizationUpdated", threadId, owner: thread.owner, patch });
    },
    [currentState, projects, dispatchAction],
  );
  const reorderThread = useCallback(
    (
      threadId: string,
      targetThreadId: string,
      placement: AgentThreadPlacement,
      destination?: AgentThreadDropSection,
    ): void => {
      const thread = currentState().threads.get(threadId);
      if (thread === undefined || !ownsThread(projects, thread)) return;
      dispatchAction({
        kind: "threadReordered",
        threadId,
        owner: thread.owner,
        targetThreadId,
        placement,
        destination,
        now: now(),
      });
    },
    [currentState, projects, dispatchAction, now],
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

  const threadCopyDetail = useCallback(
    (threadId: string, detail: AgentThreadCopyDetail): string | null => {
      const thread = currentState().threads.get(threadId);
      if (thread === undefined) return null;
      if (!ownsThread(projects, thread)) return null;
      return copyDetailOf(thread, shipStates.get(threadId) ?? fallbackShipState(thread), detail);
    },
    [currentState, projects, shipStates],
  );

  return {
    remove,
    togglePin,
    archive,
    unarchive,
    releaseProjectTasks,
    hasLiveTasksForOwner,
    markThreadViewed,
    markThreadUnread,
    updateThreadOrganization,
    reorderThread,
    renameThread,
    threadCopyDetail,
  };
}

function ownsThread(projects: ReadonlyArray<AgentProjectDescriptor>, thread: AgentThread): boolean {
  return projects.some((project) => agentProjectOwnsOwner(project, thread.owner));
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
