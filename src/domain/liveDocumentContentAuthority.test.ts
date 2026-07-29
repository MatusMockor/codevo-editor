import { describe, expect, it } from "vitest";
import {
  createRetainedDocumentContentState,
  DEFAULT_LIVE_DOCUMENT_CONTENT_LIMITS,
  MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS,
  recordLiveDocumentContentChange,
  sameLiveDocumentAuthority,
  type LiveDocumentAuthority,
  type LiveDocumentContentChangeEvent,
  type LiveDocumentContentState,
} from "./liveDocumentContentAuthority";

function authority(overrides: Partial<LiveDocumentAuthority> = {}): LiveDocumentAuthority {
  return {
    canonicalRoot: "/workspace",
    documentIdentityKey: "inode:1",
    documentIncarnation: DOCUMENT,
    modelId: "file:///workspace/a.ts",
    modelIncarnation: MODEL,
    ownerGeneration: 1,
    ownerIncarnation: OWNER,
    ownerKey: "workspace-owner",
    path: "/workspace/a.ts",
    ...overrides,
  };
}

function event(
  modelVersionId: number,
  postUtf16Length: number,
  overrides: Partial<LiveDocumentContentChangeEvent> = {},
): LiveDocumentContentChangeEvent {
  return {
    alternativeVersionId: modelVersionId,
    changes: [
      {
        range: {
          endColumn: 1,
          endLineNumber: 1,
          startColumn: 1,
          startLineNumber: 1,
        },
        rangeLength: 0,
        rangeOffset: postUtf16Length - 1,
        text: "x",
      },
    ],
    isEolChange: false,
    isFlush: false,
    isRedoing: false,
    isUndoing: false,
    modelVersionId,
    postUtf16Length,
    ...overrides,
  };
}

const OWNER = {};
const DOCUMENT = {};
const MODEL = {};

