import { agentRootOwnerId } from "./agentProject";
import { parseAgentSubagentLifecycle, type AgentSubagentLifecycle } from "./agentSubagentLifecycle";
import { AGENT_TASK_ID_PATTERN, MAX_AGENT_TASK_PATH_BYTES } from "./agentTask";
import type { AgentTurnEvent } from "./agentThread";
import { parseTurnEvent, serializeTurnEvent } from "./agentThreadWire";
import {
  AGENT_TURN_DIGEST_VERSION,
  MAX_AGENT_TURN_DIGEST_CAPACITIES,
  MAX_AGENT_TURN_DIGEST_MODEL_BYTES,
  type AgentTurnDigestCapacity,
  type AgentTurnDigestContext,
  type AgentTurnDigestOccupancy,
  type AgentTurnDigestWire,
} from "./agentTurnDigest";
import {
  AGENT_TURN_LOG_FIRST_SEQ,
  AGENT_TURN_LOG_LIMITS,
  AGENT_TURN_LOG_SEQUENCE_GAP_PREFIX,
  AgentTurnLogBatchTooLargeError,
  AgentTurnLogFailure,
  isAgentTurnLogError,
  parseAgentTurnLogSequenceGap,
  type AgentTurnLogAnchor,
  type AgentTurnLogBudget,
  type AgentTurnLogEntry,
  type AgentTurnLogLease,
  type AgentTurnLogLoss,
  type AgentTurnLogPage,
  type AgentTurnLogScope,
  type AgentTurnLogSummary,
  type AppendAgentTurnLogReceipt,
  type AppendAgentTurnLogRequest,
  type DeleteAgentThreadLogRequest,
  type DeleteAgentThreadLogResult,
  type OpenAgentTurnLogRequest,
  type ReadAgentTurnLogPageRequest,
  type SummarizeAgentTurnLogsRequest,
} from "./agentTurnLog";
import type { AgentContextWindow } from "./agentContextWindow";

const UTF8_ENCODER = new TextEncoder();
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const OP_ENVELOPE_BYTES = '{"seq":,"event":}'.length;
const EMPTY_OPS_BYTES = "[]".length;
const EVENT_JSON_BYTES = new WeakMap<AgentTurnEvent & object, number>();
const BUDGETS = ["ok", "near", "evicting"] as const;
const PROVIDERS = ["claudeCode", "codex"] as const;
const ANCHOR_SEQ_POSITIONS = ["before", "after", "around"] as const;
const RUNTIME_ONLY_EVENT_FIELDS = ["remoteMessageId"] as const;

export interface AgentTurnLogEntryWire {
  readonly seq: number;
  readonly event: Record<string, unknown>;
}

export interface OpenAgentTurnLogRequestWire {
  readonly scope: AgentTurnLogScope;
  readonly priorLoss: AgentTurnLogLoss;
  readonly prompt: string | null;
}

export interface AppendAgentTurnLogRequestWire {
  readonly scope: AgentTurnLogScope;
  readonly writerEpoch: number;
  readonly expectedNextSeq: number;
  readonly ops: ReadonlyArray<AgentTurnLogEntryWire>;
  readonly digest: AgentTurnDigestWire | null;
  readonly seal: boolean;
  readonly loss: AgentTurnLogLoss;
  readonly lifecycle: AgentSubagentLifecycle | null;
}

export interface ReadAgentTurnLogPageRequestWire {
  readonly scope: AgentTurnLogScope;
  readonly anchor: AgentTurnLogAnchor;
  readonly maxEvents: number;
  readonly maxBytes: number;
}

export function agentTurnLogOpBytes(entry: AgentTurnLogEntry): number {
  return eventJsonBytes(entry.event) + OP_ENVELOPE_BYTES + String(entry.seq).length;
}

export function agentTurnLogOpsBytes(ops: ReadonlyArray<AgentTurnLogEntry>): number {
  if (ops.length === 0) return EMPTY_OPS_BYTES;
  let bytes = ops.length + 1;
  for (const op of ops) bytes += agentTurnLogOpBytes(op);
  return bytes;
}

