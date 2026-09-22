import { interruptedTurnLogLosses } from "./agentTurnLogRestartRecovery";
import { persistentAgentThreadSaveRequest } from "./agentThreadSaveRequest";
import { agentTurnArtifactReferences } from "../domain/agentTurnArtifactReferences";
import { agentTurnLogEvidence } from "./agentTurnLogStatusStore";
import { useAgentTurnLogHydration } from "./useAgentTurnLogHydration";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { agentRootOwnerId, type AgentProjectDescriptor } from "../domain/agentProject";
import { isTerminalAgentTaskStatus } from "../domain/agentTask";
import {
  AGENT_THREAD_STORE_FULL_ERROR,
  MAX_AGENT_THREADS_PER_ROOT,
  agentThreadsReducer,
  emptyAgentThreadsState,
  isTerminalAgentTurnStatus,
  runningTurn,
  type AgentThread,
  type AgentThreadOwner,
  type AgentThreadsAction,
  type AgentThreadsState,
  type AgentTurnEvent,
} from "../domain/agentThread";
import { agentPromptLooksClipped } from "../domain/agentPromptClipping";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";
import { NO_AGENT_TURN_LOG_LOSS, type AgentTurnLogLoss } from "../domain/agentTurnLog";
import { isRemoteAgentIdentity } from "./remoteAgentSurface";
import type { AgentTurnLogIntegration } from "./useAgentTurnLogging";
import {
  AGENT_TASKS_SOURCE,
  attempt,
  errorMessageOf,
  projectAuthority,
  projectByOwnerId,
  projectByRootKey,
  sameProjectAuthority,
  warning,
  type AgentProjectAuthority,
} from "./agentProjectAuthority";
import type {
  AgentTasksNotice,
  AgentThreadStoreGateway,
  AgentThreadStoreSurface,
  DeleteAgentThreadRequest,
} from "./agentThreadPorts";

export const LEGACY_AGENT_THREAD_PIN_STORAGE_KEY_PREFIX = "mockor.agents.threadPins.";
export const MIN_AGENT_THREAD_PERSIST_INTERVAL_MS = 10_000;
export const MAX_INTERRUPTED_AGENT_THREADS_PER_LOAD = 8;
export const MAX_SEALED_INTERRUPTED_TURN_LOGS_PER_THREAD = 16;

export const PERSIST_FAILURE_NOTICE = "Some agent conversations could not be saved.";
export const MAX_PERSIST_FAILURE_REASON_CHARS = 180;
export const TURN_LOG_DELETE_FAILURE_NOTICE =
  "The saved transcript of a removed thread could not be deleted from this computer.";
const STORE_FULL_NOTICE =
  "The saved-thread store is full. Unpin or remove older threads so new conversations can be saved.";

const BACKEND_REASON_PREFIXES = [
  "Agent context ",
  "Agent project ",
  "Agent session ",
  "Agent task ",
  "Agent thread ",
  "Agent tool ",
  "Agent turn ",
  "The agent thread ",
  "The saved thread ",
  "Unable to ",
] as const;

export interface AgentThreadLegacyPinStorage {
  removeItem(key: string): void;
}

export interface AgentThreadStoreDependencies {
  readonly agentThreadStoreGateway: AgentThreadStoreGateway;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly agentModeActive: boolean;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
  readonly now?: () => number;
  readonly legacyPinStorage?: AgentThreadLegacyPinStorage;
  readonly minimumPersistIntervalMs?: number;
  readonly turnLog?: AgentTurnLogIntegration;
}

type PersistUrgency = "immediate" | "coalesced";

interface ThreadRemoval {
  readonly request: DeleteAgentThreadRequest;
  readonly logged: boolean;
}

interface ThreadPersistSlot {
  inFlight: boolean;
  lastSaveSucceeded: boolean;
  settled: Promise<void> | null;
  pending: PersistUrgency | null;
  lastSaveAtMs: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export function useAgentThreadStore(
  dependencies: AgentThreadStoreDependencies,
): AgentThreadStoreSurface {
  const [state, publishState] = useReducer(
    (_current: AgentThreadsState, next: AgentThreadsState) => next,
    undefined,
    emptyAgentThreadsState,
  );
  const [loadedRootKeys, setLoadedRootKeys] = useState<ReadonlySet<string>>(() => new Set());

  const dependenciesRef = useRef(dependencies);
  const stateRef = useRef(state);
  stateRef.current = state;
  const mountedRef = useRef(true);
  const admissionsRef = useRef(
    new Map<string, { threadId: string; authority: AgentProjectAuthority }>(),
  );
  const loadKeysRef = useRef<Map<string, string>>(new Map());
  const clearedLegacyPinRootsRef = useRef<Set<string>>(new Set());
  const slotsRef = useRef<Map<string, ThreadPersistSlot>>(new Map());
  const dirtyRef = useRef<Map<string, PersistUrgency>>(new Map());
  const deleteQueueRef = useRef<ThreadRemoval[]>([]);
  const persistFailureNoticeShownRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  useEffect(() => {
    mountedRef.current = true;
    const slots = slotsRef.current;
    return () => {
      mountedRef.current = false;
      for (const slot of slots.values()) {
        if (slot.timer === null) continue;
        clearTimeout(slot.timer);
        slot.timer = null;
      }
    };
  }, []);

  const nowMs = useCallback((): number => (dependenciesRef.current.now ?? Date.now)(), []);

  const persistIntervalMs = useCallback(
    (): number =>
      dependenciesRef.current.minimumPersistIntervalMs ?? MIN_AGENT_THREAD_PERSIST_INTERVAL_MS,
    [],
  );

  const scheduleSaveRef = useRef<(threadId: string, urgency: PersistUrgency) => void>(
    () => undefined,
  );

  const notePersistFailure = useCallback((error: unknown): void => {
    dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error);
    if (!mountedRef.current) return;
    const message = persistFailureMessage(error);
    const refusalStaysVisible = message === STORE_FULL_NOTICE;
    if (!refusalStaysVisible && persistFailureNoticeShownRef.current === message) return;
    persistFailureNoticeShownRef.current = message;
    dependenciesRef.current.setNotice(warning(message));
  }, []);

