import {
  boundedUtf8Length,
  MAX_LANGUAGE_SERVER_DOCUMENT_VERSION,
  type IncrementalDocumentContentChange,
} from "./incrementalDocumentSync";

export interface LiveDocumentContentLimits {
  readonly maxColumn: number;
  readonly maxChangesPerEvent: number;
  readonly maxDocumentUtf16Units: number;
  readonly maxJournalChanges: number;
  readonly maxJournalEvents: number;
  readonly maxJournalInsertedUtf16Units: number;
  readonly maxJournalInsertedUtf8Bytes: number;
  readonly maxLineNumber: number;
  readonly maxInsertedUtf16UnitsPerChange: number;
  readonly maxInsertedUtf8BytesPerChange: number;
}

export const MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS = 10 * 1024 * 1024;

export const DEFAULT_LIVE_DOCUMENT_CONTENT_LIMITS: LiveDocumentContentLimits = Object.freeze({
  maxColumn: MAX_LANGUAGE_SERVER_DOCUMENT_VERSION,
  maxChangesPerEvent: 64,
  maxDocumentUtf16Units: MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS,
  maxJournalChanges: 256,
  maxJournalEvents: 256,
  maxJournalInsertedUtf16Units: 512 * 1024,
  maxJournalInsertedUtf8Bytes: 512 * 1024,
  maxLineNumber: MAX_LANGUAGE_SERVER_DOCUMENT_VERSION,
  maxInsertedUtf16UnitsPerChange: 256 * 1024,
  maxInsertedUtf8BytesPerChange: 256 * 1024,
});

export interface LiveDocumentAuthority {
  readonly canonicalRoot: string;
  readonly documentIdentityKey: string;
  readonly documentIncarnation: object;
  readonly modelId: string;
  readonly modelIncarnation: object;
  readonly ownerGeneration: number;
  readonly ownerIncarnation: object;
  readonly ownerKey: string;
  readonly path: string;
}

export interface RetainedDocumentContentState {
  readonly alternativeVersionId: number;
  readonly contentVersion: number;
  readonly kind: "retained";
  readonly modelVersionId: number;
  readonly utf16Length: number;
  readonly utf8Bytes: number;
}

export type LiveDocumentSnapshotReason =
  | "change-limit"
  | "document-size-limit"
  | "eol-change"
  | "flush"
  | "inserted-text-limit"
  | "invalid-change"
  | "journal-limit"
  | "notification-queue-limit"
  | "version-overflow"
  | "version-gap";

export interface LiveDocumentJournal {
  readonly changeCount: number;
  readonly eventCount: number;
  readonly events: readonly UnvalidatedLiveDocumentContentEvent[];
  readonly insertedUtf16Units: number;
  readonly insertedUtf8Bytes: number;
  readonly kind: "incremental";
}

export interface UnvalidatedLiveDocumentContentEvent {
  readonly coordinateTrust: "unvalidated";
  readonly event: LiveDocumentContentChangeEvent;
}

export interface SnapshotRequiredJournal {
  readonly kind: "snapshot-required";
  readonly reason: LiveDocumentSnapshotReason;
}

export interface LiveModelDocumentContentState {
  readonly alternativeVersionId: number;
  readonly authority: LiveDocumentAuthority;
  readonly contentVersion: number;
  readonly journal: LiveDocumentJournal | SnapshotRequiredJournal;
  readonly kind: "live-model";
  readonly modelVersionId: number;
  readonly mutationCount: number;
  readonly utf16Length: number | null;
}

export type LiveDocumentContentState = RetainedDocumentContentState | LiveModelDocumentContentState;

export interface LiveDocumentContentChangeEvent {
  readonly alternativeVersionId: number;
  readonly changes: readonly IncrementalDocumentContentChange[];
  readonly isEolChange: boolean;
  readonly isFlush: boolean;
  readonly isRedoing: boolean;
  readonly isUndoing: boolean;
  readonly modelVersionId: number;
  readonly postUtf16Length: number;
}