function eventJsonBytes(event: AgentTurnEvent): number {
  const cached = EVENT_JSON_BYTES.get(event);
  if (cached !== undefined) return cached;
  const bytes = utf8Bytes(JSON.stringify(serializeTurnEvent(event)));
  EVENT_JSON_BYTES.set(event, bytes);
  return bytes;
}

export function validateOpenAgentTurnLogRequest(
  request: OpenAgentTurnLogRequest,
): OpenAgentTurnLogRequestWire {
  const value = record(request, "request");
  exactKeys(value, ["scope", "priorLoss", "prompt"], "request");
  return {
    scope: parseAgentTurnLogScope(value.scope, "request.scope"),
    priorLoss: parseAgentTurnLogLoss(value.priorLoss, "request.priorLoss"),
    prompt: promptText(value.prompt, "request.prompt"),
  };
}

export function validateAppendAgentTurnLogRequest(
  request: AppendAgentTurnLogRequest,
): AppendAgentTurnLogRequestWire {
  const value = record(request, "request");
  exactKeys(
    value,
    ["scope", "writerEpoch", "expectedNextSeq", "ops", "digest", "seal", "loss", "lifecycle"],
    "request",
  );
  const expectedNextSeq = integer(
    value.expectedNextSeq,
    "request.expectedNextSeq",
    AGENT_TURN_LOG_FIRST_SEQ,
    MAX_SAFE,
  );
  const ops = appendOps(value.ops, expectedNextSeq, "request.ops");
  return {
    scope: parseAgentTurnLogScope(value.scope, "request.scope"),
    writerEpoch: integer(value.writerEpoch, "request.writerEpoch", 1, MAX_SAFE),
    expectedNextSeq,
    ops,
    digest: optionalDigest(value.digest, "request.digest"),
    seal: booleanValue(value.seal, "request.seal"),
    loss: parseAgentTurnLogLoss(value.loss, "request.loss"),
    lifecycle: lifecycleSnapshot(value.lifecycle, "request.lifecycle"),
  };
}

export function validateReadAgentTurnLogPageRequest(
  request: ReadAgentTurnLogPageRequest,
): ReadAgentTurnLogPageRequestWire {
  const value = record(request, "request");
  exactKeys(value, ["scope", "anchor", "maxEvents", "maxBytes"], "request");
  return {
    scope: parseAgentTurnLogScope(value.scope, "request.scope"),
    anchor: parseAnchor(value.anchor, "request.anchor"),
    maxEvents: integer(value.maxEvents, "request.maxEvents", 1, AGENT_TURN_LOG_LIMITS.pageEvents),
    maxBytes: integer(value.maxBytes, "request.maxBytes", 1, AGENT_TURN_LOG_LIMITS.pageBytes),
  };
}

export function validateSummarizeAgentTurnLogsRequest(
  request: SummarizeAgentTurnLogsRequest,
): SummarizeAgentTurnLogsRequest {
  const value = record(request, "request");
  exactKeys(
    value,
    [
      "rootKey",
      "ownerId",
      "threadId",
      "includePrompts",
      "includeLifecycles",
      ...(Object.prototype.hasOwnProperty.call(value, "turnId") ? ["turnId"] : []),
    ],
    "request",
  );
  const rootKey = rootKeyText(value.rootKey, "request.rootKey");
  return {
    ...(Object.prototype.hasOwnProperty.call(value, "turnId")
      ? { turnId: identifier(value.turnId, "request.turnId") }
      : {}),
    rootKey,
    ownerId: ownerIdText(value.ownerId, rootKey, "request.ownerId"),
    threadId: identifier(value.threadId, "request.threadId"),
    includePrompts: booleanValue(value.includePrompts, "request.includePrompts"),
    includeLifecycles: booleanValue(value.includeLifecycles, "request.includeLifecycles"),
  };
}

