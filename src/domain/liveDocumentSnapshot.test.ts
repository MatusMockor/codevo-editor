import { describe, expect, it } from "vitest";
import { MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS } from "./liveDocumentContentAuthority";
import {
  HARD_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS,
  liveDocumentSnapshotUtf16Limit,
  validateLiveDocumentSnapshotPurposeLimits,
} from "./liveDocumentSnapshot";

describe("live document snapshot policy", () => {
  it("maps every closed purpose to its hard bounded UTF-16 limit", () => {
    expect(liveDocumentSnapshotUtf16Limit("change-hunks")).toBe(
      HARD_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS.changeHunksMaxUtf16Units,
    );
    expect(liveDocumentSnapshotUtf16Limit("dirty-search")).toBe(
      HARD_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS.dirtySearchMaxUtf16Units,
    );
    expect(liveDocumentSnapshotUtf16Limit("save")).toBe(MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS);
    expect(HARD_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS.saveMaxUtf16Units).toBe(
      MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS,
    );
    expect(HARD_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS.changeHunksMaxUtf16Units).toBe(256 * 1024);
    expect(HARD_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS.dirtySearchMaxUtf16Units).toBe(256 * 1024);
  });

  it("rejects unknown fields, zeroes, and values above immutable hard bounds", () => {
    expect(() =>
      validateLiveDocumentSnapshotPurposeLimits({
        ...HARD_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS,
        saveMaxUtf16Units: HARD_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS.saveMaxUtf16Units + 1,
      }),
    ).toThrow(/hard limit/);
    expect(() =>
      validateLiveDocumentSnapshotPurposeLimits({
        ...HARD_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS,
        dirtySearchMaxUtf16Units: 0,
      }),
    ).toThrow(/hard limit/);
    expect(() =>
      validateLiveDocumentSnapshotPurposeLimits({
        ...HARD_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS,
        unexpected: 1,
      } as typeof HARD_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS),
    ).toThrow(/shape/);
  });
});
