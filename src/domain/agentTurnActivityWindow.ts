import {
  MAX_AGENT_EVENT_BYTES_PER_TURN,
  agentTurnEventUtf8Bytes,
  coalesceAgentTextEvents,
  type AgentTurnEvent,
} from "./agentThread";
import {
  AGENT_TURN_LOG_LIMITS,
  type AgentTurnLogAnchor,
  type AgentTurnLogEntry,
  type AgentTurnLogLoss,
  type AgentTurnLogPage,
} from "./agentTurnLog";

export const MAX_AGENT_TURN_ACTIVITY_WINDOW_ENTRIES = 1_000;
export const MAX_AGENT_TURN_ACTIVITY_WINDOW_BYTES = MAX_AGENT_EVENT_BYTES_PER_TURN;
export const MAX_AGENT_TURN_ACTIVITY_OPEN_PAGES = 16;

const AGENT_SNAPSHOT_TOOL_NAMES: ReadonlySet<string> = new Set(["TodoWrite", "update_plan"]);

export interface AgentTurnActivityWindow {
  readonly entries: ReadonlyArray<AgentTurnLogEntry>;
  readonly bytes: number;
  readonly hasEarlier: boolean;
  readonly hasLater: boolean;
  readonly gap: boolean;
  readonly loss: AgentTurnLogLoss;
  readonly clipped: boolean;
}

export type AgentTurnActivityRejection =
  "oversized" | "unordered" | "inconsistent" | "notAdvancing";

export interface AgentTurnActivityWindowEvents {
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly seqs: ReadonlyArray<number>;
}

export function agentTurnActivityPageRejection(
  page: AgentTurnLogPage,
  anchor: AgentTurnLogAnchor,
): AgentTurnActivityRejection | null {
  if (page.entries.length > AGENT_TURN_LOG_LIMITS.pageEvents) return "oversized";
  if (!ascending(page.entries)) return "unordered";
  const first = page.entries[0];
  const last = page.entries[page.entries.length - 1];
  if (first === undefined || last === undefined) return emptyPageRejection(page, anchor);
  if (first.seq !== page.firstSeq || last.seq !== page.lastSeq) return "inconsistent";
  if (anchor.at === "before" && page.lastSeq >= anchor.seq) return "notAdvancing";
  if (anchor.at === "after" && page.firstSeq <= anchor.seq) return "notAdvancing";
  return null;
}

export function agentTurnActivityPageBytes(page: AgentTurnLogPage): number {
  return entriesBytes(page.entries);
}

export function openAgentTurnActivityWindow(page: AgentTurnLogPage): AgentTurnActivityWindow {
  return evictNewest({
    entries: page.entries,
    bytes: entriesBytes(page.entries),
    hasEarlier: page.hasEarlier,
    hasLater: page.hasLater,
    gap: false,
    loss: page.loss,
    clipped: page.clipped,
  });
}

export function prependAgentTurnActivityPage(
  window: AgentTurnActivityWindow,
  page: AgentTurnLogPage,
): AgentTurnActivityWindow {
  const first = window.entries[0];
  const joinedGap =
    first !== undefined && page.entries.length > 0 && page.lastSeq + 1 !== first.seq;
  return evictNewest({
    entries: [...page.entries, ...window.entries],
    bytes: window.bytes + entriesBytes(page.entries),
    hasEarlier: page.hasEarlier,
    hasLater: window.hasLater,
    gap: window.gap || joinedGap,
    loss: firstLoss(window.loss, page.loss),
    clipped: window.clipped || page.clipped,
  });
}

export function appendAgentTurnActivityPage(
  window: AgentTurnActivityWindow,
  page: AgentTurnLogPage,
): AgentTurnActivityWindow {
  const last = window.entries[window.entries.length - 1];
  const joinedGap = last !== undefined && page.entries.length > 0 && page.firstSeq !== last.seq + 1;
  return evictEarliest({
    entries: [...window.entries, ...page.entries],
    bytes: window.bytes + entriesBytes(page.entries),
    hasEarlier: window.hasEarlier,
    hasLater: page.hasLater,
    gap: window.gap || joinedGap,
    loss: firstLoss(window.loss, page.loss),
    clipped: window.clipped || page.clipped,
  });
}

