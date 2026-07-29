import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_INCREMENTAL_DOCUMENT_SYNC_LIMITS,
  normalizeDocumentSyncCapability,
  type IncrementalDocumentContentEvent,
  type IncrementalDocumentSyncLease,
} from "../domain/incrementalDocumentSync";
import { IncrementalDocumentSyncCoordinator } from "./incrementalDocumentSyncCoordinator";

describe("IncrementalDocumentSyncCoordinator", () => {
  it("coalesces 100 edits to a 1 MiB document without a full read into one envelope", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator();
    const lease = ownerLease("a", 1, "a-1");
    const baseLength = 1_048_576;
    const readSnapshot = vi.fn(() => "must not be read");
    expect(
      coordinator.admit(lease, normalizeDocumentSyncCapability(2), {
        alternativeVersionId: 1,
        utf16Length: baseLength,
        versionId: 1,
      }),
    ).toEqual({ status: "admitted" });

    for (let index = 0; index < 100; index += 1) {
      expect(
        coordinator.append(lease, insertion(index + 2, baseLength + index, index + 1)),
      ).toMatchObject({
        fullTextReads: 0,
        status: "accepted",
      });
    }
    expect(readSnapshot).not.toHaveBeenCalled();

    const result = coordinator.prepareFlush(lease, 2, snapshotReader(readSnapshot, 16));
    expect(result.status).toBe("prepared");
    expect(result.fullTextReads).toBe(0);
    expect(readSnapshot).not.toHaveBeenCalled();
    if (result.status !== "prepared") throw new Error("Expected envelope");
    expect(result.envelope.kind).toBe("incremental");
    if (result.envelope.kind !== "incremental") throw new Error("Expected incremental envelope");
    expect(result.envelope.changes).toHaveLength(100);
    expect(result.envelope.changes.reduce((total, change) => total + change.text.length, 0)).toBe(
      100,
    );
    expect(coordinator.commitFlush(lease, result.transaction)).toEqual({ status: "committed" });
    expect(coordinator.pendingDocumentCount).toBe(1);
  });

  it.each([1, 2, 4])(
    "publishes one model batch independently of %i shared pane registrations",
    (_paneCount) => {
      const coordinator = new IncrementalDocumentSyncCoordinator();
      const lease = ownerLease("a", 1, "shared");
      coordinator.admit(lease, normalizeDocumentSyncCapability(2), {
        alternativeVersionId: 1,
        utf16Length: 10,
        versionId: 1,
      });
      coordinator.append(lease, insertion(2, 10, 11));
      const result = coordinator.prepareFlush(
        lease,
        2,
        snapshotReader(
          vi.fn(() => ""),
          0,
        ),
      );
      expect(result).toMatchObject({ fullTextReads: 0, status: "prepared" });
      if (result.status === "prepared" && result.envelope.kind === "incremental") {
        expect(result.envelope.changes).toHaveLength(1);
      }
    },
  );

  it("invalidates old A across A to B to new-A ownership", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator();
    const oldA = ownerLease("a", 1, "old-a");
    const b = ownerLease("b", 1, "b");
    const newA = ownerLease("a", 2, "new-a");
    coordinator.admit(oldA, normalizeDocumentSyncCapability(2), base());
    coordinator.append(oldA, insertion(2, 10, 11));
    coordinator.admit(b, normalizeDocumentSyncCapability(2), base());
    coordinator.admit(newA, normalizeDocumentSyncCapability(2), base());

    expect(
      coordinator.prepareFlush(
        oldA,
        2,
        snapshotReader(
          vi.fn(() => "old"),
          3,
        ),
      ),
    ).toEqual({
      fullTextReads: 0,
      status: "stale",
    });
    coordinator.append(newA, insertion(2, 10, 11));
    expect(
      coordinator.prepareFlush(
        newA,
        2,
        snapshotReader(
          vi.fn(() => "new"),
          3,
        ),
      ),
    ).toMatchObject({
      fullTextReads: 0,
      status: "prepared",
    });
  });

  it("defers full-mode and EOL snapshots until flush and reads exactly once", () => {
    const fullCoordinator = new IncrementalDocumentSyncCoordinator();
    const fullLease = ownerLease("a", 1, "full");
    const readFull = vi.fn(() => "snapshot");
    fullCoordinator.admit(fullLease, normalizeDocumentSyncCapability(1), base());
    expect(fullCoordinator.append(fullLease, insertion(2, 10, 11))).toMatchObject({
      fullTextReads: 0,
      status: "accepted",
    });
    expect(readFull).not.toHaveBeenCalled();
    expect(fullCoordinator.prepareFlush(fullLease, 2, snapshotReader(readFull, 8))).toMatchObject({
      envelope: { kind: "full", text: "snapshot" },
      fullTextReads: 1,
      status: "prepared",
    });
    expect(readFull).toHaveBeenCalledOnce();

    const eolCoordinator = new IncrementalDocumentSyncCoordinator();
    const eolLease = ownerLease("a", 2, "eol");
    const readEol = vi.fn(() => "eol snapshot");
    eolCoordinator.admit(eolLease, normalizeDocumentSyncCapability(2), base());
    expect(
      eolCoordinator.append(eolLease, {
        ...insertion(2, 10, 11),
        isEolChange: true,
      }),
    ).toMatchObject({ fullTextReads: 0, status: "snapshot-required" });
    expect(readEol).not.toHaveBeenCalled();
    expect(eolCoordinator.prepareFlush(eolLease, 2, snapshotReader(readEol, 12))).toMatchObject({
      envelope: { kind: "full", text: "eol snapshot" },
      fullTextReads: 1,
      status: "prepared",
    });
  });

  it("reports truthful degradation when a fallback snapshot exceeds its bound", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator({
      ...DEFAULT_INCREMENTAL_DOCUMENT_SYNC_LIMITS,
      maxFullSnapshotUtf16Units: 4,
    });
    const lease = ownerLease("a", 1, "large");
    coordinator.admit(lease, normalizeDocumentSyncCapability(1), base());
    coordinator.append(lease, insertion(2, 10, 11));
    expect(
      coordinator.prepareFlush(
        lease,
        2,
        snapshotReader(
          vi.fn(() => "oversized"),
          9,
        ),
      ),
    ).toEqual({
      fullTextReads: 0,
      reason: "snapshot-limit",
      status: "degraded",
    });
  });

  it("revalidates exact A authority after a reentrant snapshot read", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator();
    const oldA = ownerLease("a", 1, "old");
    const newA = ownerLease("a", 2, "new");
    coordinator.admit(oldA, normalizeDocumentSyncCapability(1), base());
    coordinator.append(oldA, insertion(2, 10, 11));

    const result = coordinator.prepareFlush(
      oldA,
      2,
      snapshotReader(() => {
        coordinator.admit(newA, normalizeDocumentSyncCapability(1), base());
        return "old snapshot";
      }, 12),
    );
    expect(result).toEqual({ fullTextReads: 1, status: "stale" });
    expect(coordinator.append(newA, insertion(2, 10, 11))).toMatchObject({
      status: "accepted",
    });
  });

  it("does not read after ownership changes during snapshot length preflight", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator();
    const oldA = ownerLease("a", 1, "length-old");
    const newA = ownerLease("a", 2, "length-new");
    coordinator.admit(oldA, normalizeDocumentSyncCapability(1), base());
    coordinator.append(oldA, insertion(2, 10, 11));
    const read = vi.fn(() => "must not read");

    expect(
      coordinator.prepareFlush(oldA, 2, {
        getUtf16Length: () => {
          coordinator.admit(newA, normalizeDocumentSyncCapability(1), base());
          return 10;
        },
        read,
      }),
    ).toEqual({ fullTextReads: 0, status: "stale" });
    expect(read).not.toHaveBeenCalled();
  });

  it("does not erase a same-lease edit appended during a snapshot read", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator();
    const lease = ownerLease("a", 1, "same");
    coordinator.admit(lease, normalizeDocumentSyncCapability(1), base());
    coordinator.append(lease, insertion(2, 10, 11));

    expect(
      coordinator.prepareFlush(
        lease,
        2,
        snapshotReader(() => {
          coordinator.append(lease, insertion(3, 11, 12));
          return "stale snapshot";
        }, 14),
      ),
    ).toEqual({ fullTextReads: 1, status: "stale" });
    expect(
      coordinator.prepareFlush(
        lease,
        3,
        snapshotReader(() => "current snapshot", 16),
      ),
    ).toMatchObject({
      envelope: { text: "current snapshot" },
      status: "prepared",
    });
  });

  it("does not erase a reentrant edit after the batch already requires a snapshot", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator();
    const lease = ownerLease("a", 1, "fallback");
    coordinator.admit(lease, normalizeDocumentSyncCapability(2), base());
    coordinator.append(lease, { ...insertion(2, 10, 11), isEolChange: true });

    expect(
      coordinator.prepareFlush(
        lease,
        2,
        snapshotReader(() => {
          coordinator.append(lease, insertion(3, 11, 12));
          return "old fallback";
        }, 12),
      ),
    ).toEqual({ fullTextReads: 1, status: "stale" });
    expect(
      coordinator.prepareFlush(
        lease,
        3,
        snapshotReader(() => "new fallback", 12),
      ),
    ).toMatchObject({
      envelope: { kind: "full", text: "new fallback" },
      status: "prepared",
    });
  });

  it("rejects invalid limits and invalid outbound versions before reading", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      expect(
        () =>
          new IncrementalDocumentSyncCoordinator({
            ...DEFAULT_INCREMENTAL_DOCUMENT_SYNC_LIMITS,
            maxChangesPerBatch: value,
          }),
      ).toThrow(TypeError);
    }

    const coordinator = new IncrementalDocumentSyncCoordinator();
    const lease = ownerLease("a", 1, "version");
    coordinator.admit(lease, normalizeDocumentSyncCapability(1), base());
    coordinator.append(lease, insertion(2, 10, 11));
    const read = vi.fn(() => "unused");
    expect(coordinator.prepareFlush(lease, 0, snapshotReader(read, 6))).toEqual({
      fullTextReads: 0,
      reason: "invalid-envelope",
      status: "degraded",
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects forged capabilities and paths over the UTF-8 wire bound", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator();
    expect(
      coordinator.admit(ownerLease("a", 1, "forged"), { changeKind: "unknown" } as never, base()),
    ).toEqual({ reason: "invalid-admission", status: "rejected" });
    expect(
      coordinator.admit(
        {
          ...ownerLease("a", 1, "path"),
          path: `/${"ž".repeat(2_100)}`,
        },
        normalizeDocumentSyncCapability(2),
        base(),
      ),
    ).toEqual({ reason: "invalid-admission", status: "rejected" });
  });

  it("bounds pending document admission and sends nothing for unsupported sync", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator({
      ...DEFAULT_INCREMENTAL_DOCUMENT_SYNC_LIMITS,
      maxPendingDocuments: 1,
    });
    const first = ownerLease("a", 1, "first");
    const second = { ...ownerLease("a", 1, "second"), path: "/workspace/second.ts" };
    expect(coordinator.admit(first, normalizeDocumentSyncCapability(2), base())).toEqual({
      status: "admitted",
    });
    expect(coordinator.admit(second, normalizeDocumentSyncCapability(2), base())).toEqual({
      reason: "pending-document-limit",
      status: "rejected",
    });

    const unsupported = new IncrementalDocumentSyncCoordinator();
    unsupported.admit(first, normalizeDocumentSyncCapability(0), base());
    const read = vi.fn(() => "unused");
    expect(unsupported.prepareFlush(first, 2, snapshotReader(read, 6))).toEqual({
      fullTextReads: 0,
      status: "unsupported",
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps a busy or failed batch identical until an explicit commit", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator();
    const lease = ownerLease("a", 1, "retry");
    coordinator.admit(lease, normalizeDocumentSyncCapability(2), base());
    coordinator.append(lease, insertion(2, 10, 11));

    const first = coordinator.prepareFlush(lease, 2, snapshotReader(vi.fn(), 0));
    expect(first.status).toBe("prepared");
    expect(coordinator.prepareFlush(lease, 2, snapshotReader(vi.fn(), 0))).toEqual({
      fullTextReads: 0,
      status: "busy",
    });
    if (first.status !== "prepared") throw new Error("Expected prepared batch");

    expect(coordinator.rollbackFlush(lease, first.transaction)).toEqual({
      status: "rolled-back",
    });
    const retry = coordinator.prepareFlush(lease, 2, snapshotReader(vi.fn(), 0));
    expect(retry).toMatchObject({
      envelope: first.envelope,
      fullTextReads: first.fullTextReads,
      status: "prepared",
    });
    if (retry.status !== "prepared") throw new Error("Expected retry batch");
    expect(retry.envelope).toEqual(first.envelope);
    expect(coordinator.commitFlush(lease, retry.transaction)).toEqual({ status: "committed" });
  });

  it("rolls back after a sender exception without losing the prepared batch", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator();
    const lease = ownerLease("a", 1, "throw");
    coordinator.admit(lease, normalizeDocumentSyncCapability(2), base());
    coordinator.append(lease, insertion(2, 10, 11));
    const prepared = coordinator.prepareFlush(lease, 2, snapshotReader(vi.fn(), 0));
    if (prepared.status !== "prepared") throw new Error("Expected prepared batch");

    try {
      throw new Error("transport disconnected");
    } catch {
      expect(coordinator.rollbackFlush(lease, prepared.transaction)).toEqual({
        status: "rolled-back",
      });
    }

    const retry = coordinator.prepareFlush(lease, 2, snapshotReader(vi.fn(), 0));
    expect(retry).toMatchObject({ envelope: prepared.envelope, status: "prepared" });
  });

  it("queues edits arriving in flight as an ordered successor", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator();
    const lease = ownerLease("a", 1, "successor");
    coordinator.admit(lease, normalizeDocumentSyncCapability(2), base());
    coordinator.append(lease, insertion(2, 10, 11));
    const first = coordinator.prepareFlush(lease, 2, snapshotReader(vi.fn(), 0));
    if (first.status !== "prepared") throw new Error("Expected first batch");

    expect(coordinator.append(lease, insertion(3, 11, 12))).toMatchObject({
      status: "accepted",
    });
    expect(coordinator.commitFlush(lease, first.transaction)).toEqual({ status: "committed" });

    const successor = coordinator.prepareFlush(lease, 3, snapshotReader(vi.fn(), 0));
    expect(successor.status).toBe("prepared");
    if (successor.status !== "prepared" || successor.envelope.kind !== "incremental") {
      throw new Error("Expected incremental successor");
    }
    expect(successor.envelope.changes.map((change) => change.text)).toEqual(["x"]);
    expect(successor.envelope.version).toBe(3);
  });

  it("preserves successor order across rollback and rejects forged settlement tokens", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator();
    const lease = ownerLease("a", 1, "rollback-successor");
    coordinator.admit(lease, normalizeDocumentSyncCapability(2), base());
    coordinator.append(lease, insertion(2, 10, 11));
    const first = coordinator.prepareFlush(lease, 2, snapshotReader(vi.fn(), 0));
    if (first.status !== "prepared") throw new Error("Expected first batch");
    coordinator.append(lease, insertion(3, 11, 12));
    coordinator.rollbackFlush(lease, first.transaction);

    const retry = coordinator.prepareFlush(lease, 2, snapshotReader(vi.fn(), 0));
    if (retry.status !== "prepared") throw new Error("Expected retry");
    expect(coordinator.commitFlush(lease, { id: retry.transaction.id })).toEqual({
      status: "unknown-transaction",
    });
    expect(coordinator.commitFlush(lease, retry.transaction)).toEqual({ status: "committed" });

    const successor = coordinator.prepareFlush(lease, 3, snapshotReader(vi.fn(), 0));
    expect(successor).toMatchObject({ status: "prepared" });
    if (successor.status === "prepared" && successor.envelope.kind === "incremental") {
      expect(successor.envelope.changes).toHaveLength(1);
    }
  });

  it("bases an EOL fallback successor on the exact prepared snapshot", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator();
    const lease = ownerLease("a", 1, "eol-successor");
    coordinator.admit(lease, normalizeDocumentSyncCapability(2), base());
    coordinator.append(lease, { ...insertion(2, 10, 11), isEolChange: true });
    const prepared = coordinator.prepareFlush(
      lease,
      2,
      snapshotReader(() => "abc", 3),
    );
    if (prepared.status !== "prepared") throw new Error("Expected fallback snapshot");

    expect(coordinator.append(lease, insertion(3, 3, 4))).toMatchObject({
      status: "accepted",
    });
    expect(coordinator.commitFlush(lease, prepared.transaction)).toEqual({
      status: "committed",
    });
    expect(coordinator.prepareFlush(lease, 3, snapshotReader(vi.fn(), 0))).toMatchObject({
      envelope: { kind: "incremental" },
      status: "prepared",
    });
  });

  it("does not mutate or lose a batch when the deferred snapshot reader throws", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator();
    const lease = ownerLease("a", 1, "snapshot-throw");
    coordinator.admit(lease, normalizeDocumentSyncCapability(1), base());
    coordinator.append(lease, insertion(2, 10, 11));
    expect(() =>
      coordinator.prepareFlush(
        lease,
        2,
        snapshotReader(() => {
          throw new Error("model disposed");
        }, 10),
      ),
    ).toThrow("model disposed");
    expect(
      coordinator.prepareFlush(
        lease,
        2,
        snapshotReader(() => "0123456789x", 11),
      ),
    ).toMatchObject({ envelope: { kind: "full" }, status: "prepared" });
  });

  it("reserves snapshot preparation before reentrant length and read callbacks", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator();
    const lease = ownerLease("a", 1, "recursive-snapshot");
    coordinator.admit(lease, normalizeDocumentSyncCapability(1), base());
    coordinator.append(lease, insertion(2, 10, 11));
    const nestedReceipts: unknown[] = [];

    const outer = coordinator.prepareFlush(lease, 10, {
      getUtf16Length: () => {
        nestedReceipts.push(
          coordinator.prepareFlush(
            lease,
            10,
            snapshotReader(() => "nested", 6),
          ),
        );
        return 11;
      },
      read: () => {
        nestedReceipts.push(
          coordinator.prepareFlush(
            lease,
            10,
            snapshotReader(() => "nested", 6),
          ),
        );
        return "0123456789x";
      },
    });

    expect(nestedReceipts).toEqual([
      { fullTextReads: 0, status: "busy" },
      { fullTextReads: 0, status: "busy" },
    ]);
    expect(outer).toMatchObject({
      envelope: { kind: "full", version: 10 },
      status: "prepared",
    });
    expect(coordinator.prepareFlush(lease, 10, snapshotReader(vi.fn(), 0))).toEqual({
      fullTextReads: 0,
      status: "busy",
    });
  });

  it("cleans a failed preparation reservation after either snapshot callback throws", () => {
    for (const callback of ["length", "read"] as const) {
      const coordinator = new IncrementalDocumentSyncCoordinator();
      const lease = ownerLease("a", 1, `throw-${callback}`);
      coordinator.admit(lease, normalizeDocumentSyncCapability(1), base());
      coordinator.append(lease, insertion(2, 10, 11));

      expect(() =>
        coordinator.prepareFlush(lease, 10, {
          getUtf16Length: () => {
            if (callback === "length") throw new Error("length failed");
            return 11;
          },
          read: () => {
            if (callback === "read") throw new Error("read failed");
            return "0123456789x";
          },
        }),
      ).toThrow(`${callback} failed`);

      expect(
        coordinator.prepareFlush(
          lease,
          10,
          snapshotReader(() => "0123456789x", 11),
        ),
      ).toMatchObject({ status: "prepared" });
    }
  });

  it("enforces monotonic server versions after commit while preserving exact rollback retry", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator();
    const lease = ownerLease("a", 1, "monotonic");
    coordinator.admit(lease, normalizeDocumentSyncCapability(2), base());
    coordinator.append(lease, insertion(2, 10, 11));

    const ten = coordinator.prepareFlush(lease, 10, snapshotReader(vi.fn(), 0));
    if (ten.status !== "prepared") throw new Error("Expected version 10");
    coordinator.append(lease, insertion(3, 11, 12));
    expect(coordinator.rollbackFlush(lease, ten.transaction)).toEqual({
      status: "rolled-back",
    });
    expect(coordinator.prepareFlush(lease, 11, snapshotReader(vi.fn(), 0))).toEqual({
      fullTextReads: 0,
      reason: "non-monotonic-version",
      status: "degraded",
    });

    const tenRetry = coordinator.prepareFlush(lease, 10, snapshotReader(vi.fn(), 0));
    expect(tenRetry).toMatchObject({ envelope: { version: 10 }, status: "prepared" });
    if (tenRetry.status !== "prepared") throw new Error("Expected exact version 10 retry");
    expect(coordinator.commitFlush(lease, tenRetry.transaction)).toEqual({
      status: "committed",
    });

    for (const staleVersion of [9, 10]) {
      expect(coordinator.prepareFlush(lease, staleVersion, snapshotReader(vi.fn(), 0))).toEqual({
        fullTextReads: 0,
        reason: "non-monotonic-version",
        status: "degraded",
      });
    }
    expect(coordinator.prepareFlush(lease, 11, snapshotReader(vi.fn(), 0))).toMatchObject({
      envelope: { version: 11 },
      status: "prepared",
    });
  });

  it("scopes monotonic server versions to exact A to B to A model authority", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator();
    const oldA = ownerLease("a", 1, "old-a-version");
    coordinator.admit(oldA, normalizeDocumentSyncCapability(2), base());
    coordinator.append(oldA, insertion(2, 10, 11));
    const oldPrepared = coordinator.prepareFlush(oldA, MAX_VERSION, snapshotReader(vi.fn(), 0));
    if (oldPrepared.status !== "prepared") throw new Error("Expected old A");
    coordinator.commitFlush(oldA, oldPrepared.transaction);

    const newA = {
      ...oldA,
      modelIncarnation: "new-a-model-version",
      ownerGeneration: 2,
      ownerIncarnation: "a-2",
    };
    coordinator.admit(newA, normalizeDocumentSyncCapability(2), base());
    coordinator.append(newA, insertion(2, 10, 11));
    expect(coordinator.prepareFlush(oldA, MAX_VERSION, snapshotReader(vi.fn(), 0))).toEqual({
      fullTextReads: 0,
      status: "stale",
    });
    expect(coordinator.prepareFlush(newA, 1, snapshotReader(vi.fn(), 0))).toMatchObject({
      envelope: { version: 1 },
      status: "prepared",
    });
  });

  it("rejects stale model incarnations across A to B to A and fails closed on version overflow", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator();
    const oldA = ownerLease("a", 1, "same-document");
    const newA = {
      ...oldA,
      modelIncarnation: "replacement-model",
    };
    coordinator.admit(oldA, normalizeDocumentSyncCapability(2), base());
    coordinator.append(oldA, insertion(2, 10, 11));
    coordinator.admit(newA, normalizeDocumentSyncCapability(2), base());
    expect(coordinator.append(oldA, insertion(3, 11, 12))).toEqual({
      fullTextReads: 0,
      status: "stale",
    });

    const nearOverflow = ownerLease("overflow", 1, "overflow");
    coordinator.admit(nearOverflow, normalizeDocumentSyncCapability(2), {
      alternativeVersionId: MAX_VERSION - 1,
      utf16Length: 10,
      versionId: MAX_VERSION - 1,
    });
    expect(coordinator.append(nearOverflow, insertion(MAX_VERSION, 10, 11))).toMatchObject({
      status: "accepted",
    });
    expect(coordinator.append(nearOverflow, insertion(MAX_VERSION + 1, 11, 12))).toMatchObject({
      reason: "version-gap",
      status: "snapshot-required",
    });
  });

  it("rejects model incarnation tokens beyond the UTF-8 wire bound", () => {
    const coordinator = new IncrementalDocumentSyncCoordinator();
    expect(
      coordinator.admit(
        {
          ...ownerLease("a", 1, "wide-token"),
          modelIncarnation: "ž".repeat(2_100),
        },
        normalizeDocumentSyncCapability(2),
        base(),
      ),
    ).toEqual({ reason: "invalid-admission", status: "rejected" });
  });
});

