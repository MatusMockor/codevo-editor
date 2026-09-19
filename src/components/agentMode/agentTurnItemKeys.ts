const AGENT_TURN_ITEM_KEY_PREFIX = "e";
const AGENT_TURN_ITEM_KEY_PATTERN = /^e(-?\d{1,15})$/u;

export interface AgentTurnHydrationShift {
  readonly clientHeight: number;
  readonly insertionTops: ReadonlyArray<number>;
  readonly previousScrollHeight: number;
  readonly scrollHeight: number;
  readonly scrollTop: number;
}

export function normalizeAgentTurnEventOffset(offset: number | undefined): number {
  if (offset === undefined) return 0;
  if (!Number.isSafeInteger(offset)) return 0;
  if (offset > 0) return 0;
  return offset;
}

export function agentTurnItemKey(eventIndex: number, firstEventOffset = 0): string {
  const index = Number.isSafeInteger(eventIndex) && eventIndex >= 0 ? eventIndex : 0;
  return `${AGENT_TURN_ITEM_KEY_PREFIX}${index + normalizeAgentTurnEventOffset(firstEventOffset)}`;
}

export function agentTurnEventIndexFromKey(key: string, firstEventOffset = 0): number | null {
  const match = AGENT_TURN_ITEM_KEY_PATTERN.exec(key);
  if (match === null) return null;
  const parsed = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isSafeInteger(parsed)) return null;
  const index = parsed - normalizeAgentTurnEventOffset(firstEventOffset);
  if (!Number.isSafeInteger(index)) return null;
  if (index < 0) return null;
  return index;
}

export function agentTurnHydrationScrollTop(shift: AgentTurnHydrationShift): number | null {
  if (shift.insertionTops.length === 0) return null;
  if (!Number.isFinite(shift.scrollTop)) return null;
  if (!Number.isFinite(shift.scrollHeight)) return null;
  if (!Number.isFinite(shift.previousScrollHeight)) return null;
  if (!Number.isFinite(shift.clientHeight)) return null;
  const grown = shift.scrollHeight - shift.previousScrollHeight;
  if (grown <= 0) return null;
  const hidden = shift.insertionTops.every((top) => Number.isFinite(top) && top <= shift.scrollTop);
  if (!hidden) return null;
  const limit = Math.max(0, shift.scrollHeight - Math.max(0, shift.clientHeight));
  return Math.min(limit, Math.max(0, shift.scrollTop + grown));
}