export function validateDeleteAgentThreadLogRequest(
  request: DeleteAgentThreadLogRequest,
): DeleteAgentThreadLogRequest {
  const value = record(request, "request");
  exactKeys(value, ["rootKey", "ownerId", "threadId"], "request");
  const rootKey = rootKeyText(value.rootKey, "request.rootKey");
  return {
    rootKey,
    ownerId: ownerIdText(value.ownerId, rootKey, "request.ownerId"),
    threadId: identifier(value.threadId, "request.threadId"),
  };
}

export function parseDeleteAgentThreadLogResult(value: unknown): DeleteAgentThreadLogResult {
  const result = record(value, "result");
  exactKeys(result, ["deleted"], "result");
  return Object.freeze({ deleted: booleanValue(result.deleted, "result.deleted") });
}

export function parseAgentTurnLogLease(value: unknown): AgentTurnLogLease {
  const lease = record(value, "lease");
  exactKeys(lease, ["writerEpoch", "nextSeq", "digest", "digestThroughSeq"], "lease");
  const nextSeq = integer(lease.nextSeq, "lease.nextSeq", AGENT_TURN_LOG_FIRST_SEQ, MAX_SAFE);
  const digest = optionalDigest(lease.digest, "lease.digest");
  const digestThroughSeq = integer(lease.digestThroughSeq, "lease.digestThroughSeq", 0, MAX_SAFE);
  if (digest === null && digestThroughSeq !== 0)
    invalid("lease.digestThroughSeq", "0 without a digest");
  if (digest !== null && digestThroughSeq === 0)
    invalid("lease.digestThroughSeq", "the sequence the digest covers");
  if (digestThroughSeq > nextSeq - 1)
    invalid("lease.digestThroughSeq", "a sequence the log already holds");
  return Object.freeze({
    writerEpoch: integer(lease.writerEpoch, "lease.writerEpoch", 1, MAX_SAFE),
    nextSeq,
    digest,
    digestThroughSeq,
  });
}

export function parseAppendAgentTurnLogReceipt(value: unknown): AppendAgentTurnLogReceipt {
  const receipt = record(value, "receipt");
  exactKeys(receipt, ["persistedThroughSeq", "nextSeq", "turnBytes", "budget"], "receipt");
  const nextSeq = integer(receipt.nextSeq, "receipt.nextSeq", AGENT_TURN_LOG_FIRST_SEQ, MAX_SAFE);
  const persistedThroughSeq = integer(
    receipt.persistedThroughSeq,
    "receipt.persistedThroughSeq",
    0,
    MAX_SAFE,
  );
  if (persistedThroughSeq !== nextSeq - 1)
    invalid("receipt.persistedThroughSeq", "the sequence before the next sequence");
  return Object.freeze({
    persistedThroughSeq,
    nextSeq,
    turnBytes: integer(receipt.turnBytes, "receipt.turnBytes", 0, MAX_SAFE),
    budget: choice<AgentTurnLogBudget>(receipt.budget, BUDGETS, "receipt.budget"),
  });
}

export function parseAgentTurnLogPage(value: unknown): AgentTurnLogPage {
  const page = record(value, "page");
  exactKeys(
    page,
    ["entries", "firstSeq", "lastSeq", "hasEarlier", "hasLater", "loss", "clipped"],
    "page",
  );
  const entries = pageEntries(page.entries, "page.entries");
  const firstSeq = integer(page.firstSeq, "page.firstSeq", 0, MAX_SAFE);
  const lastSeq = integer(page.lastSeq, "page.lastSeq", 0, MAX_SAFE);
  const first = entries[0];
  const last = entries[entries.length - 1];
  if (first === undefined && (firstSeq !== 0 || lastSeq !== 0))
    invalid("page.firstSeq", "0 for an empty page");
  if (first !== undefined && firstSeq !== first.seq)
    invalid("page.firstSeq", "the sequence of the first entry");
  if (last !== undefined && lastSeq !== last.seq)
    invalid("page.lastSeq", "the sequence of the last entry");
  return Object.freeze({
    entries,
    firstSeq,
    lastSeq,
    hasEarlier: booleanValue(page.hasEarlier, "page.hasEarlier"),
    hasLater: booleanValue(page.hasLater, "page.hasLater"),
    loss: parseAgentTurnLogLoss(page.loss, "page.loss"),
    clipped: booleanValue(page.clipped, "page.clipped"),
  });
}

