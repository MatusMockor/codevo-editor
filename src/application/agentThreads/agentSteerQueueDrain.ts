import type { AgentSessionRestartPolicy } from "../../domain/agentTask";
import { runningTurn, type AgentThreadsState } from "../../domain/agentThread";
import {
  clearDeferred,
  deferredFollowUpsForThread,
  deferredQueueIsEditing,
  promoteDeferred,
  releaseNextDeferred,
  removeDeferred,
  takeDeferredHead,
} from "../agentDeferredFollowUps";
import { isCurrentThreadLaunchAuthority, warning } from "../agentProjectAuthority";
import type { AgentSteerOutcome, AgentSteerRequest } from "../agentThreadPorts";
import { deferredQueueInState } from "../agentSessionRestartConsent";
import { DEFERRED_SEND_FAILED_NOTICE, sendDeferredFollowUp } from "../agentDeferredFollowUpSend";
import { agentThreadIsSteerable } from "../agentTurnAdmission";
import type { ClaimedTurnAttachments } from "../agentTurnAttachments";
import type { AgentSteerQueueContext } from "./agentSteerQueueState";
import { DEFERRED_CLEARED_NOTICE } from "./agentSteerSend";

export interface AgentSteerQueueDrainPorts {
  steer(request: AgentSteerRequest, claimed?: ClaimedTurnAttachments): Promise<AgentSteerOutcome>;
  removeDeferredFollowUp(threadId: string, id: string): void;
}

export interface AgentSteerQueueDrain {
  sendDeferredFollowUpNow(threadId: string, id: string): Promise<void>;
  resumeDeferredFollowUps(threadId: string): Promise<void>;
  restartDeferredFollowUp(threadId: string, id: string): Promise<void>;
  onTurnSettled(threadId: string): void;
  onThreadStopped(threadId: string): void;
  clearDeferredForOwner(ownerId: string): void;
  drainDeferred(current: AgentThreadsState): void;
  releaseBlockedThreads(): void;
}

