export interface AgentTranscriptTurnPosition {
  readonly kind: "turn";
  readonly turnId: string;
  readonly offsetPx: number;
}

export type AgentTranscriptPosition = AgentTranscriptTurnPosition;

export interface AgentTranscriptPositionEntry {
  readonly threadId: string;
  readonly position: AgentTranscriptPosition;
}

export const AGENT_TRANSCRIPT_POSITIONS_VERSION = 1;
export const MAX_AGENT_TRANSCRIPT_POSITION_THREADS = 64;
export const MAX_AGENT_TRANSCRIPT_THREAD_ID_CHARS = 256;
export const MAX_AGENT_TRANSCRIPT_TURN_ID_CHARS = 512;
export const MAX_AGENT_TRANSCRIPT_OFFSET_PX = 1_000_000;
export const MAX_AGENT_TRANSCRIPT_POSITIONS_CHARS = 65_536;

const ROOT_KEYS = ["positions", "version"];
const ENTRY_KEYS = ["offsetPx", "threadId", "turnId"];
const NO_ENTRIES: ReadonlyArray<AgentTranscriptPositionEntry> = Object.freeze([]);

export function agentTranscriptTurnPosition(
  turnId: string,
  offsetPx: number,
): AgentTranscriptPosition | null {
  if (!validId(turnId, MAX_AGENT_TRANSCRIPT_TURN_ID_CHARS)) return null;
  if (!Number.isFinite(offsetPx)) return null;
  const bounded = Math.max(
    -MAX_AGENT_TRANSCRIPT_OFFSET_PX,
    Math.min(MAX_AGENT_TRANSCRIPT_OFFSET_PX, Math.round(offsetPx)),
  );
  return { kind: "turn", turnId, offsetPx: bounded === 0 ? 0 : bounded };
}

export function sameAgentTranscriptPosition(
  left: AgentTranscriptPosition | null,
  right: AgentTranscriptPosition | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.turnId === right.turnId && left.offsetPx === right.offsetPx;
}

const REMOTE_THREAD_PREFIX = "remote-thread:";

export function validAgentTranscriptThreadId(threadId: string): boolean {
  if (threadId.startsWith(REMOTE_THREAD_PREFIX)) return false;
  return validId(threadId, MAX_AGENT_TRANSCRIPT_THREAD_ID_CHARS);
}

export function boundAgentTranscriptPositionEntries(
  entries: ReadonlyArray<AgentTranscriptPositionEntry>,
): ReadonlyArray<AgentTranscriptPositionEntry> {
  const latest = new Map<string, AgentTranscriptPositionEntry>();
  for (const entry of entries) {
    if (!validAgentTranscriptThreadId(entry.threadId)) continue;
    const position = agentTranscriptTurnPosition(entry.position.turnId, entry.position.offsetPx);
    if (position === null) continue;
    latest.delete(entry.threadId);
    latest.set(entry.threadId, { threadId: entry.threadId, position });
  }
  const ordered = [...latest.values()];
  return ordered.slice(Math.max(0, ordered.length - MAX_AGENT_TRANSCRIPT_POSITION_THREADS));
}

export function serializeAgentTranscriptPositions(
  entries: ReadonlyArray<AgentTranscriptPositionEntry>,
): string {
  let kept = boundAgentTranscriptPositionEntries(entries);
  let raw = wireFormat(kept);
  while (raw.length > MAX_AGENT_TRANSCRIPT_POSITIONS_CHARS && kept.length > 0) {
    kept = kept.slice(1);
    raw = wireFormat(kept);
  }
  return raw;
}

export function parseAgentTranscriptPositions(
  raw: string | null,
): ReadonlyArray<AgentTranscriptPositionEntry> {
  if (raw === null || raw === "" || raw.length > MAX_AGENT_TRANSCRIPT_POSITIONS_CHARS) {
    return NO_ENTRIES;
  }
  const value = parseJson(raw);
  if (!isRecord(value) || !hasExactKeys(value, ROOT_KEYS)) return NO_ENTRIES;
  if (value.version !== AGENT_TRANSCRIPT_POSITIONS_VERSION) return NO_ENTRIES;
  if (!Array.isArray(value.positions)) return NO_ENTRIES;
  const entries: AgentTranscriptPositionEntry[] = [];
  for (const item of value.positions as ReadonlyArray<unknown>) {
    const entry = parseEntry(item);
    if (entry !== null) entries.push(entry);
  }
  return boundAgentTranscriptPositionEntries(entries);
}

function parseEntry(value: unknown): AgentTranscriptPositionEntry | null {
  if (!isRecord(value) || !hasExactKeys(value, ENTRY_KEYS)) return null;
  const { threadId, turnId, offsetPx } = value;
  if (typeof threadId !== "string" || !validAgentTranscriptThreadId(threadId)) return null;
  if (typeof turnId !== "string" || typeof offsetPx !== "number") return null;
  if (!Number.isInteger(offsetPx)) return null;
  const position = agentTranscriptTurnPosition(turnId, offsetPx);
  if (position === null) return null;
  return { threadId, position };
}

function wireFormat(entries: ReadonlyArray<AgentTranscriptPositionEntry>): string {
  return JSON.stringify({
    version: AGENT_TRANSCRIPT_POSITIONS_VERSION,
    positions: entries.map(({ threadId, position }) => ({
      threadId,
      turnId: position.turnId,
      offsetPx: position.offsetPx,
    })),
  });
}

function validId(value: string, maxChars: number): boolean {
  return value !== "" && value.length <= maxChars;
}

function hasExactKeys(value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