export function parseAgentTurnLogSummaries(value: unknown): ReadonlyArray<AgentTurnLogSummary> {
  if (!Array.isArray(value)) return invalid("summaries", "an array");
  if (value.length > AGENT_TURN_LOG_LIMITS.summaries)
    invalid("summaries", `at most ${AGENT_TURN_LOG_LIMITS.summaries} entries`);
  const seen = new Set<string>();
  let promptBytes = 0;
  let lifecycleBytes = 0;
  return Object.freeze(
    value.map((entry, index) => {
      const summary = parseAgentTurnLogSummary(entry, `summaries[${index}]`);
      if (seen.has(summary.turnId)) invalid(`summaries[${index}].turnId`, "a unique turn id");
      seen.add(summary.turnId);
      promptBytes += summary.prompt === null ? 0 : utf8Bytes(summary.prompt);
      if (promptBytes > AGENT_TURN_LOG_LIMITS.summaryPromptBytes) {
        invalid("summaries", `at most ${AGENT_TURN_LOG_LIMITS.summaryPromptBytes} prompt bytes`);
      }
      lifecycleBytes += summary.lifecycle === null ? 0 : lifecycleJsonBytes(summary.lifecycle);
      if (lifecycleBytes > AGENT_TURN_LOG_LIMITS.summaryLifecycleBytes) {
        invalid(
          "summaries",
          `at most ${AGENT_TURN_LOG_LIMITS.summaryLifecycleBytes} lifecycle bytes`,
        );
      }
      return summary;
    }),
  );
}

export function parseAgentTurnDigest(value: unknown, path = "digest"): AgentTurnDigestWire {
  const digest = record(value, path);
  exactKeys(digest, ["version", "context"], path);
  if (digest.version !== AGENT_TURN_DIGEST_VERSION)
    invalid(`${path}.version`, `version ${AGENT_TURN_DIGEST_VERSION}`);
  const parsed: AgentTurnDigestWire = {
    version: AGENT_TURN_DIGEST_VERSION,
    context: digestContext(digest.context, `${path}.context`),
  };
  if (utf8Bytes(JSON.stringify(parsed)) > AGENT_TURN_LOG_LIMITS.digestBytes)
    invalid(path, `at most ${AGENT_TURN_LOG_LIMITS.digestBytes} bytes`);
  return Object.freeze(parsed);
}

export function parseAgentTurnLogLoss(value: unknown, path = "loss"): AgentTurnLogLoss {
  const loss = record(value, path);
  const kind = loss.kind;
  if (kind === "diskBudget") {
    exactKeys(loss, ["kind", "atEpochMs"], path);
    return Object.freeze({
      kind: "diskBudget",
      atEpochMs: integer(loss.atEpochMs, `${path}.atEpochMs`, 0, MAX_SAFE),
    });
  }
  if (
    kind === "none" ||
    kind === "legacyWindow" ||
    kind === "supervisorGap" ||
    kind === "turnCeiling" ||
    kind === "unreadable"
  ) {
    exactKeys(loss, ["kind"], path);
    return Object.freeze({ kind });
  }
  return invalid(`${path}.kind`, "a known agent turn log loss");
}

export function parseAgentTurnLogScope(value: unknown, path = "scope"): AgentTurnLogScope {
  const scope = record(value, path);
  exactKeys(scope, ["rootKey", "ownerId", "threadId", "turnId"], path);
  const rootKey = rootKeyText(scope.rootKey, `${path}.rootKey`);
  return Object.freeze({
    rootKey,
    ownerId: ownerIdText(scope.ownerId, rootKey, `${path}.ownerId`),
    threadId: identifier(scope.threadId, `${path}.threadId`),
    turnId: identifier(scope.turnId, `${path}.turnId`),
  });
}

