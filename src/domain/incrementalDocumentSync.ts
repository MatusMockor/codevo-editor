export type DocumentSyncChangeKind = "none" | "full" | "incremental";

export type DocumentSyncSaveCapability =
  { readonly kind: "unsupported" } | { readonly includeText: boolean; readonly kind: "supported" };

export interface NegotiatedDocumentSyncCapability {
  readonly changeKind: DocumentSyncChangeKind;
  readonly openClose: boolean;
  readonly save: DocumentSyncSaveCapability;
}

export interface IncrementalDocumentSyncLimits {
  readonly maxChangesPerBatch: number;
  readonly maxChangesPerEvent: number;
  readonly maxEventsPerBatch: number;
  readonly maxFullSnapshotUtf16Units: number;
  readonly maxInsertedUtf8BytesPerBatch: number;
  readonly maxInsertedUtf8BytesPerChange: number;
  readonly maxPendingDocuments: number;
}

export const DEFAULT_INCREMENTAL_DOCUMENT_SYNC_LIMITS: IncrementalDocumentSyncLimits =
  Object.freeze({
    maxChangesPerBatch: 256,
    maxChangesPerEvent: 64,
    maxEventsPerBatch: 256,
    maxFullSnapshotUtf16Units: 2 * 1024 * 1024,
    maxInsertedUtf8BytesPerBatch: 512 * 1024,
    maxInsertedUtf8BytesPerChange: 256 * 1024,
    maxPendingDocuments: 32,
  });

export interface IncrementalDocumentSyncLease {
  readonly documentIncarnation: string;
  /**
   * Opaque, bounded identity for one concrete editor-model lifetime.
   *
   * This is deliberately a wire-safe token rather than a Monaco model object.
   */
  readonly modelIncarnation: string;
  readonly ownerGeneration: number;
  readonly ownerIncarnation: string;
  readonly ownerKey: string;
  readonly path: string;
}

export interface IncrementalDocumentRange {
  readonly endColumn: number;
  readonly endLineNumber: number;
  readonly startColumn: number;
  readonly startLineNumber: number;
}

export interface IncrementalDocumentContentChange {
  readonly range: IncrementalDocumentRange;
  readonly rangeLength: number;
  readonly rangeOffset: number;
  readonly text: string;
}

export interface IncrementalDocumentContentEvent {
  readonly alternativeVersionId: number;
  readonly changes: readonly IncrementalDocumentContentChange[];
  readonly eol: string;
  readonly isEolChange: boolean;
  readonly isFlush: boolean;
  readonly isRedoing: boolean;
  readonly isUndoing: boolean;
  readonly versionId: number;
}

export type BoundedUtf8LengthReceipt =
  | {
      readonly bytes: number;
      readonly status: "within-limit";
      readonly visitedUtf16Units: number;
    }
  | {
      readonly status: "limit-exceeded";
      readonly visitedUtf16Units: number;
    };

export interface LanguageServerPositionDto {
  readonly character: number;
  readonly line: number;
}

export interface LanguageServerRangeDto {
  readonly end: LanguageServerPositionDto;
  readonly start: LanguageServerPositionDto;
}

export interface LanguageServerIncrementalChangeDto {
  readonly kind: "incremental";
  readonly range: LanguageServerRangeDto;
  readonly rangeLength: number;
  readonly text: string;
}

export type LanguageServerDocumentChangeEnvelope =
  | {
      readonly changes: readonly LanguageServerIncrementalChangeDto[];
      readonly kind: "incremental";
      readonly path: string;
      readonly version: number;
    }
  | {
      readonly kind: "full";
      readonly path: string;
      readonly text: string;
      readonly version: number;
    };

export type IncrementalDocumentFallbackReason =
  | "batch-change-limit"
  | "batch-event-limit"
  | "change-limit"
  | "eol-change"
  | "flush"
  | "inserted-text-limit"
  | "invalid-change"
  | "version-gap";

export const MAX_LANGUAGE_SERVER_DOCUMENT_VERSION = 2_147_483_647;

export interface IncrementalDocumentBatch {
  readonly changeCount: number;
  readonly currentUtf16Length: number;
  readonly events: readonly IncrementalDocumentContentEvent[];
  readonly fallbackReason: IncrementalDocumentFallbackReason | null;
  readonly finalAlternativeVersionId: number;
  readonly finalVersionId: number;
  readonly insertedUtf8Bytes: number;
}