  const runSave = useCallback(
    async (threadId: string): Promise<void> => {
      const slot = slotFor(slotsRef.current, threadId);
      const thread = stateRef.current.threads.get(threadId);
      if (thread === undefined) return;
      const authority = threadAuthority(dependenciesRef.current.projects, thread);
      if (authority === null) return;

      const facts = isLoggedAgentThread(thread)
        ? dependenciesRef.current.turnLog?.facts
        : undefined;

      const evidenceRevision = facts?.evidenceRevisionOf(threadId);
      slot.inFlight = true;
      slot.lastSaveAtMs = nowMs();
      const inFlight = attempt(() =>
        dependenciesRef.current.agentThreadStoreGateway.saveAgentThread({
          ...persistentAgentThreadSaveRequest(thread, facts),
          ...(dependenciesRef.current.agentThreadStoreGateway.readAgentHistoryTurns === undefined
            ? {}
            : {
                isCurrent: () =>
                  mountedRef.current &&
                  ownsProjectRoot(dependenciesRef.current.projects, authority) &&
                  stateRef.current.threads.has(threadId),
                onRevision: (revision: number) => {
                  if (
                    !mountedRef.current ||
                    !ownsProjectRoot(dependenciesRef.current.projects, authority)
                  )
                    return;
                  const latest = stateRef.current.threads.get(threadId);
                  if (latest === undefined || (latest.historyRevision ?? 0) >= revision) return;
                  const threads = new Map(stateRef.current.threads);
                  threads.set(threadId, { ...latest, historyRevision: revision });
                  const next = { threads };
                  stateRef.current = next;
                  publishState(next);
                },
              }),
        }),
      );
      slot.settled = inFlight.then(() => undefined);
      const saved = await inFlight;
      slot.inFlight = false;
      slot.lastSaveSucceeded = saved.ok;
      slot.settled = null;
      if (!mountedRef.current) return;
      if (!saved.ok && ownsProjectRoot(dependenciesRef.current.projects, authority)) {
        notePersistFailure(saved.error);
        if (facts?.evidenceRevisionOf(threadId) !== evidenceRevision) slot.pending = "coalesced";
      }
      if (saved.ok) persistFailureNoticeShownRef.current = null;
      const pending = slot.pending;
      slot.pending = null;
      if (pending === null) return;
      scheduleSaveRef.current(threadId, pending);
    },
    [notePersistFailure, nowMs],
  );

  const scheduleSave = useCallback(
    (threadId: string, urgency: PersistUrgency): void => {
      if (!mountedRef.current) return;
      const slot = slotFor(slotsRef.current, threadId);
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
      const interval = persistIntervalMs();
      if (elapsed >= interval) {
        void runSave(threadId);
        return;
      }
      if (slot.timer !== null) return;
      slot.timer = setTimeout(() => {
        slot.timer = null;
        if (!mountedRef.current) return;
        void runSave(threadId);
      }, interval - elapsed);
    },
    [nowMs, persistIntervalMs, runSave],
  );

  scheduleSaveRef.current = scheduleSave;

  useEffect(() => {
    const facts = dependencies.turnLog?.facts;
    return facts?.subscribe((changedThreadIds) => {
      for (const threadId of changedThreadIds) {
        const slot = slotsRef.current.get(threadId);
        if (slot === undefined || slot.inFlight || slot.lastSaveSucceeded) continue;
        if (!Number.isFinite(slot.lastSaveAtMs)) continue;
        scheduleSaveRef.current(threadId, "coalesced");
      }
    });
  }, [dependencies.turnLog?.facts]);

