import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentLaunchOptions } from "../domain/agentLaunch";
import type {
  AgentTaskGateway,
  AgentTaskSteerRejectionReason,
  SteerAgentTaskRequest,
} from "../domain/agentTask";
import {
  MAX_AGENT_EVENT_TEXT_BYTES,
  agentTurnAcceptsSteerBytes,
  agentTurnEventUtf8Bytes,
  runningTurn,
  type AgentThreadsState,
  type AgentTurn,
  type AgentTurnEvent,
} from "../domain/agentThread";
import type { AgentAttachmentGateway } from "./agentAttachmentPorts";
import {
  clearDeferred,
  deferredFollowUpsForThread,
  emptyDeferredFollowUps,
  enqueueDeferred,
  removeDeferred,
  takeDeferredHead,
  type DeferredFollowUp,
  type DeferredFollowUps,
} from "./agentDeferredFollowUps";
import {
  AGENT_TASKS_SOURCE,
  attempt,
  failure,
  info,
  isCurrentThreadLaunchAuthority,
  warning,
  type AgentTaskLaunchAuthority,
} from "./agentProjectAuthority";
import type {
  AgentFollowUpRequest,
  AgentSteerOutcome,
  AgentSteerRequest,
} from "./agentThreadPorts";
import {
  AGENT_THREAD_STEER_LIMIT_NOTICE,
  AGENT_THREAD_TURN_FULL_NOTICE,
  admitSteer,
  agentPromptByteLength,
  type AgentTurnAdmissionDependencies,
} from "./agentTurnAdmission";
import {
  prepareTurnAttachments,
  type AgentTurnAttachmentAuthority,
  type ClaimedTurnAttachments,
} from "./agentTurnAttachments";

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
export const DEFERRED_QUEUED_NOTICE =
  "The turn already finished, so the message is queued for the next turn.";
export const DEFERRED_FULL_NOTICE = "Too many messages are already queued for this thread.";
export const DEFERRED_CLEARED_NOTICE = "Queued messages were discarded when the agent was stopped.";
export const DEFERRED_SEND_FAILED_NOTICE = "Queued messages could not be sent and were discarded.";

const MAX_TRACKED_CLOSED_INPUTS = 256;

export interface AgentTurnSteerDependencies extends AgentTurnAdmissionDependencies {
  readonly agentTaskGateway: AgentTaskGateway;
  readonly agentAttachmentGateway?: AgentAttachmentGateway;
}

export interface AgentTurnSteerStream {
  readonly turnId: string;
  readonly threadId: string;
  readonly ownerId: string;
  readonly sawResult: boolean;
}

export interface AgentTurnSteerOptions {
  readonly state: AgentThreadsState;
  readonly dependenciesRef: { readonly current: AgentTurnSteerDependencies };
  readonly mountedRef: { readonly current: boolean };
  readonly sendFollowUpRef: {
    readonly current:
      ((request: AgentFollowUpRequest, isCurrent?: () => boolean) => Promise<boolean>) | null;
  };
  readonly flushStreams: () => void;
}

export interface AgentTurnSteerSurface {
  readonly deferredFollowUps: DeferredFollowUps;
  steer(request: AgentSteerRequest): Promise<AgentSteerOutcome>;
  removeDeferredFollowUp(threadId: string, id: string): void;
  onTurnSettled(threadId: string): void;
  onThreadStopped(threadId: string): void;
  clearDeferredForOwner(ownerId: string): void;
  noteStreamResult(stream: AgentTurnSteerStream): void;
}

