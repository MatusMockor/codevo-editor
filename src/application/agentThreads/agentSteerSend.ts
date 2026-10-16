import { admitStoredAgentLaunch } from "../../domain/agentStoredLaunch";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import type { AgentTaskSteerRejectionReason } from "../../domain/agentTask";
import { MAX_AGENT_EVENT_TEXT_BYTES, runningTurn, type AgentTurn } from "../../domain/agentThread";
import {
  DEFERRED_NEXT_TURN_NOTICE,
  MAX_DEFERRED_FOLLOW_UPS_PER_THREAD,
  MAX_DEFERRED_FOLLOW_UP_THREADS,
  clearDeferred,
  deferredFollowUpsForThread,
  enqueueDeferred,
  promoteDeferred,
  type DeferredFollowUp,
} from "../agentDeferredFollowUps";
import {
  AGENT_TASKS_SOURCE,
  attempt,
  failure,
  info,
  isCurrentThreadLaunchAuthority,
  warning,
  type AgentTaskLaunchAuthority,
} from "../agentProjectAuthority";
import type { AgentSteerOutcome, AgentSteerRequest } from "../agentThreadPorts";
import {
  AGENT_THREAD_STEER_LIMIT_NOTICE,
  AGENT_THREAD_TURN_FULL_NOTICE,
  admitSteer,
  agentPromptByteLength,
} from "../agentTurnAdmission";
import { prepareTurnAttachments, type ClaimedTurnAttachments } from "../agentTurnAttachments";
import type { AgentSteerQueueContext } from "./agentSteerQueueState";
import {
  boundedPendingInputCheck,
  deferredFollowUpRequest,
  steerAttachmentAuthority,
  steerEventFits,
  steerPayload,
  steerTargetIsCurrent,
  steerThreadIsCurrent,
  steeredEvent,
  unsupportedSteerRejection,
} from "./agentSteerPolicy";
export const STORED_LAUNCH_NEEDS_CONFIRMATION_NOTICE =
  "This conversation's saved permission mode is no longer offered, so this message would run with full access, as the permission pill shows. Send it again from the composer to run it with full access, or change the permission mode on the pill after the turn finishes.";

export const STEER_FAILED_NOTICE = "The message could not be sent to the running agent.";
export const STEER_DROPPED_NOTICE =
  "Your message was delivered, but the turn ended before it could be recorded.";
export const STEER_STOPPING_NOTICE = "This agent is stopping, so the message was not sent.";
export const STEER_UNAVAILABLE_NOTICE = "This agent cannot take a message while it runs.";
export const STEER_UNREGISTERED_NOTICE =
  "This turn is no longer registered, so the message was not sent.";
export const STEER_WRITE_FAILED_NOTICE =
  "The message could not be written to the agent, so the turn is being stopped.";
export const STEER_TOO_LONG_NOTICE =
  "The message is too long to record in this turn. Shorten it and try again.";
export const DEFERRED_FULL_NOTICE = "Too many messages are already queued for this thread.";
export const DEFERRED_CLEARED_NOTICE =
  "Queued messages are paused because the agent was stopped. Resume the queue to continue.";

