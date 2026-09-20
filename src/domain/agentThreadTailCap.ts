import {
  agentPromptLooksClipped,
  clipAgentPromptForPersistence,
  clipUtf8Text,
  utf8ByteLength,
} from "./agentPromptClipping";
import type { AgentSubagentLifecycle } from "./agentSubagentLifecycle";
import { compactPersistedAgentSubagentLifecycle } from "./agentLifecyclePersistence";
import {
  isTerminalAgentTurnStatus,
  type AgentSubagentContentEvent,
  type AgentThread,
  type AgentTurn,
  type AgentTurnEvent,
} from "./agentThread";

export const MAX_PERSISTED_AGENT_EVENTS_PER_TURN = 512;
export const MAX_PERSISTED_AGENT_THREAD_FILE_BYTES = 1_024 * 1_024;
export const PERSISTED_AGENT_THREAD_FILE_MARGIN_BYTES = 64 * 1_024;
export const PERSISTED_AGENT_THREAD_FIT_SLACK_BYTES = 32 * 1_024;
export const MAX_PERSISTED_THREAD_EVENT_BYTES =
  MAX_PERSISTED_AGENT_THREAD_FILE_BYTES -
  PERSISTED_AGENT_THREAD_FILE_MARGIN_BYTES -
  PERSISTED_AGENT_THREAD_FIT_SLACK_BYTES;

const UTF8_ENCODER = new TextEncoder();
const PERSISTED_EVENT_SEPARATOR_BYTES = 1;
const persistedEventBytes = new WeakMap<AgentTurnEvent, number>();

const CLIPPED_EVENT_TEXT_STEPS: ReadonlyArray<number> = [4_096, 1_024, 256, 0];
const SETTLED_OUTPUT_TIER = 0;
const SETTLED_STEER_TIER = 1;
const LIVE_OUTPUT_TIER = 2;
const LIVE_STEER_TIER = 3;
const FINAL_ANSWER_TIER = 4;
const NO_GUARDED_EVENTS: ReadonlySet<number> = new Set<number>();
const NO_LOGGED_PROMPT_TURNS: ReadonlySet<string> = new Set<string>();
const NO_LOGGED_LIFECYCLES: ReadonlyMap<string, AgentSubagentLifecycle> = new Map();
const SACRIFICE_TIERS: ReadonlyArray<number> = [
  SETTLED_OUTPUT_TIER,
  SETTLED_STEER_TIER,
  LIVE_OUTPUT_TIER,
  LIVE_STEER_TIER,
  FINAL_ANSWER_TIER,
];

interface TailSlot {
  readonly source: AgentTurn;
  readonly settled: boolean;
  events: ReadonlyArray<AgentTurnEvent>;
  draft: AgentTurnEvent[] | null;
  bytes: number;
  clipped: boolean;
}

interface SacrificeCandidate {
  readonly slot: TailSlot;
  readonly position: number;
  readonly index: number;
  readonly tier: number;
  readonly bytes: number;
}

export function persistedAgentEventBytes(event: AgentTurnEvent): number {
  const cached = persistedEventBytes.get(event);
  if (cached !== undefined) return cached;
  const bytes =
    UTF8_ENCODER.encode(JSON.stringify(event)).byteLength + PERSISTED_EVENT_SEPARATOR_BYTES;
  persistedEventBytes.set(event, bytes);
  return bytes;
}

export function persistedAgentEventsBytes(events: ReadonlyArray<AgentTurnEvent>): number {
  return events.reduce((total, event) => total + persistedAgentEventBytes(event), 0);
}

export function persistedAgentThreadScaffoldBytes(thread: AgentThread): number {
  const withoutEvents = { ...thread, turns: thread.turns.map((turn) => ({ ...turn, events: [] })) };
  return UTF8_ENCODER.encode(JSON.stringify(withoutEvents)).byteLength;
}

export function capAgentThreadForPersistence(
  thread: AgentThread,
  eventBudgetBytes: number = MAX_PERSISTED_THREAD_EVENT_BYTES,
  loggedPromptTurnIds: ReadonlySet<string> = NO_LOGGED_PROMPT_TURNS,
  loggedLifecycles: ReadonlyMap<string, AgentSubagentLifecycle> = NO_LOGGED_LIFECYCLES,
): AgentThread {
  const lifecycleProjection = compactLoggedLifecycles(thread, eventBudgetBytes, loggedLifecycles);
  const projection = clipLoggedPrompts(lifecycleProjection, eventBudgetBytes, loggedPromptTurnIds);
  const projected = projection.thread;
  const slots = projected.turns.map(openSlot);
  fitThreadBudget(slots, Math.max(eventBudgetBytes - projection.scaffoldBytes, 0));
  let changed = false;
  const turns = slots.map((slot) => {
    const turn = closeSlot(slot);
    if (turn !== slot.source) changed = true;
    return turn;
  });
  if (!changed) return projected;
  return { ...projected, turns };
}