export function agentTurnActivityWindowFirstSeq(window: AgentTurnActivityWindow): number | null {
  return window.entries[0]?.seq ?? null;
}

export function agentTurnActivityWindowLastSeq(window: AgentTurnActivityWindow): number | null {
  return window.entries[window.entries.length - 1]?.seq ?? null;
}

export function agentTurnActivityWindowEvents(
  window: AgentTurnActivityWindow,
): AgentTurnActivityWindowEvents {
  const events: AgentTurnEvent[] = [];
  const seqs: number[] = [];
  for (const entry of window.entries) {
    const previous = events[events.length - 1];
    const merged = previous === undefined ? null : coalesceAgentTextEvents(previous, entry.event);
    if (merged !== null) {
      events[events.length - 1] = merged;
      continue;
    }
    if (supersedesSettledSnapshot(events, entry.event)) {
      events.pop();
      seqs.pop();
      events[events.length - 1] = entry.event;
      continue;
    }
    events.push(entry.event);
    seqs.push(entry.seq);
  }
  return { events, seqs };
}

function supersedesSettledSnapshot(
  events: ReadonlyArray<AgentTurnEvent>,
  next: AgentTurnEvent,
): boolean {
  if (next.kind !== "toolCall" || !AGENT_SNAPSHOT_TOOL_NAMES.has(next.name)) return false;
  const call = events[events.length - 2];
  const result = events[events.length - 1];
  if (call?.kind !== "toolCall" || result?.kind !== "toolResult") return false;
  if (call.name !== next.name || call.parentToolId !== next.parentToolId) return false;
  return result.toolId === call.toolId && result.parentToolId === call.parentToolId;
}

function emptyPageRejection(
  page: AgentTurnLogPage,
  anchor: AgentTurnLogAnchor,
): AgentTurnActivityRejection | null {
  if (anchor.at === "before" && page.hasEarlier) return "notAdvancing";
  if (anchor.at === "after" && page.hasLater) return "notAdvancing";
  return null;
}

function ascending(entries: ReadonlyArray<AgentTurnLogEntry>): boolean {
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (previous === undefined || current === undefined) return false;
    if (current.seq <= previous.seq) return false;
  }
  return true;
}

function entriesBytes(entries: ReadonlyArray<AgentTurnLogEntry>): number {
  return entries.reduce((total, entry) => total + agentTurnEventUtf8Bytes(entry.event), 0);
}

function firstLoss(current: AgentTurnLogLoss, next: AgentTurnLogLoss): AgentTurnLogLoss {
  if (current.kind !== "none") return current;
  return next;
}

function overCap(count: number, bytes: number): boolean {
  if (count > MAX_AGENT_TURN_ACTIVITY_WINDOW_ENTRIES) return true;
  return bytes > MAX_AGENT_TURN_ACTIVITY_WINDOW_BYTES;
}

function evictNewest(window: AgentTurnActivityWindow): AgentTurnActivityWindow {
  let end = window.entries.length;
  let bytes = window.bytes;
  while (end > 1 && overCap(end, bytes)) {
    end -= 1;
    const dropped = window.entries[end];
    if (dropped !== undefined) bytes -= agentTurnEventUtf8Bytes(dropped.event);
  }
  if (end === window.entries.length) return window;
  return { ...window, entries: window.entries.slice(0, end), bytes, hasLater: true };
}

function evictEarliest(window: AgentTurnActivityWindow): AgentTurnActivityWindow {
  let start = 0;
  let bytes = window.bytes;
  while (window.entries.length - start > 1 && overCap(window.entries.length - start, bytes)) {
    const dropped = window.entries[start];
    if (dropped !== undefined) bytes -= agentTurnEventUtf8Bytes(dropped.event);
    start += 1;
  }
  if (start === 0) return window;
  return { ...window, entries: window.entries.slice(start), bytes, hasEarlier: true };
}
