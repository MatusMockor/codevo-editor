import type { AgentTurnEvent } from "./agentThread";
import { foldAgentTurnDigest, type AgentTurnDigestWire } from "./agentTurnDigest";
import type { AgentTurnEventRetentionProbe } from "./agentTurnEventRetention";
import {
  isAgentTurnCoalescibleTextEvent,
  isAgentTurnSnapshotEvent,
  mergeSupersededAgentTurnEvent,
} from "./agentTurnEventSupersession";
import {
  createAgentTurnSnapshotIndex,
  type AgentTurnSnapshotIndex,
  type AgentTurnSnapshotPlacement,
} from "./agentTurnSnapshotIndex";
import {
  AGENT_TURN_LOG_FIRST_SEQ,
  NO_AGENT_TURN_LOG_LOSS,
  type AgentTurnLogEntry,
  type AgentTurnLogLoss,
} from "./agentTurnLog";

export const MAX_AGENT_TURN_LOG_EVENT_BYTES = 262_144;
export const MAX_AGENT_TURN_LOG_OP_BYTES = 262_144;
export const MAX_AGENT_TURN_WINDOW_LIVE_SNAPSHOTS = 512;
export const MAX_AGENT_TURN_WINDOW_IDENTITIES = 4_096;

const EMPTY_BATCH_BYTES = "[]".length;
const OP_SEPARATOR_BYTES = ",".length;

export const CLIPPED_AGENT_TURN_LOG_ROW: AgentTurnEvent = Object.freeze({
  kind: "unknownLine",
  stream: "stdout",
  raw: "",
  clipped: true,
});

export interface AgentTurnWindowPolicy {
  readonly eventBytes: (event: AgentTurnEvent) => number;
  readonly opBytes: (entry: AgentTurnLogEntry) => number;
  readonly coalesceText: (
    last: AgentTurnEvent | undefined,
    next: AgentTurnEvent,
  ) => AgentTurnEvent | null;
  readonly maxEventBytes: number;
  readonly maxOpBytes: number;
  readonly maxLiveSnapshots?: number;
  readonly maxIdentities?: number;
  readonly probe?: AgentTurnEventRetentionProbe;
}

export interface AgentTurnWindowOptions {
  readonly policy: AgentTurnWindowPolicy;
  readonly firstSeq?: number;
  readonly digest: AgentTurnDigestWire;
}

export interface AgentTurnWindowPending {
  readonly ops: number;
  readonly bytes: number;
}

export interface AgentTurnWindowAcceptance {
  readonly urgent: boolean;
  readonly pending: AgentTurnWindowPending;
}

export interface AgentTurnWindowBatch {
  readonly ops: ReadonlyArray<AgentTurnLogEntry>;
  readonly digest: AgentTurnDigestWire | null;
  readonly complete: boolean;
}

export interface AgentTurnWindow {
  readonly accept: (events: ReadonlyArray<AgentTurnEvent>) => AgentTurnWindowAcceptance;
  readonly nextSeq: () => number;
  readonly totalBytes: () => number;
  readonly loss: () => AgentTurnLogLoss;
  readonly bounded: () => boolean;
  readonly digest: () => AgentTurnDigestWire;
  readonly pending: () => AgentTurnWindowPending;
  readonly changedSeqs: () => ReadonlyArray<number>;
  readonly take: (maxOps: number, maxBytes: number) => AgentTurnWindowBatch;
  readonly commit: (batch: AgentTurnWindowBatch) => void;
  readonly clip: (seq: number) => boolean;
}

interface WindowRow {
  readonly seq: number;
  readonly event: AgentTurnEvent;
}

interface WindowState {
  readonly policy: AgentTurnWindowPolicy;
  readonly step: () => void;
  readonly maxLiveSnapshots: number;
  readonly maxIdentities: number;
  readonly live: Map<number, AgentTurnEvent>;
  readonly dirty: Map<number, AgentTurnEvent>;
  readonly identities: Set<string>;
  snapshots: AgentTurnSnapshotIndex;
  tail: WindowRow | null;
  nextSeq: number;
  totalBytes: number;
  pendingBytes: number;
  bounded: boolean;
  loss: AgentTurnLogLoss;
  digest: AgentTurnDigestWire;
}

