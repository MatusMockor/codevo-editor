import { MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS } from "./liveDocumentContentAuthority";

export type LiveDocumentSnapshotPurpose = "change-hunks" | "dirty-search" | "save";

export interface LiveDocumentSnapshotPurposeLimits {
  readonly changeHunksMaxUtf16Units: number;
  readonly dirtySearchMaxUtf16Units: number;
  readonly saveMaxUtf16Units: number;
}

export const HARD_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS: LiveDocumentSnapshotPurposeLimits =
  Object.freeze({
    changeHunksMaxUtf16Units: 256 * 1024,
    dirtySearchMaxUtf16Units: 256 * 1024,
    saveMaxUtf16Units: MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS,
  });

export const DEFAULT_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS =
  HARD_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS;

export function liveDocumentSnapshotUtf16Limit(
  purpose: LiveDocumentSnapshotPurpose,
  limits: LiveDocumentSnapshotPurposeLimits = DEFAULT_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS,
): number {
  validateLiveDocumentSnapshotPurposeLimits(limits);
  switch (purpose) {
    case "change-hunks":
      return limits.changeHunksMaxUtf16Units;
    case "dirty-search":
      return limits.dirtySearchMaxUtf16Units;
    case "save":
      return limits.saveMaxUtf16Units;
    default:
      return assertNever(purpose);
  }
}

export function validateLiveDocumentSnapshotPurposeLimits(
  limits: LiveDocumentSnapshotPurposeLimits,
): void {
  const keys = Object.keys(limits).sort();
  const expected = ["changeHunksMaxUtf16Units", "dirtySearchMaxUtf16Units", "saveMaxUtf16Units"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError("Live document snapshot purpose limits have an invalid shape");
  }
  validateLimit(
    limits.changeHunksMaxUtf16Units,
    HARD_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS.changeHunksMaxUtf16Units,
    "changeHunksMaxUtf16Units",
  );
  validateLimit(
    limits.dirtySearchMaxUtf16Units,
    HARD_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS.dirtySearchMaxUtf16Units,
    "dirtySearchMaxUtf16Units",
  );
  validateLimit(
    limits.saveMaxUtf16Units,
    HARD_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS.saveMaxUtf16Units,
    "saveMaxUtf16Units",
  );
}

function validateLimit(value: number, hardLimit: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > hardLimit) {
    throw new TypeError(`${name} must be a positive integer within its hard limit`);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported live document snapshot purpose: ${String(value)}`);
}
