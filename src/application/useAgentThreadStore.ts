import { useAgentTurnLogHydration } from "./useAgentTurnLogHydration";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { emptyAgentThreadsState, type AgentThreadsState } from "../domain/agentThread";
import { projectAuthority } from "./agentProjectAuthority";
import type { AgentThreadStoreSurface } from "./agentThreadPorts";
import {
  agentLiveThreadSource,
  createAgentThreadStateStore,
  type AgentLiveThreadSource,
} from "./agentThreads/agentThreadStateStore";
import {
  authorityKey,
  isLoggedAgentThread,
  type AgentThreadStoreContext,
  type AgentThreadStoreDependencies,
} from "./agentThreads/agentThreadStoreContract";
import {
  createAgentThreadStoreCoordinator,
  type AgentThreadStoreCoordinator,
} from "./agentThreads/agentThreadStoreCoordinator";

export {
  LEGACY_AGENT_THREAD_PIN_STORAGE_KEY_PREFIX,
  MAX_INTERRUPTED_AGENT_THREADS_PER_LOAD,
  MAX_SEALED_INTERRUPTED_TURN_LOGS_PER_THREAD,
  MIN_AGENT_THREAD_PERSIST_INTERVAL_MS,
  SAVED_DELETE_IN_PROGRESS,
  SAVED_DELETE_OPENING,
  SAVED_DELETE_PROJECT_LOADING,
  SAVED_DELETE_PROJECT_UNAVAILABLE,
  SAVED_DELETE_THREAD_OPEN,
  isLoggedAgentThread,
  type AgentThreadLegacyPinStorage,
  type AgentThreadStoreDependencies,
} from "./agentThreads/agentThreadStoreContract";
export {
  MAX_PERSIST_FAILURE_REASON_CHARS,
  PERSIST_FAILURE_NOTICE,
  TURN_LOG_DELETE_FAILURE_NOTICE,
} from "./agentThreads/agentThreadPersistFailure";

interface AgentThreadStoreRuntime {
  readonly context: AgentThreadStoreContext;
  readonly liveThreads: AgentLiveThreadSource;
  readonly coordinator: AgentThreadStoreCoordinator;
}

export function useAgentThreadStore(
  dependencies: AgentThreadStoreDependencies,
): AgentThreadStoreSurface {
  const [loadedRootKeys, setLoadedRootKeys] = useState<ReadonlySet<string>>(() => new Set());
  const dependenciesRef = useRef(dependencies);
  const mountedRef = useRef(true);
  const [{ context, coordinator, liveThreads }] = useState<AgentThreadStoreRuntime>(() => {
    const created: AgentThreadStoreContext = {
      threads: createAgentThreadStateStore(emptyAgentThreadsState()),
      dependencies: () => dependenciesRef.current,
      mounted: () => mountedRef.current,
    };
    return {
      context: created,
      liveThreads: agentLiveThreadSource(created.threads),
      coordinator: createAgentThreadStoreCoordinator(created, {
        publishLoadedRootKeys: setLoadedRootKeys,
      }),
    };
  });
  const threadState = context.threads;
  const state = useSyncExternalStore(
    threadState.subscribe,
    threadState.structural,
    threadState.structural,
  );
  const { persistence, loading, admission, dispatch: dispatchAction } = coordinator;

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      coordinator.dispose();
    };
  }, [coordinator]);

  useEffect(() => {
    const facts = dependencies.turnLog?.facts;
    return facts?.subscribe((changedThreadIds) => persistence.retryFailedSaves(changedThreadIds));
  }, [dependencies.turnLog?.facts, persistence]);

  useEffect(() => {
    persistence.flushQueue();
  }, [persistence, state]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saveRunningTurns = (): void => persistence.saveRunningThreadsNow();
    window.addEventListener("pagehide", saveRunningTurns);
    return () => window.removeEventListener("pagehide", saveRunningTurns);
  }, [persistence]);

  const hydrateLoggedThread = useAgentTurnLogHydration({
    turnLog: () => dependenciesRef.current.turnLog ?? null,
    projects: () => dependenciesRef.current.projects,
    currentState: () => threadState.current(),
    loadKeyOf: (rootKey) => loading.loadKeyOf(rootKey),
    mounted: () => mountedRef.current,
    publish: dispatchAction,
  });

  const hydrateThread = useCallback(
    (threadId: string): void => {
      const turnLog = dependenciesRef.current.turnLog;
      turnLog?.facts.setVisibleThread(threadId);
      const thread = threadState.current().threads.get(threadId);
      if (thread === undefined) return;
      if (!isLoggedAgentThread(thread)) return;
      hydrateLoggedThread(threadId);
    },
    [hydrateLoggedThread, threadState],
  );

  const projectsSignature = useMemo(
    () => dependencies.projects.map((project) => authorityKey(projectAuthority(project))).join(";"),
    [dependencies.projects],
  );

  useEffect(() => {
    loading.syncProjects();
  }, [loading, projectsSignature]);

  const actions = useMemo(
    () => ({
      togglePin: (threadId: string) => dispatchAction({ kind: "pinToggled", threadId }),
      archive: (threadId: string) => dispatchAction({ kind: "archived", threadId }),
      remove: (threadId: string) => dispatchAction({ kind: "deleted", threadId }),
      markUnread: (threadId: string) => dispatchAction({ kind: "threadMarkedUnread", threadId }),
      rename: (threadId: string, title: string) =>
        dispatchAction({ kind: "threadRenamed", threadId, title }),
      currentState: (): AgentThreadsState => threadState.current(),
    }),
    [dispatchAction, threadState],
  );

  return useMemo(
    () => ({
      state,
      liveThreads,
      loadedRootKeys,
      currentState: actions.currentState,
      flushThread: persistence.flushThread,
      restoreThread: admission.restoreThread,
      deleteSavedThread: admission.deleteSavedThread,
      reserveThreadSlot: admission.reserveThreadSlot,
      hydrateThread,
      saveRunningThreadsNow: persistence.saveRunningThreadsNow,
      dispatchAction,
      togglePin: actions.togglePin,
      archive: actions.archive,
      remove: actions.remove,
      markUnread: actions.markUnread,
      rename: actions.rename,
    }),
    [
      actions,
      admission,
      dispatchAction,
      hydrateThread,
      liveThreads,
      loadedRootKeys,
      persistence,
      state,
    ],
  );
}