export interface LiveDocumentChangeWork {
  readonly changeCount: number;
  readonly eventCount: 1;
  readonly fullTextReads: 0;
  readonly insertedUtf16Units: number | null;
  readonly insertedUtf8Bytes: number | null;
  readonly removedUtf16Units: number | null;
}

export interface RecordLiveDocumentChangeReceipt {
  readonly mode: "incremental" | "snapshot-required";
  readonly state: LiveModelDocumentContentState;
  readonly work: LiveDocumentChangeWork;
}

export function createRetainedDocumentContentState(input: {
  readonly alternativeVersionId: number;
  readonly contentVersion: number;
  readonly modelVersionId: number;
  readonly utf16Length: number;
  readonly utf8Bytes: number;
}): RetainedDocumentContentState {
  requirePositive(input.alternativeVersionId, "alternativeVersionId");
  requirePositive(input.contentVersion, "contentVersion");
  requirePositive(input.modelVersionId, "modelVersionId");
  if (
    input.alternativeVersionId > MAX_LANGUAGE_SERVER_DOCUMENT_VERSION ||
    input.modelVersionId > MAX_LANGUAGE_SERVER_DOCUMENT_VERSION
  ) {
    throw new TypeError("Retained model version exceeds downstream bounds");
  }
  requireNonNegative(input.utf16Length, "utf16Length");
  requireNonNegative(input.utf8Bytes, "utf8Bytes");
  return Object.freeze({
    alternativeVersionId: input.alternativeVersionId,
    contentVersion: input.contentVersion,
    kind: "retained",
    modelVersionId: input.modelVersionId,
    utf16Length: input.utf16Length,
    utf8Bytes: input.utf8Bytes,
  });
}

export function validateLiveDocumentAuthority(authority: LiveDocumentAuthority): void {
  requireText(authority.canonicalRoot, "canonicalRoot");
  requireText(authority.documentIdentityKey, "documentIdentityKey");
  requireObject(authority.documentIncarnation, "documentIncarnation");
  requireText(authority.modelId, "modelId");
  requireObject(authority.modelIncarnation, "modelIncarnation");
  requirePositive(authority.ownerGeneration, "ownerGeneration");
  requireObject(authority.ownerIncarnation, "ownerIncarnation");
  requireText(authority.ownerKey, "ownerKey");
  requireText(authority.path, "path");
}

export function validateLiveDocumentContentLimits(limits: LiveDocumentContentLimits): void {
  const keys = Object.keys(limits).sort();
  const expected = [
    "maxChangesPerEvent",
    "maxColumn",
    "maxDocumentUtf16Units",
    "maxInsertedUtf16UnitsPerChange",
    "maxInsertedUtf8BytesPerChange",
    "maxJournalChanges",
    "maxJournalEvents",
    "maxJournalInsertedUtf16Units",
    "maxJournalInsertedUtf8Bytes",
    "maxLineNumber",
  ];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError("Live document content limits have an invalid shape");
  }
  for (const value of Object.values(limits)) requirePositive(value, "limit");
  if (
    limits.maxColumn > MAX_LANGUAGE_SERVER_DOCUMENT_VERSION ||
    limits.maxLineNumber > MAX_LANGUAGE_SERVER_DOCUMENT_VERSION ||
    limits.maxDocumentUtf16Units > MAX_LANGUAGE_SERVER_DOCUMENT_VERSION
  ) {
    throw new TypeError("Live document limits exceed the downstream integer bound");
  }
}

export function sameLiveDocumentAuthority(
  left: LiveDocumentAuthority,
  right: LiveDocumentAuthority,
): boolean {
  return (
    left.canonicalRoot === right.canonicalRoot &&
    left.documentIdentityKey === right.documentIdentityKey &&
    left.documentIncarnation === right.documentIncarnation &&
    left.modelId === right.modelId &&
    left.modelIncarnation === right.modelIncarnation &&
    left.ownerGeneration === right.ownerGeneration &&
    left.ownerIncarnation === right.ownerIncarnation &&
    left.ownerKey === right.ownerKey &&
    left.path === right.path
  );
}