export function createAgentTurnWindow(options: AgentTurnWindowOptions): AgentTurnWindow {
  const state = createState(options);
  return {
    accept: (events) => acceptEvents(state, events),
    nextSeq: () => state.nextSeq,
    totalBytes: () => state.totalBytes,
    loss: () => state.loss,
    bounded: () => state.bounded,
    digest: () => state.digest,
    pending: () => pendingOf(state),
    changedSeqs: () => sortedSeqs(state),
    take: (maxOps, maxBytes) => takeBatch(state, maxOps, maxBytes),
    commit: (batch) => commitBatch(state, batch),
    clip: (seq) => clipRow(state, seq),
  };
}

export function urgentAgentTurnLogEvent(event: AgentTurnEvent): boolean {
  return event.kind === "userMessage" || event.kind === "result" || event.kind === "error";
}

function createState(options: AgentTurnWindowOptions): WindowState {
  const step = options.policy.probe?.step ?? noStep;
  return {
    policy: options.policy,
    step,
    maxLiveSnapshots: options.policy.maxLiveSnapshots ?? MAX_AGENT_TURN_WINDOW_LIVE_SNAPSHOTS,
    maxIdentities: options.policy.maxIdentities ?? MAX_AGENT_TURN_WINDOW_IDENTITIES,
    live: new Map(),
    dirty: new Map(),
    identities: new Set(),
    snapshots: createAgentTurnSnapshotIndex(step),
    tail: null,
    nextSeq: options.firstSeq ?? AGENT_TURN_LOG_FIRST_SEQ,
    totalBytes: 0,
    pendingBytes: 0,
    bounded: false,
    loss: NO_AGENT_TURN_LOG_LOSS,
    digest: options.digest,
  };
}

function noStep(): void {
  return undefined;
}

function acceptEvents(
  state: WindowState,
  events: ReadonlyArray<AgentTurnEvent>,
): AgentTurnWindowAcceptance {
  let urgent = false;
  for (const event of events) {
    state.step();
    urgent = urgent || urgentAgentTurnLogEvent(event);
    acceptEvent(state, event);
  }
  state.digest = foldAgentTurnDigest(state.digest, events);
  return { urgent, pending: pendingOf(state) };
}

function acceptEvent(state: WindowState, event: AgentTurnEvent): void {
  if (state.policy.eventBytes(event) > state.policy.maxEventBytes) {
    state.loss = { kind: "supervisorGap" };
    return;
  }
  if (overOpBound(state, state.nextSeq, event)) {
    state.loss = { kind: "supervisorGap" };
    return;
  }
  if (coalesceIntoTail(state, event)) return;
  placeEvent(state, state.snapshots.place(event));
}

function overOpBound(state: WindowState, seq: number, event: AgentTurnEvent): boolean {
  return state.policy.opBytes({ seq, event }) > state.policy.maxOpBytes;
}

function coalesceIntoTail(state: WindowState, event: AgentTurnEvent): boolean {
  const tail = state.tail;
  if (tail === null) return false;
  const coalesced = state.policy.coalesceText(tail.event, event);
  if (coalesced === null) return false;
  if (overOpBound(state, tail.seq, coalesced)) return false;
  replaceRow(state, tail.seq, tail.event, coalesced);
  state.tail = { seq: tail.seq, event: coalesced };
  return true;
}

function placeEvent(state: WindowState, placement: AgentTurnSnapshotPlacement): void {
  if (supersedeInPlace(state, placement)) return;
  appendRow(state, placement.event);
}

function supersedeInPlace(state: WindowState, placement: AgentTurnSnapshotPlacement): boolean {
  if (placement.liveSlot === null) return false;
  if (state.tail !== null && isAgentTurnCoalescibleTextEvent(state.tail.event)) return false;
  const previous = state.live.get(placement.liveSlot);
  if (previous === undefined) {
    state.bounded = true;
    return false;
  }
  const merged = mergeSupersededAgentTurnEvent(previous, placement.event);
  if (merged === null) return false;
  if (overOpBound(state, placement.liveSlot, merged)) return false;
  replaceRow(state, placement.liveSlot, previous, merged);
  retainLiveSnapshot(state, placement.liveSlot, merged);
  return true;
}

