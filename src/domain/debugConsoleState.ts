import {
  MAX_DEBUG_EVALUATION_ERROR_BYTES,
  MAX_DEBUG_EVALUATION_EXPRESSION_BYTES,
  MAX_DEBUG_EVALUATION_TYPE_BYTES,
  MAX_DEBUG_EVALUATION_VALUE_BYTES,
  debugEvaluationOwnersEqual,
  debugUtf8ByteLength,
  validateDebugExpression,
  type DebugEvaluationErrorKind,
  type DebugEvaluationOwner,
  type DebugEvaluationResult,
} from "./debugEvaluationPolicy";

export const MAX_DEBUG_CONSOLE_ENTRIES = 1_000;
export const MAX_DEBUG_CONSOLE_BYTES = 5 * 1_024 * 1_024;
export const MAX_DEBUG_CONSOLE_HISTORY = 100;
export const MAX_DEBUG_CONSOLE_OUTPUT_BYTES = 64 * 1_024;
export const MAX_DEBUG_CONSOLE_REQUEST_ID_BYTES = 128;

export interface DebugConsoleResultOwner extends DebugEvaluationOwner {
  readonly epoch: number;
  readonly frameId: number;
  readonly rootKey: string;
  readonly workspaceOwnerKey: string;
}

const UTF8_ENCODER = new TextEncoder();
const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const MAX_DEBUG_CONSOLE_HISTORY_SERIALIZED_CHARS =
  MAX_DEBUG_CONSOLE_HISTORY * (MAX_DEBUG_EVALUATION_EXPRESSION_BYTES * 6 + 3) + 1;

interface DebugConsoleEntryBase {
  readonly id: string;
  readonly owner: DebugEvaluationOwner;
  readonly sequence: number;
}

export type DebugConsoleEntry =
  | (DebugConsoleEntryBase & { readonly kind: "stdout" | "stderr"; readonly text: string })
  | (DebugConsoleEntryBase & {
      readonly kind: "pending";
      readonly requestId: string;
      readonly expression: string;
      readonly resultOwner?: DebugConsoleResultOwner;
    })
  | (DebugConsoleEntryBase & {
      readonly kind: "result";
      readonly requestId: string;
      readonly value: string;
      readonly valueType: string | null;
      readonly evaluateName?: string;
      readonly variablesReference: number;
      readonly resultOwner?: DebugConsoleResultOwner;
    })
  | (DebugConsoleEntryBase & {
      readonly kind: "error";
      readonly requestId: string;
      readonly errorKind: DebugEvaluationErrorKind;
      readonly message: string;
    })
  | (DebugConsoleEntryBase & {
      readonly kind: "truncated";
      readonly omittedEntries: number;
      readonly omittedBytes: number;
    });

export interface DebugConsoleState {
  readonly owner: DebugEvaluationOwner | null;
  readonly entries: readonly DebugConsoleEntry[];
  readonly history: readonly string[];
  readonly pendingRequestIds: readonly string[];
  readonly nextSequence: number;
  readonly totalBytes: number;
}

export type DebugConsoleAction =
  | { readonly type: "own"; readonly owner: DebugEvaluationOwner | null }
  | { readonly type: "replace-history"; readonly history: readonly string[] }
  | {
      readonly type: "output";
      readonly owner: DebugEvaluationOwner;
      readonly stream: "stdout" | "stderr";
      readonly text: string;
    }
  | {
      readonly type: "evaluation-pending";
      readonly owner: DebugEvaluationOwner;
      readonly requestId: string;
      readonly expression: string;
      readonly resultOwner?: DebugConsoleResultOwner;
    }
  | {
      readonly type: "evaluation-settled";
      readonly owner: DebugEvaluationOwner;
      readonly requestId: string;
      readonly result: DebugEvaluationResult;
    }
  | {
      readonly type: "cancel-evaluation";
      readonly owner: DebugEvaluationOwner;
      readonly requestId: string;
    }
  | { readonly type: "clear"; readonly owner: DebugEvaluationOwner };

export function createDebugConsoleState(
  owner: DebugEvaluationOwner | null = null,
): DebugConsoleState {
  return { owner, entries: [], history: [], pendingRequestIds: [], nextSequence: 1, totalBytes: 0 };
}