export function recordLiveDocumentContentChange(
  previous: LiveDocumentContentState,
  authority: LiveDocumentAuthority,
  event: LiveDocumentContentChangeEvent,
  limits: LiveDocumentContentLimits = DEFAULT_LIVE_DOCUMENT_CONTENT_LIMITS,
): RecordLiveDocumentChangeReceipt {
  validateLiveDocumentAuthority(authority);
  validateLiveDocumentContentLimits(limits);
  const priorLive = previous.kind === "live-model" ? previous : null;
  if (priorLive && !sameLiveDocumentAuthority(priorLive.authority, authority)) {
    return Object.freeze({
      mode: "snapshot-required",
      state: requireSnapshotForLiveDocument(priorLive, "invalid-change"),
      work: EMPTY_WORK,
    });
  }
  const fallbackVersion =
    priorLive?.modelVersionId ??
    (previous.kind === "retained" ? previous.modelVersionId : event.modelVersionId - 1);
  const fallbackAlternative =
    priorLive?.alternativeVersionId ??
    (previous.kind === "retained" ? previous.alternativeVersionId : event.alternativeVersionId);
  const fallbackLength =
    priorLive?.utf16Length ?? (previous.kind === "retained" ? previous.utf16Length : null);
  const expectedVersion = priorLive ? priorLive.modelVersionId + 1 : previous.modelVersionId + 1;
  const work = measureEventWork(event, limits);
  let reason = eventReason(event, expectedVersion, fallbackLength, priorLive, work, limits);
  if (
    previous.contentVersion === Number.MAX_SAFE_INTEGER ||
    priorLive?.mutationCount === Number.MAX_SAFE_INTEGER
  ) {
    reason = "version-overflow";
  }

  if (priorLive?.journal.kind === "snapshot-required") {
    reason = priorLive.journal.reason;
  }

  const modelVersionId = boundedModelVersion(event.modelVersionId)
    ? event.modelVersionId
    : fallbackVersion;
  const alternativeVersionId = boundedModelVersion(event.alternativeVersionId)
    ? event.alternativeVersionId
    : fallbackAlternative;
  const utf16Length = validPostLength(event.postUtf16Length, limits)
    ? event.postUtf16Length
    : reason
      ? null
      : fallbackLength;
  const copiedAuthority = freezeAuthority(authority);
  const mutationCount = incrementSaturated(priorLive?.mutationCount ?? 0);
  const contentVersion = incrementSaturated(previous.contentVersion);

  if (reason) {
    const state = Object.freeze({
      alternativeVersionId,
      authority: copiedAuthority,
      contentVersion,
      journal: Object.freeze({ kind: "snapshot-required", reason }),
      kind: "live-model",
      modelVersionId,
      mutationCount,
      utf16Length,
    }) satisfies LiveModelDocumentContentState;
    return Object.freeze({
      mode: "snapshot-required",
      state,
      work: freezeWork(work),
    });
  }

  const copiedEvent = copyEvent(event);
  const priorJournal =
    priorLive?.journal.kind === "incremental" ? priorLive.journal : EMPTY_JOURNAL;
  const journal = Object.freeze({
    changeCount: priorJournal.changeCount + copiedEvent.changes.length,
    eventCount: priorJournal.eventCount + 1,
    events: Object.freeze([
      ...priorJournal.events,
      Object.freeze({
        coordinateTrust: "unvalidated",
        event: copiedEvent,
      }),
    ]),
    insertedUtf16Units: priorJournal.insertedUtf16Units + (work.insertedUtf16Units ?? 0),
    insertedUtf8Bytes: priorJournal.insertedUtf8Bytes + (work.insertedUtf8Bytes ?? 0),
    kind: "incremental",
  }) satisfies LiveDocumentJournal;
  const state = Object.freeze({
    alternativeVersionId,
    authority: copiedAuthority,
    contentVersion,
    journal,
    kind: "live-model",
    modelVersionId,
    mutationCount,
    utf16Length,
  }) satisfies LiveModelDocumentContentState;
  return Object.freeze({
    mode: "incremental",
    state,
    work: freezeWork(work),
  });
}