  const runDelete = useCallback(
    async ({ request, logged }: ThreadRemoval): Promise<void> => {
      const project = projectByRootKey(dependenciesRef.current.projects, request.rootKey);
      const authority = project === undefined ? null : projectAuthority(project);
      const settled = slotsRef.current.get(request.threadId)?.settled;
      if (settled !== undefined && settled !== null) await settled;
      const removed = await attempt(() =>
        dependenciesRef.current.agentThreadStoreGateway.deleteAgentThread(request),
      );
      if (!removed.ok) {
        notePersistFailure(removed.error);
        return;
      }
      const turnLog = dependenciesRef.current.turnLog;
      if (!logged || turnLog === undefined || authority === null) return;
      if (!mountedRef.current) return;
      if (!ownsProjectRoot(dependenciesRef.current.projects, authority)) return;
      const logRemoved = await attempt(() => turnLog.deleteThreadLog(request));
      if (logRemoved.ok) return;
      dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, logRemoved.error);
      if (!mountedRef.current) return;
      if (!ownsProjectRoot(dependenciesRef.current.projects, authority)) return;
      dependenciesRef.current.setNotice(warning(TURN_LOG_DELETE_FAILURE_NOTICE));
    },
    [notePersistFailure],
  );

  const flushPersistQueue = useCallback((): void => {
    for (const removal of deleteQueueRef.current.splice(0)) void runDelete(removal);
    const dirty = [...dirtyRef.current];
    dirtyRef.current.clear();
    for (const [threadId, urgency] of dirty) scheduleSave(threadId, urgency);
  }, [runDelete, scheduleSave]);

  useEffect(() => {
    flushPersistQueue();
  }, [flushPersistQueue, state]);

  const dispatchAction = useCallback((action: AgentThreadsAction): void => {
    const current = stateRef.current;
    if (
      dependenciesRef.current.agentThreadStoreGateway.readAgentHistoryTurns !== undefined &&
      (action.kind === "threadCreated" || action.kind === "historyThreadOpened")
    ) {
      const reservation = admissionsRef.current.get(action.thread.owner.rootKey);
      if (reservation !== undefined && reservation.threadId !== action.thread.threadId) return;
      if (
        [...current.threads.values()].filter(
          (thread) => thread.owner.rootKey === action.thread.owner.rootKey,
        ).length >= MAX_AGENT_THREADS_PER_ROOT
      )
        return;
    }
    const next = agentThreadsReducer(current, action);
    const intent = persistIntent(current, next, action);
    stateRef.current = next;
    const turnLog = dependenciesRef.current.turnLog;
    if (turnLog !== undefined) {
      applyTurnLogEffects(turnLog, dependenciesRef.current.projects, current, next, action);
    }
    for (const [threadId, urgency] of intent.saves) {
      const existing = dirtyRef.current.get(threadId);
      if (existing === "immediate") continue;
      dirtyRef.current.set(threadId, urgency);
    }
    if (intent.remove !== null) {
      dirtyRef.current.delete(intent.remove.threadId);
      const slot = slotsRef.current.get(intent.remove.threadId);
      if (slot !== undefined) {
        clearSlotTimer(slot);
        slot.pending = null;
      }
      const removed = current.threads.get(intent.remove.threadId);
      deleteQueueRef.current.push({
        request: intent.remove,
        logged: removed !== undefined && isLoggedAgentThread(removed),
      });
    }
    publishState(next);
  }, []);

  const saveRunningThreadsNow = useCallback((): void => {
    for (const thread of stateRef.current.threads.values()) {
      if (runningTurn(thread) === null) continue;
      scheduleSaveRef.current(thread.threadId, "immediate");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saveRunningTurns = (): void => saveRunningThreadsNow();
    window.addEventListener("pagehide", saveRunningTurns);
    return () => window.removeEventListener("pagehide", saveRunningTurns);
  }, [saveRunningThreadsNow]);

  const hydrateLoggedThread = useAgentTurnLogHydration({
    turnLog: () => dependenciesRef.current.turnLog ?? null,
    projects: () => dependenciesRef.current.projects,
    currentState: () => stateRef.current,
    loadKeyOf: (rootKey) => loadKeysRef.current.get(rootKey) ?? null,
    mounted: () => mountedRef.current,
    publish: dispatchAction,
  });

  const hydrateThread = useCallback(
    (threadId: string): void => {
      const turnLog = dependenciesRef.current.turnLog;
      turnLog?.facts.setVisibleThread(threadId);
      const thread = stateRef.current.threads.get(threadId);
      if (thread === undefined) return;
      if (!isLoggedAgentThread(thread)) return;
      hydrateLoggedThread(threadId);
    },
    [hydrateLoggedThread],
  );

  const togglePin = useCallback(
    (threadId: string): void => dispatchAction({ kind: "pinToggled", threadId }),
    [dispatchAction],
  );

  const archive = useCallback(
    (threadId: string): void => dispatchAction({ kind: "archived", threadId }),
    [dispatchAction],
  );

  const remove = useCallback(
    (threadId: string): void => dispatchAction({ kind: "deleted", threadId }),
    [dispatchAction],
  );

  const markUnread = useCallback(
    (threadId: string): void => dispatchAction({ kind: "threadMarkedUnread", threadId }),
    [dispatchAction],
  );

  const rename = useCallback(
    (threadId: string, title: string): void =>
      dispatchAction({ kind: "threadRenamed", threadId, title }),
    [dispatchAction],
  );

  const loadTurnLogSummaries = useCallback(
    async (
      authority: AgentProjectAuthority,
      threads: ReadonlyArray<AgentThread>,
    ): Promise<void> => {
      const turnLog = dependenciesRef.current.turnLog;
      if (turnLog === undefined) return;
      const key = loadKeysRef.current.get(authority.rootKey);
      const ownerId = agentRootOwnerId(authority.rootKey);
      for (const thread of interruptedLoggedThreads(threads)) {
        const currentThread = stateRef.current.threads.get(thread.threadId);
        if (currentThread === undefined) continue;
        const ownsThread = () => stateRef.current.threads.get(thread.threadId) === currentThread;
        const summarized = await attempt(() =>
          turnLog.summarize({
            rootKey: authority.rootKey,
            ownerId,
            threadId: thread.threadId,
            includePrompts: false,
            includeLifecycles: false,
          }),
        );
        if (!mountedRef.current) return;
        if (!ownsProjectRoot(dependenciesRef.current.projects, authority)) return;
        if (loadKeysRef.current.get(authority.rootKey) !== key) return;
        if (!summarized.ok || !ownsThread()) continue;
        turnLog.facts.publishSummaries(
          thread.threadId,
          summarized.value,
          thread.turns.map((turn) => turn.turnId),
        );
        const losses = await interruptedTurnLogLosses(
          turnLog,
          thread,
          summarized.value,
          () =>
            mountedRef.current &&
            ownsThread() &&
            ownsProjectRoot(dependenciesRef.current.projects, authority) &&
            loadKeysRef.current.get(authority.rootKey) === key,
        );
        if (!mountedRef.current) return;
        if (!ownsProjectRoot(dependenciesRef.current.projects, authority)) return;
        if (loadKeysRef.current.get(authority.rootKey) !== key) return;
        if (!ownsThread()) continue;
        sealInterruptedTurnLogs(turnLog, authority, thread, losses);
      }
    },
    [],
  );

  const loadProject = useCallback(
    async (authority: AgentProjectAuthority): Promise<void> => {
      const key = authorityKey(authority);
      const previous = loadKeysRef.current.get(authority.rootKey);
      if (previous === key) return;
      loadKeysRef.current.set(authority.rootKey, key);
      if (previous !== undefined)
        setLoadedRootKeys((current) => withoutRoot(current, authority.rootKey));
      clearLegacyPinKey(
        dependenciesRef.current,
        clearedLegacyPinRootsRef.current,
        authority.rootKey,
      );

      const loaded = await attempt(() =>
        dependenciesRef.current.agentThreadStoreGateway.loadAgentThreads({
          rootKey: authority.rootKey,
          ownerId: agentRootOwnerId(authority.rootKey),
        }),
      );
      if (!mountedRef.current) return;
      if (!ownsProjectRoot(dependenciesRef.current.projects, authority)) return;
      if (loadKeysRef.current.get(authority.rootKey) !== key) return;
      if (!loaded.ok) {
        loadKeysRef.current.delete(authority.rootKey);
        dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, loaded.error);
        return;
      }

      dispatchAction({
        kind: "loaded",
        owner: { rootKey: authority.rootKey, ownerId: authority.ownerId },
        threads: loaded.value.threads.map((thread) => withRuntimeOwner(thread, authority.ownerId)),
      });
      setLoadedRootKeys((current) => withRoot(current, authority.rootKey));
      void loadTurnLogSummaries(authority, loaded.value.threads);
      if (loaded.value.unreadable.length === 0) return;
      dependenciesRef.current.setNotice(warning(unreadableNotice(loaded.value.unreadable.length)));
    },
    [dispatchAction, loadTurnLogSummaries],
  );

  const projectsSignature = useMemo(
    () => dependencies.projects.map((project) => authorityKey(projectAuthority(project))).join(";"),
    [dependencies.projects],
  );

  useEffect(() => {
    const projects = dependenciesRef.current.projects;
    const present = new Set(projects.map((project) => project.rootKey));
    for (const rootKey of [...loadKeysRef.current.keys()]) {
      if (present.has(rootKey)) continue;
      loadKeysRef.current.delete(rootKey);
      clearedLegacyPinRootsRef.current.delete(rootKey);
    }
    setLoadedRootKeys((current) => retainRoots(current, present));
    if (!dependenciesRef.current.agentModeActive) return;
    for (const project of projects) void loadProject(projectAuthority(project));
  }, [dependencies.agentModeActive, loadProject, projectsSignature]);

  const flushThread = useCallback(
    async (threadId: string): Promise<boolean> => {
      const thread = stateRef.current.threads.get(threadId);
      if (thread === undefined || runningTurn(thread) !== null) return false;
      const lastTurn = thread.turns[thread.turns.length - 1];
      const durableHistory =
        dependenciesRef.current.agentThreadStoreGateway.readAgentHistoryTurns !== undefined;
      if (lastTurn === undefined && !durableHistory) return true;
      const evidence = agentTurnLogEvidence(
        dependenciesRef.current.turnLog?.facts.factsOf(lastTurn?.turnId ?? "") ?? null,
      );
      if (
        !durableHistory &&
        lastTurn !== undefined &&
        agentTurnArtifactReferences(lastTurn, evidence).length === 0
      )
        return true;
      const authority = threadAuthority(dependenciesRef.current.projects, thread);
      if (authority === null) return false;
      const turnId = thread.turns[thread.turns.length - 1]?.turnId;
      const current = (): boolean => {
        const latest = stateRef.current.threads.get(threadId);
        return (
          mountedRef.current &&
          ownsProjectRoot(dependenciesRef.current.projects, authority) &&
          latest !== undefined &&
          latest.turns[latest.turns.length - 1]?.turnId === turnId &&
          runningTurn(latest) === null
        );
      };
      const slot = slotFor(slotsRef.current, threadId);
      // Persistence can schedule one coalesced successor; cap retries under a mutation storm.
      for (let attempt = 0; slot.inFlight && attempt < 8; attempt += 1) {
        await slot.settled;
        if (!current()) return false;
      }
      if (slot.inFlight || !current()) return false;
      clearSlotTimer(slot);
      dirtyRef.current.delete(threadId);
      await runSave(threadId);
      return current() && slot.lastSaveSucceeded;
    },
    [runSave],
  );

  const reserveThreadSlot = useCallback(
    async (threadId: string, owner: AgentThreadOwner): Promise<(() => void) | null> => {
      if (dependenciesRef.current.agentThreadStoreGateway.readAgentHistoryTurns === undefined)
        return () => undefined;
      const authority = threadOwnerAuthority(dependenciesRef.current.projects, owner);
      if (authority === null || !mountedRef.current) return null;
      const existing = admissionsRef.current.get(owner.rootKey);
      if (
        existing !== undefined &&
        ownsProjectRoot(dependenciesRef.current.projects, existing.authority)
      )
        return null;
      const reservation = { threadId, authority };
      admissionsRef.current.set(owner.rootKey, reservation);
      const release = (): void => {
        if (admissionsRef.current.get(owner.rootKey) === reservation)
          admissionsRef.current.delete(owner.rootKey);
      };
      const current = (): boolean =>
        mountedRef.current &&
        ownsProjectRoot(dependenciesRef.current.projects, authority) &&
        admissionsRef.current.get(owner.rootKey) === reservation;
      let admitted = false;
      try {
        const sameRoot = [...stateRef.current.threads.values()].filter(
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
          if (victim === undefined || !(await flushThread(victim.threadId)) || !current())
            return null;
          const latest = stateRef.current.threads.get(victim.threadId);
          const slot = slotsRef.current.get(victim.threadId);
          if (latest === undefined || !sameThreadContent(victim, latest) || slot?.inFlight)
            return null;
          dispatchAction({ kind: "historyThreadEvicted", threadId: victim.threadId });
          if (stateRef.current.threads.has(victim.threadId)) return null;
          if (slot !== undefined) {
            clearSlotTimer(slot);
            slot.pending = null;
          }
          dirtyRef.current.delete(victim.threadId);
          slotsRef.current.delete(victim.threadId);
        }
        if (!current()) return null;
        admitted = true;
        return release;
      } finally {
        if (!admitted) release();
      }
    },
    [dispatchAction, flushThread],
  );

  const restoreThread = useCallback(
    async (thread: AgentThread): Promise<boolean> => {
      const authority = threadAuthority(dependenciesRef.current.projects, thread);
      if (authority === null) return false;
      if (stateRef.current.threads.has(thread.threadId)) return true;
      const release = await reserveThreadSlot(thread.threadId, thread.owner);
      if (release === null) return false;
      try {
        if (!mountedRef.current || !ownsProjectRoot(dependenciesRef.current.projects, authority))
          return false;
        dispatchAction({ kind: "historyThreadOpened", thread, evictThreadId: null });
        return stateRef.current.threads.has(thread.threadId);
      } finally {
        release();
      }
    },
    [dispatchAction, reserveThreadSlot],
  );

  const currentState = useCallback((): AgentThreadsState => stateRef.current, []);

  return useMemo(
    () => ({
      state,
      loadedRootKeys,
      currentState,
      flushThread,
      restoreThread,
      reserveThreadSlot,
      hydrateThread,
      saveRunningThreadsNow,
      dispatchAction,
      togglePin,
      archive,
      remove,
      markUnread,
      rename,
    }),
    [
      archive,
      currentState,
      flushThread,
      restoreThread,
      reserveThreadSlot,
      hydrateThread,
      saveRunningThreadsNow,
      dispatchAction,
      loadedRootKeys,
      markUnread,
      remove,
      rename,
      state,
      togglePin,
    ],
  );
}