export type AppendIncrementalDocumentEventResult =
  | {
      readonly batch: IncrementalDocumentBatch;
      readonly status: "accepted";
    }
  | {
      readonly batch: IncrementalDocumentBatch;
      readonly reason: IncrementalDocumentFallbackReason;
      readonly status: "snapshot-required";
    };

export function normalizeDocumentSyncCapability(value: unknown): NegotiatedDocumentSyncCapability {
  if (typeof value === "number") {
    return Object.freeze({
      changeKind: changeKind(value),
      openClose: false,
      save: UNSUPPORTED_SAVE,
    });
  }
  if (!isRecord(value)) {
    return NO_DOCUMENT_SYNC;
  }

  return Object.freeze({
    changeKind: changeKind(value.change),
    openClose: value.openClose === true,
    save: normalizeSaveCapability(value.save),
  });
}

export function createIncrementalDocumentBatch(
  versionId: number,
  alternativeVersionId: number,
  utf16Length: number,
): IncrementalDocumentBatch {
  if (
    !positiveSafeInteger(versionId) ||
    versionId > MAX_LANGUAGE_SERVER_DOCUMENT_VERSION ||
    !positiveSafeInteger(alternativeVersionId) ||
    !nonNegativeSafeInteger(utf16Length)
  ) {
    throw new TypeError("Invalid incremental document batch base.");
  }

  return freezeBatch({
    changeCount: 0,
    currentUtf16Length: utf16Length,
    events: [],
    fallbackReason: null,
    finalAlternativeVersionId: alternativeVersionId,
    finalVersionId: versionId,
    insertedUtf8Bytes: 0,
  });
}

export function appendIncrementalDocumentEvent(
  batch: IncrementalDocumentBatch,
  event: IncrementalDocumentContentEvent,
  limits: IncrementalDocumentSyncLimits = DEFAULT_INCREMENTAL_DOCUMENT_SYNC_LIMITS,
): AppendIncrementalDocumentEventResult {
  if (batch.fallbackReason) {
    return snapshotRequired(batch, batch.fallbackReason);
  }

  const reason = eventFallbackReason(batch, event, limits);
  if (reason) {
    return snapshotRequired(
      freezeBatch({
        ...batch,
        fallbackReason: reason,
        finalAlternativeVersionId: validVersionOr(
          event.alternativeVersionId,
          batch.finalAlternativeVersionId,
        ),
        finalVersionId: validVersionOr(event.versionId, batch.finalVersionId),
      }),
      reason,
    );
  }

  const insertedUtf8Bytes = event.changes.reduce(
    (total, change) => total + conservativeUtf8Bytes(change.text),
    0,
  );
  const nextLength =
    batch.currentUtf16Length +
    event.changes.reduce((delta, change) => delta + change.text.length - change.rangeLength, 0);
  const copiedEvent = copyEvent(event);
  const next = freezeBatch({
    changeCount: batch.changeCount + copiedEvent.changes.length,
    currentUtf16Length: nextLength,
    events: [...batch.events, copiedEvent],
    fallbackReason: null,
    finalAlternativeVersionId: copiedEvent.alternativeVersionId,
    finalVersionId: copiedEvent.versionId,
    insertedUtf8Bytes: batch.insertedUtf8Bytes + insertedUtf8Bytes,
  });

  return { batch: next, status: "accepted" };
}

export function incrementalEnvelope(
  path: string,
  version: number,
  batch: IncrementalDocumentBatch,
): LanguageServerDocumentChangeEnvelope | null {
  if (
    !validPath(path) ||
    !positiveSafeInteger(version) ||
    version > MAX_LANGUAGE_SERVER_DOCUMENT_VERSION ||
    batch.fallbackReason ||
    batch.events.length === 0
  ) {
    return null;
  }

  return Object.freeze({
    changes: Object.freeze(
      batch.events.flatMap((event) => event.changes.map(toLanguageServerChange)),
    ),
    kind: "incremental",
    path,
    version,
  });
}