export function requireSnapshotForLiveDocument(
  state: LiveModelDocumentContentState,
  reason: LiveDocumentSnapshotReason,
): LiveModelDocumentContentState {
  if (state.journal.kind === "snapshot-required") {
    return state;
  }
  return Object.freeze({
    ...state,
    journal: Object.freeze({ kind: "snapshot-required", reason }),
  });
}

export function degradeObservedLiveDocumentMutation(
  previous: LiveDocumentContentState,
  authority: LiveDocumentAuthority,
  reason: LiveDocumentSnapshotReason,
): RecordLiveDocumentChangeReceipt {
  const priorLive = previous.kind === "live-model" ? previous : null;
  const state = Object.freeze({
    alternativeVersionId: priorLive?.alternativeVersionId ?? previous.alternativeVersionId,
    authority: priorLive?.authority ?? freezeAuthority(authority),
    contentVersion: incrementSaturated(previous.contentVersion),
    journal: Object.freeze({ kind: "snapshot-required", reason }),
    kind: "live-model",
    modelVersionId:
      priorLive?.modelVersionId ??
      Math.min(previous.modelVersionId + 1, MAX_LANGUAGE_SERVER_DOCUMENT_VERSION),
    mutationCount: incrementSaturated(priorLive?.mutationCount ?? 0),
    utf16Length: null,
  }) satisfies LiveModelDocumentContentState;
  return Object.freeze({
    mode: "snapshot-required",
    state,
    work: UNKNOWN_WORK,
  });
}

function eventReason(
  event: LiveDocumentContentChangeEvent,
  expectedVersion: number,
  currentLength: number | null,
  priorLive: LiveModelDocumentContentState | null,
  work: MutableWork,
  limits: LiveDocumentContentLimits,
): LiveDocumentSnapshotReason | null {
  if (
    typeof event.isEolChange !== "boolean" ||
    typeof event.isFlush !== "boolean" ||
    typeof event.isRedoing !== "boolean" ||
    typeof event.isUndoing !== "boolean" ||
    (event.isRedoing && event.isUndoing)
  ) {
    return "invalid-change";
  }
  if (
    !positive(event.modelVersionId) ||
    !positive(event.alternativeVersionId) ||
    event.modelVersionId > MAX_LANGUAGE_SERVER_DOCUMENT_VERSION ||
    event.alternativeVersionId > MAX_LANGUAGE_SERVER_DOCUMENT_VERSION ||
    event.modelVersionId !== expectedVersion
  ) {
    return "version-gap";
  }
  if (event.isFlush) return "flush";
  if (event.isEolChange) return "eol-change";
  if (
    !Array.isArray(event.changes) ||
    event.changes.length === 0 ||
    event.changes.length > limits.maxChangesPerEvent
  ) {
    return "change-limit";
  }
  if (!validPostLength(event.postUtf16Length, limits)) {
    return "document-size-limit";
  }
  if (work.unmeasurable) return "invalid-change";
  if (work.limitExceeded) return "inserted-text-limit";
  if (currentLength === null || !validRanges(event.changes, currentLength, limits)) {
    return "invalid-change";
  }
  const expectedPostLength =
    currentLength +
    event.changes.reduce((delta, change) => delta + change.text.length - change.rangeLength, 0);
  if (expectedPostLength !== event.postUtf16Length) {
    return "invalid-change";
  }
  const journal = priorLive?.journal.kind === "incremental" ? priorLive.journal : EMPTY_JOURNAL;
  if (
    journal.eventCount + 1 > limits.maxJournalEvents ||
    journal.changeCount + event.changes.length > limits.maxJournalChanges ||
    journal.insertedUtf16Units + (work.insertedUtf16Units ?? 0) >
      limits.maxJournalInsertedUtf16Units ||
    journal.insertedUtf8Bytes + (work.insertedUtf8Bytes ?? 0) > limits.maxJournalInsertedUtf8Bytes
  ) {
    return "journal-limit";
  }
  return null;
}