export function isLoggedAgentThread(thread: AgentThread): boolean {
  if (isRemoteAgentIdentity(thread.threadId)) return false;
  return !isRemoteAgentIdentity(thread.owner.ownerId);
}

function applyTurnLogEffects(
  turnLog: AgentTurnLogIntegration,
  projects: ReadonlyArray<AgentProjectDescriptor>,
  state: AgentThreadsState,
  next: AgentThreadsState,
  action: AgentThreadsAction,
): void {
  if (next === state) return;
  switch (action.kind) {
    case "turnStarted":
      return openTurnLogSlot(turnLog, projects, next, action);
    case "turnEventsAppended":
      return recordTurnLogEvents(turnLog, next, action);
    case "turnSteered":
      return turnLog.writer.recordEvents(action.turnId, [action.event]);
    case "taskStatusEvent":
      if (!isTerminalAgentTaskStatus(action.event.status)) return;
      return turnLog.writer.sealTurn(action.event.taskId);
    case "turnInterrupted":
      return turnLog.writer.sealTurn(action.turnId);
    case "deleted":
      return closeTurnLogSlots(turnLog, state, action.threadId);
    case "turnHydrated":
      return;
    default:
      return;
  }
}

function openTurnLogSlot(
  turnLog: AgentTurnLogIntegration,
  projects: ReadonlyArray<AgentProjectDescriptor>,
  next: AgentThreadsState,
  action: Extract<AgentThreadsAction, { kind: "turnStarted" }>,
): void {
  const thread = next.threads.get(action.threadId);
  if (thread === undefined) return;
  if (!isLoggedAgentThread(thread)) return;
  const authority = threadAuthority(projects, thread);
  if (authority === null) return;
  turnLog.writer.openTurn({
    scope: {
      rootKey: thread.owner.rootKey,
      ownerId: agentRootOwnerId(thread.owner.rootKey),
      threadId: thread.threadId,
      turnId: action.turn.turnId,
    },
    generation: authority.generation,
    provider: thread.provider.kind,
    priorLoss: resumedTurnLoss(action.turn.eventsTruncated),
    prompt: loggablePrompt(action.turn.prompt),
  });
}

