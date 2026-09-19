import type { AgentTurnEvent } from "./agentThread";
import type { AgentTurnDigestWire } from "./agentTurnDigest";

export const AGENT_TURN_LOG_FIRST_SEQ = 1;

export const AGENT_TURN_LOG_LIMITS = {
  appendOps: 256,
  appendBytes: 1_048_576,
  pageEvents: 200,
  pageBytes: 524_288,
  digestBytes: 65_536,
  digestCapacities: 16,
  summaries: 64,
  promptBytes: 32_768,
  summaryPromptBytes: 524_288,
  rootKeyBytes: 4_096,
  idBytes: 64,
  turnCeilingBytes: 268_435_456,
} as const;

export type AgentTurnLogLoss =
  | { readonly kind: "none" }
  | { readonly kind: "legacyWindow" }
  | { readonly kind: "supervisorGap" }
  | { readonly kind: "diskBudget"; readonly atEpochMs: number }
  | { readonly kind: "turnCeiling" }
  | { readonly kind: "unreadable" };

export interface AgentTurnLogScope {
  readonly rootKey: string;
  readonly ownerId: string;
  readonly threadId: string;
  readonly turnId: string;
}

export interface AgentTurnLogEntry {
  readonly seq: number;
  readonly event: AgentTurnEvent;
}

export interface OpenAgentTurnLogRequest {
  readonly scope: AgentTurnLogScope;
  readonly priorLoss: AgentTurnLogLoss;
  readonly prompt: string | null;
}

export interface AgentTurnLogLease {
  readonly writerEpoch: number;
  readonly nextSeq: number;
  readonly digest: AgentTurnDigestWire | null;
  readonly digestThroughSeq: number;
}

export interface AppendAgentTurnLogRequest {
  readonly scope: AgentTurnLogScope;
  readonly writerEpoch: number;
  readonly expectedNextSeq: number;
  readonly ops: ReadonlyArray<AgentTurnLogEntry>;
  readonly digest: AgentTurnDigestWire | null;
  readonly seal: boolean;
  readonly loss: AgentTurnLogLoss;
}

export type AgentTurnLogBudget = "ok" | "near" | "evicting";

export interface AppendAgentTurnLogReceipt {
  readonly persistedThroughSeq: number;
  readonly nextSeq: number;
  readonly turnBytes: number;
  readonly budget: AgentTurnLogBudget;
}

export type AgentTurnLogAnchor =
  | { readonly at: "tail" }
  | { readonly at: "before"; readonly seq: number }
  | { readonly at: "after"; readonly seq: number }
  | { readonly at: "around"; readonly seq: number };

export interface ReadAgentTurnLogPageRequest {
  readonly scope: AgentTurnLogScope;
  readonly anchor: AgentTurnLogAnchor;
  readonly maxEvents: number;
  readonly maxBytes: number;
}

export interface AgentTurnLogPage {
  readonly entries: ReadonlyArray<AgentTurnLogEntry>;
  readonly firstSeq: number;
  readonly lastSeq: number;
  readonly hasEarlier: boolean;
  readonly hasLater: boolean;
  readonly loss: AgentTurnLogLoss;
  readonly clipped: boolean;
}

export interface SummarizeAgentTurnLogsRequest {
  readonly rootKey: string;
  readonly ownerId: string;
  readonly threadId: string;
  readonly includePrompts: boolean;
}

export interface DeleteAgentThreadLogRequest {
  readonly rootKey: string;
  readonly ownerId: string;
  readonly threadId: string;
}

export interface DeleteAgentThreadLogResult {
  readonly deleted: boolean;
}

export interface AgentTurnLogSummary {
  readonly turnId: string;
  readonly eventCount: number;
  readonly bytes: number;
  readonly loss: AgentTurnLogLoss;
  readonly sealed: boolean;
  readonly digest: AgentTurnDigestWire | null;
  readonly prompt: string | null;
  readonly promptOmitted: boolean;
}

export const AGENT_TURN_LOG_ERRORS = [
  "supersededWriter",
  "sequenceGap",
  "sealed",
  "ownerMismatch",
  "budgetExhausted",
  "diskFull",
  "foreign",
  "unreadable",
  "busy",
] as const;

export type AgentTurnLogError = (typeof AGENT_TURN_LOG_ERRORS)[number];

export const AGENT_TURN_LOG_SEQUENCE_GAP_PREFIX = "sequenceGap:";

export const NO_AGENT_TURN_LOG_LOSS: AgentTurnLogLoss = Object.freeze({ kind: "none" });

export function isAgentTurnLogError(value: unknown): value is AgentTurnLogError {
  return AGENT_TURN_LOG_ERRORS.some((code) => code === value);
}

export class AgentTurnLogFailure extends Error {
  readonly code: AgentTurnLogError;
  readonly nextSeq: number | null;

  constructor(code: AgentTurnLogError, nextSeq: number | null = null) {
    super(`Agent turn log refused the request: ${code}.`);
    this.name = "AgentTurnLogFailure";
    this.code = code;
    this.nextSeq = nextSeq;
  }
}

export class AgentTurnLogBatchTooLargeError extends TypeError {
  readonly bytes: number;
  readonly maxBytes: number;

  constructor(path: string, bytes: number, maxBytes: number) {
    super(`Invalid agent turn log value at ${path}: expected at most ${maxBytes} bytes.`);
    this.name = "AgentTurnLogBatchTooLargeError";
    this.bytes = bytes;
    this.maxBytes = maxBytes;
  }
}

export function isAgentTurnLogBatchTooLarge(error: unknown): boolean {
  return error instanceof AgentTurnLogBatchTooLargeError;
}

export function agentTurnLogFailureCode(error: unknown): AgentTurnLogError | null {
  if (error instanceof AgentTurnLogFailure) return error.code;
  return null;
}

export function agentTurnLogFailureNextSeq(error: unknown): number | null {
  if (error instanceof AgentTurnLogFailure) return error.nextSeq;
  return null;
}

export function parseAgentTurnLogSequenceGap(text: string): number | null {
  if (!text.startsWith(AGENT_TURN_LOG_SEQUENCE_GAP_PREFIX)) return null;
  const digits = text.slice(AGENT_TURN_LOG_SEQUENCE_GAP_PREFIX.length);
  if (!/^[1-9][0-9]{0,18}$/u.test(digits)) return null;
  const nextSeq = Number(digits);
  if (!Number.isSafeInteger(nextSeq)) return null;
  if (nextSeq < AGENT_TURN_LOG_FIRST_SEQ) return null;
  return nextSeq;
}