export function agentTurnLogFailureFrom(error: unknown): AgentTurnLogFailure | null {
  const code = failureText(error);
  if (code === null) return null;
  if (code.startsWith(AGENT_TURN_LOG_SEQUENCE_GAP_PREFIX))
    return new AgentTurnLogFailure("sequenceGap", parseAgentTurnLogSequenceGap(code));
  if (!isAgentTurnLogError(code)) return null;
  return new AgentTurnLogFailure(code);
}

function failureText(error: unknown): string | null {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return null;
}

function parseAgentTurnLogSummary(value: unknown, path: string): AgentTurnLogSummary {
  const summary = record(value, path);
  exactKeys(
    summary,
    [
      "turnId",
      "eventCount",
      "bytes",
      "loss",
      "sealed",
      "digest",
      "prompt",
      "promptOmitted",
      "lifecycle",
      "lifecycleOmitted",
    ],
    path,
  );
  const prompt = promptText(summary.prompt, `${path}.prompt`);
  const promptOmitted = booleanValue(summary.promptOmitted, `${path}.promptOmitted`);
  if (prompt !== null && promptOmitted)
    invalid(`${path}.promptOmitted`, "false when the summary carries a prompt");
  const lifecycle = lifecycleSnapshot(summary.lifecycle, `${path}.lifecycle`);
  const lifecycleOmitted = booleanValue(summary.lifecycleOmitted, `${path}.lifecycleOmitted`);
  if (lifecycle !== null && lifecycleOmitted)
    invalid(`${path}.lifecycleOmitted`, "false when the summary carries a lifecycle");
  return Object.freeze({
    turnId: identifier(summary.turnId, `${path}.turnId`),
    eventCount: integer(summary.eventCount, `${path}.eventCount`, 0, MAX_SAFE),
    bytes: integer(summary.bytes, `${path}.bytes`, 0, MAX_SAFE),
    loss: parseAgentTurnLogLoss(summary.loss, `${path}.loss`),
    sealed: booleanValue(summary.sealed, `${path}.sealed`),
    digest: optionalDigest(summary.digest, `${path}.digest`),
    prompt,
    promptOmitted,
    lifecycle,
    lifecycleOmitted,
  });
}

export function agentTurnLogLifecycleFits(lifecycle: AgentSubagentLifecycle): boolean {
  return lifecycleJsonBytes(lifecycle) <= AGENT_TURN_LOG_LIMITS.lifecycleBytes;
}

function lifecycleJsonBytes(lifecycle: AgentSubagentLifecycle): number {
  return utf8Bytes(JSON.stringify(lifecycle));
}

function lifecycleSnapshot(value: unknown, path: string): AgentSubagentLifecycle | null {
  if (value === null) return null;
  const parsed = strictLifecycle(value);
  if (parsed === null) return invalid(path, "a valid subagent lifecycle snapshot or null");
  if (!agentTurnLogLifecycleFits(parsed))
    invalid(path, `at most ${AGENT_TURN_LOG_LIMITS.lifecycleBytes} bytes`);
  return parsed;
}

function strictLifecycle(value: unknown): AgentSubagentLifecycle | null {
  if (value === undefined) return null;
  try {
    return parseAgentSubagentLifecycle(value) ?? null;
  } catch {
    return null;
  }
}

function promptText(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return invalid(path, "a prompt string or null");
  if (value.length === 0) return invalid(path, "a non-empty prompt");
  if (value.includes("\0")) return invalid(path, "a prompt without a NUL byte");
  if (utf8Bytes(value) > AGENT_TURN_LOG_LIMITS.promptBytes)
    invalid(path, `at most ${AGENT_TURN_LOG_LIMITS.promptBytes} bytes`);
  return value;
}

