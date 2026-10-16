import { agentRootOwnerId } from "../../domain/agentProject";
import type { AgentThread, AgentThreadsAction } from "../../domain/agentThread";
import { reconcileAgentThreadLoad } from "../../domain/agentThreadLoadReconciliation";
import { normalizedWorkspaceRootKey } from "../../domain/workspaceRootKey";
import {
  AGENT_TASKS_SOURCE,
  attempt,
  projectAuthority,
  warning,
  type AgentProjectAuthority,
} from "../agentProjectAuthority";
import { AgentThreadLoadJournal } from "../agentThreadLoadJournal";
import { interruptedTurnLogLosses } from "../agentTurnLogRestartRecovery";
import {
  LEGACY_AGENT_THREAD_PIN_STORAGE_KEY_PREFIX,
  authorityKey,
  ownsProjectRoot,
  type AgentThreadLegacyPinStorage,
  type AgentThreadStoreContext,
  type AgentThreadStoreDependencies,
} from "./agentThreadStoreContract";
import { interruptedLoggedThreads, sealInterruptedTurnLogs } from "./agentThreadTurnLogEffects";

export type LoadedRootKeysUpdate = (current: ReadonlySet<string>) => ReadonlySet<string>;

export interface AgentThreadLoadingPorts {
  dispatch(action: AgentThreadsAction): void;
  publishLoadedRootKeys(update: LoadedRootKeysUpdate): void;
}

export interface AgentThreadLoading {
  syncProjects(): void;
  loadKeyOf(rootKey: string): string | null;
  isLoading(rootKey: string): boolean;
  recordRemoval(rootKey: string, threadId: string): void;
  dispose(): void;
}

export function createAgentThreadLoading(
  context: AgentThreadStoreContext,
  ports: AgentThreadLoadingPorts,
): AgentThreadLoading {
  const loadKeys = new Map<string, string>();
  const clearedLegacyPinRoots = new Set<string>();
  const loading = new Map<string, number>();
  const journal = new AgentThreadLoadJournal();
  const deps = context.dependencies;

  const loadTurnLogSummaries = async (
    authority: AgentProjectAuthority,
    threads: ReadonlyArray<AgentThread>,
  ): Promise<void> => {
    const turnLog = deps().turnLog;
    if (turnLog === undefined) return;
    const key = loadKeys.get(authority.rootKey);
    const ownerId = agentRootOwnerId(authority.rootKey);
    const loadIsCurrent = (): boolean =>
      ownsProjectRoot(deps().projects, authority) && loadKeys.get(authority.rootKey) === key;
    for (const thread of interruptedLoggedThreads(threads)) {
      const currentThread = context.threads.current().threads.get(thread.threadId);
      if (currentThread === undefined) continue;
      const ownsThread = () =>
        context.threads.current().threads.get(thread.threadId) === currentThread;
      const summarized = await attempt(() =>
        turnLog.summarize({
          rootKey: authority.rootKey,
          ownerId,
          threadId: thread.threadId,
          includePrompts: false,
          includeLifecycles: false,
        }),
      );
      if (!context.mounted()) return;
      if (!loadIsCurrent()) return;
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
        () => context.mounted() && ownsThread() && loadIsCurrent(),
      );
      if (!context.mounted()) return;
      if (!loadIsCurrent()) return;
      if (!ownsThread()) continue;
      sealInterruptedTurnLogs(turnLog, authority, thread, losses);
    }
  };

  const loadProject = async (authority: AgentProjectAuthority): Promise<void> => {
    const key = authorityKey(authority);
    const previous = loadKeys.get(authority.rootKey);
    if (previous === key) return;
    loadKeys.set(authority.rootKey, key);
    if (previous !== undefined)
      ports.publishLoadedRootKeys((current) => withoutRoot(current, authority.rootKey));
    clearLegacyPinKey(deps(), clearedLegacyPinRoots, authority.rootKey);

    loading.set(authority.rootKey, (loading.get(authority.rootKey) ?? 0) + 1);
    const beforeLoad = context.threads.current();
    const loadLease = journal.begin(authority.rootKey);
    try {
      const loaded = await attempt(() =>
        deps().agentThreadStoreGateway.loadAgentThreads({
          rootKey: authority.rootKey,
          ownerId: agentRootOwnerId(authority.rootKey),
        }),
      );
      if (!context.mounted()) return;
      if (loadLease.abandoned) return;
      if (!ownsProjectRoot(deps().projects, authority)) return;
      if (loadKeys.get(authority.rootKey) !== key) return;
      if (loadLease.overflowed) {
        loadKeys.delete(authority.rootKey);
        deps().reportError(
          AGENT_TASKS_SOURCE,
          new Error(
            "Saved agent history changed too often during loading; reopen the project to reload it.",
          ),
        );
        return;
      }
      if (!loaded.ok) {
        loadKeys.delete(authority.rootKey);
        deps().reportError(AGENT_TASKS_SOURCE, loaded.error);
        return;
      }

      const reconciled = reconcileAgentThreadLoad(
        beforeLoad,
        context.threads.current(),
        authority,
        loaded.value.threads,
        loadLease.removedThreadIds,
      );
      ports.dispatch({
        kind: "loaded",
        owner: { rootKey: authority.rootKey, ownerId: authority.ownerId },
        ...reconciled,
      });
      ports.publishLoadedRootKeys((current) => withRoot(current, authority.rootKey));
      void loadTurnLogSummaries(
        authority,
        reconciled.threads.filter((thread) => !reconciled.retainedThreadIds.has(thread.threadId)),
      );
      if (loaded.value.unreadable.length === 0) return;
      deps().setNotice(warning(unreadableNotice(loaded.value.unreadable.length)));
    } finally {
      releaseLoading(loading, authority.rootKey);
      journal.settle(loadLease);
    }
  };

  return {
    syncProjects() {
      const projects = deps().projects;
      const present = new Set(projects.map((project) => project.rootKey));
      for (const rootKey of [...loadKeys.keys()]) {
        if (present.has(rootKey)) continue;
        loadKeys.delete(rootKey);
        journal.discard(rootKey);
        clearedLegacyPinRoots.delete(rootKey);
      }
      ports.publishLoadedRootKeys((current) => retainRoots(current, present));
      for (const project of projects) void loadProject(projectAuthority(project));
    },
    loadKeyOf: (rootKey) => loadKeys.get(rootKey) ?? null,
    isLoading: (rootKey) => loading.has(rootKey),
    recordRemoval: (rootKey, threadId) => journal.recordRemoval(rootKey, threadId),
    dispose() {
      journal.clear();
      loadKeys.clear();
    },
  };
}

function releaseLoading(loading: Map<string, number>, rootKey: string): void {
  const remaining = (loading.get(rootKey) ?? 1) - 1;
  if (remaining > 0) {
    loading.set(rootKey, remaining);
    return;
  }
  loading.delete(rootKey);
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
