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
  agentThreadsReducer,
  emptyAgentThreadsState,
  runningTurn,
  type AgentThread,
  type AgentThreadsAction,
  type AgentThreadsState,
} from "../domain/agentThread";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";
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
  SaveAgentThreadRequest,
} from "./agentThreadPorts";

export const LEGACY_AGENT_THREAD_PIN_STORAGE_KEY_PREFIX = "mockor.agents.threadPins.";
export const MIN_AGENT_THREAD_PERSIST_INTERVAL_MS = 1_000;

const PERSIST_FAILURE_NOTICE = "Some agent conversations could not be saved.";
const STORE_FULL_NOTICE =
  "The saved-thread store is full. Unpin or remove older threads so new conversations can be saved.";

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
}

type PersistUrgency = "immediate" | "coalesced";

interface ThreadPersistSlot {
  inFlight: boolean;
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
  const loadKeysRef = useRef<Map<string, string>>(new Map());
  const clearedLegacyPinRootsRef = useRef<Set<string>>(new Set());
  const slotsRef = useRef<Map<string, ThreadPersistSlot>>(new Map());
  const dirtyRef = useRef<Map<string, PersistUrgency>>(new Map());
  const deleteQueueRef = useRef<DeleteAgentThreadRequest[]>([]);
  const persistFailureNoticeShownRef = useRef(false);

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
    if (errorMessageOf(error) === AGENT_THREAD_STORE_FULL_ERROR) {
      persistFailureNoticeShownRef.current = true;
      dependenciesRef.current.setNotice(warning(STORE_FULL_NOTICE));
      return;
    }
    if (persistFailureNoticeShownRef.current) return;
    persistFailureNoticeShownRef.current = true;
    dependenciesRef.current.setNotice(warning(PERSIST_FAILURE_NOTICE));
  }, []);

  const runSave = useCallback(
    async (threadId: string): Promise<void> => {
      const slot = slotFor(slotsRef.current, threadId);
      const thread = stateRef.current.threads.get(threadId);
      if (thread === undefined) return;
      const authority = threadAuthority(dependenciesRef.current.projects, thread);
      if (authority === null) return;

      slot.inFlight = true;
      slot.lastSaveAtMs = nowMs();
      const inFlight = attempt(() =>
        dependenciesRef.current.agentThreadStoreGateway.saveAgentThread(
          persistentSaveRequest(thread),
        ),
      );
      slot.settled = inFlight.then(() => undefined);
      const saved = await inFlight;
      slot.inFlight = false;
      slot.settled = null;
      if (!mountedRef.current) return;
      if (!saved.ok && ownsProjectRoot(dependenciesRef.current.projects, authority)) {
        notePersistFailure(saved.error);
      }
      if (saved.ok) persistFailureNoticeShownRef.current = false;
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

  const runDelete = useCallback(
    async (request: DeleteAgentThreadRequest): Promise<void> => {
      const settled = slotsRef.current.get(request.threadId)?.settled;
      if (settled !== undefined && settled !== null) await settled;
      const removed = await attempt(() =>
        dependenciesRef.current.agentThreadStoreGateway.deleteAgentThread(request),
      );
      if (removed.ok) return;
      notePersistFailure(removed.error);
    },
    [notePersistFailure],
  );

  const flushPersistQueue = useCallback((): void => {
    for (const request of deleteQueueRef.current.splice(0)) void runDelete(request);
    const dirty = [...dirtyRef.current];
    dirtyRef.current.clear();
    for (const [threadId, urgency] of dirty) scheduleSave(threadId, urgency);
  }, [runDelete, scheduleSave]);

  useEffect(() => {
    flushPersistQueue();
  }, [flushPersistQueue, state]);

  const dispatchAction = useCallback((action: AgentThreadsAction): void => {
    const current = stateRef.current;
    const next = agentThreadsReducer(current, action);
    const intent = persistIntent(current, next, action);
    stateRef.current = next;
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
      deleteQueueRef.current.push(intent.remove);
    }
    publishState(next);
  }, []);

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
      if (loaded.value.unreadable.length === 0) return;
      dependenciesRef.current.setNotice(warning(unreadableNotice(loaded.value.unreadable.length)));
    },
    [dispatchAction],
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

  const currentState = useCallback((): AgentThreadsState => stateRef.current, []);

  return useMemo(
    () => ({
      state,
      loadedRootKeys,
      currentState,
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
      return saveIntent(action.threadId, "immediate");
    case "taskStatusEvent":
      return liveTurnIntent(
        state,
        action.threadId,
        action.event.taskId,
        isTerminalAgentTaskStatus(action.event.status) ? "immediate" : "coalesced",
      );
    case "turnEventsAppended":
      return sessionCaptureIntent(state, action.threadId, action.turnId, action.sessionId);
    case "turnInterrupted":
      return liveTurnIntentByTurnId(state, action.turnId, "immediate");
    case "threadViewed":
      return threadViewedIntent(state, action.threadId, action.atEpochMs);
    case "threadMarkedUnread":
      return changedThreadIntent(state, action, "coalesced");
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
): PersistIntent {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return NO_PERSIST;
  if (!thread.turns.some((turn) => turn.turnId === turnId)) return NO_PERSIST;
  const captured = sessionId !== null && thread.provider.sessionId === null;
  return saveIntent(thread.threadId, captured ? "immediate" : "coalesced");
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

function persistentSaveRequest(thread: AgentThread): SaveAgentThreadRequest {
  const ownerId = agentRootOwnerId(thread.owner.rootKey);
  return {
    rootKey: thread.owner.rootKey,
    ownerId,
    thread: { ...thread, owner: { ...thread.owner, ownerId } },
  };
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
  const project = projectByRootKey(projects, thread.owner.rootKey);
  if (project === undefined) return null;
  if (
    project.ownerId !== thread.owner.ownerId &&
    project.runtimeOwnerIds?.includes(thread.owner.ownerId) !== true
  )
    return null;
  return projectAuthority(project, thread.owner.ownerId);
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