function compactLoggedLifecycles(
  thread: AgentThread,
  budgetBytes: number,
  loggedLifecycles: ReadonlyMap<string, AgentSubagentLifecycle>,
): AgentThread {
  if (loggedLifecycles.size === 0) return thread;
  let scaffold = persistedAgentThreadScaffoldBytes(thread);
  if (scaffold <= budgetBytes) return thread;
  const turns = [...thread.turns];
  let changed = false;
  for (let index = 0; index < turns.length && scaffold > budgetBytes; index += 1) {
    const turn = turns[index]!;
    if (!isTerminalAgentTurnStatus(turn.status)) continue;
    const lifecycle = turn.subagentLifecycle;
    const logged = loggedLifecycles.get(turn.turnId);
    if (lifecycle === undefined || logged === undefined) continue;
    const original = JSON.stringify(lifecycle);
    if (original !== JSON.stringify(logged)) continue;
    const compact = compactPersistedAgentSubagentLifecycle(lifecycle);
    if (compact === undefined) continue;
    const released = utf8ByteLength(original) - utf8ByteLength(JSON.stringify(compact));
    if (released <= 0) continue;
    scaffold -= released;
    turns[index] = { ...turn, subagentLifecycle: compact };
    changed = true;
  }
  if (!changed) return thread;
  return { ...thread, turns };
}

interface PromptProjection {
  readonly thread: AgentThread;
  readonly scaffoldBytes: number;
}

function clipLoggedPrompts(
  thread: AgentThread,
  budgetBytes: number,
  loggedPromptTurnIds: ReadonlySet<string>,
): PromptProjection {
  let scaffold = persistedAgentThreadScaffoldBytes(thread);
  if (loggedPromptTurnIds.size === 0) return { thread, scaffoldBytes: scaffold };
  if (scaffold <= budgetBytes) return { thread, scaffoldBytes: scaffold };
  const turns = [...thread.turns];
  const newest = turns.length - 1;
  let clipped = false;
  for (let index = 0; index < newest && scaffold > budgetBytes; index += 1) {
    const turn = turns[index]!;
    if (!isClippablePromptTurn(turn, loggedPromptTurnIds)) continue;
    const prompt = clipAgentPromptForPersistence(turn.prompt);
    if (prompt === null) continue;
    scaffold -= jsonTextBytes(turn.prompt) - jsonTextBytes(prompt);
    turns[index] = { ...turn, prompt };
    clipped = true;
  }
  if (!clipped) return { thread, scaffoldBytes: scaffold };
  return { thread: { ...thread, turns }, scaffoldBytes: scaffold };
}

function isClippablePromptTurn(turn: AgentTurn, loggedPromptTurnIds: ReadonlySet<string>): boolean {
  if (!isTerminalAgentTurnStatus(turn.status)) return false;
  if (!loggedPromptTurnIds.has(turn.turnId)) return false;
  return !agentPromptLooksClipped(turn.prompt);
}

function jsonTextBytes(text: string): number {
  return utf8ByteLength(JSON.stringify(text));
}

function openSlot(turn: AgentTurn): TailSlot {
  const events = capTurnTail(
    turn.events,
    MAX_PERSISTED_AGENT_EVENTS_PER_TURN,
    Number.POSITIVE_INFINITY,
  );
  return {
    source: turn,
    settled: isTerminalAgentTurnStatus(turn.status),
    events,
    draft: null,
    bytes: persistedAgentEventsBytes(events),
    clipped: false,
  };
}

function closeSlot(slot: TailSlot): AgentTurn {
  const truncated =
    slot.source.eventsTruncated || slot.clipped || slot.events.length < slot.source.events.length;
  const intact =
    !slot.clipped &&
    slot.events.length === slot.source.events.length &&
    truncated === slot.source.eventsTruncated;
  if (intact) return slot.source;
  return { ...slot.source, events: slot.events, eventsTruncated: truncated };
}

export function capTurnTail(
  events: ReadonlyArray<AgentTurnEvent>,
  maxEvents: number,
  maxBytes: number,
): ReadonlyArray<AgentTurnEvent> {
  if (events.length <= maxEvents && persistedAgentEventsBytes(events) <= maxBytes) return events;
  const kept = new Set<number>();
  let bytes = 0;
  const take = (index: number): boolean => {
    if (kept.has(index)) return true;
    if (kept.size >= maxEvents) return false;
    const size = persistedAgentEventBytes(events[index]!);
    if (kept.size > 0 && bytes + size > maxBytes) return false;
    kept.add(index);
    bytes += size;
    return true;
  };
  const closing = lastIndexOfKind(events, "result");
  if (closing !== null) take(closing);
  const answer = lastIndexOfKind(events, "assistantText");
  if (answer !== null) take(answer);
  for (let index = events.length - 1; index >= 0 && kept.size < maxEvents; index -= 1) {
    if (events[index]?.kind !== "userMessage") continue;
    take(index);
  }
  for (let index = events.length - 1; index >= 0 && kept.size < maxEvents; index -= 1) {
    take(index);
  }
  return events.filter((_event, index) => kept.has(index));
}

