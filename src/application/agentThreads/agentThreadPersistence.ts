import { agentRootOwnerId } from "../../domain/agentProject";
import { runningTurn, type AgentThread, type AgentThreadsState } from "../../domain/agentThread";
import { agentTurnArtifactReferences } from "../../domain/agentTurnArtifactReferences";
import {
  AGENT_TASKS_SOURCE,
  attempt,
  projectAuthority,
  projectByRootKey,
  warning,
  type AgentProjectAuthority,
} from "../agentProjectAuthority";
import {
  AgentThreadCleanupIncompleteError,
  type DeleteAgentThreadRequest,
} from "../agentThreadPorts";
import { persistentAgentThreadSaveRequest } from "../agentThreadSaveRequest";
import { agentTurnLogEvidence } from "../agentTurnLogStatusStore";
import type { PersistIntent, PersistUrgency } from "./agentThreadPersistIntent";
import {
  STORE_FULL_NOTICE,
  TURN_LOG_DELETE_FAILURE_NOTICE,
  historyDeletedCleanupFailure,
  persistFailureMessage,
} from "./agentThreadPersistFailure";
import {
  MIN_AGENT_THREAD_PERSIST_INTERVAL_MS,
  durableAgentHistory,
  isLoggedAgentThread,
  ownsProjectRoot,
  threadAuthority,
  type AgentThreadStoreContext,
} from "./agentThreadStoreContract";

export interface AgentThreadRemoval {
  readonly request: DeleteAgentThreadRequest;
  readonly logged: boolean;
}

export interface AgentThreadPersistence {
  record(intent: PersistIntent, previous: AgentThreadsState): void;
  flushQueue(): void;
  flushThread(threadId: string): Promise<boolean>;
  deletePersisted(removal: AgentThreadRemoval): Promise<void>;
  saveRunningThreadsNow(): void;
  retryFailedSaves(changedThreadIds: ReadonlySet<string>): void;
  isSaving(threadId: string): boolean;
  forget(threadId: string): void;
  dispose(): void;
}

