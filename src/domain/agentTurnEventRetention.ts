import type { AgentTurnEvent } from "./agentThread";
import {
  isAgentTurnCoalescibleTextEvent,
  isAgentTurnSnapshotEvent,
  mergeSupersededAgentTurnEvent,
} from "./agentTurnEventSupersession";
import {
  INERT_AGENT_TURN_SNAPSHOT_INDEX,
  createAgentTurnSnapshotIndex,
  type AgentTurnSnapshotIndex,
  type AgentTurnSnapshotPlacement,
} from "./agentTurnSnapshotIndex";

export interface AgentTurnEventRetentionProbe {
  readonly step: () => void;
}

export interface AgentTurnEventRetentionPolicy {
  readonly maxEvents: number;
  readonly maxBytes: number;
  readonly maxSubagentThreads: number;
  readonly eventBytes: (event: AgentTurnEvent) => number;
  readonly coalesceText: (
    last: AgentTurnEvent | undefined,
    next: AgentTurnEvent,
  ) => AgentTurnEvent | null;
  readonly probe?: AgentTurnEventRetentionProbe;
}

export interface AgentTurnEventRetentionResult {
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly truncated: boolean;
}

interface RetentionState {
  readonly policy: AgentTurnEventRetentionPolicy;
  readonly step: () => void;
  readonly slots: Array<AgentTurnEvent | null>;
  readonly snapshots: AgentTurnSnapshotIndex;
  readonly subagentThreads: Map<string, number>;
  liveCount: number;
  retainedBytes: number;
  evictionCursor: number;
  truncated: boolean;
}

export function retainAgentTurnEvents(
  existing: ReadonlyArray<AgentTurnEvent>,
  incoming: ReadonlyArray<AgentTurnEvent>,
  policy: AgentTurnEventRetentionPolicy,
): AgentTurnEventRetentionResult {
  const step = probeStep(policy);
  return retain(existing, incoming, policy, snapshotIndexFor(incoming, step));
}

export function capAgentTurnEvents(
  events: ReadonlyArray<AgentTurnEvent>,
  policy: AgentTurnEventRetentionPolicy,
): AgentTurnEventRetentionResult {
  return retain([], events, policy, INERT_AGENT_TURN_SNAPSHOT_INDEX);
}

function probeStep(policy: AgentTurnEventRetentionPolicy): () => void {
  return policy.probe?.step ?? noStep;
}

function noStep(): void {
  return undefined;
}

function snapshotIndexFor(
  incoming: ReadonlyArray<AgentTurnEvent>,
  step: () => void,
): AgentTurnSnapshotIndex {
  for (const event of incoming) {
    step();
    if (isAgentTurnSnapshotEvent(event)) return createAgentTurnSnapshotIndex(step);
  }
  return INERT_AGENT_TURN_SNAPSHOT_INDEX;
}

function retain(
  existing: ReadonlyArray<AgentTurnEvent>,
  incoming: ReadonlyArray<AgentTurnEvent>,
  policy: AgentTurnEventRetentionPolicy,
  snapshots: AgentTurnSnapshotIndex,
): AgentTurnEventRetentionResult {
  if (incoming.length === 0) return { events: existing, truncated: false };
  const state: RetentionState = {
    policy,
    step: probeStep(policy),
    slots: [...existing],
    snapshots,
    subagentThreads: new Map(),
    liveCount: 0,
    retainedBytes: 0,
    evictionCursor: 0,
    truncated: false,
  };
  for (let slot = 0; slot < existing.length; slot += 1) adoptSlot(state, existing[slot], slot);
  for (const event of incoming) {
    state.step();
    acceptEvent(state, event);
  }
  return { events: liveEvents(state), truncated: state.truncated };
}

function acceptEvent(state: RetentionState, event: AgentTurnEvent): void {
  if (state.policy.eventBytes(event) > state.policy.maxBytes) {
    state.truncated = true;
    return;
  }
  if (!coalesceIntoTail(state, event)) placeEvent(state, state.snapshots.place(event));
  enforceLimits(state);
}

