import type { DebugVariable } from "./debug";
import { debugUtf8ByteLength, isBoundedDebugEvaluateName } from "./debugEvaluationPolicy";

export const DEBUG_VARIABLE_PAGE_SIZE = 100;
export const MAX_DEBUG_VARIABLE_PAGE_SIZE = 100;
export const MAX_DEBUG_VARIABLE_CACHE_VARIABLES = 10_000;
export const MAX_DEBUG_VARIABLE_CACHE_BYTES = 5 * 1_024 * 1_024;
export const MAX_DEBUG_VARIABLE_CACHE_REFERENCES = 1_000;
export const MAX_DEBUG_VARIABLE_CONCURRENT_REQUESTS = 16;
export const MAX_DEBUG_VARIABLE_EXPANSION_DEPTH = 32;

const MAX_ROOT_KEY_BYTES = 4_096;
const MAX_REQUEST_ID_BYTES = 128;
const MAX_ERROR_BYTES = 4 * 1_024;
const MAX_NAME_BYTES = 1_024;
const MAX_VALUE_BYTES = 64 * 1_024;
const MAX_TYPE_BYTES = 256;
const VARIABLE_LOAD_ERROR_FALLBACK = "Variable loading failed.";
const INVALID_VARIABLE_PAGE_ERROR = "The debug adapter returned an invalid variable page.";

export interface DebugInspectionOwner {
  readonly rootKey: string;
  readonly sessionId: number;
  readonly pauseGeneration: number;
  readonly frameId: number;
}

export interface DebugVariablePageResult {
  readonly variablesReference: number;
  readonly start: number;
  readonly variables: readonly DebugVariable[];
  readonly nextStart: number | null;
}

export interface DebugVariablePage {
  readonly start: number;
  readonly variables: readonly DebugVariable[];
  readonly nextStart: number | null;
}

export type DebugVariableLimitReason =
  "variables" | "bytes" | "references" | "concurrency" | "depth";

export interface DebugVariableReferencePages {
  readonly pages: Readonly<Record<number, DebugVariablePage>>;
  readonly pending: Readonly<Record<number, string>>;
  readonly errors: Readonly<Record<number, string>>;
  readonly limit: DebugVariableLimitReason | null;
}

export interface DebugVariablePagesState {
  readonly owner: DebugInspectionOwner | null;
  readonly references: Readonly<Record<number, DebugVariableReferencePages>>;
  readonly pendingCount: number;
  readonly totalVariables: number;
  readonly totalBytes: number;
}

export type DebugVariablePagesAction =
  | { readonly type: "own"; readonly owner: DebugInspectionOwner | null }
  | {
      readonly type: "request";
      readonly owner: DebugInspectionOwner;
      readonly variablesReference: number;
      readonly start: number;
      readonly requestId: string;
    }
  | {
      readonly type: "resolve";
      readonly owner: DebugInspectionOwner;
      readonly variablesReference: number;
      readonly start: number;
      readonly requestId: string;
      readonly result: unknown;
    }
  | {
      readonly type: "reject";
      readonly owner: DebugInspectionOwner;
      readonly variablesReference: number;
      readonly start: number;
      readonly requestId: string;
      readonly message: unknown;
    }
  | {
      readonly type: "cancel";
      readonly owner: DebugInspectionOwner;
      readonly variablesReference: number;
      readonly start: number;
      readonly requestId: string;
    }
  | { readonly type: "clear"; readonly owner: DebugInspectionOwner };

export type DebugVariableExpansionState =
  | { readonly kind: "stale" }
  | { readonly kind: "leaf" }
  | { readonly kind: "circular" }
  | { readonly kind: "limit"; readonly reason: DebugVariableLimitReason }
  | { readonly kind: "idle"; readonly nextStart: 0 }
  | {
      readonly kind: "loading";
      readonly variables: readonly DebugVariable[];
      readonly nextStart: number;
    }
  | {
      readonly kind: "error";
      readonly variables: readonly DebugVariable[];
      readonly nextStart: number;
      readonly message: string;
    }
  | {
      readonly kind: "ready";
      readonly variables: readonly DebugVariable[];
      readonly nextStart: number | null;
    };

const emptyReferences: Readonly<Record<number, DebugVariableReferencePages>> = {};

export function createDebugVariablePagesState(
  owner: DebugInspectionOwner | null = null,
): DebugVariablePagesState {
  return {
    owner: isDebugInspectionOwner(owner) ? owner : null,
    references: emptyReferences,
    pendingCount: 0,
    totalVariables: 0,
    totalBytes: 0,
  };
}

