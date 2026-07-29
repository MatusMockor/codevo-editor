import { describe, expect, it } from "vitest";
import {
  DEFAULT_INCREMENTAL_DOCUMENT_SYNC_LIMITS,
  appendIncrementalDocumentEvent,
  boundedUtf8Length,
  createIncrementalDocumentBatch,
  incrementalEnvelope,
  normalizeDocumentSyncCapability,
  type IncrementalDocumentContentEvent,
} from "./incrementalDocumentSync";

describe("incremental document sync domain", () => {
  it("normalizes numeric and object sync capabilities fail closed", () => {
    expect(normalizeDocumentSyncCapability(0)).toEqual({
      changeKind: "none",
      openClose: false,
      save: { kind: "unsupported" },
    });
    expect(normalizeDocumentSyncCapability(1).changeKind).toBe("full");
    expect(normalizeDocumentSyncCapability(2).changeKind).toBe("incremental");
    expect(
      normalizeDocumentSyncCapability({
        change: 2,
        openClose: true,
        save: { includeText: true },
      }),
    ).toEqual({
      changeKind: "incremental",
      openClose: true,
      save: { includeText: true, kind: "supported" },
    });
    expect(normalizeDocumentSyncCapability({ change: 99, save: "yes" })).toEqual({
      changeKind: "none",
      openClose: false,
      save: { kind: "unsupported" },
    });
  });

  it("projects Monaco UTF-16 positions and surrogate lengths without code-point conversion", () => {
    const initial = createIncrementalDocumentBatch(1, 1, 4);
    const result = appendIncrementalDocumentEvent(
      initial,
      event(2, [
        {
          range: {
            endColumn: 4,
            endLineNumber: 1,
            startColumn: 2,
            startLineNumber: 1,
          },
          rangeLength: 2,
          rangeOffset: 1,
          text: "",
        },
      ]),
    );
    expect(result.status).toBe("accepted");
    expect(result.batch.currentUtf16Length).toBe(2);
    expect(incrementalEnvelope("/workspace/a.ts", 7, result.batch)).toEqual({
      changes: [
        {
          kind: "incremental",
          range: {
            end: { character: 3, line: 0 },
            start: { character: 1, line: 0 },
          },
          rangeLength: 2,
          text: "",
        },
      ],
      kind: "incremental",
      path: "/workspace/a.ts",
      version: 7,
    });
  });

  it("accepts descending non-overlapping multi-cursor edits", () => {
    const result = appendIncrementalDocumentEvent(
      createIncrementalDocumentBatch(10, 10, 12),
      event(11, [change(9, 1, "high", 1, 10, 11), change(2, 2, "low", 1, 3, 5)]),
    );
    expect(result.status).toBe("accepted");
    expect(result.batch.changeCount).toBe(2);
    expect(result.batch.currentUtf16Length).toBe(16);
    const envelope = incrementalEnvelope("/workspace/a.ts", 12, result.batch);
    expect(envelope?.kind).toBe("incremental");
    if (envelope?.kind !== "incremental") throw new Error("Expected incremental envelope");
    expect(envelope.changes.map((item) => item.text)).toEqual(["high", "low"]);
  });

  it("preserves multiline CRLF ranges and UTF-16 surrogate columns exactly", () => {
    const result = appendIncrementalDocumentEvent(createIncrementalDocumentBatch(1, 1, 8), {
      ...event(2, [change(3, 4, "x", 1, 4, 3)]),
      changes: [
        {
          range: {
            endColumn: 3,
            endLineNumber: 2,
            startColumn: 4,
            startLineNumber: 1,
          },
          rangeLength: 4,
          rangeOffset: 3,
          text: "x",
        },
      ],
      eol: "\r\n",
    });
    expect(result.status).toBe("accepted");
    expect(incrementalEnvelope("/workspace/a.ts", 2, result.batch)).toMatchObject({
      changes: [
        {
          range: {
            end: { character: 2, line: 1 },
            start: { character: 3, line: 0 },
          },
          rangeLength: 4,
        },
      ],
    });
  });

  it.each([
    ["undo", { isUndoing: true }],
    ["redo", { isRedoing: true }],
  ] as const)("treats %s as a regular versioned delta", (_label, flags) => {
    const result = appendIncrementalDocumentEvent(
      createIncrementalDocumentBatch(4, 8, 3),
      event(5, [change(1, 1, "x", 1, 2, 3)], flags),
    );
    expect(result.status).toBe("accepted");
  });

  it.each([
    ["flush", { isFlush: true }, "flush"],
    ["EOL", { isEolChange: true }, "eol-change"],
  ] as const)("requires a deferred snapshot for %s events", (_label, flags, reason) => {
    const result = appendIncrementalDocumentEvent(
      createIncrementalDocumentBatch(1, 1, 3),
      event(2, [change(0, 0, "x", 1, 1, 1)], flags),
    );
    expect(result).toMatchObject({ reason, status: "snapshot-required" });
  });

  it.each([
    [
      "overlap",
      event(2, [change(5, 2, "x", 1, 6, 8), change(4, 2, "y", 1, 5, 7)]),
      "invalid-change",
    ],
    ["out of range", event(2, [change(11, 1, "x", 1, 12, 13)]), "invalid-change"],
    ["version gap", event(3, [change(0, 0, "x", 1, 1, 1)]), "version-gap"],
  ] as const)("fails closed for %s", (_label, changed, reason) => {
    const result = appendIncrementalDocumentEvent(
      createIncrementalDocumentBatch(1, 1, 10),
      changed,
    );
    expect(result).toMatchObject({ reason, status: "snapshot-required" });
  });

  it("bounds per-event, per-batch, and inserted-text work", () => {
    const smallLimits = {
      ...DEFAULT_INCREMENTAL_DOCUMENT_SYNC_LIMITS,
      maxChangesPerBatch: 2,
      maxChangesPerEvent: 1,
      maxInsertedUtf8BytesPerBatch: 5,
      maxInsertedUtf8BytesPerChange: 1,
    };
    const tooMany = appendIncrementalDocumentEvent(
      createIncrementalDocumentBatch(1, 1, 4),
      event(2, [change(2, 0, "x", 1, 3, 3), change(0, 0, "y", 1, 1, 1)]),
      smallLimits,
    );
    expect(tooMany).toMatchObject({ reason: "change-limit", status: "snapshot-required" });

    const tooLarge = appendIncrementalDocumentEvent(
      createIncrementalDocumentBatch(1, 1, 4),
      event(2, [change(0, 0, "xx", 1, 1, 1)]),
      smallLimits,
    );
    expect(tooLarge).toMatchObject({
      reason: "inserted-text-limit",
      status: "snapshot-required",
    });
  });

  it("fails closed before the tracked UTF-16 length exceeds a safe integer", () => {
    const result = appendIncrementalDocumentEvent(
      createIncrementalDocumentBatch(1, 1, Number.MAX_SAFE_INTEGER),
      event(2, [change(Number.MAX_SAFE_INTEGER, 0, "x", 1, 1, 1)]),
    );
    expect(result).toMatchObject({ reason: "invalid-change", status: "snapshot-required" });
  });

  it("rejects an oversized paste without traversing its UTF-16 contents", () => {
    const oversized = "x".repeat(1_048_576);
    expect(boundedUtf8Length(oversized, 256 * 1024)).toEqual({
      status: "limit-exceeded",
      visitedUtf16Units: 0,
    });
    const result = appendIncrementalDocumentEvent(
      createIncrementalDocumentBatch(1, 1, 1),
      event(2, [change(0, 0, oversized, 1, 1, 1)]),
    );
    expect(result).toMatchObject({
      reason: "inserted-text-limit",
      status: "snapshot-required",
    });
  });

  it("caps rangeLength to the LSP uinteger maximum", () => {
    const tooLarge = 2_147_483_648;
    const result = appendIncrementalDocumentEvent(
      createIncrementalDocumentBatch(1, 1, tooLarge),
      event(2, [change(0, tooLarge, "", 1, 1, 1)]),
    );
    expect(result).toMatchObject({ reason: "invalid-change", status: "snapshot-required" });
  });

  it("fails closed when a model version would overflow the LSP integer bound", () => {
    const batch = createIncrementalDocumentBatch(2_147_483_647, 2_147_483_647, 1);
    const result = appendIncrementalDocumentEvent(
      batch,
      event(2_147_483_648, [change(1, 0, "x", 1, 2, 2)]),
    );
    expect(result).toMatchObject({
      batch: { finalVersionId: 2_147_483_647 },
      reason: "version-gap",
      status: "snapshot-required",
    });
  });
});

function event(
  versionId: number,
  changes: IncrementalDocumentContentEvent["changes"],
  flags: Partial<
    Pick<IncrementalDocumentContentEvent, "isEolChange" | "isFlush" | "isRedoing" | "isUndoing">
  > = {},
): IncrementalDocumentContentEvent {
  return {
    alternativeVersionId: versionId,
    changes,
    eol: "\n",
    isEolChange: false,
    isFlush: false,
    isRedoing: false,
    isUndoing: false,
    versionId,
    ...flags,
  };
}

function change(
  rangeOffset: number,
  rangeLength: number,
  text: string,
  line: number,
  startColumn: number,
  endColumn: number,
) {
  return {
    range: {
      endColumn,
      endLineNumber: line,
      startColumn,
      startLineNumber: line,
    },
    rangeLength,
    rangeOffset,
    text,
  };
}