function loggablePrompt(prompt: string): string | null {
  if (agentPromptLooksClipped(prompt)) return null;
  return prompt;
}

function resumedTurnLoss(eventsTruncated: boolean): AgentTurnLogLoss {
  if (!eventsTruncated) return NO_AGENT_TURN_LOG_LOSS;
  return { kind: "legacyWindow" };
}

function recordTurnLogEvents(
  turnLog: AgentTurnLogIntegration,
  next: AgentThreadsState,
  action: Extract<AgentThreadsAction, { kind: "turnEventsAppended" }>,
): void {
  turnLog.writer.recordEvents(action.turnId, action.events);
  recordTurnLogLifecycle(turnLog, next, action.threadId, action.turnId);
  if (!action.supervisorTruncated) return;
  turnLog.writer.reportLoss(action.turnId, { kind: "supervisorGap" });
}

function recordTurnLogLifecycle(
  turnLog: AgentTurnLogIntegration,
  next: AgentThreadsState,
  threadId: string,
  turnId: string,
): void {
  const turn = next.threads.get(threadId)?.turns.find((candidate) => candidate.turnId === turnId);
  if (turn?.subagentLifecycle === undefined) return;
  turnLog.writer.recordLifecycle(turnId, turn.subagentLifecycle);
}

function interruptedLoggedThreads(threads: ReadonlyArray<AgentThread>): ReadonlyArray<AgentThread> {
  const interrupted: AgentThread[] = [];
  for (const thread of threads) {
    if (interrupted.length >= MAX_INTERRUPTED_AGENT_THREADS_PER_LOAD) return interrupted;
    if (!isLoggedAgentThread(thread)) continue;
    if (thread.turns.every((turn) => isTerminalAgentTurnStatus(turn.status))) continue;
    interrupted.push(thread);
  }
  return interrupted;
}