export function createAgentSteerSend(context: AgentSteerQueueContext): {
  steer(request: AgentSteerRequest, claimed?: ClaimedTurnAttachments): Promise<AgentSteerOutcome>;
} {
  const { state, dependenciesRef, mountedRef, commitDeferred, armDrain } = context;
  const flushStreams = (): void => context.flushStreams();

  const deferSteer = (
    threadId: string,
    launch: AgentLaunchOptions,
    request: AgentSteerRequest,
    authority: AgentTaskLaunchAuthority,
    prepared: ClaimedTurnAttachments,
  ): AgentSteerOutcome => {
    const deps = dependenciesRef.current;
    const admission = admitStoredAgentLaunch(launch, request.dangerousLaunchConfirmed === true);
    if (admission.kind === "needsConfirmation") {
      deps.setNotice(warning(STORED_LAUNCH_NEEDS_CONFIRMATION_NOTICE));
      return "kept";
    }
    const now = deps.now ?? Date.now;
    state.deferredSequence += 1;
    const entry: DeferredFollowUp = {
      id: `deferred-${state.deferredSequence}`,
      request: deferredFollowUpRequest(threadId, admission, request),
      queuedAtEpochMs: now(),
    };
    const priorAuthority = state.deferredAuthorities.get(threadId);
    if (
      priorAuthority !== undefined &&
      !isCurrentThreadLaunchAuthority(dependenciesRef, mountedRef, priorAuthority)
    ) {
      commitDeferred(clearDeferred(state.deferred, threadId));
    }
    const enqueued = enqueueDeferred(state.deferred, threadId, entry);
    if (!enqueued.accepted) {
      deps.setNotice(warning(DEFERRED_FULL_NOTICE));
      return "kept";
    }
    if (!state.deferred.has(threadId)) {
      const turn = deps.store.currentState().threads.get(threadId);
      state.boundaryTracker.anchor(threadId, turn === undefined ? null : runningTurn(turn), true);
    }
    state.deferredAuthorities.set(threadId, authority);
    state.preparedDeferred.set(entry.request, prepared);
    commitDeferred(enqueued.map);
    deps.setNotice(null);
    const thread = deps.store.currentState().threads.get(threadId);
    if (thread !== undefined && runningTurn(thread) !== null) return "deferred";
    armDrain(threadId);
    return "deferred";
  };

  const holdForNextTurn = (threadId: string, id: string): AgentSteerOutcome => {
    const promoted = promoteDeferred(state.deferred, threadId, id);
    if (promoted === state.deferred) return "kept";
    commitDeferred(promoted);
    state.awaitingSettlement.add(threadId);
    if (state.userSendNow.has(threadId)) {
      dependenciesRef.current.setNotice(info(DEFERRED_NEXT_TURN_NOTICE));
    }
    return "kept";
  };

  const rejectSteer = (
    reason: AgentTaskSteerRejectionReason,
    threadId: string,
    turn: AgentTurn,
    request: AgentSteerRequest,
    authority: AgentTaskLaunchAuthority,
    prepared: ClaimedTurnAttachments,
  ): AgentSteerOutcome => {
    const deps = dependenciesRef.current;
    const queuedId = state.sendingQueued.get(threadId);
    switch (reason) {
      case "notSteerable":
      case "inputClosed":
      case "notRunning":
        if (request.delivery === "immediate") {
          if (queuedId !== undefined && reason !== "notSteerable") {
            return holdForNextTurn(threadId, queuedId);
          }
          if (queuedId !== undefined) state.awaitingSettlement.add(threadId);
          deps.setNotice(
            info("The agent cannot receive this message now. Your message has not been sent."),
          );
          return "kept";
        }
        if (turn.launch === null) return "kept";
        return deferSteer(threadId, turn.launch, request, authority, prepared);
      case "stopping":
        deps.setNotice(warning(STEER_STOPPING_NOTICE));
        return "kept";
      case "limitExceeded":
        deps.setNotice(warning(AGENT_THREAD_STEER_LIMIT_NOTICE));
        return "kept";
      case "inputUnavailable":
        deps.setNotice(warning(STEER_UNAVAILABLE_NOTICE));
        return "kept";
      case "notRegistered":
        if (queuedId !== undefined) return holdForNextTurn(threadId, queuedId);
        deps.setNotice(warning(STEER_UNREGISTERED_NOTICE));
        return "kept";
      case "writeTimedOut":
      case "writeFailed":
        deps.setNotice(failure(STEER_WRITE_FAILED_NOTICE));
        return "kept";
      default:
        return unsupportedSteerRejection(reason);
    }
  };

  const steer = async (
    request: AgentSteerRequest,
    claimed?: ClaimedTurnAttachments,
  ): Promise<AgentSteerOutcome> => {
    const admitted = admitSteer(dependenciesRef.current, request, state.inFlightSteers);
    if (admitted === null) return "kept";
    const { thread, turn, authority, prompt } = admitted;
    const threadId = thread.threadId;
    const reservedThreads = new Set([...state.deferred.keys(), ...state.inFlightSteers]);
    if (
      (!reservedThreads.has(threadId) && reservedThreads.size >= MAX_DEFERRED_FOLLOW_UP_THREADS) ||
      (claimed === undefined &&
        deferredFollowUpsForThread(state.deferred, threadId).length >=
          MAX_DEFERRED_FOLLOW_UPS_PER_THREAD)
    ) {
      dependenciesRef.current.setNotice(warning(DEFERRED_FULL_NOTICE));
      return "kept";
    }
    const turnId = turn.turnId;
    const ownerId = thread.owner.ownerId;
    const lease = { authority, cancelled: false };
    state.steerLeases.set(threadId, lease);
    state.inFlightSteers.add(threadId);
    const ownsTarget = (): boolean =>
      !lease.cancelled &&
      isCurrentThreadLaunchAuthority(dependenciesRef, mountedRef, authority) &&
      steerThreadIsCurrent(dependenciesRef.current, threadId, turnId, ownerId);
    try {
      const prepared =
        claimed ??
        (await prepareTurnAttachments(
          {
            ...dependenciesRef.current,
            setNotice: (notice) => {
              if (ownsTarget()) dependenciesRef.current.setNotice(notice);
            },
          },
          request,
          steerAttachmentAuthority(authority),
          threadId,
          prompt,
        ));
      if (prepared === null || !ownsTarget()) return "kept";
      if (request.delivery === "queued") {
        if (turn.launch === null || prepared.notice !== null) return "kept";
        return deferSteer(threadId, turn.launch, { ...request, prompt }, authority, prepared);
      }
      const pendingInput = dependenciesRef.current.hasPendingThreadInput;
      if (pendingInput !== undefined) {
        const blocked = await attempt(() => boundedPendingInputCheck(pendingInput, threadId));
        if (!ownsTarget()) return "kept";
        if (!blocked.ok || blocked.value) {
          if (state.deferred.has(threadId)) state.blockedThreads.add(threadId);
          state.boundaryTracker.retry(threadId);
          dependenciesRef.current.setNotice(
            info(
              blocked.ok
                ? "Answer the pending question or approval before sending this message."
                : "Pending requests could not be checked. Your message has not been sent.",
            ),
          );
          return "kept";
        }
        state.blockedThreads.delete(threadId);
      }
      if (agentPromptByteLength(prepared.prompt) > MAX_AGENT_EVENT_TEXT_BYTES) {
        dependenciesRef.current.setNotice(warning(STEER_TOO_LONG_NOTICE));
        return "kept";
      }
      if (
        !ownsTarget() ||
        !steerTargetIsCurrent(dependenciesRef, mountedRef, threadId, turnId, ownerId)
      ) {
        return "kept";
      }
      flushStreams();
      const event = steeredEvent(prepared);
      if (!steerEventFits(dependenciesRef.current, threadId, turnId, event)) {
        dependenciesRef.current.setNotice(warning(AGENT_THREAD_TURN_FULL_NOTICE));
        return "kept";
      }
      const sent = await attempt(() =>
        dependenciesRef.current.agentTaskGateway.steerAgentTask(
          steerPayload(turnId, ownerId, threadId, prepared),
        ),
      );
      if (!sent.ok) {
        dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, sent.error);
        if (ownsTarget()) dependenciesRef.current.setNotice(failure(STEER_FAILED_NOTICE));
        return "kept";
      }
      if (sent.value.kind === "rejected") {
        if (!ownsTarget()) return "kept";
        if (sent.value.rejection.reason === "notSteerable" && pendingInput !== undefined) {
          const blocked = await attempt(() => boundedPendingInputCheck(pendingInput, threadId));
          if (!ownsTarget()) return "kept";
          if (!blocked.ok || blocked.value) {
            if (state.deferred.has(threadId)) state.blockedThreads.add(threadId);
            state.boundaryTracker.retry(threadId);
            return "kept";
          }
        }
        return rejectSteer(
          sent.value.rejection.reason,
          threadId,
          turn,
          request,
          authority,
          prepared,
        );
      }
      flushStreams();
      if (
        !ownsTarget() ||
        !steerTargetIsCurrent(dependenciesRef, mountedRef, threadId, turnId, ownerId)
      ) {
        if (ownsTarget()) dependenciesRef.current.setNotice(warning(STEER_DROPPED_NOTICE));
        return "sent";
      }
      if (!steerEventFits(dependenciesRef.current, threadId, turnId, event)) {
        dependenciesRef.current.setNotice(
          warning(
            "Your message was delivered, but the turn reached its history limit before it could be recorded.",
          ),
        );
        return "sent";
      }
      dependenciesRef.current.store.dispatchAction({
        kind: "turnSteered",
        threadId,
        turnId,
        event,
      });
      dependenciesRef.current.setNotice(prepared.notice);
      return "sent";
    } finally {
      state.inFlightSteers.delete(threadId);
      if (state.steerLeases.get(threadId) === lease) state.steerLeases.delete(threadId);
    }
  };

  return { steer };
}