export function agentTurnSkeletonEvents(
  events: ReadonlyArray<AgentTurnEvent>,
): ReadonlyArray<AgentTurnEvent> {
  const kept = new Set<number>();
  for (let index = 0; index < events.length; index += 1) {
    if (events[index]?.kind === "userMessage") kept.add(index);
  }
  const closing = lastIndexOfKind(events, "result");
  if (closing !== null) kept.add(closing);
  const answer = lastIndexOfKind(events, "assistantText");
  if (answer !== null) kept.add(answer);
  return events.filter((_event, index) => kept.has(index));
}

function lastIndexOfKind(
  events: ReadonlyArray<AgentTurnEvent>,
  kind: AgentTurnEvent["kind"],
): number | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.kind === kind) return index;
  }
  return null;
}

function fitThreadBudget(slots: ReadonlyArray<TailSlot>, budgetBytes: number): void {
  let total = slots.reduce((sum, slot) => sum + slot.bytes, 0);
  if (total <= budgetBytes) return;
  for (const slot of slots) {
    if (total <= budgetBytes) return;
    if (!slot.settled) continue;
    total -= shrinkToSkeleton(slot);
  }
  total = dropOldestEvents(slots, total, budgetBytes, false);
  total = dropOldestEvents(slots, total, budgetBytes, true);
  if (total <= budgetBytes) return;
  const candidates = rankSacrifice(slots);
  total = clipRetainedText(candidates, total, budgetBytes);
  if (total <= budgetBytes) return;
  dropSacrificedEvents(candidates, total, budgetBytes);
}

function shrinkToSkeleton(slot: TailSlot): number {
  return replaceEvents(slot, agentTurnSkeletonEvents(slot.events));
}

function replaceEvents(slot: TailSlot, events: ReadonlyArray<AgentTurnEvent>): number {
  const bytes = persistedAgentEventsBytes(events);
  const released = slot.bytes - bytes;
  slot.events = events;
  slot.draft = null;
  slot.bytes = bytes;
  return released;
}

function draftEvents(slot: TailSlot): AgentTurnEvent[] {
  if (slot.draft !== null) return slot.draft;
  const draft = [...slot.events];
  slot.draft = draft;
  slot.events = draft;
  return draft;
}

function dropOldestEvents(
  slots: ReadonlyArray<TailSlot>,
  startingTotal: number,
  budgetBytes: number,
  sacrificePinned: boolean,
): number {
  let total = startingTotal;
  const newest = slots[slots.length - 1];
  for (const slot of slots) {
    if (total <= budgetBytes) return total;
    const guarded = slot === newest ? finalAnswerIndices(slot.events) : NO_GUARDED_EVENTS;
    const retained: AgentTurnEvent[] = [];
    for (let index = 0; index < slot.events.length; index += 1) {
      const event = slot.events[index]!;
      const droppable =
        total > budgetBytes &&
        index < slot.events.length - 1 &&
        !guarded.has(index) &&
        (sacrificePinned || event.kind !== "userMessage");
      if (!droppable) {
        retained.push(event);
        continue;
      }
      total -= persistedAgentEventBytes(event);
    }
    if (retained.length === slot.events.length) continue;
    replaceEvents(slot, retained);
  }
  return total;
}

function rankSacrifice(slots: ReadonlyArray<TailSlot>): ReadonlyArray<SacrificeCandidate> {
  const candidates: SacrificeCandidate[] = [];
  const newest = slots.length - 1;
  slots.forEach((slot, position) => {
    const guarded = position === newest ? finalAnswerIndices(slot.events) : NO_GUARDED_EVENTS;
    slot.events.forEach((event, index) => {
      candidates.push({
        slot,
        position,
        index,
        tier: sacrificeTier(slot, event, guarded.has(index)),
        bytes: persistedAgentEventBytes(event),
      });
    });
  });
  return candidates.sort(compareSacrifice);
}

function finalAnswerIndices(events: ReadonlyArray<AgentTurnEvent>): Set<number> {
  const guarded = new Set<number>();
  const answer = lastIndexOfKind(events, "assistantText");
  if (answer !== null) guarded.add(answer);
  const closing = lastIndexOfKind(events, "result");
  if (closing !== null) guarded.add(closing);
  return guarded;
}