function sealInterruptedTurnLogs(
  turnLog: AgentTurnLogIntegration,
  authority: AgentProjectAuthority,
  thread: AgentThread,
  losses: ReadonlyMap<string, AgentTurnLogLoss>,
): void {
  if (losses.size === 0) return;
  let sealed = 0;
  for (const turn of thread.turns) {
    if (sealed >= MAX_SEALED_INTERRUPTED_TURN_LOGS_PER_THREAD) return;
    if (isTerminalAgentTurnStatus(turn.status)) continue;
    const loss = losses.get(turn.turnId);
    if (loss === undefined) continue;
    turnLog.writer.openTurn({
      scope: {
        rootKey: thread.owner.rootKey,
        ownerId: agentRootOwnerId(thread.owner.rootKey),
        threadId: thread.threadId,
        turnId: turn.turnId,
      },
      generation: authority.generation,
      provider: thread.provider.kind,
      priorLoss: loss,
      prompt: loggablePrompt(turn.prompt),
    });
    turnLog.writer.sealTurn(turn.turnId);
    sealed += 1;
  }
}

function closeTurnLogSlots(
  turnLog: AgentTurnLogIntegration,
  state: AgentThreadsState,
  threadId: string,
): void {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return;
  for (const turn of thread.turns) {
    turnLog.writer.closeTurn(turn.turnId);
    turnLog.facts.forgetTurn(turn.turnId);
  }
}