describe("live document content authority", () => {
  it("uses exact owner, document, and model incarnations for A-B-A fencing", () => {
    const current = authority();
    expect(sameLiveDocumentAuthority(current, { ...current })).toBe(true);
    expect(
      sameLiveDocumentAuthority(current, {
        ...current,
        ownerIncarnation: {},
      }),
    ).toBe(false);
    expect(
      sameLiveDocumentAuthority(current, {
        ...current,
        documentIncarnation: {},
      }),
    ).toBe(false);
    expect(
      sameLiveDocumentAuthority(current, {
        ...current,
        modelIncarnation: {},
      }),
    ).toBe(false);
  });

  it("records 100 edits on a 1 MiB document without full-text reads", () => {
    let state: LiveDocumentContentState = createRetainedDocumentContentState({
      alternativeVersionId: 1,
      contentVersion: 1,
      modelVersionId: 1,
      utf16Length: 1024 * 1024,
      utf8Bytes: 1024 * 1024,
    });
    let fullTextReads = 0;
    let insertedUtf16Units = 0;
    let insertedUtf8Bytes = 0;
    for (let index = 0; index < 100; index += 1) {
      const result = recordLiveDocumentContentChange(
        state,
        authority(),
        event(index + 2, 1024 * 1024 + index + 1),
      );
      state = result.state;
      fullTextReads += result.work.fullTextReads;
      insertedUtf16Units += result.work.insertedUtf16Units ?? 0;
      insertedUtf8Bytes += result.work.insertedUtf8Bytes ?? 0;
    }
    expect(state).toMatchObject({
      kind: "live-model",
      modelVersionId: 101,
      mutationCount: 100,
      utf16Length: 1024 * 1024 + 100,
    });
    expect({ fullTextReads, insertedUtf16Units, insertedUtf8Bytes }).toEqual({
      fullTextReads: 0,
      insertedUtf16Units: 100,
      insertedUtf8Bytes: 100,
    });
  });

  it.each([3, 5, 10])("records 100 metadata-only edits on a %i MiB document", (sizeMiB) => {
    const finalLength = sizeMiB * 1024 * 1024;
    let state: LiveDocumentContentState = createRetainedDocumentContentState({
      alternativeVersionId: 1,
      contentVersion: 1,
      modelVersionId: 1,
      utf16Length: finalLength - 100,
      utf8Bytes: finalLength - 100,
    });
    for (let index = 0; index < 100; index += 1) {
      const result = recordLiveDocumentContentChange(
        state,
        authority(),
        event(index + 2, finalLength - 99 + index),
      );
      expect(result.work.fullTextReads).toBe(0);
      expect(result.mode).toBe("incremental");
      state = result.state;
    }
    expect(state.utf16Length).toBe(finalLength);
  });

  it("keeps the exact 10 MiB boundary and degrades only above it", () => {
    const exact = recordLiveDocumentContentChange(
      createRetainedDocumentContentState({
        alternativeVersionId: 1,
        contentVersion: 1,
        modelVersionId: 1,
        utf16Length: MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS - 1,
        utf8Bytes: MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS - 1,
      }),
      authority(),
      event(2, MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS),
    );
    expect(exact).toMatchObject({
      mode: "incremental",
      state: { utf16Length: MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS },
    });

    const oversized = recordLiveDocumentContentChange(
      exact.state,
      authority(),
      event(3, MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS + 1),
    );
    expect(oversized).toMatchObject({
      mode: "snapshot-required",
      state: {
        journal: { kind: "snapshot-required", reason: "document-size-limit" },
        utf16Length: null,
      },
    });
  });

  it("preserves multicursor order and counts surrogate payloads exactly", () => {
    const retained = createRetainedDocumentContentState({
      alternativeVersionId: 1,
      contentVersion: 1,
      modelVersionId: 1,
      utf16Length: 12,
      utf8Bytes: 14,
    });
    const result = recordLiveDocumentContentChange(
      retained,
      authority(),
      event(2, 13, {
        changes: [
          {
            range: {
              endColumn: 1,
              endLineNumber: 1,
              startColumn: 1,
              startLineNumber: 1,
            },
            rangeLength: 1,
            rangeOffset: 9,
            text: "XY",
          },
          {
            range: {
              endColumn: 1,
              endLineNumber: 1,
              startColumn: 1,
              startLineNumber: 1,
            },
            rangeLength: 2,
            rangeOffset: 1,
            text: "🙂",
          },
        ],
      }),
    );
    expect(result.mode).toBe("incremental");
    expect(result.work).toMatchObject({
      insertedUtf16Units: 4,
      insertedUtf8Bytes: 6,
      removedUtf16Units: 3,
    });
    expect(
      result.state.journal.kind === "incremental"
        ? result.state.journal.events[0]?.event.changes.map((change) => change.rangeOffset)
        : null,
    ).toEqual([9, 1]);
  });

  it.each([
    ["version-gap", event(4, 13)],
    ["flush", event(2, 13, { isFlush: true })],
    ["eol-change", event(2, 13, { isEolChange: true })],
  ] as const)("degrades %s without rejecting the observed mutation", (reason, changed) => {
    const result = recordLiveDocumentContentChange(
      createRetainedDocumentContentState({
        alternativeVersionId: 1,
        contentVersion: 1,
        modelVersionId: 1,
        utf16Length: 12,
        utf8Bytes: 14,
      }),
      authority(),
      changed,
    );
    expect(result).toMatchObject({
      mode: "snapshot-required",
      state: {
        contentVersion: 2,
        journal: { kind: "snapshot-required", reason },
        kind: "live-model",
        mutationCount: 1,
      },
    });
  });

  it("clears the journal and preserves live authority on cap overflow", () => {
    const limits = {
      ...DEFAULT_LIVE_DOCUMENT_CONTENT_LIMITS,
      maxJournalInsertedUtf16Units: 1,
      maxJournalInsertedUtf8Bytes: 1,
    };
    const first = recordLiveDocumentContentChange(
      createRetainedDocumentContentState({
        alternativeVersionId: 1,
        contentVersion: 1,
        modelVersionId: 1,
        utf16Length: 2,
        utf8Bytes: 2,
      }),
      authority(),
      event(2, 3),
      limits,
    );
    const second = recordLiveDocumentContentChange(first.state, authority(), event(3, 4), limits);
    expect(second).toMatchObject({
      mode: "snapshot-required",
      state: {
        authority: authority(),
        journal: { kind: "snapshot-required", reason: "journal-limit" },
        kind: "live-model",
        mutationCount: 2,
        utf16Length: 4,
      },
    });
  });

  it("fails closed when a prior live journal is presented to another authority", () => {
    const first = recordLiveDocumentContentChange(
      createRetainedDocumentContentState({
        alternativeVersionId: 1,
        contentVersion: 1,
        modelVersionId: 1,
        utf16Length: 2,
        utf8Bytes: 2,
      }),
      authority(),
      event(2, 3),
    );
    const foreign = recordLiveDocumentContentChange(
      first.state,
      authority({ modelIncarnation: {} }),
      event(3, 4),
    );
    expect(foreign).toMatchObject({
      mode: "snapshot-required",
      state: {
        authority: first.state.authority,
        journal: { kind: "snapshot-required", reason: "invalid-change" },
        mutationCount: 1,
      },
    });
  });

  it("degrades malformed coordinates and a dishonest post length", () => {
    const base = createRetainedDocumentContentState({
      alternativeVersionId: 1,
      contentVersion: 1,
      modelVersionId: 1,
      utf16Length: 2,
      utf8Bytes: 2,
    });
    expect(recordLiveDocumentContentChange(base, authority(), event(2, 99)).mode).toBe(
      "snapshot-required",
    );
    expect(
      recordLiveDocumentContentChange(
        base,
        authority(),
        event(2, 3, {
          changes: [
            {
              range: {
                endColumn: 1,
                endLineNumber: 1,
                startColumn: 0,
                startLineNumber: 1,
              },
              rangeLength: 0,
              rangeOffset: 2,
              text: "x",
            },
          ],
        }),
      ).mode,
    ).toBe("snapshot-required");
  });

  it("accepts coordinate caps exactly and degrades N+1", () => {
    const base = createRetainedDocumentContentState({
      alternativeVersionId: 1,
      contentVersion: 1,
      modelVersionId: 1,
      utf16Length: 2,
      utf8Bytes: 2,
    });
    const limits = {
      ...DEFAULT_LIVE_DOCUMENT_CONTENT_LIMITS,
      maxColumn: 2,
      maxLineNumber: 2,
    };
    expect(
      recordLiveDocumentContentChange(
        base,
        authority(),
        event(2, 3, {
          changes: [
            {
              range: {
                endColumn: 2,
                endLineNumber: 2,
                startColumn: 2,
                startLineNumber: 2,
              },
              rangeLength: 0,
              rangeOffset: 2,
              text: "x",
            },
          ],
        }),
        limits,
      ).mode,
    ).toBe("incremental");
    expect(
      recordLiveDocumentContentChange(
        base,
        authority(),
        event(2, 3, {
          changes: [
            {
              range: {
                endColumn: 3,
                endLineNumber: 2,
                startColumn: 2,
                startLineNumber: 2,
              },
              rangeLength: 0,
              rangeOffset: 2,
              text: "x",
            },
          ],
        }),
        limits,
      ).mode,
    ).toBe("snapshot-required");
  });

  it("degrades contradictory undo/redo metadata and bounds identities by UTF-8", () => {
    const base = createRetainedDocumentContentState({
      alternativeVersionId: 1,
      contentVersion: 1,
      modelVersionId: 1,
      utf16Length: 2,
      utf8Bytes: 2,
    });
    expect(
      recordLiveDocumentContentChange(
        base,
        authority(),
        event(2, 3, { isRedoing: true, isUndoing: true }),
      ),
    ).toMatchObject({
      mode: "snapshot-required",
      state: { journal: { reason: "invalid-change" } },
    });
    expect(() =>
      recordLiveDocumentContentChange(base, authority({ modelId: "🙂".repeat(2048) }), event(2, 3)),
    ).toThrow(/bounded/);
  });

  it("marks unmeasured oversized payload work as unknown", () => {
    const base = createRetainedDocumentContentState({
      alternativeVersionId: 1,
      contentVersion: 1,
      modelVersionId: 1,
      utf16Length: 2,
      utf8Bytes: 2,
    });
    const manyChanges = Array.from({ length: 65 }, () => ({
      range: {
        endColumn: 1,
        endLineNumber: 1,
        startColumn: 1,
        startLineNumber: 1,
      },
      rangeLength: 0,
      rangeOffset: 2,
      text: "🙂",
    }));
    expect(
      recordLiveDocumentContentChange(base, authority(), event(2, 132, { changes: manyChanges })),
    ).toMatchObject({
      mode: "snapshot-required",
      work: {
        insertedUtf16Units: null,
        insertedUtf8Bytes: null,
        removedUtf16Units: null,
      },
    });
    expect(
      recordLiveDocumentContentChange(
        base,
        authority(),
        event(2, 4, {
          changes: [{ ...manyChanges[0]!, text: "🙂" }],
        }),
        {
          ...DEFAULT_LIVE_DOCUMENT_CONTENT_LIMITS,
          maxInsertedUtf16UnitsPerChange: 1,
        },
      ).work.insertedUtf8Bytes,
    ).toBeNull();
  });

  it("rejects downstream cap N+1 and degrades version rollover representably", () => {
    const invalidLimits = {
      ...DEFAULT_LIVE_DOCUMENT_CONTENT_LIMITS,
      maxColumn: 2_147_483_648,
    };
    expect(() =>
      recordLiveDocumentContentChange(
        createRetainedDocumentContentState({
          alternativeVersionId: 1,
          contentVersion: 1,
          modelVersionId: 1,
          utf16Length: 2,
          utf8Bytes: 2,
        }),
        authority(),
        event(2, 3),
        invalidLimits,
      ),
    ).toThrow(/downstream/);
    expect(
      recordLiveDocumentContentChange(
        createRetainedDocumentContentState({
          alternativeVersionId: 1,
          contentVersion: Number.MAX_SAFE_INTEGER,
          modelVersionId: 1,
          utf16Length: 2,
          utf8Bytes: 2,
        }),
        authority(),
        event(2, 3),
      ),
    ).toMatchObject({
      mode: "snapshot-required",
      state: {
        contentVersion: Number.MAX_SAFE_INTEGER,
        journal: { reason: "version-overflow" },
      },
    });
    const maximumBase = createRetainedDocumentContentState({
      alternativeVersionId: 2_147_483_647,
      contentVersion: 1,
      modelVersionId: 2_147_483_647,
      utf16Length: 2,
      utf8Bytes: 2,
    });
    expect(
      recordLiveDocumentContentChange(
        maximumBase,
        authority(),
        event(2_147_483_648, 3, {
          alternativeVersionId: 2_147_483_648,
        }),
      ),
    ).toMatchObject({
      mode: "snapshot-required",
      state: {
        alternativeVersionId: 2_147_483_647,
        modelVersionId: 2_147_483_647,
      },
    });
  });

  it("copies only closed authority and event fields", () => {
    const oversizedExtra = "x".repeat(100_000);
    const changedEvent = {
      ...event(2, 3),
      changes: [
        {
          ...event(2, 3).changes[0]!,
          extraPayload: oversizedExtra,
        },
      ],
      extraPayload: oversizedExtra,
    } as unknown as LiveDocumentContentChangeEvent;
    const result = recordLiveDocumentContentChange(
      createRetainedDocumentContentState({
        alternativeVersionId: 1,
        contentVersion: 1,
        modelVersionId: 1,
        utf16Length: 2,
        utf8Bytes: 2,
      }),
      { ...authority(), extraPayload: oversizedExtra } as LiveDocumentAuthority,
      changedEvent,
    );
    expect(
      "extraPayload" in
        (result.state.authority as LiveDocumentAuthority & {
          extraPayload?: string;
        }),
    ).toBe(false);
    if (result.state.journal.kind === "incremental") {
      expect(
        "extraPayload" in
          (result.state.journal.events[0]!.event as LiveDocumentContentChangeEvent & {
            extraPayload?: string;
          }),
      ).toBe(false);
      expect(
        "extraPayload" in
          (result.state.journal.events[0]!.event.changes[0]! as {
            extraPayload?: string;
          }),
      ).toBe(false);
    }
    expect(() =>
      recordLiveDocumentContentChange(
        createRetainedDocumentContentState({
          alternativeVersionId: 1,
          contentVersion: 1,
          modelVersionId: 1,
          utf16Length: 2,
          utf8Bytes: 2,
        }),
        authority({ modelId: "bad\0identity" }),
        event(2, 3),
      ),
    ).toThrow(/bounded/);
  });

  it("marks every work metric unknown for a malformed runtime change", () => {
    const malformed = event(2, 3, {
      changes: [
        {
          range: {
            endColumn: 1,
            endLineNumber: 1,
            startColumn: 1,
            startLineNumber: 1,
          },
          rangeLength: 0,
          rangeOffset: 2,
          text: 42,
        },
      ],
    } as unknown as Partial<LiveDocumentContentChangeEvent>);
    expect(
      recordLiveDocumentContentChange(
        createRetainedDocumentContentState({
          alternativeVersionId: 1,
          contentVersion: 1,
          modelVersionId: 1,
          utf16Length: 2,
          utf8Bytes: 2,
        }),
        authority(),
        malformed,
      ),
    ).toMatchObject({
      mode: "snapshot-required",
      state: { journal: { reason: "invalid-change" } },
      work: {
        insertedUtf16Units: null,
        insertedUtf8Bytes: null,
        removedUtf16Units: null,
      },
    });
  });
});