export function reduceDebugVariablePages(
  state: DebugVariablePagesState,
  action: DebugVariablePagesAction,
): DebugVariablePagesState {
  if (action.type === "own") {
    const owner = isDebugInspectionOwner(action.owner) ? action.owner : null;
    return debugInspectionOwnersEqual(state.owner, owner)
      ? state
      : createDebugVariablePagesState(owner);
  }
  if (!debugInspectionOwnersEqual(state.owner, action.owner)) return state;
  if (action.type === "clear") return createDebugVariablePagesState(state.owner);
  if (
    !isPositiveSafeInteger(action.variablesReference) ||
    !isNonNegativeSafeInteger(action.start) ||
    !isRequestId(action.requestId)
  ) {
    return state;
  }
  if (action.type === "request") return requestPage(state, action);
  if (action.type === "resolve") return resolvePage(state, action);
  if (action.type === "reject") return rejectPage(state, action);
  return cancelPage(state, action);
}

export function selectDebugVariableExpansion(
  state: DebugVariablePagesState,
  owner: DebugInspectionOwner,
  variablesReference: number,
  ancestorReferences: readonly number[] = [],
  depth = 0,
): DebugVariableExpansionState {
  if (!debugInspectionOwnersEqual(state.owner, owner)) return { kind: "stale" };
  if (!isPositiveSafeInteger(variablesReference)) return { kind: "leaf" };
  if (ancestorReferences.includes(variablesReference)) return { kind: "circular" };
  if (!isNonNegativeSafeInteger(depth) || depth >= MAX_DEBUG_VARIABLE_EXPANSION_DEPTH) {
    return { kind: "limit", reason: "depth" };
  }
  const reference = state.references[variablesReference];
  if (!reference) {
    if (Object.keys(state.references).length >= MAX_DEBUG_VARIABLE_CACHE_REFERENCES) {
      return { kind: "limit", reason: "references" };
    }
    if (state.pendingCount >= MAX_DEBUG_VARIABLE_CONCURRENT_REQUESTS) {
      return { kind: "limit", reason: "concurrency" };
    }
    if (state.totalVariables >= MAX_DEBUG_VARIABLE_CACHE_VARIABLES) {
      return { kind: "limit", reason: "variables" };
    }
    if (state.totalBytes >= MAX_DEBUG_VARIABLE_CACHE_BYTES) {
      return { kind: "limit", reason: "bytes" };
    }
    return { kind: "idle", nextStart: 0 };
  }
  if (reference.limit) return { kind: "limit", reason: reference.limit };
  const pages = orderedPages(reference);
  const variables = pages.flatMap((page) => page.variables);
  const nextStart = pages.length === 0 ? 0 : pages[pages.length - 1]!.nextStart;
  if (nextStart === null) return { kind: "ready", variables, nextStart: null };
  if (reference.pending[nextStart]) return { kind: "loading", variables, nextStart };
  const message = reference.errors[nextStart];
  if (message !== undefined) return { kind: "error", variables, nextStart, message };
  return pages.length === 0
    ? { kind: "idle", nextStart: 0 }
    : { kind: "ready", variables, nextStart };
}

export function debugInspectionOwnersEqual(
  left: DebugInspectionOwner | null,
  right: DebugInspectionOwner | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.rootKey === right.rootKey &&
      left.sessionId === right.sessionId &&
      left.pauseGeneration === right.pauseGeneration &&
      left.frameId === right.frameId)
  );
}

export function isDebugInspectionOwner(value: unknown): value is DebugInspectionOwner {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["rootKey", "sessionId", "pauseGeneration", "frameId"])
  ) {
    return false;
  }
  return (
    isBoundedText(value.rootKey, MAX_ROOT_KEY_BYTES, false) &&
    isPositiveSafeInteger(value.sessionId) &&
    isPositiveSafeInteger(value.pauseGeneration) &&
    isPositiveSafeInteger(value.frameId)
  );
}