interface PersistIntent {
  readonly saves: ReadonlyArray<readonly [string, PersistUrgency]>;
  readonly remove: DeleteAgentThreadRequest | null;
}

const NO_PERSIST: PersistIntent = Object.freeze({ saves: Object.freeze([]), remove: null });

function persistIntent(
  state: AgentThreadsState,
  next: AgentThreadsState,
  action: AgentThreadsAction,
): PersistIntent {
  if (next === state) return NO_PERSIST;
  switch (action.kind) {
    case "threadCreated":
      return saveIntent(action.thread.threadId, "immediate");
    case "turnStarted":
    case "externalHistoryLoaded":
      return saveIntent(action.threadId, "immediate");
    case "taskStatusEvent":
      return liveTurnIntent(
        state,
        action.threadId,
        action.event.taskId,
        isTerminalAgentTaskStatus(action.event.status) ? "immediate" : "coalesced",
      );
    case "turnEventsAppended":
      return sessionCaptureIntent(
        state,
        action.threadId,
        action.turnId,
        action.sessionId,
        action.events,
      );
    case "turnSteered":
      return liveTurnIntent(state, action.threadId, action.turnId, "immediate");
    case "turnInterrupted":
      return liveTurnIntentByTurnId(state, action.turnId, "immediate");
    case "threadViewed":
      return threadViewedIntent(state, action.threadId, action.atEpochMs);
    case "threadMarkedUnread":
      return changedThreadIntent(state, action, "coalesced");
    case "threadOrganizationUpdated":
      return saveIntent(action.threadId, "immediate");
    case "threadReordered":
      return {
        saves: [...next.threads.values()]
          .filter((thread) => thread !== state.threads.get(thread.threadId))
          .map((thread) => [thread.threadId, "immediate"] as const),
        remove: null,
      };
    case "threadRenamed":
      return changedThreadIntent(state, action, "immediate");
    case "ownerRebound":
      return NO_PERSIST;
    case "pinToggled":
    case "archived":
    case "integrationRecorded":
      return state.threads.has(action.threadId)
        ? saveIntent(action.threadId, "immediate")
        : NO_PERSIST;
    case "deleted":
      return removeIntent(state, action.threadId);
    case "loaded":
      return interruptedTurnsIntent(state, action.threads);
    case "ownerReleased":
    case "turnHydrated":
      return NO_PERSIST;
    default:
      return NO_PERSIST;
  }
}

function saveIntent(threadId: string, urgency: PersistUrgency): PersistIntent {
  return { saves: [[threadId, urgency]], remove: null };
}

function changedThreadIntent(
  state: AgentThreadsState,
  action: Extract<AgentThreadsAction, { kind: "threadMarkedUnread" | "threadRenamed" }>,
  urgency: PersistUrgency,
): PersistIntent {
  if (agentThreadsReducer(state, action) === state) return NO_PERSIST;
  return saveIntent(action.threadId, urgency);
}

function threadViewedIntent(
  state: AgentThreadsState,
  threadId: string,
  atEpochMs: number,
): PersistIntent {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return NO_PERSIST;
  if (!Number.isSafeInteger(atEpochMs) || atEpochMs < 0) return NO_PERSIST;
  if (thread.viewedAtEpochMs !== null && atEpochMs <= thread.viewedAtEpochMs) return NO_PERSIST;
  return saveIntent(threadId, "coalesced");
}

function liveTurnIntent(
  state: AgentThreadsState,
  threadId: string,
  turnId: string,
  urgency: PersistUrgency,
): PersistIntent {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return NO_PERSIST;
  if (!thread.turns.some((turn) => turn.turnId === turnId)) return NO_PERSIST;
  return saveIntent(thread.threadId, urgency);
}

function liveTurnIntentByTurnId(
  state: AgentThreadsState,
  turnId: string,
  urgency: PersistUrgency,
): PersistIntent {
  const thread = threadByLiveTurnId(state, turnId);
  if (thread === null) return NO_PERSIST;
  return saveIntent(thread.threadId, urgency);
}

function sessionCaptureIntent(
  state: AgentThreadsState,
  threadId: string,
  turnId: string,
  sessionId: string | null,
  events: ReadonlyArray<AgentTurnEvent>,
): PersistIntent {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return NO_PERSIST;
  if (!thread.turns.some((turn) => turn.turnId === turnId)) return NO_PERSIST;
  const captured = sessionId !== null && thread.provider.sessionId === null;
  const steered = events.some((event) => event.kind === "userMessage");
  return saveIntent(thread.threadId, captured || steered ? "immediate" : "coalesced");
}