export function reduceDebugConsoleState(
  state: DebugConsoleState,
  action: DebugConsoleAction,
): DebugConsoleState {
  if (action.type === "own") return ownConsole(state, action.owner);
  if (action.type === "replace-history") {
    const history = normalizeDebugConsoleHistory(action.history);
    return historiesEqual(state.history, history) ? state : { ...state, history };
  }
  if (!state.owner || !debugEvaluationOwnersEqual(state.owner, action.owner)) return state;
  if (action.type === "clear") {
    return state.entries.length === 0 && state.pendingRequestIds.length === 0
      ? state
      : { ...state, entries: [], pendingRequestIds: [], totalBytes: 0 };
  }
  if (action.type === "output") {
    if (typeof action.text !== "string" || action.text.length === 0) return state;
    const bounded = truncateUtf8(action.text, MAX_DEBUG_CONSOLE_OUTPUT_BYTES);
    return appendEntry(state, { kind: action.stream, text: bounded.value }, bounded.omittedBytes);
  }
  if (!isRequestId(action.requestId)) return state;
  if (action.type === "evaluation-pending") {
    if (state.pendingRequestIds.includes(action.requestId)) return state;
    const expression = validateDebugConsoleExpression(action.expression);
    if (!expression.ok) return state;
    const resultOwner = isDebugConsoleResultOwner(action.resultOwner)
      ? Object.freeze({ ...action.resultOwner })
      : undefined;
    const next = appendEntry(
      state,
      {
        kind: "pending",
        requestId: action.requestId,
        expression: expression.expression,
        ...(resultOwner ? { resultOwner } : {}),
      },
      0,
    );
    return {
      ...next,
      history: appendDebugConsoleHistory(state.history, expression.expression),
      pendingRequestIds: next.pendingRequestIds.includes(action.requestId)
        ? next.pendingRequestIds
        : [...next.pendingRequestIds, action.requestId],
    };
  }
  if (action.type === "cancel-evaluation") {
    return cancelEvaluation(state, action.requestId);
  }
  return settleEvaluation(state, action.requestId, action.result);
}

function validateDebugConsoleExpression(
  value: unknown,
): ReturnType<typeof validateDebugExpression> {
  if (typeof value !== "string") return { ok: false, reason: "type" };
  const validation = validateDebugExpression(value.replace(/[\r\n]/g, " "));
  return validation.ok ? { ok: true, expression: value } : validation;
}

function ownConsole(
  state: DebugConsoleState,
  owner: DebugEvaluationOwner | null,
): DebugConsoleState {
  if (debugEvaluationOwnersEqual(state.owner, owner)) return state;
  const preserveSession =
    state.owner !== null && owner !== null && state.owner.sessionId === owner.sessionId;
  return {
    owner,
    entries: preserveSession ? state.entries : [],
    history: state.history,
    pendingRequestIds: [],
    nextSequence: preserveSession ? state.nextSequence : 1,
    totalBytes: preserveSession ? state.totalBytes : 0,
  };
}

function settleEvaluation(
  state: DebugConsoleState,
  requestId: string,
  result: unknown,
): DebugConsoleState {
  if (!state.pendingRequestIds.includes(requestId)) return state;
  if (!isDebugEvaluationResult(result)) return state;
  if (result.status === "error") {
    const bounded = truncateUtf8(result.message, MAX_DEBUG_EVALUATION_ERROR_BYTES);
    const next = appendEntry(
      state,
      { kind: "error", requestId, errorKind: result.kind, message: bounded.value },
      bounded.omittedBytes,
    );
    return removePendingRequestId(next, requestId);
  }
  const value = truncateUtf8(result.value, MAX_DEBUG_EVALUATION_VALUE_BYTES);
  const valueType = truncateUtf8(result.type ?? "", MAX_DEBUG_EVALUATION_TYPE_BYTES);
  const pending = state.entries.find(
    (entry) => entry.kind === "pending" && entry.requestId === requestId,
  );
  const resultOwner = pending?.kind === "pending" ? pending.resultOwner : undefined;
  const next = appendEntry(
    state,
    {
      kind: "result",
      requestId,
      value: value.value,
      valueType: result.type === null || result.type === undefined ? null : valueType.value,
      ...(result.evaluateName === undefined ? {} : { evaluateName: result.evaluateName }),
      variablesReference: result.variablesReference ?? 0,
      ...(resultOwner ? { resultOwner } : {}),
    },
    value.omittedBytes + valueType.omittedBytes,
  );
  return removePendingRequestId(next, requestId);
}

function cancelEvaluation(state: DebugConsoleState, requestId: string): DebugConsoleState {
  if (!state.pendingRequestIds.includes(requestId)) return state;
  const entries = state.entries.filter(
    (entry) => !(entry.kind === "pending" && entry.requestId === requestId),
  );
  return {
    ...state,
    entries,
    pendingRequestIds: state.pendingRequestIds.filter((candidate) => candidate !== requestId),
    totalBytes: entries.reduce((total, entry) => total + consoleEntryBytes(entry), 0),
  };
}

function removePendingRequestId(state: DebugConsoleState, requestId: string): DebugConsoleState {
  return {
    ...state,
    pendingRequestIds: state.pendingRequestIds.filter((candidate) => candidate !== requestId),
  };
}

