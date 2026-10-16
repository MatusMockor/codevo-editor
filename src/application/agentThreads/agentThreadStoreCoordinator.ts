import { agentThreadsReducer, type AgentThreadsAction } from "../../domain/agentThread";
import { createAgentThreadAdmission, type AgentThreadAdmission } from "./agentThreadAdmission";
import {
  createAgentThreadLoading,
  type AgentThreadLoading,
  type LoadedRootKeysUpdate,
} from "./agentThreadLoading";
import { persistIntent } from "./agentThreadPersistIntent";
import {
  createAgentThreadPersistence,
  type AgentThreadPersistence,
} from "./agentThreadPersistence";
import type { AgentThreadStoreContext } from "./agentThreadStoreContract";
import { applyTurnLogEffects } from "./agentThreadTurnLogEffects";

export interface AgentThreadStoreCoordinatorPorts {
  publishLoadedRootKeys(update: LoadedRootKeysUpdate): void;
}

export interface AgentThreadStoreCoordinator {
  readonly persistence: AgentThreadPersistence;
  readonly loading: AgentThreadLoading;
  readonly admission: AgentThreadAdmission;
  dispatch(action: AgentThreadsAction): void;
  dispose(): void;
}

export function createAgentThreadStoreCoordinator(
  context: AgentThreadStoreContext,
  ports: AgentThreadStoreCoordinatorPorts,
): AgentThreadStoreCoordinator {
  const persistence = createAgentThreadPersistence(context);
  let quietFlushScheduled = false;

  const flushAfterQuietChange = (): void => {
    if (quietFlushScheduled) return;
    quietFlushScheduled = true;
    queueMicrotask(() => {
      quietFlushScheduled = false;
      if (!context.mounted()) return;
      persistence.flushQueue();
    });
  };

  const dispatch = (action: AgentThreadsAction): void => {
    const current = context.threads.current();
    if (!admission.admits(action, current)) return;
    const next = agentThreadsReducer(current, action);
    if (action.kind === "deleted" || action.kind === "historyThreadEvicted") {
      const removed = current.threads.get(action.threadId);
      if (removed !== undefined && !next.threads.has(action.threadId))
        loading.recordRemoval(removed.owner.rootKey, action.threadId);
    }
    const intent = persistIntent(current, next, action);
    const structuralBefore = context.threads.structural();
    context.threads.stage(next);
    const dependencies = context.dependencies();
    const turnLog = dependencies.turnLog;
    if (turnLog !== undefined) {
      applyTurnLogEffects(turnLog, dependencies.projects, current, next, action);
    }
    persistence.record(intent, current);
    context.threads.notify();
    if (next !== current && context.threads.structural() === structuralBefore)
      flushAfterQuietChange();
  };

  const loading = createAgentThreadLoading(context, {
    dispatch,
    publishLoadedRootKeys: ports.publishLoadedRootKeys,
  });
  const admission = createAgentThreadAdmission(context, { persistence, loading, dispatch });

  return {
    persistence,
    loading,
    admission,
    dispatch,
    dispose() {
      loading.dispose();
      persistence.dispose();
    },
  };
}