function interruptedTurnsIntent(
  state: AgentThreadsState,
  loaded: ReadonlyArray<AgentThread>,
): PersistIntent {
  const saves: Array<readonly [string, PersistUrgency]> = [];
  for (const thread of loaded) {
    if (runningTurn(thread) === null) continue;
    const inMemory = state.threads.get(thread.threadId);
    if (inMemory !== undefined && runningTurn(inMemory) !== null) continue;
    saves.push([thread.threadId, "immediate"]);
  }
  if (saves.length === 0) return NO_PERSIST;
  return { saves, remove: null };
}

function removeIntent(state: AgentThreadsState, threadId: string): PersistIntent {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return NO_PERSIST;
  if (runningTurn(thread) !== null) return NO_PERSIST;
  return {
    saves: [],
    remove: {
      rootKey: thread.owner.rootKey,
      ownerId: agentRootOwnerId(thread.owner.rootKey),
      threadId,
    },
  };
}

function persistFailureMessage(error: unknown): string {
  const raw = errorMessageOf(error);
  if (raw === AGENT_THREAD_STORE_FULL_ERROR) return STORE_FULL_NOTICE;
  const reason = boundedPersistFailureReason(raw);
  if (reason === null) return PERSIST_FAILURE_NOTICE;
  return `${PERSIST_FAILURE_NOTICE} ${reason}`;
}

function boundedPersistFailureReason(raw: string): string | null {
  const collapsed = raw
    .replace(/\p{Cc}|\p{Cf}/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!BACKEND_REASON_PREFIXES.some((prefix) => collapsed.startsWith(prefix))) return null;
  const points = [...collapsed];
  if (points.length <= MAX_PERSIST_FAILURE_REASON_CHARS) return collapsed;
  return `${points.slice(0, MAX_PERSIST_FAILURE_REASON_CHARS).join("")}…`;
}

function withRuntimeOwner(thread: AgentThread, ownerId: string): AgentThread {
  if (thread.owner.ownerId === ownerId) return thread;
  return { ...thread, owner: { ...thread.owner, ownerId } };
}

function threadByLiveTurnId(state: AgentThreadsState, turnId: string): AgentThread | null {
  for (const thread of state.threads.values()) {
    const last = thread.turns[thread.turns.length - 1];
    if (last !== undefined && last.turnId === turnId) return thread;
  }
  return null;
}

function threadAuthority(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  thread: AgentThread,
): AgentProjectAuthority | null {
  return threadOwnerAuthority(projects, thread.owner);
}

function threadOwnerAuthority(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  owner: AgentThreadOwner,
): AgentProjectAuthority | null {
  const project = projectByRootKey(projects, owner.rootKey);
  if (project === undefined) return null;
  if (
    project.ownerId !== owner.ownerId &&
    project.runtimeOwnerIds?.includes(owner.ownerId) !== true
  )
    return null;
  return projectAuthority(project, owner.ownerId);
}

function ownsProjectRoot(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  authority: AgentProjectAuthority,
): boolean {
  const project = projectByOwnerId(projects, authority.ownerId);
  if (project === undefined) return false;
  if (project.rootKey !== authority.rootKey) return false;
  return sameProjectAuthority(projectAuthority(project, authority.ownerId), authority);
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

function clearLegacyPinKey(
  dependencies: AgentThreadStoreDependencies,
  cleared: Set<string>,
  rootKey: string,
): void {
  if (rootKey === "") return;
  if (cleared.has(rootKey)) return;
  cleared.add(rootKey);
  const storage = dependencies.legacyPinStorage ?? browserLocalStorage();
  if (storage === null) return;
  try {
    storage.removeItem(
      `${LEGACY_AGENT_THREAD_PIN_STORAGE_KEY_PREFIX}${normalizedWorkspaceRootKey(rootKey)}`,
    );
  } catch {
    return;
  }
}

function browserLocalStorage(): AgentThreadLegacyPinStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function authorityKey(authority: AgentProjectAuthority): string {
  return [authority.rootKey, authority.ownerId, authority.generation].join("#");
}

function sameThreadContent(left: AgentThread, right: AgentThread): boolean {
  return (Object.keys(left) as Array<keyof AgentThread>).every(
    (key) => key === "historyRevision" || left[key] === right[key],
  );
}

function unreadableNotice(count: number): string {
  const threads = count === 1 ? "thread" : "threads";
  return `${count} saved ${threads} could not be read and were skipped.`;
}

function withRoot(current: ReadonlySet<string>, rootKey: string): ReadonlySet<string> {
  if (current.has(rootKey)) return current;
  return new Set(current).add(rootKey);
}

function withoutRoot(current: ReadonlySet<string>, rootKey: string): ReadonlySet<string> {
  if (!current.has(rootKey)) return current;
  const next = new Set(current);
  next.delete(rootKey);
  return next;
}

function retainRoots(
  current: ReadonlySet<string>,
  present: ReadonlySet<string>,
): ReadonlySet<string> {
  const retained = [...current].filter((rootKey) => present.has(rootKey));
  if (retained.length === current.size) return current;
  return new Set(retained);
}
