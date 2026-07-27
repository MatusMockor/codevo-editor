import type { DebugVariable, DebugVariableFilter, DebugVariablePageLimitReason } from "./debug";
import { debugUtf8ByteLength, isBoundedDebugEvaluateName } from "./debugEvaluationPolicy";

export const DEBUG_VARIABLE_PAGE_SIZE = 100;
export const MAX_DEBUG_VARIABLE_PAGE_SIZE = 100;
export const MAX_DEBUG_VARIABLE_CACHE_VARIABLES = 10_000;
export const MAX_DEBUG_VARIABLE_CACHE_BYTES = 4 * 1_024 * 1_024;
export const MAX_DEBUG_VARIABLE_CACHE_REFERENCES = 4_096;
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
  readonly workspaceId?: string | null;
  readonly workspaceEpoch?: number;
  readonly sessionId: number;
  readonly pauseGeneration: number;
  readonly frameId: number;
}

export interface DebugVariablePageResult {
  readonly variablesReference: number;
  readonly filter?: DebugVariableFilter;
  readonly start: number;
  readonly variables: readonly DebugVariable[];
  readonly nextStart: number | null;
  readonly total?: number | null;
  readonly truncated?: boolean;
  readonly limitReason?: DebugVariablePageLimitReason | null;
}

export interface DebugVariablePage {
  readonly filter?: DebugVariableFilter;
  readonly start: number;
  readonly variables: readonly DebugVariable[];
  readonly nextStart: number | null;
  readonly total?: number | null;
  readonly truncated?: boolean;
  readonly limitReason?: DebugVariablePageLimitReason | null;
}

export type DebugVariableLimitReason =
  "variables" | "bytes" | "references" | "concurrency" | "depth";

export interface DebugVariableReferencePages {
  readonly pages: Readonly<Record<string, DebugVariablePage>>;
  readonly pending: Readonly<Record<string, string>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly limit: DebugVariableLimitReason | null;
}