function requestPage(
  state: DebugVariablePagesState,
  action: Extract<DebugVariablePagesAction, { type: "request" }>,
): DebugVariablePagesState {
  const existing = state.references[action.variablesReference];
  if (existing?.pages[action.start] || existing?.pending[action.start]) return state;
  if (!isExpectedStart(existing, action.start)) return state;
  if (!existing && Object.keys(state.references).length >= MAX_DEBUG_VARIABLE_CACHE_REFERENCES) {
    return state;
  }
  const reference = existing ?? emptyReference();
  if (reference.limit || state.pendingCount >= MAX_DEBUG_VARIABLE_CONCURRENT_REQUESTS) return state;
  return replaceReference(
    state,
    action.variablesReference,
    {
      ...reference,
      pending: { ...reference.pending, [action.start]: action.requestId },
      errors: omitNumericKey(reference.errors, action.start),
    },
    { pendingCount: state.pendingCount + 1 },
  );
}

function resolvePage(
  state: DebugVariablePagesState,
  action: Extract<DebugVariablePagesAction, { type: "resolve" }>,
): DebugVariablePagesState {
  const reference = state.references[action.variablesReference];
  if (!reference || reference.pending[action.start] !== action.requestId) return state;
  const result = decodePageResult(action.result);
  if (
    !result ||
    result.variablesReference !== action.variablesReference ||
    result.start !== action.start ||
    !pageDoesNotOverlap(reference, result)
  ) {
    return settleInvalidPage(state, action, reference);
  }
  const addedVariables = result.variables.length;
  const addedBytes = result.variables.reduce(
    (total, variable) => total + variableBytes(variable),
    0,
  );
  const pending = omitNumericKey(reference.pending, action.start);
  if (state.totalVariables + addedVariables > MAX_DEBUG_VARIABLE_CACHE_VARIABLES) {
    return replaceReference(
      state,
      action.variablesReference,
      { ...reference, pending, limit: "variables" },
      {
        pendingCount: state.pendingCount - 1,
      },
    );
  }
  if (state.totalBytes + addedBytes > MAX_DEBUG_VARIABLE_CACHE_BYTES) {
    return replaceReference(
      state,
      action.variablesReference,
      { ...reference, pending, limit: "bytes" },
      {
        pendingCount: state.pendingCount - 1,
      },
    );
  }
  const page: DebugVariablePage = {
    start: result.start,
    variables: result.variables.map((variable) => ({ ...variable })),
    nextStart: result.nextStart,
  };
  return replaceReference(
    state,
    action.variablesReference,
    {
      ...reference,
      pages: { ...reference.pages, [action.start]: page },
      pending,
      errors: omitNumericKey(reference.errors, action.start),
    },
    {
      pendingCount: state.pendingCount - 1,
      totalVariables: state.totalVariables + addedVariables,
      totalBytes: state.totalBytes + addedBytes,
    },
  );
}

function rejectPage(
  state: DebugVariablePagesState,
  action: Extract<DebugVariablePagesAction, { type: "reject" }>,
): DebugVariablePagesState {
  const reference = state.references[action.variablesReference];
  if (!reference || reference.pending[action.start] !== action.requestId) {
    return state;
  }
  const message = boundedErrorMessage(action.message);
  return replaceReference(
    state,
    action.variablesReference,
    {
      ...reference,
      pending: omitNumericKey(reference.pending, action.start),
      errors: { ...reference.errors, [action.start]: message },
    },
    { pendingCount: state.pendingCount - 1 },
  );
}

function settleInvalidPage(
  state: DebugVariablePagesState,
  action: Extract<DebugVariablePagesAction, { type: "resolve" }>,
  reference: DebugVariableReferencePages,
): DebugVariablePagesState {
  return replaceReference(
    state,
    action.variablesReference,
    {
      ...reference,
      pending: omitNumericKey(reference.pending, action.start),
      errors: { ...reference.errors, [action.start]: INVALID_VARIABLE_PAGE_ERROR },
    },
    { pendingCount: state.pendingCount - 1 },
  );
}

function boundedErrorMessage(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return VARIABLE_LOAD_ERROR_FALLBACK;
  if (debugUtf8ByteLength(value) <= MAX_ERROR_BYTES) return value;
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = debugUtf8ByteLength(character);
    if (bytes + characterBytes > MAX_ERROR_BYTES) break;
    result += character;
    bytes += characterBytes;
  }
  return result || VARIABLE_LOAD_ERROR_FALLBACK;
}

function cancelPage(
  state: DebugVariablePagesState,
  action: Extract<DebugVariablePagesAction, { type: "cancel" }>,
): DebugVariablePagesState {
  const reference = state.references[action.variablesReference];
  if (!reference || reference.pending[action.start] !== action.requestId) return state;
  return replaceReference(
    state,
    action.variablesReference,
    { ...reference, pending: omitNumericKey(reference.pending, action.start) },
    { pendingCount: state.pendingCount - 1 },
  );
}