export function useAgentTurnSteer(options: AgentTurnSteerOptions): AgentTurnSteerSurface {
  const { state, dependenciesRef, mountedRef, sendFollowUpRef, flushStreams } = options;
  const [deferredFollowUps, setDeferredFollowUps] =
    useState<DeferredFollowUps>(emptyDeferredFollowUps);
  const [drainTick, setDrainTick] = useState(0);
  const deferredRef = useRef<DeferredFollowUps>(deferredFollowUps);
  const inFlightSteersRef = useRef<Set<string>>(new Set());
  const steerLeasesRef = useRef<
    Map<string, { readonly authority: AgentTaskLaunchAuthority; cancelled: boolean }>
  >(new Map());
  const deferredAuthoritiesRef = useRef<Map<string, AgentTaskLaunchAuthority>>(new Map());
  const drainLeasesRef = useRef<
    Map<string, { readonly authority: AgentTaskLaunchAuthority; cancelled: boolean }>
  >(new Map());
  const pendingDrainsRef = useRef<Set<string>>(new Set());
  const closedInputsRef = useRef<Set<string>>(new Set());
  const deferredSequenceRef = useRef(0);

  const commitDeferred = useCallback(
    (next: DeferredFollowUps): void => {
      deferredRef.current = next;
      for (const threadId of deferredAuthoritiesRef.current.keys()) {
        if (!next.has(threadId)) deferredAuthoritiesRef.current.delete(threadId);
      }
      if (!mountedRef.current) return;
      setDeferredFollowUps(next);
    },
    [mountedRef],
  );

  const armDrain = useCallback(
    (threadId: string): void => {
      pendingDrainsRef.current.add(threadId);
      if (!mountedRef.current) return;
      setDrainTick((tick) => tick + 1);
    },
    [mountedRef],
  );

  const deferSteer = useCallback(
    (
      threadId: string,
      launch: AgentLaunchOptions,
      request: AgentSteerRequest,
      authority: AgentTaskLaunchAuthority,
    ): AgentSteerOutcome => {
      const deps = dependenciesRef.current;
      const now = deps.now ?? Date.now;
      deferredSequenceRef.current += 1;
      const entry: DeferredFollowUp = {
        id: `deferred-${deferredSequenceRef.current}`,
        request: deferredFollowUpRequest(threadId, launch, request),
        queuedAtEpochMs: now(),
      };
      const enqueued = enqueueDeferred(deferredRef.current, threadId, entry);
      if (!enqueued.accepted) {
        deps.setNotice(warning(DEFERRED_FULL_NOTICE));
        return "kept";
      }
      deferredAuthoritiesRef.current.set(threadId, authority);
      commitDeferred(enqueued.map);
      deps.setNotice(info(DEFERRED_QUEUED_NOTICE));
      const thread = deps.store.currentState().threads.get(threadId);
      if (thread !== undefined && runningTurn(thread) !== null) return "deferred";
      armDrain(threadId);
      return "deferred";
    },
    [armDrain, commitDeferred, dependenciesRef],
  );

  const rejectSteer = useCallback(
    (
      reason: AgentTaskSteerRejectionReason,
      threadId: string,
      turn: AgentTurn,
      request: AgentSteerRequest,
      authority: AgentTaskLaunchAuthority,
    ): AgentSteerOutcome => {
      const deps = dependenciesRef.current;
      switch (reason) {
        case "notSteerable":
        case "inputClosed":
        case "notRunning":
          if (turn.launch === null) return "kept";
          return deferSteer(threadId, turn.launch, request, authority);
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
          deps.setNotice(warning(STEER_UNREGISTERED_NOTICE));
          return "kept";
        case "writeTimedOut":
        case "writeFailed":
          deps.setNotice(failure(STEER_WRITE_FAILED_NOTICE));
          return "kept";
        default:
          return unsupportedSteerRejection(reason);
      }
    },
    [deferSteer, dependenciesRef],
  );

  const steer = useCallback(
    async (request: AgentSteerRequest): Promise<AgentSteerOutcome> => {
      const admitted = admitSteer(dependenciesRef.current, request, inFlightSteersRef.current);
      if (admitted === null) return "kept";
      const { thread, turn, authority, prompt } = admitted;
      const threadId = thread.threadId;
      const turnId = turn.turnId;
      const ownerId = thread.owner.ownerId;
      const lease = { authority, cancelled: false };
      steerLeasesRef.current.set(threadId, lease);
      inFlightSteersRef.current.add(threadId);
      const ownsTarget = (): boolean =>
        !lease.cancelled &&
        isCurrentThreadLaunchAuthority(dependenciesRef, mountedRef, authority) &&
        steerThreadIsCurrent(dependenciesRef.current, threadId, turnId, ownerId);
      try {
        const prepared = await prepareTurnAttachments(
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
        );
        if (prepared === null || !ownsTarget()) return "kept";
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
          return rejectSteer(sent.value.rejection.reason, threadId, turn, request, authority);
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
        inFlightSteersRef.current.delete(threadId);
        if (steerLeasesRef.current.get(threadId) === lease) steerLeasesRef.current.delete(threadId);
      }
    },
    [dependenciesRef, flushStreams, mountedRef, rejectSteer],
  );

  const removeDeferredFollowUp = useCallback(
    (threadId: string, id: string): void => {
      const next = removeDeferred(deferredRef.current, threadId, id);
      if (next === deferredRef.current) return;
      commitDeferred(next);
    },
    [commitDeferred],
  );

  const onTurnSettled = useCallback(
    (threadId: string): void => {
      if (deferredFollowUpsForThread(deferredRef.current, threadId).length === 0) return;
      armDrain(threadId);
    },
    [armDrain],
  );

  const onThreadStopped = useCallback(
    (threadId: string): void => {
      const lease = steerLeasesRef.current.get(threadId);
      if (lease !== undefined) lease.cancelled = true;
      const drainLease = drainLeasesRef.current.get(threadId);
      if (drainLease !== undefined) drainLease.cancelled = true;
      deferredAuthoritiesRef.current.delete(threadId);
      pendingDrainsRef.current.delete(threadId);
      const cleared = clearDeferred(deferredRef.current, threadId);
      if (cleared === deferredRef.current) return;
      commitDeferred(cleared);
      dependenciesRef.current.setNotice(warning(DEFERRED_CLEARED_NOTICE));
    },
    [commitDeferred, dependenciesRef],
  );

  const clearDeferredForOwner = useCallback(
    (ownerId: string): void => {
      for (const lease of [
        ...steerLeasesRef.current.values(),
        ...drainLeasesRef.current.values(),
      ]) {
        if (lease.authority.ownerId === ownerId) lease.cancelled = true;
      }
      const threads = dependenciesRef.current.store.currentState().threads;
      let next = deferredRef.current;
      for (const threadId of next.keys()) {
        if (threads.get(threadId)?.owner.ownerId !== ownerId) continue;
        pendingDrainsRef.current.delete(threadId);
        deferredAuthoritiesRef.current.delete(threadId);
        next = clearDeferred(next, threadId);
      }
      if (next === deferredRef.current) return;
      commitDeferred(next);
    },
    [commitDeferred, dependenciesRef],
  );

  const noteStreamResult = useCallback(
    (stream: AgentTurnSteerStream): void => {
      if (!stream.sawResult) return;
      if (closedInputsRef.current.has(stream.turnId)) return;
      if (!steerableStream(dependenciesRef.current, stream)) return;
      retainClosedInput(closedInputsRef.current, stream.turnId);
      void closeAgentTaskInput(dependenciesRef.current, stream.turnId, stream.ownerId);
    },
    [dependenciesRef],
  );

  const drainDeferred = useCallback(
    (current: AgentThreadsState): void => {
      const deps = dependenciesRef.current;
      for (const threadId of deferredRef.current.keys()) {
        const thread = current.threads.get(threadId);
        const authority = deferredAuthoritiesRef.current.get(threadId);
        if (
          thread !== undefined &&
          !thread.archived &&
          authority !== undefined &&
          isCurrentThreadLaunchAuthority(dependenciesRef, mountedRef, authority)
        )
          continue;
        pendingDrainsRef.current.delete(threadId);
        deferredAuthoritiesRef.current.delete(threadId);
        commitDeferred(clearDeferred(deferredRef.current, threadId));
        deps.setNotice(warning(DEFERRED_SEND_FAILED_NOTICE));
      }
      for (const threadId of [...pendingDrainsRef.current]) {
        const thread = current.threads.get(threadId);
        if (thread !== undefined && runningTurn(thread) !== null) continue;
        pendingDrainsRef.current.delete(threadId);
        if (thread === undefined || thread.archived) {
          const dropped = clearDeferred(deferredRef.current, threadId);
          if (dropped !== deferredRef.current) commitDeferred(dropped);
          continue;
        }
        const send = sendFollowUpRef.current;
        if (send === null) continue;
        if (drainLeasesRef.current.has(threadId)) continue;
        const authority = deferredAuthoritiesRef.current.get(threadId);
        if (authority === undefined) continue;
        const lease = { authority, cancelled: false };
        drainLeasesRef.current.set(threadId, lease);
        const isCurrent = (): boolean =>
          !lease.cancelled &&
          isCurrentThreadLaunchAuthority(dependenciesRef, mountedRef, authority);
        const taken = takeDeferredHead(deferredRef.current, threadId);
        if (taken.head === null) continue;
        commitDeferred(taken.map);
        void sendDeferredFollowUp(deps, send, taken.head.request, isCurrent).then((sent) => {
          if (drainLeasesRef.current.get(threadId) === lease)
            drainLeasesRef.current.delete(threadId);
          if (!isCurrent()) return;
          if (sent) {
            const thread = dependenciesRef.current.store.currentState().threads.get(threadId);
            if (thread !== undefined && runningTurn(thread) === null) armDrain(threadId);
            return;
          }
          pendingDrainsRef.current.delete(threadId);
          commitDeferred(clearDeferred(deferredRef.current, threadId));
        });
      }
    },
    [armDrain, commitDeferred, dependenciesRef, mountedRef, sendFollowUpRef],
  );

  useEffect(() => {
    drainDeferred(state);
  }, [drainDeferred, drainTick, state]);

  return {
    deferredFollowUps,
    steer,
    removeDeferredFollowUp,
    onTurnSettled,
    onThreadStopped,
    clearDeferredForOwner,
    noteStreamResult,
  };
}

