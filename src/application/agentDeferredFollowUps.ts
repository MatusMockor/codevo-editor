import type { AgentFollowUpRequest } from "./agentThreadPorts";

export const MAX_DEFERRED_FOLLOW_UPS_PER_THREAD = 8;
export const MAX_DEFERRED_FOLLOW_UP_THREADS = 64;

export interface DeferredFollowUp {
  readonly state?: "queued" | "paused" | "uncertain";
  readonly id: string;
  readonly request: AgentFollowUpRequest;
  /** Presentation only; never an executable attachment reference. */
  readonly displayAttachmentCount?: number;
  readonly queuedAtEpochMs: number;
  readonly editLease?: number;
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

export function deferredQueueIsEditing(queue: ReadonlyArray<DeferredFollowUp>): boolean {
  return queue.some((entry) => entry.editLease !== undefined);
}

export function editedDeferredEntry(
  map: DeferredFollowUps,
  threadId: string,
  id: string,
  lease: number,
): DeferredFollowUp | null {
  const entry = deferredFollowUpsForThread(map, threadId).find((candidate) => candidate.id === id);
  if (entry === undefined || entry.editLease !== lease) return null;
  return entry;
}

export function beginDeferredEdit(
  map: DeferredFollowUps,
  threadId: string,
  id: string,
  lease: number,
): DeferredFollowUps {
  const queue = deferredFollowUpsForThread(map, threadId);
  if (deferredQueueIsEditing(queue)) return map;
  const entry = queue.find((candidate) => candidate.id === id);
  if (entry === undefined || entry.state === "uncertain") return map;
  return withQueue(
    map,
    threadId,
    queue.map((candidate) => (candidate === entry ? { ...entry, editLease: lease } : candidate)),
  );
}

export function endDeferredEdit(
  map: DeferredFollowUps,
  threadId: string,
  id: string,
  lease: number,
  replacement: DeferredFollowUp["request"] | null,
): DeferredFollowUps {
  const entry = editedDeferredEntry(map, threadId, id, lease);
  if (entry === null) return map;
  const { editLease: _released, ...rest } = entry;
  const settled: DeferredFollowUp = replacement === null ? rest : { ...rest, request: replacement };
  return withQueue(
    map,
    threadId,
    deferredFollowUpsForThread(map, threadId).map((candidate) =>
      candidate === entry ? settled : candidate,
    ),
  );
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