type NewDebugConsoleEntry =
  | { readonly kind: "stdout" | "stderr"; readonly text: string }
  | {
      readonly kind: "pending";
      readonly requestId: string;
      readonly expression: string;
      readonly resultOwner?: DebugConsoleResultOwner;
    }
  | {
      readonly kind: "result";
      readonly requestId: string;
      readonly value: string;
      readonly valueType: string | null;
      readonly evaluateName?: string;
      readonly variablesReference: number;
      readonly resultOwner?: DebugConsoleResultOwner;
    }
  | {
      readonly kind: "error";
      readonly requestId: string;
      readonly errorKind: DebugEvaluationErrorKind;
      readonly message: string;
    };

function appendEntry(
  state: DebugConsoleState,
  value: NewDebugConsoleEntry,
  newlyOmittedBytes: number,
): DebugConsoleState {
  const owner = state.owner!;
  const entry: DebugConsoleEntry = {
    ...value,
    id: `console-${state.nextSequence}`,
    owner,
    sequence: state.nextSequence,
  };
  const previousMarker = state.entries.find((candidate) => candidate.kind === "truncated");
  const entries = state.entries.filter((candidate) => candidate.kind !== "truncated");
  entries.push(entry);
  let omittedEntries = previousMarker?.omittedEntries ?? 0;
  let omittedBytes = (previousMarker?.omittedBytes ?? 0) + newlyOmittedBytes;
  let totalBytes = entries.reduce((total, candidate) => total + consoleEntryBytes(candidate), 0);
  const needsMarker = () => omittedEntries > 0 || omittedBytes > 0;
  while (entries.length > MAX_DEBUG_CONSOLE_ENTRIES - (needsMarker() ? 1 : 0)) {
    const removed = entries.shift()!;
    const removedBytes = consoleEntryBytes(removed);
    totalBytes -= removedBytes;
    omittedEntries += 1;
    omittedBytes += removedBytes;
  }
  while (totalBytes + (needsMarker() ? truncationMarkerBytes() : 0) > MAX_DEBUG_CONSOLE_BYTES) {
    const removed = entries.shift();
    if (!removed) break;
    const removedBytes = consoleEntryBytes(removed);
    totalBytes -= removedBytes;
    omittedEntries += 1;
    omittedBytes += removedBytes;
  }
  const boundedEntries: DebugConsoleEntry[] = needsMarker()
    ? [
        {
          kind: "truncated",
          id: "console-truncated",
          owner,
          sequence: entries[0]?.sequence ?? entry.sequence,
          omittedEntries,
          omittedBytes,
        },
        ...entries,
      ]
    : entries;
  const retainedRequestIds = new Set(
    boundedEntries.flatMap((candidate) =>
      candidate.kind === "pending" ? [candidate.requestId] : [],
    ),
  );
  return {
    ...state,
    entries: boundedEntries,
    pendingRequestIds: state.pendingRequestIds.filter((requestId) =>
      retainedRequestIds.has(requestId),
    ),
    nextSequence: state.nextSequence + 1,
    totalBytes: boundedEntries.reduce(
      (total, candidate) => total + consoleEntryBytes(candidate),
      0,
    ),
  };
}

export function appendDebugConsoleHistory(
  history: readonly string[],
  expression: string,
): readonly string[] {
  if (!validateDebugConsoleExpression(expression).ok) return history;
  if (history[history.length - 1] === expression) return history;
  const next = [...history, expression];
  return next.slice(-MAX_DEBUG_CONSOLE_HISTORY);
}

export function serializeDebugConsoleHistory(history: readonly string[]): string {
  return JSON.stringify(normalizeDebugConsoleHistory(history));
}

export function deserializeDebugConsoleHistory(raw: string): readonly string[] {
  if (raw.length > MAX_DEBUG_CONSOLE_HISTORY_SERIALIZED_CHARS) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_DEBUG_CONSOLE_HISTORY) return [];
  if (parsed.some((entry) => typeof entry !== "string")) return [];
  if (parsed.some((entry) => !validateDebugConsoleExpression(entry).ok)) return [];
  return normalizeDebugConsoleHistory(parsed);
}

function normalizeDebugConsoleHistory(history: readonly string[]): readonly string[] {
  return history.reduce<readonly string[]>(
    (current, expression) =>
      typeof expression === "string" && expression.length > 0
        ? appendDebugConsoleHistory(current, expression)
        : current,
    [],
  );
}

function historiesEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((expression, index) => expression === right[index])
  );
}

