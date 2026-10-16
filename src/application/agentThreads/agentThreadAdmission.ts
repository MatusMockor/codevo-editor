import {
  MAX_AGENT_THREADS_PER_ROOT,
  runningTurn,
  type AgentThread,
  type AgentThreadOwner,
  type AgentThreadsAction,
  type AgentThreadsState,
} from "../../domain/agentThread";
import type { AgentProjectAuthority } from "../agentProjectAuthority";
import { savedThreadRemoval, type AgentThreadPersistence } from "./agentThreadPersistence";
import type { AgentThreadLoading } from "./agentThreadLoading";
import {
  SAVED_DELETE_IN_PROGRESS,
  SAVED_DELETE_OPENING,
  SAVED_DELETE_PROJECT_LOADING,
  SAVED_DELETE_PROJECT_UNAVAILABLE,
  SAVED_DELETE_THREAD_OPEN,
  durableAgentHistory,
  ownsProjectRoot,
  threadAuthority,
  threadOwnerAuthority,
  type AgentThreadStoreContext,
} from "./agentThreadStoreContract";

export interface AgentThreadAdmissionPorts {
  readonly persistence: AgentThreadPersistence;
  readonly loading: AgentThreadLoading;
  dispatch(action: AgentThreadsAction): void;
}

export interface AgentThreadAdmission {
  admits(action: AgentThreadsAction, current: AgentThreadsState): boolean;
  reserveThreadSlot(threadId: string, owner: AgentThreadOwner): Promise<(() => void) | null>;
  restoreThread(thread: AgentThread): Promise<boolean>;
  deleteSavedThread(thread: AgentThread): Promise<void>;
}

interface SlotReservation {
  readonly threadId: string;
  readonly authority: AgentProjectAuthority;
}

export function createAgentThreadAdmission(
  context: AgentThreadStoreContext,
  ports: AgentThreadAdmissionPorts,
): AgentThreadAdmission {
  const reservations = new Map<string, SlotReservation>();
  const deleting = new Set<string>();
  const restoring = new Set<string>();
  const deps = context.dependencies;
  const threads = () => context.threads.current().threads;

  const reserveThreadSlot = async (
    threadId: string,
    owner: AgentThreadOwner,
  ): Promise<(() => void) | null> => {
    if (!durableAgentHistory(context)) return () => undefined;
    const authority = threadOwnerAuthority(deps().projects, owner);
    if (authority === null || !context.mounted()) return null;
    const existing = reservations.get(owner.rootKey);
    if (existing !== undefined && ownsProjectRoot(deps().projects, existing.authority)) return null;
    const reservation = { threadId, authority };
    reservations.set(owner.rootKey, reservation);
    const release = (): void => {
      if (reservations.get(owner.rootKey) === reservation) reservations.delete(owner.rootKey);
    };
    const current = (): boolean =>
      context.mounted() &&
      ownsProjectRoot(deps().projects, authority) &&
      reservations.get(owner.rootKey) === reservation;
    let admitted = false;
    try {
      const sameRoot = [...threads().values()].filter(
        (entry) => entry.owner.rootKey === owner.rootKey,
      );
      if (sameRoot.length >= MAX_AGENT_THREADS_PER_ROOT) {
        const victim = sameRoot
          .filter((entry) => !entry.pinned && runningTurn(entry) === null)
          .sort(
            (left, right) =>
              left.updatedAtEpochMs - right.updatedAtEpochMs ||
              left.threadId.localeCompare(right.threadId),
          )[0];
        if (
          victim === undefined ||
          !(await ports.persistence.flushThread(victim.threadId)) ||
          !current()
        )
          return null;
        const latest = threads().get(victim.threadId);
        if (
          latest === undefined ||
          !sameThreadContent(victim, latest) ||
          ports.persistence.isSaving(victim.threadId)
        )
          return null;
        ports.dispatch({ kind: "historyThreadEvicted", threadId: victim.threadId });
        if (threads().has(victim.threadId)) return null;
        ports.persistence.forget(victim.threadId);
      }
      if (!current()) return null;
      admitted = true;
      return release;
    } finally {
      if (!admitted) release();
    }
  };

  return {
    admits(action, current) {
      if (!durableAgentHistory(context)) return true;
      if (action.kind !== "threadCreated" && action.kind !== "historyThreadOpened") return true;
      const reservation = reservations.get(action.thread.owner.rootKey);
      if (reservation !== undefined && reservation.threadId !== action.thread.threadId)
        return false;
      return (
        [...current.threads.values()].filter(
          (thread) => thread.owner.rootKey === action.thread.owner.rootKey,
        ).length < MAX_AGENT_THREADS_PER_ROOT
      );
    },
    reserveThreadSlot,
    async restoreThread(thread) {
      const authority = threadAuthority(deps().projects, thread);
      if (authority === null) return false;
      if (threads().has(thread.threadId)) return true;
      if (deleting.has(thread.threadId)) return false;
      if (restoring.has(thread.threadId)) return false;
      restoring.add(thread.threadId);
      try {
        const release = await reserveThreadSlot(thread.threadId, thread.owner);
        if (release === null) return false;
        try {
          if (!context.mounted() || !ownsProjectRoot(deps().projects, authority)) return false;
          ports.dispatch({ kind: "historyThreadOpened", thread, evictThreadId: null });
          return threads().has(thread.threadId);
        } finally {
          release();
        }
      } finally {
        restoring.delete(thread.threadId);
      }
    },
    async deleteSavedThread(thread) {
      if (threadAuthority(deps().projects, thread) === null)
        throw new Error(SAVED_DELETE_PROJECT_UNAVAILABLE);
      if (threads().has(thread.threadId)) throw new Error(SAVED_DELETE_THREAD_OPEN);
      if (deleting.has(thread.threadId)) throw new Error(SAVED_DELETE_IN_PROGRESS);
      if (restoring.has(thread.threadId)) throw new Error(SAVED_DELETE_OPENING);
      if (ports.loading.isLoading(thread.owner.rootKey))
        throw new Error(SAVED_DELETE_PROJECT_LOADING);
      deleting.add(thread.threadId);
      try {
        await ports.persistence.deletePersisted(savedThreadRemoval(thread));
      } finally {
        deleting.delete(thread.threadId);
      }
    },
  };
}

function sameThreadContent(left: AgentThread, right: AgentThread): boolean {
  return (Object.keys(left) as Array<keyof AgentThread>).every(
    (key) => key === "historyRevision" || left[key] === right[key],
  );
}
