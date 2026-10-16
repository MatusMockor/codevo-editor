import type { DeferredFollowUps } from "../agentDeferredFollowUps";
import { createAgentSteerQueueDrain, type AgentSteerQueueDrain } from "./agentSteerQueueDrain";
import { createAgentSteerQueueEdits, type AgentSteerQueueEdits } from "./agentSteerQueueEdits";
import {
  createAgentSteerQueueState,
  type AgentSteerQueueContext,
  type AgentTurnSteerOptions,
  type AgentTurnSteerSurface,
} from "./agentSteerQueueState";
import { createAgentSteerSend } from "./agentSteerSend";

export interface AgentTurnSteerCoordinatorPorts {
  readonly initialDeferred: DeferredFollowUps;
  options(): AgentTurnSteerOptions;
  publishDeferred(next: DeferredFollowUps): void;
  requestDrain(): void;
}

export type AgentTurnSteerCoordinator = Omit<AgentTurnSteerSurface, "deferredFollowUps"> &
  AgentSteerQueueEdits &
  AgentSteerQueueDrain;

export function createAgentTurnSteerCoordinator(
  ports: AgentTurnSteerCoordinatorPorts,
): AgentTurnSteerCoordinator {
  const state = createAgentSteerQueueState(ports.initialDeferred);
  const options = ports.options;
  const mountedRef = options().mountedRef;

  const commitDeferred = (next: DeferredFollowUps): void => {
    state.deferred = next;
    state.boundaryTracker.retain(next.keys());
    for (const pending of [state.blockedThreads, state.awaitingSettlement]) {
      for (const threadId of pending) {
        if (!next.has(threadId)) pending.delete(threadId);
      }
    }
    for (const threadId of state.pausedThreads) {
      if (!next.has(threadId)) state.pausedThreads.delete(threadId);
    }
    for (const threadId of state.deferredAuthorities.keys()) {
      if (!next.has(threadId)) state.deferredAuthorities.delete(threadId);
    }
    if (!mountedRef.current) return;
    ports.publishDeferred(next);
  };

  const armDrain = (threadId: string): void => {
    state.pendingDrains.add(threadId);
    if (!mountedRef.current) return;
    ports.requestDrain();
  };

  const context: AgentSteerQueueContext = {
    state,
    dependenciesRef: options().dependenciesRef,
    mountedRef,
    sendFollowUpRef: options().sendFollowUpRef,
    needsRestart: (threadId) => options().needsRestart(threadId),
    flushStreams: () => options().flushStreams(),
    commitDeferred,
    armDrain,
  };
  const { steer } = createAgentSteerSend(context);
  const edits = createAgentSteerQueueEdits(context);
  const drain = createAgentSteerQueueDrain(context, {
    steer,
    removeDeferredFollowUp: edits.removeDeferredFollowUp,
  });
  return { ...edits, ...drain, steer };
}