async function sendDeferredFollowUp(
  deps: AgentTurnSteerDependencies,
  send: (request: AgentFollowUpRequest, isCurrent?: () => boolean) => Promise<boolean>,
  request: AgentFollowUpRequest,
  isCurrent: () => boolean,
): Promise<boolean> {
  const sent = await attempt(() => send(request, isCurrent));
  if (!isCurrent()) return false;
  if (sent.ok && sent.value) return true;
  if (!sent.ok) deps.reportError(AGENT_TASKS_SOURCE, sent.error);
  deps.setNotice(failure(DEFERRED_SEND_FAILED_NOTICE));
  return false;
}

async function closeAgentTaskInput(
  deps: AgentTurnSteerDependencies,
  taskId: string,
  workspaceId: string,
): Promise<void> {
  const closed = await attempt(() =>
    deps.agentTaskGateway.closeAgentTaskInput({ taskId, workspaceId }),
  );
  if (closed.ok) return;
  deps.reportError(AGENT_TASKS_SOURCE, closed.error);
}

function steerableStream(deps: AgentTurnSteerDependencies, stream: AgentTurnSteerStream): boolean {
  const thread = deps.store.currentState().threads.get(stream.threadId);
  if (thread === undefined) return false;
  const turn = thread.turns.find((candidate) => candidate.turnId === stream.turnId);
  return turn?.launch?.provider === "claudeCode";
}