export function fullEnvelope(
  path: string,
  version: number,
  text: string,
): LanguageServerDocumentChangeEnvelope | null {
  if (
    !validPath(path) ||
    !positiveSafeInteger(version) ||
    version > MAX_LANGUAGE_SERVER_DOCUMENT_VERSION ||
    typeof text !== "string"
  ) {
    return null;
  }
  return Object.freeze({ kind: "full", path, text, version });
}

export function validDocumentSyncPath(path: string): boolean {
  return validPath(path);
}

export function boundedUtf8Length(value: string, limit: number): BoundedUtf8LengthReceipt {
  if (!nonNegativeSafeInteger(limit) || value.length > limit) {
    return { status: "limit-exceeded", visitedUtf16Units: 0 };
  }
  let bytes = 0;
  let visitedUtf16Units = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    visitedUtf16Units += 1;
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
        visitedUtf16Units += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > limit) {
      return { status: "limit-exceeded", visitedUtf16Units };
    }
  }
  return { bytes, status: "within-limit", visitedUtf16Units };
}

function eventFallbackReason(
  batch: IncrementalDocumentBatch,
  event: IncrementalDocumentContentEvent,
  limits: IncrementalDocumentSyncLimits,
): IncrementalDocumentFallbackReason | null {
  if (event.isFlush) return "flush";
  if (event.isEolChange) return "eol-change";
  if (
    typeof event.isFlush !== "boolean" ||
    typeof event.isEolChange !== "boolean" ||
    typeof event.isRedoing !== "boolean" ||
    typeof event.isUndoing !== "boolean" ||
    (event.eol !== "\n" && event.eol !== "\r\n")
  ) {
    return "invalid-change";
  }
  if (
    !positiveSafeInteger(event.versionId) ||
    event.versionId > MAX_LANGUAGE_SERVER_DOCUMENT_VERSION ||
    event.versionId !== batch.finalVersionId + 1
  ) {
    return "version-gap";
  }
  if (!positiveSafeInteger(event.alternativeVersionId)) return "invalid-change";
  if (
    !Array.isArray(event.changes) ||
    event.changes.length === 0 ||
    event.changes.length > limits.maxChangesPerEvent
  ) {
    return "change-limit";
  }
  if (batch.events.length + 1 > limits.maxEventsPerBatch) return "batch-event-limit";
  if (batch.changeCount + event.changes.length > limits.maxChangesPerBatch) {
    return "batch-change-limit";
  }

  let previousOffset = batch.currentUtf16Length;
  let insertedBytes = 0;
  let lengthDelta = 0;
  for (const change of event.changes) {
    if (!validChange(change, batch.currentUtf16Length, previousOffset)) {
      return "invalid-change";
    }
    const remainingBatchBytes =
      limits.maxInsertedUtf8BytesPerBatch - batch.insertedUtf8Bytes - insertedBytes;
    const byteLimit = Math.min(limits.maxInsertedUtf8BytesPerChange, remainingBatchBytes);
    const measured = boundedUtf8Length(change.text, byteLimit);
    if (measured.status === "limit-exceeded") {
      return "inserted-text-limit";
    }
    const changeBytes = measured.bytes;
    insertedBytes += changeBytes;
    lengthDelta += change.text.length - change.rangeLength;
    previousOffset = change.rangeOffset;
  }
  if (
    !Number.isSafeInteger(lengthDelta) ||
    !Number.isSafeInteger(batch.currentUtf16Length + lengthDelta) ||
    batch.currentUtf16Length + lengthDelta < 0
  ) {
    return "invalid-change";
  }
  if (batch.insertedUtf8Bytes + insertedBytes > limits.maxInsertedUtf8BytesPerBatch) {
    return "inserted-text-limit";
  }
  return null;
}

function validChange(
  change: IncrementalDocumentContentChange,
  currentLength: number,
  previousOffset: number,
): boolean {
  if (
    !isRecord(change) ||
    typeof change.text !== "string" ||
    !nonNegativeSafeInteger(change.rangeOffset) ||
    !nonNegativeSafeInteger(change.rangeLength) ||
    change.rangeLength > MAX_LANGUAGE_SERVER_DOCUMENT_VERSION ||
    change.rangeOffset + change.rangeLength > currentLength ||
    change.rangeOffset + change.rangeLength > previousOffset ||
    !validRange(change.range)
  ) {
    return false;
  }
  return true;
}