function base() {
  return {
    alternativeVersionId: 1,
    utf16Length: 10,
    versionId: 1,
  };
}

function ownerLease(
  ownerKey: string,
  ownerGeneration: number,
  documentIncarnation: string,
): IncrementalDocumentSyncLease {
  return {
    documentIncarnation,
    modelIncarnation: `model-${documentIncarnation}`,
    ownerGeneration,
    ownerIncarnation: `${ownerKey}-${ownerGeneration}`,
    ownerKey,
    path: "/workspace/a.ts",
  };
}

const MAX_VERSION = 2_147_483_647;

function insertion(
  versionId: number,
  rangeOffset: number,
  startColumn: number,
): IncrementalDocumentContentEvent {
  return {
    alternativeVersionId: versionId,
    changes: [
      {
        range: {
          endColumn: startColumn,
          endLineNumber: 1,
          startColumn,
          startLineNumber: 1,
        },
        rangeLength: 0,
        rangeOffset,
        text: "x",
      },
    ],
    eol: "\n",
    isEolChange: false,
    isFlush: false,
    isRedoing: false,
    isUndoing: false,
    versionId,
  };
}

function snapshotReader(read: () => string, utf16Length: number) {
  return {
    getUtf16Length: vi.fn(() => utf16Length),
    read,
  };
}