export interface DebugVariablePagesState {
  readonly owner: DebugInspectionOwner | null;
  readonly references: Readonly<Record<number, DebugVariableReferencePages>>;
  readonly referenceCount?: number;
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
      readonly filter?: DebugVariableFilter;
      readonly start: number;
      readonly requestId: string;
    }
  | {
      readonly type: "resolve";
      readonly owner: DebugInspectionOwner;
      readonly variablesReference: number;
      readonly filter?: DebugVariableFilter;
      readonly start: number;
      readonly requestId: string;
      readonly result: unknown;
    }
  | {
      readonly type: "reject";
      readonly owner: DebugInspectionOwner;
      readonly variablesReference: number;
      readonly filter?: DebugVariableFilter;
      readonly start: number;
      readonly requestId: string;
      readonly message: unknown;
    }
  | {
      readonly type: "cancel";
      readonly owner: DebugInspectionOwner;
      readonly variablesReference: number;
      readonly filter?: DebugVariableFilter;
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

const REFERENCE_STORE_BUCKETS = 64;
interface ReferenceStoreMetadata {
  readonly buckets: readonly Readonly<Record<number, DebugVariableReferencePages>>[];
}
const referenceStoreMetadata = new WeakMap<object, ReferenceStoreMetadata>();
const emptyReferences = createReferenceStore(
  Array.from({ length: REFERENCE_STORE_BUCKETS }, () => ({})),
);
const legacyReferenceCounts = new WeakMap<object, number>();

export function createDebugVariablePagesState(
  owner: DebugInspectionOwner | null = null,
): DebugVariablePagesState {
  return {
    owner: isDebugInspectionOwner(owner) ? owner : null,
    references: emptyReferences,
    referenceCount: 0,
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
  filter: DebugVariableFilter = "named",
): DebugVariableExpansionState {
  if (!debugInspectionOwnersEqual(state.owner, owner)) return { kind: "stale" };
  if (!isPositiveSafeInteger(variablesReference)) return { kind: "leaf" };
  if (ancestorReferences.includes(variablesReference)) return { kind: "circular" };
  if (!isNonNegativeSafeInteger(depth) || depth >= MAX_DEBUG_VARIABLE_EXPANSION_DEPTH) {
    return { kind: "limit", reason: "depth" };
  }
  const reference = state.references[variablesReference];
  if (!reference) {
    if (debugVariableReferenceCount(state) >= MAX_DEBUG_VARIABLE_CACHE_REFERENCES) {
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
  const pages = orderedPages(reference, filter);
  const variables = pages.flatMap((page) => page.variables);
  const nextStart = nextUnloadedStart(reference, filter, pages);
  if (nextStart === null) return { kind: "ready", variables, nextStart: null };
  if (reference.pending[pageKey(filter, nextStart)]) {
    return { kind: "loading", variables, nextStart };
  }
  const message = reference.errors[pageKey(filter, nextStart)];
  if (message !== undefined) return { kind: "error", variables, nextStart, message };
  return pages.length === 0
    ? { kind: "idle", nextStart: 0 }
    : { kind: "ready", variables, nextStart };
}

function debugVariableReferenceCount(state: DebugVariablePagesState): number {
  if (
    state.referenceCount !== undefined &&
    (state.referenceCount > 0 || state.references === emptyReferences)
  ) {
    return state.referenceCount;
  }
  const cached = legacyReferenceCounts.get(state.references);
  if (cached !== undefined) return cached;
  const count = Object.keys(state.references).length;
  legacyReferenceCounts.set(state.references, count);
  return count;
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
      left.workspaceId === right.workspaceId &&
      left.workspaceEpoch === right.workspaceEpoch &&
      left.sessionId === right.sessionId &&
      left.pauseGeneration === right.pauseGeneration &&
      left.frameId === right.frameId)
  );
}

export function isDebugInspectionOwner(value: unknown): value is DebugInspectionOwner {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (
    !keys.every((key) =>
      [
        "rootKey",
        "workspaceId",
        "workspaceEpoch",
        "sessionId",
        "pauseGeneration",
        "frameId",
      ].includes(key),
    ) ||
    !["rootKey", "sessionId", "pauseGeneration", "frameId"].every((key) => hasOwn(value, key))
  )
    return false;
  const hasWorkspaceId = hasOwn(value, "workspaceId");
  const hasWorkspaceEpoch = hasOwn(value, "workspaceEpoch");
  if (hasWorkspaceId !== hasWorkspaceEpoch) return false;
  return (
    isBoundedText(value.rootKey, MAX_ROOT_KEY_BYTES, false) &&
    (!hasWorkspaceId ||
      ((value.workspaceId === null ||
        isBoundedText(value.workspaceId, MAX_ROOT_KEY_BYTES, false)) &&
        isNonNegativeSafeInteger(value.workspaceEpoch))) &&
    isPositiveSafeInteger(value.sessionId) &&
    isPositiveSafeInteger(value.pauseGeneration) &&
    isPositiveSafeInteger(value.frameId)
  );
}

function requestPage(
  state: DebugVariablePagesState,
  action: Extract<DebugVariablePagesAction, { type: "request" }>,
): DebugVariablePagesState {
  const filter = action.filter ?? "named";
  const existing = state.references[action.variablesReference];
  const key = pageKey(filter, action.start);
  if (existing?.pages[key] || existing?.pending[key]) return state;
  if (
    existing &&
    orderedPages(existing, filter).some(
      (page) => action.start >= page.start && action.start < page.start + page.variables.length,
    )
  ) {
    return state;
  }
  if (!existing && debugVariableReferenceCount(state) >= MAX_DEBUG_VARIABLE_CACHE_REFERENCES) {
    return state;
  }
  const reference = existing ?? emptyReference();
  if (reference.limit || state.pendingCount >= MAX_DEBUG_VARIABLE_CONCURRENT_REQUESTS) return state;
  return replaceReference(
    state,
    action.variablesReference,
    {
      ...reference,
      pending: { ...reference.pending, [key]: action.requestId },
      errors: omitKey(reference.errors, key),
    },
    { pendingCount: state.pendingCount + 1 },
  );
}

function resolvePage(
  state: DebugVariablePagesState,
  action: Extract<DebugVariablePagesAction, { type: "resolve" }>,
): DebugVariablePagesState {
  const filter = action.filter ?? "named";
  const reference = state.references[action.variablesReference];
  const key = pageKey(filter, action.start);
  if (!reference || reference.pending[key] !== action.requestId) return state;
  const result = decodePageResult(action.result);
  if (
    !result ||
    result.variablesReference !== action.variablesReference ||
    (result.filter ?? "named") !== filter ||
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
  const pending = omitKey(reference.pending, key);
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
    filter: result.filter,
    variables: result.variables.map((variable) => ({ ...variable })),
    nextStart: result.nextStart,
    total: result.total,
    truncated: result.truncated,
    limitReason: result.limitReason,
  };
  return replaceReference(
    state,
    action.variablesReference,
    {
      ...reference,
      pages: { ...reference.pages, [key]: page },
      pending,
      errors: omitKey(reference.errors, key),
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
  const filter = action.filter ?? "named";
  const reference = state.references[action.variablesReference];
  const key = pageKey(filter, action.start);
  if (!reference || reference.pending[key] !== action.requestId) {
    return state;
  }
  const message = boundedErrorMessage(action.message);
  return replaceReference(
    state,
    action.variablesReference,
    {
      ...reference,
      pending: omitKey(reference.pending, key),
      errors: { ...reference.errors, [key]: message },
    },
    { pendingCount: state.pendingCount - 1 },
  );
}

function settleInvalidPage(
  state: DebugVariablePagesState,
  action: Extract<DebugVariablePagesAction, { type: "resolve" }>,
  reference: DebugVariableReferencePages,
): DebugVariablePagesState {
  const filter = action.filter ?? "named";
  return replaceReference(
    state,
    action.variablesReference,
    {
      ...reference,
      pending: omitKey(reference.pending, pageKey(filter, action.start)),
      errors: {
        ...reference.errors,
        [pageKey(filter, action.start)]: INVALID_VARIABLE_PAGE_ERROR,
      },
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
  const filter = action.filter ?? "named";
  const reference = state.references[action.variablesReference];
  const key = pageKey(filter, action.start);
  if (!reference || reference.pending[key] !== action.requestId) return state;
  return replaceReference(
    state,
    action.variablesReference,
    { ...reference, pending: omitKey(reference.pending, key) },
    { pendingCount: state.pendingCount - 1 },
  );
}

function decodePageResult(value: unknown): DebugVariablePageResult | null {
  if (
    isRecord(value) &&
    hasExactKeys(value, ["variablesReference", "start", "variables", "nextStart"])
  ) {
    const variables = Array.isArray(value.variables) ? value.variables : [];
    value = {
      ...value,
      filter: "named",
      total:
        value.nextStart === null && isNonNegativeSafeInteger(value.start)
          ? value.start + variables.length
          : isNonNegativeSafeInteger(value.nextStart)
            ? value.nextStart + 1
            : null,
      truncated: value.nextStart !== null,
      limitReason: value.nextStart === null ? null : "page-bytes",
    };
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "variablesReference",
      "filter",
      "start",
      "variables",
      "nextStart",
      "total",
      "truncated",
      "limitReason",
    ])
  ) {
    return null;
  }
  if (
    !isPositiveSafeInteger(value.variablesReference) ||
    !isDebugVariableFilter(value.filter) ||
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
  if (!isValidPageCompletion(value, minimumNext)) return null;
  return {
    variablesReference: value.variablesReference,
    filter: value.filter,
    start: value.start,
    variables: value.variables,
    nextStart: value.nextStart,
    total: value.total,
    truncated: value.truncated,
    limitReason: value.limitReason,
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
      "childrenLimitReason",
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
    (!hasOwn(value, "childrenLimitReason") ||
      value.childrenLimitReason === "references" ||
      value.childrenLimitReason === "referenceBytes") &&
    (!hasOwn(value, "childrenLimitReason") || value.variablesReference === 0) &&
    isNonNegativeSafeInteger(value.variablesReference)
  );
}

function pageDoesNotOverlap(
  reference: DebugVariableReferencePages,
  result: DebugVariablePageResult,
): boolean {
  const end = result.start + result.variables.length;
  return orderedPages(reference, result.filter ?? "named").every((page) => {
    const pageEnd = page.start + page.variables.length;
    return end <= page.start || result.start >= pageEnd;
  });
}

function orderedPages(
  reference: DebugVariableReferencePages,
  filter: DebugVariableFilter,
): DebugVariablePage[] {
  return Object.values(reference.pages)
    .filter((page) => (page.filter ?? "named") === filter)
    .sort((left, right) => left.start - right.start);
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
    referenceCount:
      state.referenceCount === undefined
        ? undefined
        : state.referenceCount + (state.references[variablesReference] ? 0 : 1),
    references: updateReferenceStore(state.references, variablesReference, reference),
  };
}

function updateReferenceStore(
  references: Readonly<Record<number, DebugVariableReferencePages>>,
  variablesReference: number,
  reference: DebugVariableReferencePages,
): Readonly<Record<number, DebugVariableReferencePages>> {
  const metadata = referenceStoreMetadata.get(references) ?? materializeReferenceStore(references);
  const bucketIndex = variablesReference % REFERENCE_STORE_BUCKETS;
  const buckets = [...metadata.buckets];
  buckets[bucketIndex] = { ...buckets[bucketIndex], [variablesReference]: reference };
  return createReferenceStore(buckets);
}

function materializeReferenceStore(
  references: Readonly<Record<number, DebugVariableReferencePages>>,
): ReferenceStoreMetadata {
  const buckets: Record<number, DebugVariableReferencePages>[] = Array.from(
    { length: REFERENCE_STORE_BUCKETS },
    () => ({}),
  );
  for (const [reference, pages] of Object.entries(references)) {
    const value = Number(reference);
    buckets[value % REFERENCE_STORE_BUCKETS]![value] = pages;
  }
  const metadata = { buckets };
  referenceStoreMetadata.set(references, metadata);
  return metadata;
}

function createReferenceStore(
  buckets: readonly Readonly<Record<number, DebugVariableReferencePages>>[],
): Readonly<Record<number, DebugVariableReferencePages>> {
  const target: Record<number, DebugVariableReferencePages> = {};
  const store = new Proxy(target, {
    get(_target, property) {
      if (typeof property !== "string" || !/^(?:0|[1-9]\d*)$/.test(property)) return undefined;
      const reference = Number(property);
      return buckets[reference % REFERENCE_STORE_BUCKETS]?.[reference];
    },
    has(_target, property) {
      return (
        typeof property === "string" &&
        /^(?:0|[1-9]\d*)$/.test(property) &&
        Number(property) in buckets[Number(property) % REFERENCE_STORE_BUCKETS]!
      );
    },
    ownKeys: () =>
      buckets
        .flatMap((bucket) => Object.keys(bucket))
        .sort((left, right) => Number(left) - Number(right)),
    getOwnPropertyDescriptor(_target, property) {
      if (typeof property !== "string" || !/^(?:0|[1-9]\d*)$/.test(property)) return undefined;
      const reference = Number(property);
      return reference in buckets[reference % REFERENCE_STORE_BUCKETS]!
        ? { configurable: true, enumerable: true }
        : undefined;
    },
  });
  referenceStoreMetadata.set(store, { buckets });
  return store;
}

function omitKey<Value>(
  record: Readonly<Record<string, Value>>,
  key: string,
): Record<string, Value> {
  const next = { ...record };
  delete next[key];
  return next;
}

function pageKey(filter: DebugVariableFilter, start: number): string {
  return filter === "named" ? String(start) : `indexed:${start}`;
}

function nextUnloadedStart(
  reference: DebugVariableReferencePages,
  filter: DebugVariableFilter,
  pages: readonly DebugVariablePage[],
): number | null {
  if (pages.length === 0) return 0;
  for (const page of pages) {
    if (page.nextStart !== null && !reference.pages[pageKey(filter, page.nextStart)]) {
      return page.nextStart;
    }
  }
  const last = pages[pages.length - 1];
  return last?.nextStart ?? null;
}

function isDebugVariableFilter(value: unknown): value is DebugVariableFilter {
  return value === "indexed" || value === "named";
}

function isValidPageCompletion(
  value: Record<string, unknown>,
  consumed: number,
): value is Record<string, unknown> & {
  total: number | null;
  truncated: boolean;
  limitReason: DebugVariablePageLimitReason | null;
} {
  const total = value.total;
  const truncated = value.truncated;
  const limitReason = value.limitReason;
  if (
    (total !== null && (!isNonNegativeSafeInteger(total) || total < consumed)) ||
    typeof truncated !== "boolean" ||
    !isPageLimitReasonOrNull(limitReason)
  ) {
    return false;
  }
  if (!truncated) {
    if (total === null || limitReason !== null) return false;
    return value.nextStart === (consumed < total ? consumed : null);
  }
  if (limitReason === null) return false;
  return value.nextStart === null || value.nextStart === consumed;
}

function isPageLimitReasonOrNull(value: unknown): value is DebugVariablePageLimitReason | null {
  return (
    value === null ||
    value === "descriptor-count" ||
    value === "descriptor-bytes" ||
    value === "page-bytes" ||
    value === "references" ||
    value === "reference-bytes"
  );
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