function retainClosedInput(tracked: Set<string>, turnId: string): void {
  if (tracked.size >= MAX_TRACKED_CLOSED_INPUTS) {
    const oldest = tracked.values().next().value;
    if (oldest !== undefined) tracked.delete(oldest);
  }
  tracked.add(turnId);
}

function steerEventFits(
  deps: AgentTurnSteerDependencies,
  threadId: string,
  turnId: string,
  event: Extract<AgentTurnEvent, { kind: "userMessage" }>,
): boolean {
  const turn = deps.store
    .currentState()
    .threads.get(threadId)
    ?.turns.find((candidate) => candidate.turnId === turnId);
  return turn !== undefined && agentTurnAcceptsSteerBytes(turn, agentTurnEventUtf8Bytes(event));
}

function steerThreadIsCurrent(
  deps: AgentTurnSteerDependencies,
  threadId: string,
  turnId: string,
  ownerId: string,
): boolean {
  const thread = deps.store.currentState().threads.get(threadId);
  if (thread === undefined || thread.archived || thread.owner.ownerId !== ownerId) return false;
  return thread.turns[thread.turns.length - 1]?.turnId === turnId;
}

function steerTargetIsCurrent(
  dependenciesRef: { readonly current: AgentTurnSteerDependencies },
  mountedRef: { readonly current: boolean },
  threadId: string,
  turnId: string,
  ownerId: string,
): boolean {
  if (!mountedRef.current) return false;
  const thread = dependenciesRef.current.store.currentState().threads.get(threadId);
  if (thread === undefined) return false;
  if (thread.owner.ownerId !== ownerId) return false;
  const turn = runningTurn(thread);
  return turn !== null && turn.turnId === turnId;
}

function steerAttachmentAuthority(
  authority: AgentTaskLaunchAuthority,
): AgentTurnAttachmentAuthority {
  return {
    rootKey: authority.rootKey,
    ownerId: authority.ownerId,
    generation: authority.generation,
    workspaceId: authority.workspaceId,
  };
}

function steerPayload(
  taskId: string,
  workspaceId: string,
  threadId: string,
  prepared: ClaimedTurnAttachments,
): SteerAgentTaskRequest {
  const payload = { taskId, workspaceId, threadId, prompt: prepared.prompt };
  if (prepared.references.length === 0) return payload;
  return { ...payload, attachments: prepared.references };
}

function steeredEvent(
  prepared: ClaimedTurnAttachments,
): Extract<AgentTurnEvent, { kind: "userMessage" }> {
  if (prepared.attachments.length === 0) return { kind: "userMessage", text: prepared.prompt };
  return { kind: "userMessage", text: prepared.prompt, attachments: prepared.attachments };
}

function deferredFollowUpRequest(
  threadId: string,
  launch: AgentLaunchOptions,
  request: AgentSteerRequest,
): AgentFollowUpRequest {
  const followUp: AgentFollowUpRequest = {
    threadId,
    prompt: request.prompt,
    launch,
    dangerousLaunchConfirmed: true,
  };
  if (request.attachments === undefined) return followUp;
  if (request.attachmentOwner === undefined) {
    return { ...followUp, attachments: request.attachments };
  }
  return {
    ...followUp,
    attachments: request.attachments,
    attachmentOwner: request.attachmentOwner,
  };
}

function unsupportedSteerRejection(reason: never): never {
  throw new TypeError(`Unsupported agent task steer rejection: ${String(reason)}.`);
}