function appendOps(
  value: unknown,
  expectedNextSeq: number,
  path: string,
): ReadonlyArray<AgentTurnLogEntryWire> {
  if (!Array.isArray(value)) return invalid(path, "an array");
  if (value.length > AGENT_TURN_LOG_LIMITS.appendOps)
    invalid(path, `at most ${AGENT_TURN_LOG_LIMITS.appendOps} operations`);
  let previous = 0;
  let appended = expectedNextSeq;
  const ops = value.map((entry, index) => {
    const item = record(entry, `${path}[${index}]`);
    exactKeys(item, ["seq", "event"], `${path}[${index}]`);
    const seq = integer(item.seq, `${path}[${index}].seq`, AGENT_TURN_LOG_FIRST_SEQ, MAX_SAFE);
    if (seq <= previous) invalid(`${path}[${index}].seq`, "a sequence above the previous entry");
    previous = seq;
    if (seq >= expectedNextSeq) {
      if (seq !== appended)
        invalid(`${path}[${index}].seq`, "a contiguous sequence from the expected next sequence");
      appended += 1;
    }
    return { seq, event: wireEvent(item.event, `${path}[${index}].event`) };
  });
  const bytes = utf8Bytes(JSON.stringify(ops));
  if (bytes > AGENT_TURN_LOG_LIMITS.appendBytes)
    throw new AgentTurnLogBatchTooLargeError(path, bytes, AGENT_TURN_LOG_LIMITS.appendBytes);
  return Object.freeze(ops);
}

function pageEntries(value: unknown, path: string): ReadonlyArray<AgentTurnLogEntry> {
  if (!Array.isArray(value)) return invalid(path, "an array");
  if (value.length > AGENT_TURN_LOG_LIMITS.pageEvents)
    invalid(path, `at most ${AGENT_TURN_LOG_LIMITS.pageEvents} entries`);
  let previous = 0;
  const entries = value.map((entry, index) => {
    const item = record(entry, `${path}[${index}]`);
    exactKeys(item, ["seq", "event"], `${path}[${index}]`);
    const seq = integer(item.seq, `${path}[${index}].seq`, AGENT_TURN_LOG_FIRST_SEQ, MAX_SAFE);
    if (seq <= previous) invalid(`${path}[${index}].seq`, "a sequence above the previous entry");
    previous = seq;
    return { seq, event: parseTurnEvent(item.event, `${path}[${index}].event`) };
  });
  if (utf8Bytes(JSON.stringify(entries)) > AGENT_TURN_LOG_LIMITS.pageBytes)
    invalid(path, `at most ${AGENT_TURN_LOG_LIMITS.pageBytes} bytes`);
  return Object.freeze(entries);
}

function wireEvent(value: unknown, path: string): Record<string, unknown> {
  return serializeTurnEvent(parseTurnEvent(persistedEventShape(value, path), path));
}

function persistedEventShape(value: unknown, path: string): Record<string, unknown> {
  const event = record(value, path);
  return Object.fromEntries(
    Object.entries(event).filter(
      ([key]) => !RUNTIME_ONLY_EVENT_FIELDS.some((skip) => skip === key),
    ),
  );
}

function parseAnchor(value: unknown, path: string): AgentTurnLogAnchor {
  const anchor = record(value, path);
  if (anchor.at === "tail") {
    exactKeys(anchor, ["at"], path);
    return Object.freeze({ at: "tail" });
  }
  const at = choice(anchor.at, ANCHOR_SEQ_POSITIONS, `${path}.at`);
  exactKeys(anchor, ["at", "seq"], path);
  return Object.freeze({
    at,
    seq: integer(anchor.seq, `${path}.seq`, AGENT_TURN_LOG_FIRST_SEQ, MAX_SAFE),
  });
}

function digestContext(value: unknown, path: string): AgentTurnDigestContext {
  const context = record(value, path);
  exactKeys(context, ["provider", "capacities", "primary", "current", "bounded"], path);
  return Object.freeze({
    provider: choice(context.provider, PROVIDERS, `${path}.provider`),
    capacities: digestCapacities(context.capacities, `${path}.capacities`),
    primary: digestPrimary(context.primary, `${path}.primary`),
    current: digestWindow(context.current, `${path}.current`),
    bounded: booleanValue(context.bounded, `${path}.bounded`),
  });
}