function appendRow(state: WindowState, event: AgentTurnEvent): void {
  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  state.tail = { seq, event };
  state.totalBytes += state.policy.eventBytes(event);
  markDirty(state, seq, event);
  state.snapshots.adopt(event, seq);
  if (isAgentTurnSnapshotEvent(event)) retainLiveSnapshot(state, seq, event);
  trackIdentities(state, event);
}

function replaceRow(
  state: WindowState,
  seq: number,
  previous: AgentTurnEvent,
  event: AgentTurnEvent,
): void {
  state.totalBytes += state.policy.eventBytes(event) - state.policy.eventBytes(previous);
  markDirty(state, seq, event);
}

function markDirty(state: WindowState, seq: number, event: AgentTurnEvent): void {
  const replaced = state.dirty.get(seq);
  const previousBytes = replaced === undefined ? 0 : opBytes(state, seq, replaced);
  state.pendingBytes += opBytes(state, seq, event) - previousBytes;
  state.dirty.set(seq, event);
}

function retainLiveSnapshot(state: WindowState, seq: number, event: AgentTurnEvent): void {
  state.live.delete(seq);
  state.live.set(seq, event);
  while (state.live.size > state.maxLiveSnapshots) {
    const oldest = state.live.keys().next().value;
    if (oldest === undefined) return;
    state.step();
    state.live.delete(oldest);
    state.bounded = true;
  }
}

function trackIdentities(state: WindowState, event: AgentTurnEvent): void {
  if ("toolId" in event && event.toolId !== undefined) state.identities.add(event.toolId);
  if ("taskId" in event && event.taskId !== undefined) state.identities.add(event.taskId);
  if ("agentThreadId" in event) state.identities.add(event.agentThreadId);
  if (state.identities.size <= state.maxIdentities) return;
  state.identities.clear();
  state.live.clear();
  state.snapshots = createAgentTurnSnapshotIndex(state.step);
  state.bounded = true;
}

function opBytes(state: WindowState, seq: number, event: AgentTurnEvent): number {
  return state.policy.opBytes({ seq, event });
}

function pendingOf(state: WindowState): AgentTurnWindowPending {
  return { ops: state.dirty.size, bytes: state.pendingBytes };
}

function sortedSeqs(state: WindowState): ReadonlyArray<number> {
  return [...state.dirty.keys()].sort(ascending);
}

function ascending(left: number, right: number): number {
  return left - right;
}

function takeBatch(state: WindowState, maxOps: number, maxBytes: number): AgentTurnWindowBatch {
  const seqs = sortedSeqs(state);
  const ops: AgentTurnLogEntry[] = [];
  let bytes = EMPTY_BATCH_BYTES;
  for (const seq of seqs) {
    const event = state.dirty.get(seq);
    if (event === undefined) continue;
    if (ops.length >= maxOps) break;
    const size = opBytes(state, seq, event) + OP_SEPARATOR_BYTES;
    if (ops.length > 0 && bytes + size > maxBytes) break;
    ops.push({ seq, event });
    bytes += size;
  }
  const complete = ops.length === seqs.length;
  return { ops, digest: complete ? state.digest : null, complete };
}

function commitBatch(state: WindowState, batch: AgentTurnWindowBatch): void {
  for (const op of batch.ops) {
    state.step();
    const current = state.dirty.get(op.seq);
    if (current !== op.event) continue;
    state.dirty.delete(op.seq);
    state.pendingBytes -= opBytes(state, op.seq, current);
  }
  if (state.dirty.size === 0) state.pendingBytes = 0;
}

function clipRow(state: WindowState, seq: number): boolean {
  const current = state.dirty.get(seq);
  if (current === undefined) return false;
  if (current === CLIPPED_AGENT_TURN_LOG_ROW) return false;
  state.loss = { kind: "supervisorGap" };
  state.totalBytes +=
    state.policy.eventBytes(CLIPPED_AGENT_TURN_LOG_ROW) - state.policy.eventBytes(current);
  markDirty(state, seq, CLIPPED_AGENT_TURN_LOG_ROW);
  if (state.tail?.seq === seq) state.tail = { seq, event: CLIPPED_AGENT_TURN_LOG_ROW };
  return true;
}
