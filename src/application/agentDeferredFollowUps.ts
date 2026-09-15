import type { AgentFollowUpRequest } from "./agentThreadPorts";

export const MAX_DEFERRED_FOLLOW_UPS_PER_THREAD = 8;
export const MAX_DEFERRED_FOLLOW_UP_THREADS = 64;

export interface DeferredFollowUp {
  readonly state?: "queued" | "paused";
  readonly id: string;
  readonly request: AgentFollowUpRequest;
  /** Presentation only; never an executable attachment reference. */
  readonly displayAttachmentCount?: number;
  readonly queuedAtEpochMs: number;
}

export type DeferredFollowUps = ReadonlyMap<string, ReadonlyArray<DeferredFollowUp>>;

export interface DeferredFollowUpEnqueue {
  readonly map: DeferredFollowUps;
  readonly accepted: boolean;
}

export interface DeferredFollowUpHead {
  readonly map: DeferredFollowUps;
  readonly head: DeferredFollowUp | null;
}

const EMPTY_QUEUE: ReadonlyArray<DeferredFollowUp> = [];

export function emptyDeferredFollowUps(): DeferredFollowUps {
  return new Map();
}

export function deferredFollowUpsForThread(
  map: DeferredFollowUps,
  threadId: string,
): ReadonlyArray<DeferredFollowUp> {
  return map.get(threadId) ?? EMPTY_QUEUE;
}

export function enqueueDeferred(
  map: DeferredFollowUps,
  threadId: string,
  entry: DeferredFollowUp,
): DeferredFollowUpEnqueue {
  const queue = deferredFollowUpsForThread(map, threadId);
  if (!map.has(threadId) && map.size >= MAX_DEFERRED_FOLLOW_UP_THREADS)
    return { map, accepted: false };
  if (queue.length >= MAX_DEFERRED_FOLLOW_UPS_PER_THREAD) return { map, accepted: false };
  if (queue.some((candidate) => candidate.id === entry.id)) return { map, accepted: false };
  return { map: withQueue(map, threadId, [...queue, entry]), accepted: true };
}

export function takeDeferredHead(map: DeferredFollowUps, threadId: string): DeferredFollowUpHead {
  const queue = deferredFollowUpsForThread(map, threadId);
  const head = queue[0];
  if (head === undefined) return { map, head: null };
  return { map: withQueue(map, threadId, queue.slice(1)), head };
}

export function removeDeferred(
  map: DeferredFollowUps,
  threadId: string,
  id: string,
): DeferredFollowUps {
  const queue = deferredFollowUpsForThread(map, threadId);
  const retained = queue.filter((candidate) => candidate.id !== id);
  if (retained.length === queue.length) return map;
  return withQueue(map, threadId, retained);
}

export function clearDeferred(map: DeferredFollowUps, threadId: string): DeferredFollowUps {
  if (!map.has(threadId)) return map;
  const next = new Map(map);
  next.delete(threadId);
  return next;
}

function withQueue(
  map: DeferredFollowUps,
  threadId: string,
  queue: ReadonlyArray<DeferredFollowUp>,
): DeferredFollowUps {
  if (queue.length === 0) return clearDeferred(map, threadId);
  const next = new Map(map);
  next.set(threadId, queue);
  return next;
}
