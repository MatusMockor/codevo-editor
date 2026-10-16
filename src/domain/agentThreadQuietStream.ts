import type { AgentThread, AgentTurn, AgentTurnEvent } from "./agentThread";

type QuietEventKind = "assistantText" | "reasoning" | "contextUsage";

const QUIET_EVENT_KINDS: ReadonlySet<AgentTurnEvent["kind"]> = new Set<QuietEventKind>([
  "assistantText",
  "reasoning",
  "contextUsage",
]);

const STREAMED_TURN_FIELDS: ReadonlySet<string> = new Set([
  "events",
  "lastOutputSequence",
  "streamMetrics",
]);

export function agentThreadQuietlyStreamed(shown: AgentThread, next: AgentThread): boolean {
  if (shown === next) return true;
  if (shown.threadId !== next.threadId) return false;
  if (!sameFieldsExcept(shown, next, "turns")) return false;
  if (shown.turns.length !== next.turns.length) return false;
  let streamed = false;
  for (let index = 0; index < shown.turns.length; index += 1) {
    const before = shown.turns[index]!;
    const after = next.turns[index]!;
    if (before === after) continue;
    if (streamed) return false;
    if (!agentTurnQuietlyStreamed(before, after)) return false;
    streamed = true;
  }
  return true;
}

export function agentTurnQuietlyStreamed(shown: AgentTurn, next: AgentTurn): boolean {
  if (shown === next) return true;
  if (!sameTurnFacts(shown, next)) return false;
  return quietEventsAppended(shown.events, next.events);
}

function sameTurnFacts(shown: AgentTurn, next: AgentTurn): boolean {
  const keys = new Set([...Object.keys(shown), ...Object.keys(next)]);
  for (const key of keys) {
    if (STREAMED_TURN_FIELDS.has(key)) continue;
    if (!Object.is(fieldOf(shown, key), fieldOf(next, key))) return false;
  }
  return true;
}

function quietEventsAppended(
  shown: ReadonlyArray<AgentTurnEvent>,
  next: ReadonlyArray<AgentTurnEvent>,
): boolean {
  if (shown === next) return true;
  if (next.length < shown.length) return false;
  const lastIndex = shown.length - 1;
  for (let index = 0; index < lastIndex; index += 1) {
    if (shown[index] !== next[index]) return false;
  }
  const last = shown[lastIndex];
  const firstChanged =
    last === undefined || last === next[lastIndex] ? shown.length : coalescedAt(last, lastIndex);
  if (firstChanged < 0) return false;
  if (firstChanged === next.length) return true;
  let startsRootForeground = false;
  for (let index = firstChanged; index < next.length; index += 1) {
    const event = next[index]!;
    if (!QUIET_EVENT_KINDS.has(event.kind)) return false;
    if (rootForegroundStart(event)) startsRootForeground = true;
  }
  if (!startsRootForeground) return true;
  return rootForegroundAlreadyRunning(shown);

  function coalescedAt(previous: AgentTurnEvent, index: number): number {
    const replacement = next[index];
    if (replacement === undefined) return -1;
    if (!coalescedText(previous, replacement)) return -1;
    return index;
  }
}

function coalescedText(previous: AgentTurnEvent, replacement: AgentTurnEvent): boolean {
  if (previous.kind !== "assistantText" && previous.kind !== "reasoning") return false;
  if (replacement.kind !== previous.kind) return false;
  if (replacement.parentToolId !== previous.parentToolId) return false;
  return replacement.text.startsWith(previous.text);
}

function rootForegroundStart(event: AgentTurnEvent): boolean {
  if (event.kind !== "assistantText" && event.kind !== "reasoning") return false;
  return event.parentToolId === undefined;
}

function rootForegroundAlreadyRunning(events: ReadonlyArray<AgentTurnEvent>): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.kind === "result") return false;
    if (event.kind === "userMessage") return true;
    if (rootForegroundStart(event)) return true;
    if (event.kind === "toolCall" && event.parentToolId === undefined) return true;
  }
  return true;
}

function sameFieldsExcept(shown: AgentThread, next: AgentThread, skipped: keyof AgentThread) {
  const keys = new Set([...Object.keys(shown), ...Object.keys(next)]);
  for (const key of keys) {
    if (key === skipped) continue;
    if (!Object.is(fieldOf(shown, key), fieldOf(next, key))) return false;
  }
  return true;
}

function fieldOf(value: object, key: string): unknown {
  return (value as Readonly<Record<string, unknown>>)[key];
}