function decodePageResult(value: unknown): DebugVariablePageResult | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["variablesReference", "start", "variables", "nextStart"])
  ) {
    return null;
  }
  if (
    !isPositiveSafeInteger(value.variablesReference) ||
    !isNonNegativeSafeInteger(value.start) ||
    !Array.isArray(value.variables) ||
    value.variables.length > MAX_DEBUG_VARIABLE_PAGE_SIZE ||
    !value.variables.every(isDebugVariable)
  ) {
    return null;
  }
  const minimumNext = value.start + value.variables.length;
  if (!Number.isSafeInteger(minimumNext)) return null;
  if (
    value.nextStart !== null &&
    (value.variables.length === 0 ||
      !isNonNegativeSafeInteger(value.nextStart) ||
      value.nextStart < minimumNext ||
      value.nextStart <= value.start)
  ) {
    return null;
  }
  return {
    variablesReference: value.variablesReference,
    start: value.start,
    variables: value.variables,
    nextStart: value.nextStart,
  };
}

function isDebugVariable(value: unknown): value is DebugVariable {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "name",
      "value",
      "type",
      "evaluateName",
      "canSetValue",
      "variablesReference",
    ])
  ) {
    return false;
  }
  return (
    hasOwn(value, "name") &&
    hasOwn(value, "value") &&
    hasOwn(value, "variablesReference") &&
    isBoundedText(value.name, MAX_NAME_BYTES, true) &&
    isBoundedText(value.value, MAX_VALUE_BYTES, true) &&
    (!hasOwn(value, "type") ||
      value.type === undefined ||
      value.type === null ||
      isBoundedText(value.type, MAX_TYPE_BYTES, true)) &&
    (!hasOwn(value, "evaluateName") || isBoundedEvaluateName(value.evaluateName)) &&
    (!hasOwn(value, "canSetValue") || value.canSetValue === true) &&
    isNonNegativeSafeInteger(value.variablesReference)
  );
}

function isExpectedStart(
  reference: DebugVariableReferencePages | undefined,
  start: number,
): boolean {
  if (!reference) return start === 0;
  const pages = orderedPages(reference);
  if (pages.length === 0) return start === 0;
  return pages[pages.length - 1]!.nextStart === start;
}

function pageDoesNotOverlap(
  reference: DebugVariableReferencePages,
  result: DebugVariablePageResult,
): boolean {
  const end = result.start + result.variables.length;
  return orderedPages(reference).every((page) => {
    const pageEnd = page.start + page.variables.length;
    return end <= page.start || result.start >= pageEnd;
  });
}

function orderedPages(reference: DebugVariableReferencePages): DebugVariablePage[] {
  return Object.values(reference.pages).sort((left, right) => left.start - right.start);
}

function emptyReference(): DebugVariableReferencePages {
  return { pages: {}, pending: {}, errors: {}, limit: null };
}

function replaceReference(
  state: DebugVariablePagesState,
  variablesReference: number,
  reference: DebugVariableReferencePages,
  changes: Partial<
    Pick<DebugVariablePagesState, "pendingCount" | "totalVariables" | "totalBytes">
  > = {},
): DebugVariablePagesState {
  return {
    ...state,
    ...changes,
    references: { ...state.references, [variablesReference]: reference },
  };
}

function omitNumericKey<Value>(
  record: Readonly<Record<number, Value>>,
  key: number,
): Record<number, Value> {
  const next = { ...record };
  delete next[key];
  return next;
}

function variableBytes(variable: DebugVariable): number {
  return (
    debugUtf8ByteLength(variable.name) +
    debugUtf8ByteLength(variable.value) +
    debugUtf8ByteLength(variable.type ?? "") +
    debugUtf8ByteLength(variable.evaluateName ?? "")
  );
}

function isRequestId(value: unknown): value is string {
  return isBoundedText(value, MAX_REQUEST_ID_BYTES, false);
}

function isBoundedText(value: unknown, maximum: number, allowControl: boolean): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    debugUtf8ByteLength(value) <= maximum &&
    (allowControl || !/\p{Cc}/u.test(value))
  );
}

function isBoundedEvaluateName(value: unknown): value is string {
  return isBoundedDebugEvaluateName(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
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
