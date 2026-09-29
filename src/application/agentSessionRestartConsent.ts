import { runningTurn, type AgentThread } from "../domain/agentThread";
import { AGENT_SESSION_RESTART_REFUSED_MESSAGE } from "../domain/agentThreadSession";
import {
  deferredFollowUpsForThread,
  deferredQueueIsEditing,
  type DeferredFollowUps,
} from "./agentDeferredFollowUps";
import type { AgentFollowUpRequest, AgentTasksNotice } from "./agentThreadPorts";

export const SESSION_RESTART_CONSEQUENCE =
  "Restarting ends this Claude session. Background tasks it started may stop.";
export const DEFERRED_SESSION_RESTART_NOTICE = `Queued messages are paused because sending the next one restarts Claude for this thread. ${SESSION_RESTART_CONSEQUENCE}`;
export const FOLLOW_UP_SESSION_RESTART_NOTICE = `${AGENT_SESSION_RESTART_REFUSED_MESSAGE} ${SESSION_RESTART_CONSEQUENCE}`;

const MAX_SESSION_RESTART_REFUSALS = 256;

export function deferredQueueInState(
  map: DeferredFollowUps,
  threadId: string,
  state: "queued" | "paused",
): DeferredFollowUps {
  const queue = deferredFollowUpsForThread(map, threadId);
  const next = new Map(map);
  next.set(
    threadId,
    queue.map((entry) => ({ ...entry, state })),
  );
  return next;
}

export class DeferredRestartRefusals {
  private readonly refused = new Map<string, string>();

  refuse(threadId: string, entryId: string): AgentTasksNotice {
    rememberBounded(this.refused, threadId, entryId);
    return restartNotice("error", DEFERRED_SESSION_RESTART_NOTICE, threadId, entryId);
  }

  renotify(
    map: DeferredFollowUps,
    threadId: string,
    ports: { readonly setNotice: (notice: AgentTasksNotice | null) => void },
  ): boolean {
    const entryId = this.refused.get(threadId);
    if (entryId === undefined) return false;
    if (deferredFollowUpsForThread(map, threadId).some((entry) => entry.id === entryId)) {
      ports.setNotice(restartNotice("error", DEFERRED_SESSION_RESTART_NOTICE, threadId, entryId));
      return true;
    }
    this.refused.delete(threadId);
    return false;
  }

  claim(map: DeferredFollowUps, thread: AgentThread | undefined, entryId: string): boolean {
    if (thread === undefined || thread.archived || runningTurn(thread) !== null) return false;
    const queue = deferredFollowUpsForThread(map, thread.threadId);
    if (queue[0]?.id !== entryId || deferredQueueIsEditing(queue)) return false;
    if (this.refused.get(thread.threadId) !== entryId) return false;
    this.refused.delete(thread.threadId);
    return true;
  }
}

type FollowUpRefusalAnchor =
  | { readonly kind: "stoppedTurn"; readonly turnId: string }
  | { readonly kind: "beforeStart"; readonly lastTurnId: string | null };

interface FollowUpRefusal {
  readonly anchor: FollowUpRefusalAnchor;
  readonly offer: HeldFollowUp | null;
}

interface HeldFollowUp {
  readonly id: string;
  readonly ownerId: string;
  readonly request: AgentFollowUpRequest;
}

export class FollowUpRestartRefusals {
  private readonly refusals = new Map<string, FollowUpRefusal>();
  private sequence = 0;

  refuse(threadId: string, turnId: string): void {
    rememberBounded(this.refusals, threadId, {
      anchor: { kind: "stoppedTurn", turnId },
      offer: null,
    });
  }

  refuseBeforeStart(thread: AgentThread): void {
    const lastTurnId = thread.turns[thread.turns.length - 1]?.turnId ?? null;
    rememberBounded(this.refusals, thread.threadId, {
      anchor: { kind: "beforeStart", lastTurnId },
      offer: null,
    });
  }

  readonly refused = (threadId: string): boolean => this.refusals.has(threadId);

  forget(threadId: string): void {
    this.refusals.delete(threadId);
  }

  offer(thread: AgentThread | undefined, request: AgentFollowUpRequest): AgentTasksNotice | null {
    if (thread === undefined) return null;
    const refusal = this.refusals.get(thread.threadId);
    if (refusal === undefined || !stillAnchored(thread, refusal.anchor)) return null;
    if ((request.attachments?.length ?? 0) > 0) {
      return { kind: "warning", message: FOLLOW_UP_SESSION_RESTART_NOTICE, action: null };
    }
    this.sequence += 1;
    const id = `restart-${this.sequence}`;
    rememberBounded(this.refusals, thread.threadId, {
      anchor: refusal.anchor,
      offer: { id, ownerId: thread.owner.ownerId, request },
    });
    return restartNotice("warning", FOLLOW_UP_SESSION_RESTART_NOTICE, thread.threadId, id);
  }

  take(thread: AgentThread | undefined, id: string): AgentFollowUpRequest | null {
    if (thread === undefined) return null;
    const refusal = this.refusals.get(thread.threadId);
    const offer = refusal?.offer ?? null;
    if (refusal === undefined || offer === null || offer.id !== id) return null;
    this.refusals.delete(thread.threadId);
    if (thread.archived || thread.owner.ownerId !== offer.ownerId) return null;
    if (runningTurn(thread) !== null || !stillAnchored(thread, refusal.anchor)) return null;
    return offer.request;
  }
}

function rememberBounded<T>(map: Map<string, T>, threadId: string, value: T): void {
  map.delete(threadId);
  map.set(threadId, value);
  if (map.size <= MAX_SESSION_RESTART_REFUSALS) return;
  const oldest = map.keys().next();
  if (oldest.done === true) return;
  map.delete(oldest.value);
}

function stillAnchored(thread: AgentThread, anchor: FollowUpRefusalAnchor): boolean {
  const lastTurnId = thread.turns[thread.turns.length - 1]?.turnId ?? null;
  switch (anchor.kind) {
    case "stoppedTurn":
      return lastTurnId === anchor.turnId;
    case "beforeStart":
      return lastTurnId === anchor.lastTurnId;
    default:
      return unsupportedRefusalAnchor(anchor);
  }
}

function unsupportedRefusalAnchor(anchor: never): never {
  throw new TypeError(`Unsupported restart refusal anchor: ${JSON.stringify(anchor)}.`);
}

function restartNotice(
  kind: AgentTasksNotice["kind"],
  message: string,
  threadId: string,
  entryId: string,
): AgentTasksNotice {
  return { kind, message, action: { kind: "restartFollowUp", threadId, entryId } };
}