export function createAgentSteerQueueDrain(
  context: AgentSteerQueueContext,
  ports: AgentSteerQueueDrainPorts,
): AgentSteerQueueDrain {
  const { state, dependenciesRef, mountedRef, commitDeferred, armDrain, sendFollowUpRef } = context;
  const { steer, removeDeferredFollowUp } = ports;
  const needsRestart = (threadId: string): boolean => context.needsRestart(threadId);
  const releaseBlockedThreads = (): void => {
    for (const threadId of state.blockedThreads) {
      state.blockedThreads.delete(threadId);
      if (state.deferred.has(threadId)) armDrain(threadId);
    }
  };

  const promoteIfSettled = (threadId: string, id: string): void => {
    if (state.pausedThreads.has(threadId)) return;
    const thread = dependenciesRef.current.store.currentState().threads.get(threadId);
    if (thread === undefined || runningTurn(thread) !== null) return;
    const promoted = promoteDeferred(state.deferred, threadId, id);
    if (promoted !== state.deferred) commitDeferred(promoted);
  };

  const sendQueuedNow = async (
    threadId: string,
    id: string,
    userInitiated: boolean,
  ): Promise<void> => {
    const entry = deferredFollowUpsForThread(state.deferred, threadId).find(
      (candidate) => candidate.id === id,
    );
    const authority = state.deferredAuthorities.get(threadId);
    if (
      entry === undefined ||
      entry.editLease !== undefined ||
      authority === undefined ||
      state.sendingQueued.has(threadId) ||
      state.drainLeases.has(threadId)
    )
      return;
    if (!isCurrentThreadLaunchAuthority(dependenciesRef, mountedRef, authority)) return;
    state.sendingQueued.set(threadId, id);
    if (userInitiated) state.userSendNow.add(threadId);
    try {
      const outcome = await steer(
        { ...entry.request, delivery: "immediate" },
        state.preparedDeferred.get(entry.request),
      );
      if (!isCurrentThreadLaunchAuthority(dependenciesRef, mountedRef, authority)) return;
      if (outcome === "kept") {
        if (userInitiated) promoteIfSettled(threadId, id);
        return;
      }
      const thread = dependenciesRef.current.store.currentState().threads.get(threadId);
      state.boundaryTracker.anchor(
        threadId,
        thread === undefined ? null : runningTurn(thread),
        false,
      );
      removeDeferredFollowUp(threadId, id);
    } finally {
      state.sendingQueued.delete(threadId);
      state.userSendNow.delete(threadId);
      if (state.pendingDrains.has(threadId)) armDrain(threadId);
    }
  };

  const sendDeferredFollowUpNow = (threadId: string, id: string): Promise<void> =>
    sendQueuedNow(threadId, id, true);

  const resumeDeferredFollowUps = async (threadId: string): Promise<void> => {
    if (state.restartRefusals.renotify(state.deferred, threadId, dependenciesRef.current)) return;
    if (!state.pausedThreads.delete(threadId)) return;
    commitDeferred(deferredQueueInState(state.deferred, threadId, "queued"));
    state.boundaryTracker.retry(threadId);
    state.awaitingSettlement.delete(threadId);
    armDrain(threadId);
  };

  const pauseDeferred = (threadId: string): boolean => {
    state.pendingDrains.delete(threadId);
    if (deferredFollowUpsForThread(state.deferred, threadId).length === 0) return false;
    state.pausedThreads.add(threadId);
    commitDeferred(deferredQueueInState(state.deferred, threadId, "paused"));
    return true;
  };

  const onThreadStopped = (threadId: string): void => {
    const lease = state.steerLeases.get(threadId);
    if (lease !== undefined) lease.cancelled = true;
    const drainLease = state.drainLeases.get(threadId);
    if (drainLease !== undefined) drainLease.cancelled = true;
    if (!pauseDeferred(threadId)) return;
    dependenciesRef.current.setNotice(warning(DEFERRED_CLEARED_NOTICE));
  };

  const onTurnSettled = (threadId: string): void => {
    state.awaitingSettlement.delete(threadId);
    const thread = dependenciesRef.current.store.currentState().threads.get(threadId);
    const status = thread?.turns[thread.turns.length - 1]?.status;
    if (status?.kind === "stopped") return onThreadStopped(threadId);
    if (deferredFollowUpsForThread(state.deferred, threadId).length === 0) return;
    if (status?.kind === "failed" || (status?.kind === "exited" && status.exitCode !== 0)) {
      pauseDeferred(threadId);
      dependenciesRef.current.setNotice(warning(DEFERRED_SEND_FAILED_NOTICE));
      return;
    }
    armDrain(threadId);
  };

  const clearDeferredForOwner = (ownerId: string): void => {
    for (const lease of [...state.steerLeases.values(), ...state.drainLeases.values()]) {
      if (lease.authority.ownerId === ownerId) lease.cancelled = true;
    }
    const threads = dependenciesRef.current.store.currentState().threads;
    let next = state.deferred;
    for (const threadId of next.keys()) {
      if (threads.get(threadId)?.owner.ownerId !== ownerId) continue;
      state.pendingDrains.delete(threadId);
      state.deferredAuthorities.delete(threadId);
      next = clearDeferred(next, threadId);
    }
    if (next === state.deferred) return;
    commitDeferred(next);
  };

  const sendDeferredHead = (threadId: string, sessionRestart?: AgentSessionRestartPolicy): void => {
    const send = sendFollowUpRef.current;
    if (send === null) return;
    if (state.drainLeases.has(threadId)) return;
    const authority = state.deferredAuthorities.get(threadId);
    if (authority === undefined) return;
    const taken = takeDeferredHead(state.deferred, threadId);
    if (taken.head === null) return;
    const lease = { authority, entryId: taken.head.id, cancelled: false };
    state.drainLeases.set(threadId, lease);
    const isCurrent = (): boolean =>
      !lease.cancelled && isCurrentThreadLaunchAuthority(dependenciesRef, mountedRef, authority);
    const request = taken.head.request;
    void sendDeferredFollowUp(dependenciesRef.current, {
      send,
      needsSessionRestart: needsRestart,
      refusals: state.restartRefusals,
      entryId: lease.entryId,
      request,
      sessionRestart,
      isCurrent,
      prepared: state.preparedDeferred.get(request),
    }).then((outcome) => {
      if (state.drainLeases.get(threadId) === lease) state.drainLeases.delete(threadId);
      if (outcome === "stale") {
        if (
          lease.cancelled &&
          isCurrentThreadLaunchAuthority(dependenciesRef, mountedRef, authority) &&
          !state.pausedThreads.has(threadId)
        )
          armDrain(threadId);
        return;
      }
      if (outcome === "sent") {
        commitDeferred(removeDeferred(state.deferred, threadId, lease.entryId));
        const thread = dependenciesRef.current.store.currentState().threads.get(threadId);
        if (thread !== undefined && runningTurn(thread) === null) armDrain(threadId);
        return;
      }
      pauseDeferred(threadId);
    });
  };

  const restartDeferredFollowUp = async (threadId: string, id: string): Promise<void> => {
    if (state.drainLeases.has(threadId) || state.sendingQueued.has(threadId)) return;
    const thread = dependenciesRef.current.store.currentState().threads.get(threadId);
    if (!state.restartRefusals.claim(state.deferred, thread, id)) return;
    state.pausedThreads.delete(threadId);
    commitDeferred(deferredQueueInState(state.deferred, threadId, "queued"));
    sendDeferredHead(threadId, "stopBackground");
  };

  const drainDeferred = (current: AgentThreadsState): void => {
    const deps = dependenciesRef.current;
    for (const threadId of state.deferred.keys()) {
      const thread = current.threads.get(threadId);
      const authority = state.deferredAuthorities.get(threadId);
      if (
        thread !== undefined &&
        !thread.archived &&
        authority !== undefined &&
        isCurrentThreadLaunchAuthority(dependenciesRef, mountedRef, authority)
      )
        continue;
      state.pendingDrains.delete(threadId);
      state.deferredAuthorities.delete(threadId);
      commitDeferred(clearDeferred(state.deferred, threadId));
      deps.setNotice(
        warning(
          "Queued messages were removed because their original workspace session is no longer available.",
        ),
      );
    }
    for (const [threadId, entries] of state.deferred) {
      if (
        state.sendingQueued.has(threadId) ||
        state.pausedThreads.has(threadId) ||
        state.inFlightSteers.has(threadId) ||
        state.awaitingSettlement.has(threadId) ||
        state.blockedThreads.has(threadId)
      )
        continue;
      if (deferredQueueIsEditing(entries)) continue;
      const thread = current.threads.get(threadId);
      if (thread === undefined || !agentThreadIsSteerable(thread)) continue;
      const turn = runningTurn(thread);
      const head = entries[0];
      if (turn === null || head === undefined || !state.boundaryTracker.takeDue(threadId, turn))
        continue;
      void sendQueuedNow(threadId, head.id, false).then(() => {
        if (
          !state.blockedThreads.has(threadId) &&
          !state.awaitingSettlement.has(threadId) &&
          state.deferred.get(threadId)?.some((entry) => entry.id === head.id)
        )
          pauseDeferred(threadId);
      });
    }
    for (const threadId of [...state.pendingDrains]) {
      if (
        state.sendingQueued.has(threadId) ||
        state.pausedThreads.has(threadId) ||
        state.blockedThreads.has(threadId) ||
        deferredQueueIsEditing(deferredFollowUpsForThread(state.deferred, threadId))
      )
        continue;
      const thread = current.threads.get(threadId);
      if (thread !== undefined && runningTurn(thread) !== null) {
        if (state.awaitingSettlement.has(threadId)) continue;
        const released = releaseNextDeferred(state.deferred, threadId);
        if (released !== state.deferred) commitDeferred(released);
        continue;
      }
      state.pendingDrains.delete(threadId);
      if (thread === undefined || thread.archived) {
        const dropped = clearDeferred(state.deferred, threadId);
        if (dropped !== state.deferred) commitDeferred(dropped);
        continue;
      }
      sendDeferredHead(threadId);
    }
  };

  return {
    sendDeferredFollowUpNow,
    resumeDeferredFollowUps,
    restartDeferredFollowUp,
    onTurnSettled,
    onThreadStopped,
    clearDeferredForOwner,
    drainDeferred,
    releaseBlockedThreads,
  };
}