interface MutableWork extends LiveDocumentChangeWork {
  limitExceeded: boolean;
  unmeasurable: boolean;
}

function measureEventWork(
  event: LiveDocumentContentChangeEvent,
  limits: LiveDocumentContentLimits,
): MutableWork {
  let insertedUtf16Units = 0;
  let insertedUtf8Bytes: number | null = 0;
  let removedUtf16Units = 0;
  let limitExceeded = false;
  const changes = Array.isArray(event.changes) ? event.changes : [];
  if (changes.length > limits.maxChangesPerEvent) {
    return {
      changeCount: changes.length,
      eventCount: 1,
      fullTextReads: 0,
      insertedUtf16Units: null,
      insertedUtf8Bytes: null,
      removedUtf16Units: null,
      limitExceeded: false,
      unmeasurable: true,
    };
  }
  for (const change of changes) {
    if (typeof change?.text !== "string") {
      return {
        changeCount: changes.length,
        eventCount: 1,
        fullTextReads: 0,
        insertedUtf16Units: null,
        insertedUtf8Bytes: null,
        removedUtf16Units: null,
        limitExceeded: false,
        unmeasurable: true,
      };
    }
    insertedUtf16Units += change.text.length;
    if (nonNegative(change.rangeLength)) {
      removedUtf16Units += change.rangeLength;
    }
    if (
      change.text.length > limits.maxInsertedUtf16UnitsPerChange ||
      insertedUtf16Units > limits.maxJournalInsertedUtf16Units
    ) {
      limitExceeded = true;
      insertedUtf8Bytes = null;
      continue;
    }
    const measured = boundedUtf8Length(change.text, limits.maxInsertedUtf8BytesPerChange);
    if (measured.status === "limit-exceeded") {
      limitExceeded = true;
      insertedUtf8Bytes = null;
      continue;
    }
    if (insertedUtf8Bytes !== null) {
      insertedUtf8Bytes += measured.bytes;
    }
  }
  return {
    changeCount: changes.length,
    eventCount: 1,
    fullTextReads: 0,
    insertedUtf16Units,
    insertedUtf8Bytes,
    removedUtf16Units,
    limitExceeded,
    unmeasurable: false,
  };
}

function validRanges(
  changes: readonly IncrementalDocumentContentChange[],
  currentLength: number,
  limits: LiveDocumentContentLimits,
): boolean {
  let previousOffset = currentLength + 1;
  for (const change of changes) {
    if (
      !nonNegative(change.rangeOffset) ||
      !nonNegative(change.rangeLength) ||
      change.rangeOffset + change.rangeLength > currentLength ||
      change.rangeOffset + change.rangeLength > previousOffset ||
      typeof change.text !== "string" ||
      !validRange(change.range, limits)
    ) {
      return false;
    }
    previousOffset = change.rangeOffset;
  }
  return true;
}

function validRange(
  range: IncrementalDocumentContentChange["range"],
  limits: LiveDocumentContentLimits,
): boolean {
  if (
    !range ||
    !positive(range.startLineNumber) ||
    !positive(range.startColumn) ||
    !positive(range.endLineNumber) ||
    !positive(range.endColumn) ||
    range.startLineNumber > limits.maxLineNumber ||
    range.endLineNumber > limits.maxLineNumber ||
    range.startColumn > limits.maxColumn ||
    range.endColumn > limits.maxColumn
  ) {
    return false;
  }
  return (
    range.startLineNumber < range.endLineNumber ||
    (range.startLineNumber === range.endLineNumber && range.startColumn <= range.endColumn)
  );
}