function coalesceIntoTail(state: RetentionState, event: AgentTurnEvent): boolean {
  const tailSlot = state.slots.length - 1;
  const tail = state.slots[tailSlot] ?? null;
  if (tail === null) return false;
  const coalesced = state.policy.coalesceText(tail, event);
  if (coalesced === null) return false;
  replaceSlot(state, tailSlot, tail, coalesced);
  return true;
}

function placeEvent(state: RetentionState, placement: AgentTurnSnapshotPlacement): void {
  if (supersedeInPlace(state, placement)) return;
  state.slots.push(placement.event);
  adoptSlot(state, placement.event, state.slots.length - 1);
}

function supersedeInPlace(state: RetentionState, placement: AgentTurnSnapshotPlacement): boolean {
  if (placement.liveSlot === null) return false;
  if (tailIsCoalescibleText(state)) return false;
  const previous = state.slots[placement.liveSlot] ?? null;
  if (previous === null) return false;
  const merged = mergeSupersededAgentTurnEvent(previous, placement.event);
  if (merged === null) return false;
  replaceSlot(state, placement.liveSlot, previous, merged);
  return true;
}

function tailIsCoalescibleText(state: RetentionState): boolean {
  const tail = state.slots[state.slots.length - 1] ?? null;
  return tail !== null && isAgentTurnCoalescibleTextEvent(tail);
}

function replaceSlot(
  state: RetentionState,
  slot: number,
  previous: AgentTurnEvent,
  event: AgentTurnEvent,
): void {
  state.retainedBytes += state.policy.eventBytes(event) - state.policy.eventBytes(previous);
  state.slots[slot] = event;
}

function adoptSlot(state: RetentionState, event: AgentTurnEvent | undefined, slot: number): void {
  if (event === undefined) return;
  state.step();
  state.liveCount += 1;
  state.retainedBytes += state.policy.eventBytes(event);
  countSubagentThread(state, event, 1);
  state.snapshots.adopt(event, slot);
}

function enforceLimits(state: RetentionState): void {
  while (exceedsLimits(state)) {
    const victim = nextVictimSlot(state);
    if (victim === null) return;
    evictSlot(state, victim);
  }
}

function exceedsLimits(state: RetentionState): boolean {
  return (
    state.liveCount > state.policy.maxEvents ||
    state.retainedBytes > state.policy.maxBytes ||
    state.subagentThreads.size > state.policy.maxSubagentThreads
  );
}

function nextVictimSlot(state: RetentionState): number | null {
  while (state.evictionCursor < state.slots.length && isPinned(state, state.evictionCursor)) {
    state.step();
    state.evictionCursor += 1;
  }
  if (state.evictionCursor < state.slots.length) return state.evictionCursor;
  if (state.slots.length === 0) return null;
  return state.slots.length - 1;
}

function isPinned(state: RetentionState, slot: number): boolean {
  const event = state.slots[slot] ?? null;
  return event === null || event.kind === "userMessage";
}

function evictSlot(state: RetentionState, slot: number): void {
  const event = state.slots[slot] ?? null;
  if (event === null) return;
  state.step();
  state.slots[slot] = null;
  state.liveCount -= 1;
  state.retainedBytes -= state.policy.eventBytes(event);
  state.truncated = true;
  countSubagentThread(state, event, -1);
  state.snapshots.evict(event, slot);
  trimTail(state);
}

function trimTail(state: RetentionState): void {
  while (state.slots.length > 0 && state.slots[state.slots.length - 1] === null) {
    state.step();
    state.slots.pop();
  }
  state.evictionCursor = Math.min(state.evictionCursor, state.slots.length);
}

function countSubagentThread(state: RetentionState, event: AgentTurnEvent, delta: 1 | -1): void {
  if (!("agentThreadId" in event)) return;
  const count = (state.subagentThreads.get(event.agentThreadId) ?? 0) + delta;
  if (count > 0) {
    state.subagentThreads.set(event.agentThreadId, count);
    return;
  }
  state.subagentThreads.delete(event.agentThreadId);
}

function liveEvents(state: RetentionState): ReadonlyArray<AgentTurnEvent> {
  return state.slots.filter((slot): slot is AgentTurnEvent => {
    state.step();
    return slot !== null;
  });
}