function sacrificeTier(slot: TailSlot, event: AgentTurnEvent, guarded: boolean): number {
  if (guarded) return FINAL_ANSWER_TIER;
  if (slot.settled && event.kind !== "userMessage") return SETTLED_OUTPUT_TIER;
  if (slot.settled) return SETTLED_STEER_TIER;
  if (event.kind !== "userMessage") return LIVE_OUTPUT_TIER;
  return LIVE_STEER_TIER;
}

function compareSacrifice(left: SacrificeCandidate, right: SacrificeCandidate): number {
  if (left.tier !== right.tier) return left.tier - right.tier;
  if (left.position !== right.position) return left.position - right.position;
  if (left.bytes !== right.bytes) return right.bytes - left.bytes;
  return left.index - right.index;
}

function clipRetainedText(
  candidates: ReadonlyArray<SacrificeCandidate>,
  startingTotal: number,
  budgetBytes: number,
): number {
  let total = startingTotal;
  for (const tier of SACRIFICE_TIERS) {
    const ranked = candidates.filter((candidate) => candidate.tier === tier);
    for (const limitBytes of CLIPPED_EVENT_TEXT_STEPS) {
      for (const candidate of ranked) {
        if (total <= budgetBytes) return total;
        total -= clipCandidate(candidate, limitBytes);
      }
    }
  }
  return total;
}

function clipCandidate(candidate: SacrificeCandidate, limitBytes: number): number {
  const event = candidate.slot.events[candidate.index];
  if (event === undefined) return 0;
  const before = persistedAgentEventBytes(event);
  if (before <= limitBytes) return 0;
  const clipped = clipEventText(event, limitBytes);
  if (clipped === null) return 0;
  const after = persistedAgentEventBytes(clipped);
  if (after >= before) return 0;
  draftEvents(candidate.slot)[candidate.index] = clipped;
  candidate.slot.bytes -= before - after;
  candidate.slot.clipped = true;
  return before - after;
}

function dropSacrificedEvents(
  candidates: ReadonlyArray<SacrificeCandidate>,
  startingTotal: number,
  budgetBytes: number,
): number {
  let total = startingTotal;
  const sacrificed = new Map<TailSlot, Set<number>>();
  for (const candidate of candidates) {
    if (total <= budgetBytes) break;
    const event = candidate.slot.events[candidate.index];
    if (event === undefined) continue;
    const indices = sacrificed.get(candidate.slot) ?? new Set<number>();
    indices.add(candidate.index);
    sacrificed.set(candidate.slot, indices);
    total -= persistedAgentEventBytes(event);
  }
  for (const [slot, indices] of sacrificed) {
    replaceEvents(
      slot,
      slot.events.filter((_event, index) => !indices.has(index)),
    );
  }
  return total;
}

function clipEventText(event: AgentTurnEvent, limitBytes: number): AgentTurnEvent | null {
  switch (event.kind) {
    case "assistantText":
    case "reasoning":
    case "userMessage":
    case "result": {
      const text = clipUtf8Text(event.text, limitBytes);
      if (text === event.text) return null;
      return { ...event, text };
    }
    case "error": {
      const message = clipUtf8Text(event.message, limitBytes);
      if (message === event.message) return null;
      return { ...event, message };
    }
    case "contextCompactionStatus": {
      if (event.message === null) return null;
      const message = clipUtf8Text(event.message, limitBytes);
      if (message === event.message) return null;
      return { ...event, message };
    }
    case "unknownLine": {
      const raw = clipUtf8Text(event.raw, limitBytes);
      if (raw === event.raw) return null;
      return { ...event, raw, clipped: true };
    }
    case "toolCall": {
      const inputSummary = clipUtf8Text(event.inputSummary, limitBytes);
      if (inputSummary === event.inputSummary) return null;
      return { ...event, inputSummary };
    }
    case "toolResult": {
      const outputSummary = clipUtf8Text(event.outputSummary, limitBytes);
      if (outputSummary === event.outputSummary) return null;
      return { ...event, outputSummary };
    }
    case "subagentEvent": {
      const inner = clipEventText(event.event, limitBytes);
      if (inner === null) return null;
      if (!isSubagentContentEvent(inner)) return null;
      return { ...event, event: inner };
    }
    case "backgroundTask":
    case "subagent":
    case "subagentActivity":
    case "subagentUsage":
    case "subagentTurnDone":
    case "queued":
    case "contextUsage":
    case "contextCompaction":
      return null;
    default:
      return unclippableEvent(event);
  }
}

function isSubagentContentEvent(event: AgentTurnEvent): event is AgentSubagentContentEvent {
  return (
    event.kind === "assistantText" ||
    event.kind === "reasoning" ||
    event.kind === "toolCall" ||
    event.kind === "toolResult"
  );
}

function unclippableEvent(event: never): never {
  throw new TypeError(`Unsupported agent turn event: ${JSON.stringify(event)}.`);
}