interface ThreadPersistSlot {
  inFlight: boolean;
  lastSaveSucceeded: boolean;
  settled: Promise<void> | null;
  pending: PersistUrgency | null;
  lastSaveAtMs: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const MAX_FLUSH_SUCCESSOR_WAITS = 8;

export function createAgentThreadPersistence(
  context: AgentThreadStoreContext,
): AgentThreadPersistence {
  const slots = new Map<string, ThreadPersistSlot>();
  const dirty = new Map<string, PersistUrgency>();
  const deleteQueue: AgentThreadRemoval[] = [];
  let failureNoticeShown: string | null = null;

  const deps = context.dependencies;
  const nowMs = (): number => (deps().now ?? Date.now)();
  const intervalMs = (): number =>
    deps().minimumPersistIntervalMs ?? MIN_AGENT_THREAD_PERSIST_INTERVAL_MS;

  const notePersistFailure = (error: unknown): void => {
    deps().reportError(AGENT_TASKS_SOURCE, error);
    if (!context.mounted()) return;
    const message = persistFailureMessage(error);
    const refusalStaysVisible = message === STORE_FULL_NOTICE;
    if (!refusalStaysVisible && failureNoticeShown === message) return;
    failureNoticeShown = message;
    deps().setNotice(warning(message));
  };

  const publishHistoryRevision = (
    threadId: string,
    authority: AgentProjectAuthority,
    revision: number,
  ): void => {
    if (!context.mounted() || !ownsProjectRoot(deps().projects, authority)) return;
    const current = context.threads.current();
    const latest = current.threads.get(threadId);
    if (latest === undefined || (latest.historyRevision ?? 0) >= revision) return;
    const threads = new Map(current.threads);
    threads.set(threadId, { ...latest, historyRevision: revision });
    context.threads.stage({ threads });
    context.threads.notify();
  };

  const runSave = async (threadId: string): Promise<void> => {
    const slot = slotFor(slots, threadId);
    const thread = context.threads.current().threads.get(threadId);
    if (thread === undefined) return;
    const authority = threadAuthority(deps().projects, thread);
    if (authority === null) return;

    const facts = isLoggedAgentThread(thread) ? deps().turnLog?.facts : undefined;
    const evidenceRevision = facts?.evidenceRevisionOf(threadId);
    slot.inFlight = true;
    slot.lastSaveAtMs = nowMs();
    const inFlight = attempt(() =>
      deps().agentThreadStoreGateway.saveAgentThread({
        ...persistentAgentThreadSaveRequest(thread, facts),
        ...(!durableAgentHistory(context)
          ? {}
          : {
              isCurrent: () =>
                context.mounted() &&
                ownsProjectRoot(deps().projects, authority) &&
                context.threads.current().threads.has(threadId),
              onRevision: (revision: number) =>
                publishHistoryRevision(threadId, authority, revision),
            }),
      }),
    );
    slot.settled = inFlight.then(() => undefined);
    const saved = await inFlight;
    slot.inFlight = false;
    slot.lastSaveSucceeded = saved.ok;
    slot.settled = null;
    if (!context.mounted()) return;
    if (!saved.ok && ownsProjectRoot(deps().projects, authority)) {
      notePersistFailure(saved.error);
      if (facts?.evidenceRevisionOf(threadId) !== evidenceRevision) slot.pending = "coalesced";
    }
    if (saved.ok) failureNoticeShown = null;
    const pending = slot.pending;
    slot.pending = null;
    if (pending === null) return;
    scheduleSave(threadId, pending);
  };

  const scheduleSave = (threadId: string, urgency: PersistUrgency): void => {
    if (!context.mounted()) return;
    const slot = slotFor(slots, threadId);
    if (slot.inFlight) {
      slot.pending = urgency === "immediate" ? "immediate" : (slot.pending ?? "coalesced");
      return;
    }
    if (urgency === "immediate") {
      clearSlotTimer(slot);
      void runSave(threadId);
      return;
    }
    const elapsed = nowMs() - slot.lastSaveAtMs;
    const interval = intervalMs();
    if (elapsed >= interval) {
      void runSave(threadId);
      return;
    }
    if (slot.timer !== null) return;
    slot.timer = setTimeout(() => {
      slot.timer = null;
      if (!context.mounted()) return;
      void runSave(threadId);
    }, interval - elapsed);
  };

  const deleteTurnLog = async (
    request: DeleteAgentThreadRequest,
    logged: boolean,
    authority: AgentProjectAuthority | null,
  ): Promise<void> => {
    const turnLog = deps().turnLog;
    if (!logged || turnLog === undefined || authority === null) return;
    if (!context.mounted()) return;
    if (!ownsProjectRoot(deps().projects, authority)) return;
    const logRemoved = await attempt(() => turnLog.deleteThreadLog(request));
    if (logRemoved.ok) return;
    deps().reportError(AGENT_TASKS_SOURCE, logRemoved.error);
    if (!context.mounted()) return;
    if (!ownsProjectRoot(deps().projects, authority)) return;
    deps().setNotice(warning(TURN_LOG_DELETE_FAILURE_NOTICE));
  };

  const deletePersisted = async ({ request, logged }: AgentThreadRemoval): Promise<void> => {
    const project = projectByRootKey(deps().projects, request.rootKey);
    const authority = project === undefined ? null : projectAuthority(project);
    const settled = slots.get(request.threadId)?.settled;
    if (settled !== undefined && settled !== null) await settled;
    const removed = await attempt(() => deps().agentThreadStoreGateway.deleteAgentThread(request));
    const cleanupFailure = removed.ok ? null : historyDeletedCleanupFailure(removed.error);
    if (!removed.ok && cleanupFailure === null) throw removed.error;
    await deleteTurnLog(request, logged, authority);
    if (cleanupFailure !== null) throw new AgentThreadCleanupIncompleteError(cleanupFailure);
  };

  const runDelete = async (removal: AgentThreadRemoval): Promise<void> => {
    const removed = await attempt(() => deletePersisted(removal));
    if (!removed.ok) notePersistFailure(removed.error);
  };

  const flushThread = async (threadId: string): Promise<boolean> => {
    const thread = context.threads.current().threads.get(threadId);
    if (thread === undefined || runningTurn(thread) !== null) return false;
    const lastTurn = thread.turns[thread.turns.length - 1];
    const durableHistory = durableAgentHistory(context);
    if (lastTurn === undefined && !durableHistory) return true;
    const evidence = agentTurnLogEvidence(
      deps().turnLog?.facts.factsOf(lastTurn?.turnId ?? "") ?? null,
    );
    if (
      !durableHistory &&
      lastTurn !== undefined &&
      agentTurnArtifactReferences(lastTurn, evidence).length === 0
    )
      return true;
    const authority = threadAuthority(deps().projects, thread);
    if (authority === null) return false;
    const turnId = thread.turns[thread.turns.length - 1]?.turnId;
    const current = (): boolean => {
      const latest = context.threads.current().threads.get(threadId);
      return (
        context.mounted() &&
        ownsProjectRoot(deps().projects, authority) &&
        latest !== undefined &&
        latest.turns[latest.turns.length - 1]?.turnId === turnId &&
        runningTurn(latest) === null
      );
    };
    const slot = slotFor(slots, threadId);
    // Persistence can schedule one coalesced successor; cap retries under a mutation storm.
    for (let wait = 0; slot.inFlight && wait < MAX_FLUSH_SUCCESSOR_WAITS; wait += 1) {
      await slot.settled;
      if (!current()) return false;
    }
    if (slot.inFlight || !current()) return false;
    clearSlotTimer(slot);
    dirty.delete(threadId);
    await runSave(threadId);
    return current() && slot.lastSaveSucceeded;
  };

  return {
    record(intent, previous) {
      for (const [threadId, urgency] of intent.saves) {
        const existing = dirty.get(threadId);
        if (existing === "immediate") continue;
        dirty.set(threadId, urgency);
      }
      if (intent.remove === null) return;
      dirty.delete(intent.remove.threadId);
      const slot = slots.get(intent.remove.threadId);
      if (slot !== undefined) {
        clearSlotTimer(slot);
        slot.pending = null;
      }
      const removed = previous.threads.get(intent.remove.threadId);
      deleteQueue.push({
        request: intent.remove,
        logged: removed !== undefined && isLoggedAgentThread(removed),
      });
    },
    flushQueue() {
      for (const removal of deleteQueue.splice(0)) void runDelete(removal);
      const pending = [...dirty];
      dirty.clear();
      for (const [threadId, urgency] of pending) scheduleSave(threadId, urgency);
    },
    flushThread,
    deletePersisted,
    saveRunningThreadsNow() {
      for (const thread of context.threads.current().threads.values()) {
        if (runningTurn(thread) === null) continue;
        scheduleSave(thread.threadId, "immediate");
      }
    },
    retryFailedSaves(changedThreadIds) {
      for (const threadId of changedThreadIds) {
        const slot = slots.get(threadId);
        if (slot === undefined || slot.inFlight || slot.lastSaveSucceeded) continue;
        if (!Number.isFinite(slot.lastSaveAtMs)) continue;
        scheduleSave(threadId, "coalesced");
      }
    },
    isSaving(threadId) {
      return slots.get(threadId)?.inFlight === true;
    },
    forget(threadId) {
      const slot = slots.get(threadId);
      if (slot !== undefined) {
        clearSlotTimer(slot);
        slot.pending = null;
      }
      dirty.delete(threadId);
      slots.delete(threadId);
    },
    dispose() {
      for (const slot of slots.values()) clearSlotTimer(slot);
    },
  };
}

export function savedThreadRemoval(thread: AgentThread): AgentThreadRemoval {
  return {
    request: {
      rootKey: thread.owner.rootKey,
      ownerId: agentRootOwnerId(thread.owner.rootKey),
      threadId: thread.threadId,
    },
    logged: isLoggedAgentThread(thread),
  };
}

function slotFor(slots: Map<string, ThreadPersistSlot>, threadId: string): ThreadPersistSlot {
  const existing = slots.get(threadId);
  if (existing !== undefined) return existing;
  const slot: ThreadPersistSlot = {
    inFlight: false,
    lastSaveSucceeded: false,
    settled: null,
    pending: null,
    lastSaveAtMs: Number.NEGATIVE_INFINITY,
    timer: null,
  };
  slots.set(threadId, slot);
  return slot;
}

function clearSlotTimer(slot: ThreadPersistSlot): void {
  if (slot.timer === null) return;
  clearTimeout(slot.timer);
  slot.timer = null;
}