function digestCapacities(value: unknown, path: string): ReadonlyArray<AgentTurnDigestCapacity> {
  if (!Array.isArray(value)) return invalid(path, "an array");
  if (value.length > MAX_AGENT_TURN_DIGEST_CAPACITIES)
    invalid(path, `at most ${MAX_AGENT_TURN_DIGEST_CAPACITIES} capacities`);
  const seen = new Set<string>();
  return Object.freeze(
    value.map((entry, index) => {
      const capacity = record(entry, `${path}[${index}]`);
      exactKeys(capacity, ["model", "contextWindow"], `${path}[${index}]`);
      const model = modelName(capacity.model, `${path}[${index}].model`);
      if (seen.has(model)) invalid(`${path}[${index}].model`, "a unique model");
      seen.add(model);
      return {
        model,
        contextWindow: integer(
          capacity.contextWindow,
          `${path}[${index}].contextWindow`,
          1,
          MAX_SAFE,
        ),
      };
    }),
  );
}

function digestPrimary(value: unknown, path: string): AgentTurnDigestOccupancy | null {
  if (value === null) return null;
  const primary = record(value, path);
  exactKeys(primary, ["model", "inputTokens"], path);
  return Object.freeze({
    model: modelName(primary.model, `${path}.model`),
    inputTokens: integer(primary.inputTokens, `${path}.inputTokens`, 0, MAX_SAFE),
  });
}

function digestWindow(value: unknown, path: string): AgentContextWindow | null {
  if (value === null) return null;
  const window = record(value, path);
  exactKeys(window, ["usedTokens", "contextWindow"], path);
  return Object.freeze({
    usedTokens: integer(window.usedTokens, `${path}.usedTokens`, 0, MAX_SAFE),
    contextWindow: integer(window.contextWindow, `${path}.contextWindow`, 1, MAX_SAFE),
  });
}

function optionalDigest(value: unknown, path: string): AgentTurnDigestWire | null {
  if (value === null) return null;
  return parseAgentTurnDigest(value, path);
}

function modelName(value: unknown, path: string): string {
  if (typeof value !== "string") return invalid(path, "a model name");
  if (value.length === 0) return invalid(path, "a non-empty model name");
  if (utf8Bytes(value) > MAX_AGENT_TURN_DIGEST_MODEL_BYTES)
    invalid(path, `at most ${MAX_AGENT_TURN_DIGEST_MODEL_BYTES} bytes`);
  return value;
}

function rootKeyText(value: unknown, path: string): string {
  if (typeof value !== "string") return invalid(path, "a root key string");
  if (value.length === 0) return invalid(path, "a non-empty root key");
  if (utf8Bytes(value) > MAX_AGENT_TASK_PATH_BYTES)
    invalid(path, `at most ${MAX_AGENT_TASK_PATH_BYTES} bytes`);
  if (/\p{Cc}|\p{Cf}/u.test(value)) invalid(path, "printable characters");
  return value;
}

function ownerIdText(value: unknown, rootKey: string, path: string): string {
  if (typeof value !== "string") return invalid(path, "an owner id string");
  if (value !== agentRootOwnerId(rootKey)) invalid(path, "the persistent agent root owner id");
  return value;
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== "string") return invalid(path, "an identifier string");
  if (!AGENT_TASK_ID_PATTERN.test(value)) invalid(path, "a safe agent identifier");
  return value;
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    return invalid(path, "a safe integer");
  if (value < minimum || value > maximum) return invalid(path, `${minimum} to ${maximum}`);
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return invalid(path, "a boolean");
  return value;
}

function choice<T extends string>(value: unknown, values: readonly T[], path: string): T {
  const match = values.find((candidate) => candidate === value);
  if (match === undefined) return invalid(path, `one of ${values.join(", ")}`);
  return match;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return invalid(path, "an object");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const expected = new Set<string>(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) invalid(`${path}.${key}`, "not present");
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) invalid(`${path}.${key}`, "present");
  }
}

function utf8Bytes(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(
    `Invalid agent turn log value at ${path.slice(0, 160)}: expected ${expectation.slice(0, 160)}.`,
  );
}