function copyEvent(event: LiveDocumentContentChangeEvent): LiveDocumentContentChangeEvent {
  return Object.freeze({
    alternativeVersionId: event.alternativeVersionId,
    changes: Object.freeze(
      event.changes.map((change) =>
        Object.freeze({
          range: Object.freeze({
            endColumn: change.range.endColumn,
            endLineNumber: change.range.endLineNumber,
            startColumn: change.range.startColumn,
            startLineNumber: change.range.startLineNumber,
          }),
          rangeLength: change.rangeLength,
          rangeOffset: change.rangeOffset,
          text: change.text,
        }),
      ),
    ),
    isEolChange: event.isEolChange,
    isFlush: event.isFlush,
    isRedoing: event.isRedoing,
    isUndoing: event.isUndoing,
    modelVersionId: event.modelVersionId,
    postUtf16Length: event.postUtf16Length,
  });
}

function freezeAuthority(authority: LiveDocumentAuthority): LiveDocumentAuthority {
  return Object.freeze({
    canonicalRoot: authority.canonicalRoot,
    documentIdentityKey: authority.documentIdentityKey,
    documentIncarnation: authority.documentIncarnation,
    modelId: authority.modelId,
    modelIncarnation: authority.modelIncarnation,
    ownerGeneration: authority.ownerGeneration,
    ownerIncarnation: authority.ownerIncarnation,
    ownerKey: authority.ownerKey,
    path: authority.path,
  });
}

function freezeWork(work: MutableWork): LiveDocumentChangeWork {
  return Object.freeze({
    changeCount: work.changeCount,
    eventCount: 1,
    fullTextReads: 0,
    insertedUtf16Units: work.insertedUtf16Units,
    insertedUtf8Bytes: work.insertedUtf8Bytes,
    removedUtf16Units: work.removedUtf16Units,
  });
}

const EMPTY_JOURNAL: LiveDocumentJournal = Object.freeze({
  changeCount: 0,
  eventCount: 0,
  events: Object.freeze([]),
  insertedUtf16Units: 0,
  insertedUtf8Bytes: 0,
  kind: "incremental",
});
const EMPTY_WORK: LiveDocumentChangeWork = Object.freeze({
  changeCount: 0,
  eventCount: 1,
  fullTextReads: 0,
  insertedUtf16Units: 0,
  insertedUtf8Bytes: 0,
  removedUtf16Units: 0,
});
const UNKNOWN_WORK: LiveDocumentChangeWork = Object.freeze({
  changeCount: 0,
  eventCount: 1,
  fullTextReads: 0,
  insertedUtf16Units: null,
  insertedUtf8Bytes: null,
  removedUtf16Units: null,
});

function validPostLength(value: number, limits: LiveDocumentContentLimits): boolean {
  return nonNegative(value) && value <= limits.maxDocumentUtf16Units;
}

function positive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function boundedModelVersion(value: number): boolean {
  return positive(value) && value <= MAX_LANGUAGE_SERVER_DOCUMENT_VERSION;
}

function nonNegative(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function incrementSaturated(value: number): number {
  return value < Number.MAX_SAFE_INTEGER ? value + 1 : Number.MAX_SAFE_INTEGER;
}

function requirePositive(value: number, name: string): void {
  if (!positive(value)) throw new TypeError(`${name} must be a positive integer`);
}

function requireNonNegative(value: number, name: string): void {
  if (!nonNegative(value)) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
}

function requireText(value: string, name: string): void {
  if (typeof value !== "string" || value.length > 4096 || value.includes("\0")) {
    throw new TypeError(`${name} must be bounded non-empty text`);
  }
  const utf8 = boundedUtf8Length(value, 4096);
  if (utf8.status !== "within-limit" || !value.trim()) {
    throw new TypeError(`${name} must be bounded non-empty text`);
  }
}

function requireObject(value: object, name: string): void {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    throw new TypeError(`${name} must be an object identity`);
  }
}