function validRange(value: unknown): value is IncrementalDocumentRange {
  if (!isRecord(value)) return false;
  const { startLineNumber, startColumn, endLineNumber, endColumn } = value;
  if (
    !positiveSafeInteger(startLineNumber) ||
    !positiveSafeInteger(startColumn) ||
    !positiveSafeInteger(endLineNumber) ||
    !positiveSafeInteger(endColumn) ||
    startLineNumber > MAX_LANGUAGE_SERVER_DOCUMENT_VERSION ||
    startColumn > MAX_LANGUAGE_SERVER_DOCUMENT_VERSION ||
    endLineNumber > MAX_LANGUAGE_SERVER_DOCUMENT_VERSION ||
    endColumn > MAX_LANGUAGE_SERVER_DOCUMENT_VERSION
  ) {
    return false;
  }
  return (
    endLineNumber > startLineNumber ||
    (endLineNumber === startLineNumber && endColumn >= startColumn)
  );
}

function copyEvent(event: IncrementalDocumentContentEvent): IncrementalDocumentContentEvent {
  return Object.freeze({
    alternativeVersionId: event.alternativeVersionId,
    changes: Object.freeze(
      event.changes.map((change) =>
        Object.freeze({
          range: Object.freeze({ ...change.range }),
          rangeLength: change.rangeLength,
          rangeOffset: change.rangeOffset,
          text: change.text,
        }),
      ),
    ),
    eol: event.eol,
    isEolChange: event.isEolChange,
    isFlush: event.isFlush,
    isRedoing: event.isRedoing,
    isUndoing: event.isUndoing,
    versionId: event.versionId,
  });
}

function toLanguageServerChange(
  change: IncrementalDocumentContentChange,
): LanguageServerIncrementalChangeDto {
  return Object.freeze({
    kind: "incremental",
    range: Object.freeze({
      end: Object.freeze({
        character: change.range.endColumn - 1,
        line: change.range.endLineNumber - 1,
      }),
      start: Object.freeze({
        character: change.range.startColumn - 1,
        line: change.range.startLineNumber - 1,
      }),
    }),
    rangeLength: change.rangeLength,
    text: change.text,
  });
}

function freezeBatch(batch: IncrementalDocumentBatch): IncrementalDocumentBatch {
  return Object.freeze({
    ...batch,
    events: Object.freeze([...batch.events]),
  });
}

function snapshotRequired(
  batch: IncrementalDocumentBatch,
  reason: IncrementalDocumentFallbackReason,
): AppendIncrementalDocumentEventResult {
  return { batch, reason, status: "snapshot-required" };
}

function normalizeSaveCapability(value: unknown): DocumentSyncSaveCapability {
  if (value === true) return SUPPORTED_SAVE_WITHOUT_TEXT;
  if (!isRecord(value)) return UNSUPPORTED_SAVE;
  return Object.freeze({
    includeText: value.includeText === true,
    kind: "supported",
  });
}

function changeKind(value: unknown): DocumentSyncChangeKind {
  if (value === 1) return "full";
  if (value === 2) return "incremental";
  return "none";
}

function conservativeUtf8Bytes(value: string): number {
  const measured = boundedUtf8Length(value, Number.MAX_SAFE_INTEGER);
  return measured.status === "within-limit" ? measured.bytes : Number.MAX_SAFE_INTEGER;
}

function validVersionOr(value: number, fallback: number): number {
  return positiveSafeInteger(value) && value <= MAX_LANGUAGE_SERVER_DOCUMENT_VERSION
    ? value
    : fallback;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 4_096 &&
    conservativeUtf8Bytes(path) <= 4_096 &&
    !path.includes("\0")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const UNSUPPORTED_SAVE: DocumentSyncSaveCapability = Object.freeze({
  kind: "unsupported",
});
const SUPPORTED_SAVE_WITHOUT_TEXT: DocumentSyncSaveCapability = Object.freeze({
  includeText: false,
  kind: "supported",
});
const NO_DOCUMENT_SYNC: NegotiatedDocumentSyncCapability = Object.freeze({
  changeKind: "none",
  openClose: false,
  save: UNSUPPORTED_SAVE,
});