function consoleEntryBytes(entry: DebugConsoleEntry): number {
  switch (entry.kind) {
    case "stdout":
    case "stderr":
      return debugUtf8ByteLength(entry.text);
    case "pending":
      return (
        debugUtf8ByteLength(entry.requestId) +
        debugUtf8ByteLength(entry.expression) +
        resultOwnerBytes(entry.resultOwner)
      );
    case "result":
      return (
        debugUtf8ByteLength(entry.requestId) +
        debugUtf8ByteLength(entry.value) +
        debugUtf8ByteLength(entry.valueType ?? "") +
        debugUtf8ByteLength(entry.evaluateName ?? "") +
        resultOwnerBytes(entry.resultOwner)
      );
    case "error":
      return debugUtf8ByteLength(entry.requestId) + debugUtf8ByteLength(entry.message);
    case "truncated":
      return truncationMarkerBytes();
  }
}

function truncationMarkerBytes(): number {
  return debugUtf8ByteLength("Earlier debug console entries were truncated.");
}

function truncateUtf8(value: string, maximum: number): { value: string; omittedBytes: number } {
  const bytes = UTF8_ENCODER.encode(value);
  if (bytes.byteLength <= maximum) return { value, omittedBytes: 0 };
  // A UTF-8 scalar is at most four bytes, so at most three trailing bytes
  // need to be discarded when the byte limit splits a scalar.
  for (let end = maximum; end >= Math.max(0, maximum - 3); end -= 1) {
    try {
      return {
        value: FATAL_UTF8_DECODER.decode(bytes.subarray(0, end)),
        omittedBytes: bytes.byteLength - end,
      };
    } catch {
      continue;
    }
  }
  return { value: "", omittedBytes: bytes.byteLength };
}

function resultOwnerBytes(owner: DebugConsoleResultOwner | undefined): number {
  return owner
    ? debugUtf8ByteLength(owner.rootKey) + debugUtf8ByteLength(owner.workspaceOwnerKey) + 24
    : 0;
}

function isDebugConsoleResultOwner(value: unknown): value is DebugConsoleResultOwner {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "sessionId",
      "pauseGeneration",
      "epoch",
      "frameId",
      "rootKey",
      "workspaceOwnerKey",
    ]) &&
    [value.sessionId, value.pauseGeneration, value.epoch, value.frameId].every(
      (part) => Number.isSafeInteger(part) && (part as number) > 0,
    ) &&
    isBoundedCleanOwnerText(value.rootKey, 4_096) &&
    isBoundedCleanOwnerText(value.workspaceOwnerKey, 1_024)
  );
}

function isBoundedCleanOwnerText(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !/\p{Cc}/u.test(value) &&
    debugUtf8ByteLength(value) <= maximumBytes
  );
}

function isRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !/\p{Cc}/u.test(value) &&
    debugUtf8ByteLength(value) <= MAX_DEBUG_CONSOLE_REQUEST_ID_BYTES
  );
}

function isErrorKind(value: unknown): value is DebugEvaluationErrorKind {
  return value === "exception" || value === "side-effect" || value === "unsupported";
}

function isDebugEvaluationResult(value: unknown): value is DebugEvaluationResult {
  if (!isRecord(value) || typeof value.status !== "string") return false;
  if (value.status === "error") {
    return (
      hasExactKeys(value, ["status", "kind", "message"]) &&
      isErrorKind(value.kind) &&
      isBoundedString(value.message, MAX_DEBUG_EVALUATION_ERROR_BYTES)
    );
  }
  if (value.status !== "ok") return false;
  if (!hasOnlyKeys(value, ["status", "value", "type", "evaluateName", "variablesReference"])) {
    return false;
  }
  if (!hasOwn(value, "value") || !isBoundedString(value.value, MAX_DEBUG_EVALUATION_VALUE_BYTES)) {
    return false;
  }
  if (
    hasOwn(value, "type") &&
    value.type !== undefined &&
    value.type !== null &&
    !isBoundedString(value.type, MAX_DEBUG_EVALUATION_TYPE_BYTES)
  ) {
    return false;
  }
  if (
    hasOwn(value, "evaluateName") &&
    value.evaluateName !== undefined &&
    (typeof value.evaluateName !== "string" ||
      value.evaluateName.trim().length === 0 ||
      /\p{Cc}/u.test(value.evaluateName) ||
      debugUtf8ByteLength(value.evaluateName) > MAX_DEBUG_EVALUATION_EXPRESSION_BYTES)
  ) {
    return false;
  }
  return (
    !hasOwn(value, "variablesReference") ||
    value.variablesReference === undefined ||
    (Number.isSafeInteger(value.variablesReference) && (value.variablesReference as number) >= 0)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => hasOwn(value, key));
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isBoundedString(value: unknown, maximumBytes: number): value is string {
  return typeof value === "string" && debugUtf8ByteLength(value) <= maximumBytes;
}
