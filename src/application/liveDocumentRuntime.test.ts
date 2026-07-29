import { describe, expect, it, vi } from "vitest";
import type {
  LiveDocumentAuthority,
  LiveDocumentContentChangeEvent,
} from "../domain/liveDocumentContentAuthority";
import type {
  LiveDocumentSnapshotReadExpectation,
  LiveDocumentSnapshotSourcePort,
} from "./liveDocumentSnapshotSourcePort";
import { LiveDocumentRuntime } from "./liveDocumentRuntime";

const OWNER = Object.freeze({});
const DOCUMENT = Object.freeze({});
const MODEL = Object.freeze({});

function authority(overrides: Partial<LiveDocumentAuthority> = {}): LiveDocumentAuthority {
  return Object.freeze({
    canonicalRoot: "/workspace",
    documentIdentityKey: "file:src/a.ts",
    documentIncarnation: DOCUMENT,
    modelId: "file:///workspace/src/a.ts",
    modelIncarnation: MODEL,
    ownerGeneration: 1,
    ownerIncarnation: OWNER,
    ownerKey: "owner",
    path: "/workspace/src/a.ts",
    ...overrides,
  });
}

class FakeSource implements LiveDocumentSnapshotSourcePort {
  readonly sourceAuthority = Object.freeze({});
  alternativeVersionId = 1;
  modelVersionId = 1;
  reads = 0;

  constructor(
    readonly modelAuthority: object,
    public text: string,
  ) {}

  probe() {
    return Object.freeze({
      alternativeVersionId: this.alternativeVersionId,
      modelVersionId: this.modelVersionId,
      status: "available" as const,
      utf16Length: this.text.length,
    });
  }

  readFullText(expectation: LiveDocumentSnapshotReadExpectation) {
    this.reads += 1;
    if (
      expectation.modelAuthority !== this.modelAuthority ||
      expectation.sourceAuthority !== this.sourceAuthority
    ) {
      throw new Error("foreign expectation");
    }
    return Object.freeze({
      alternativeVersionId: this.alternativeVersionId,
      modelAuthority: this.modelAuthority,
      modelVersionId: this.modelVersionId,
      sourceAuthority: this.sourceAuthority,
      text: this.text,
      utf16Length: this.text.length,
    });
  }
}

function register(
  runtime: LiveDocumentRuntime,
  exactAuthority = authority(),
  source = new FakeSource(exactAuthority.modelIncarnation, "abc"),
  holderIdentity: object = Object.freeze({}),
) {
  const receipt = runtime.register({
    authority: exactAuthority,
    base: {
      alternativeVersionId: source.alternativeVersionId,
      contentVersion: 1,
      modelVersionId: source.modelVersionId,
      utf16Length: source.text.length,
      utf8Bytes: source.text.length,
    },
    holderIdentity,
    source,
  });
  if (receipt.status !== "registered") {
    throw new Error(`registration failed: ${receipt.status}`);
  }
  return { handle: receipt.handle, receipt, source };
}

function edit(source: FakeSource, text: string): LiveDocumentContentChangeEvent {
  const previousLength = source.text.length;
  source.text = text;
  source.alternativeVersionId += 1;
  source.modelVersionId += 1;
  return Object.freeze({
    alternativeVersionId: source.alternativeVersionId,
    changes: Object.freeze([
      Object.freeze({
        range: Object.freeze({
          endColumn: previousLength + 1,
          endLineNumber: 1,
          startColumn: 1,
          startLineNumber: 1,
        }),
        rangeLength: previousLength,
        rangeOffset: 0,
        text,
      }),
    ]),
    isEolChange: false,
    isFlush: false,
    isRedoing: false,
    isUndoing: false,
    modelVersionId: source.modelVersionId,
    postUtf16Length: text.length,
  });
}

describe("LiveDocumentRuntime", () => {
  it("captures and consumes a current change-hunks snapshot without exposing a reservation", () => {
    const runtime = new LiveDocumentRuntime();
    const { handle, source } = register(runtime);
    const listener = vi.fn();
    const unsubscribe = runtime.subscribe(handle, listener);

    const recorded = handle.recordChange(edit(source, "abcd"));

    expect(recorded.status).toBe("committed");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(handle.currentRevision());

    const captured = runtime.capture(handle, new AbortController().signal);
    expect(captured.status).toBe("captured");
    if (captured.status !== "captured") return;
    expect(captured.snapshot).toMatchObject({
      content: "abcd",
      purpose: "change-hunks",
    });
    expect(runtime.consumeCurrent(handle, captured.snapshot)).toBe(true);
    expect(runtime.release(handle, captured.snapshot)).toBe(false);

    unsubscribe();
    expect(runtime.retire(handle)).toBe(true);
    expect(handle.currentRevision()).toBeNull();
  });

  it("reuses one exact payload across closed save and dirty-search captures", () => {
    const runtime = new LiveDocumentRuntime();
    const { handle, source } = register(runtime);
    expect(handle.recordChange(edit(source, "abcd"))).toMatchObject({
      status: "committed",
    });

    const save = runtime.captureForSave(handle);
    const search = runtime.captureForDirtySearch(handle);

    expect(save.status).toBe("captured");
    expect(search.status).toBe("captured");
    expect(source.reads).toBe(1);
    if (save.status !== "captured" || search.status !== "captured") return;
    expect(save.snapshot).toMatchObject({ content: "abcd", purpose: "save" });
    expect(search.snapshot).toMatchObject({ content: "abcd", purpose: "dirty-search" });
    expect(save.snapshot.snapshotAuthority).not.toBe(search.snapshot.snapshotAuthority);
    expect(runtime.release(handle, save.snapshot)).toBe(true);
    expect(runtime.release(handle, search.snapshot)).toBe(true);
  });

  it("enforces each closed purpose limit before reading the live source", () => {
    const runtime = new LiveDocumentRuntime();
    const { handle, source } = register(runtime);
    expect(handle.recordChange(edit(source, "x".repeat(256 * 1024 + 1)))).toMatchObject({
      status: "committed",
    });

    expect(runtime.captureForDirtySearch(handle)).toEqual({
      reason: "document-too-large",
      status: "rejected",
    });
    expect(source.reads).toBe(0);

    const save = runtime.captureForSave(handle);
    expect(save.status).toBe("captured");
    expect(source.reads).toBe(1);
    if (save.status === "captured") {
      expect(save.snapshot.purpose).toBe("save");
      expect(runtime.release(handle, save.snapshot)).toBe(true);
    }
  });

  it("makes an earlier purpose snapshot stale after an exact live edit", () => {
    const runtime = new LiveDocumentRuntime();
    const { handle, source } = register(runtime);
    expect(handle.recordChange(edit(source, "abcd"))).toMatchObject({ status: "committed" });
    const captured = runtime.captureForSave(handle);
    expect(captured.status).toBe("captured");
    if (captured.status !== "captured") return;

    expect(handle.recordChange(edit(source, "abcde"))).toMatchObject({ status: "committed" });
    expect(runtime.consumeCurrent(handle, captured.snapshot)).toBe(false);
    expect(runtime.release(handle, captured.snapshot)).toBe(false);
  });

  it("rejects aborted purpose capture and releases an unconsumed snapshot once", () => {
    const runtime = new LiveDocumentRuntime();
    const { handle, source } = register(runtime);
    expect(handle.recordChange(edit(source, "abcd"))).toMatchObject({ status: "committed" });
    const controller = new AbortController();
    controller.abort();

    expect(runtime.captureForSave(handle, controller.signal)).toEqual({
      reason: "aborted",
      status: "rejected",
    });
    expect(source.reads).toBe(0);

    const captured = runtime.captureForDirtySearch(handle);
    expect(captured.status).toBe("captured");
    if (captured.status !== "captured") return;
    expect(runtime.release(handle, captured.snapshot)).toBe(true);
    expect(runtime.release(handle, captured.snapshot)).toBe(false);
  });

  it.each([1, 2, 4])(
    "shares one exact source payload across closed-purpose captures from %i joined handles",
    (holderCount) => {
      const runtime = new LiveDocumentRuntime();
      const exactAuthority = authority();
      const source = new FakeSource(exactAuthority.modelIncarnation, "abc");
      const holders = Array.from({ length: holderCount }, (_, index) =>
        register(runtime, exactAuthority, source, Object.freeze({ index })),
      );
      expect(holders[0]!.handle.recordChange(edit(source, "abcd"))).toMatchObject({
        status: "committed",
      });

      const captures = holders.map(({ handle }, index) =>
        index % 2 === 0 ? runtime.captureForSave(handle) : runtime.captureForDirtySearch(handle),
      );

      expect(captures.every(({ status }) => status === "captured")).toBe(true);
      expect(source.reads).toBe(1);
      captures.forEach((capture, index) => {
        if (capture.status !== "captured") return;
        expect(capture.snapshot.content).toBe("abcd");
        expect(runtime.release(holders[index]!.handle, capture.snapshot)).toBe(true);
      });
    },
  );

  it("rejects cloned and stale handles at every snapshot boundary", () => {
    const runtime = new LiveDocumentRuntime();
    const { handle } = register(runtime);
    const cloned = Object.freeze({ ...handle });

    expect(runtime.capture(cloned, new AbortController().signal)).toEqual({
      reason: "stale",
      status: "rejected",
    });
    expect(() => runtime.subscribe(cloned, vi.fn())).toThrow("stale live document handle");
    expect(runtime.retire(handle)).toBe(true);
    expect(runtime.capture(handle, new AbortController().signal)).toEqual({
      reason: "stale",
      status: "rejected",
    });
    expect(() => runtime.subscribe(handle, vi.fn())).toThrow("stale live document handle");
  });

  it("contains observer failures and enforces per-handle and global caps", () => {
    const runtime = new LiveDocumentRuntime({
      maxObservers: 2,
      maxObserversPerHandle: 2,
    });
    const { handle, source } = register(runtime);
    const throwing = vi.fn(() => {
      throw new Error("observer failed");
    });
    const second = vi.fn();
    const overLimit = vi.fn();
    runtime.subscribe(handle, throwing);
    runtime.subscribe(handle, second);
    expect(() => runtime.subscribe(handle, overLimit)).toThrow("observer limit");

    expect(() => handle.recordChange(edit(source, "abcd"))).not.toThrow();
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(overLimit).not.toHaveBeenCalled();
  });

  it("does not leak global observer capacity through duplicate callback identities", () => {
    const runtime = new LiveDocumentRuntime({
      maxObservers: 1,
      maxObserversPerHandle: 1,
    });
    const first = register(runtime);
    const duplicate = vi.fn();
    const unsubscribe = runtime.subscribe(first.handle, duplicate);

    expect(() => runtime.subscribe(first.handle, duplicate)).toThrow("already subscribed");
    unsubscribe();

    const secondAuthority = authority({
      documentIdentityKey: "file:src/b.ts",
      documentIncarnation: Object.freeze({}),
      modelId: "file:///workspace/src/b.ts",
      modelIncarnation: Object.freeze({}),
      path: "/workspace/src/b.ts",
    });
    const second = register(runtime, secondAuthority);
    const admitted = vi.fn();
    expect(() => runtime.subscribe(second.handle, admitted)).not.toThrow();
    expect(second.handle.recordChange(edit(second.source, "abcd")).status).toBe("committed");
    expect(admitted).toHaveBeenCalledOnce();
  });

  it("continues notifying active observers after a pending observer is removed", () => {
    const runtime = new LiveDocumentRuntime();
    const { handle, source } = register(runtime);
    const first = vi.fn();
    const removed = vi.fn();
    const last = vi.fn();
    let unsubscribeRemoved: () => void = () => undefined;
    runtime.subscribe(handle, (revision) => {
      first(revision);
      unsubscribeRemoved();
    });
    unsubscribeRemoved = runtime.subscribe(handle, removed);
    runtime.subscribe(handle, last);

    expect(handle.recordChange(edit(source, "abcd")).status).toBe("committed");
    expect(first).toHaveBeenCalledOnce();
    expect(removed).not.toHaveBeenCalled();
    expect(last).toHaveBeenCalledOnce();
  });

  it.each([1, 2, 4])(
    "publishes one exact revision to every observer across %i joined holders",
    (holderCount) => {
      const runtime = new LiveDocumentRuntime();
      const exactAuthority = authority();
      const source = new FakeSource(exactAuthority.modelIncarnation, "abc");
      const holders = Array.from({ length: holderCount }, (_, index) =>
        register(runtime, exactAuthority, source, Object.freeze({ index })),
      );
      const observers = holders.map(() => vi.fn());
      holders.forEach(({ handle }, index) => runtime.subscribe(handle, observers[index]!));

      expect(holders[0]!.handle.recordChange(edit(source, "abcd")).status).toBe("committed");

      observers.forEach((observer) => {
        expect(observer).toHaveBeenCalledOnce();
        expect(observer).toHaveBeenLastCalledWith(holders[0]!.handle.currentRevision());
      });
    },
  );

  it("preserves channel-wide revision order during a joined observer's reentrant edit", () => {
    const runtime = new LiveDocumentRuntime();
    const exactAuthority = authority();
    const source = new FakeSource(exactAuthority.modelIncarnation, "abc");
    const ingress = register(runtime, exactAuthority, source, Object.freeze({ ingress: true }));
    const joined = register(runtime, exactAuthority, source, Object.freeze({ joined: true }));
    const ingressVersions: number[] = [];
    const joinedVersions: number[] = [];
    runtime.subscribe(ingress.handle, (revision) => {
      ingressVersions.push(revision.modelVersionId);
      if (revision.modelVersionId === 2) {
        ingress.handle.recordChange(edit(source, "abcde"));
      }
    });
    runtime.subscribe(joined.handle, (revision) => joinedVersions.push(revision.modelVersionId));

    expect(ingress.handle.recordChange(edit(source, "abcd")).status).toBe("committed");
    expect(ingressVersions).toEqual([2, 3]);
    expect(joinedVersions).toEqual([2, 3]);
  });

  it("delivers distinct bounded reentrant events once to every joined observer", () => {
    const runtime = new LiveDocumentRuntime();
    const exactAuthority = authority();
    const source = new FakeSource(exactAuthority.modelIncarnation, "abc");
    const ingress = register(runtime, exactAuthority, source, Object.freeze({ ingress: true }));
    const joined = register(runtime, exactAuthority, source, Object.freeze({ joined: true }));
    const joinedVersions: number[] = [];
    let firstNested = false;
    let secondNested = false;
    runtime.subscribe(ingress.handle, (revision) => {
      if (revision.modelVersionId === 2 && !firstNested) {
        firstNested = true;
        ingress.handle.recordChange(edit(source, "abcde"));
      }
    });
    runtime.subscribe(ingress.handle, (revision) => {
      if (revision.modelVersionId === 2 && !secondNested) {
        secondNested = true;
        ingress.handle.recordChange(edit(source, "abcdef"));
      }
    });
    runtime.subscribe(joined.handle, (revision) => joinedVersions.push(revision.modelVersionId));

    expect(ingress.handle.recordChange(edit(source, "abcd")).status).toBe("committed");
    expect(joinedVersions).toEqual([2, 3, 4]);
  });

  it("invalidates and permits a clean rebind when bounded publication admission is exhausted", () => {
    const runtime = new LiveDocumentRuntime();
    const exactAuthority = authority();
    const source = new FakeSource(exactAuthority.modelIncarnation, "abc");
    const { handle } = register(runtime, exactAuthority, source, Object.freeze({ ingress: true }));
    const joined = register(runtime, exactAuthority, source, Object.freeze({ joined: true }));
    let nested = 0;
    const receipts: ReturnType<typeof handle.recordChange>[] = [];
    const joinedVersions: number[] = [];
    runtime.subscribe(handle, () => {
      nested += 1;
      if (nested < 100) {
        receipts.push(handle.recordChange(edit(source, `${source.text}x`)));
      }
    });
    runtime.subscribe(joined.handle, (revision) => joinedVersions.push(revision.modelVersionId));

    expect(() => handle.recordChange(edit(source, "abcd"))).not.toThrow();
    expect(nested).toBe(16);
    expect(receipts).toHaveLength(16);
    expect(receipts.slice(0, -1).every(({ status }) => status === "committed")).toBe(true);
    expect(receipts[receipts.length - 1]).toEqual({
      reason: "notification-backpressure",
      status: "rejected",
    });
    expect(joinedVersions).toEqual(Array.from({ length: 16 }, (_, index) => index + 2));
    expect(handle.currentRevision()).toBeNull();
    expect(joined.handle.currentRevision()).toBeNull();
    expect(runtime.capture(handle, new AbortController().signal)).toEqual({
      reason: "stale",
      status: "rejected",
    });

    const rebound = register(runtime, exactAuthority, source, Object.freeze({ rebound: true }));
    expect(rebound.receipt.role).toBe("registered");
    expect(rebound.handle.currentRevision()?.modelVersionId).toBe(18);
    expect(rebound.handle.recordChange(edit(source, `${source.text}y`))).toMatchObject({
      revision: { modelVersionId: 19 },
      status: "committed",
    });
  });

  it("retires an edited channel completely so the same authority can register again", () => {
    const runtime = new LiveDocumentRuntime();
    const exactAuthority = authority();
    const first = register(runtime, exactAuthority);
    expect(first.handle.recordChange(edit(first.source, "abcd")).status).toBe("committed");
    const captured = runtime.capture(first.handle, new AbortController().signal);
    expect(captured.status).toBe("captured");

    expect(runtime.retire(first.handle)).toBe(true);
    expect(first.handle.currentRevision()).toBeNull();
    if (captured.status === "captured") {
      expect(runtime.release(first.handle, captured.snapshot)).toBe(false);
    }

    const second = register(runtime, exactAuthority, first.source);
    expect(second.receipt.role).toBe("registered");
    expect(second.handle).not.toBe(first.handle);
    expect(runtime.retire(second.handle)).toBe(true);
  });

  it("fails old A handles closed across an A-B-A owner generation switch", () => {
    const runtime = new LiveDocumentRuntime();
    const firstA = register(runtime);
    expect(runtime.retire(firstA.handle)).toBe(true);

    const bAuthority = authority({
      canonicalRoot: "/other",
      documentIdentityKey: "file:src/b.ts",
      documentIncarnation: Object.freeze({}),
      modelId: "file:///other/src/b.ts",
      modelIncarnation: Object.freeze({}),
      ownerGeneration: 2,
      ownerIncarnation: Object.freeze({}),
      ownerKey: "owner-b",
      path: "/other/src/b.ts",
    });
    const b = register(runtime, bAuthority);
    expect(runtime.retire(b.handle)).toBe(true);

    const nextA = authority({
      documentIncarnation: Object.freeze({}),
      modelIncarnation: Object.freeze({}),
      ownerGeneration: 3,
      ownerIncarnation: Object.freeze({}),
    });
    const secondA = register(runtime, nextA);
    expect(firstA.handle.currentRevision()).toBeNull();
    expect(runtime.capture(firstA.handle, new AbortController().signal).status).toBe("rejected");
    expect(runtime.captureForSave(firstA.handle).status).toBe("rejected");
    expect(runtime.captureForDirtySearch(firstA.handle).status).toBe("rejected");
    expect(secondA.handle.currentRevision()).not.toBeNull();
  });

  it("releases a joined holder without discarding the remaining exact channel", () => {
    const runtime = new LiveDocumentRuntime();
    const exactAuthority = authority();
    const source = new FakeSource(exactAuthority.modelIncarnation, "abc");
    const ingress = register(runtime, exactAuthority, source, Object.freeze({ ingress: true }));
    const joined = register(runtime, exactAuthority, source, Object.freeze({ joined: true }));

    expect(joined.receipt.role).toBe("joined");
    expect(runtime.retire(joined.handle)).toBe(true);
    expect(ingress.handle.currentRevision()).not.toBeNull();
    expect(runtime.retire(ingress.handle)).toBe(true);
  });

  it("continues joined notifications after the original ingress holder retires", () => {
    const runtime = new LiveDocumentRuntime();
    const exactAuthority = authority();
    const source = new FakeSource(exactAuthority.modelIncarnation, "abc");
    const ingress = register(runtime, exactAuthority, source, Object.freeze({ ingress: true }));
    const joined = register(runtime, exactAuthority, source, Object.freeze({ joined: true }));
    const listener = vi.fn();
    runtime.subscribe(joined.handle, listener);

    expect(runtime.retire(ingress.handle)).toBe(true);
    expect(joined.handle.recordChange(edit(source, "abcd")).status).toBe("committed");
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenLastCalledWith(joined.handle.currentRevision());
  });

  it("binds snapshot consume and release to the exact capturing holder", () => {
    const runtime = new LiveDocumentRuntime();
    const firstAuthority = authority();
    const first = register(runtime, firstAuthority);
    const secondAuthority = authority({
      documentIdentityKey: "file:src/b.ts",
      documentIncarnation: Object.freeze({}),
      modelId: "file:///workspace/src/b.ts",
      modelIncarnation: Object.freeze({}),
      path: "/workspace/src/b.ts",
    });
    const second = register(runtime, secondAuthority);
    expect(second.handle.recordChange(edit(second.source, "abcd")).status).toBe("committed");

    const consumed = runtime.capture(second.handle, new AbortController().signal);
    expect(consumed.status).toBe("captured");
    if (consumed.status !== "captured") return;
    expect(runtime.consumeCurrent(first.handle, consumed.snapshot)).toBe(false);
    expect(runtime.consumeCurrent(second.handle, consumed.snapshot)).toBe(true);

    const released = runtime.capture(second.handle, new AbortController().signal);
    expect(released.status).toBe("captured");
    if (released.status !== "captured") return;
    expect(runtime.release(first.handle, released.snapshot)).toBe(false);
    expect(runtime.release(second.handle, released.snapshot)).toBe(true);
  });

  it("does not let a joined holder settle another holder's snapshot", () => {
    const runtime = new LiveDocumentRuntime();
    const exactAuthority = authority();
    const source = new FakeSource(exactAuthority.modelIncarnation, "abc");
    const ingress = register(runtime, exactAuthority, source, Object.freeze({ ingress: true }));
    const joined = register(runtime, exactAuthority, source, Object.freeze({ joined: true }));
    expect(ingress.handle.recordChange(edit(source, "abcd")).status).toBe("committed");

    const captured = runtime.capture(joined.handle, new AbortController().signal);
    expect(captured.status).toBe("captured");
    if (captured.status !== "captured") return;
    expect(runtime.consumeCurrent(ingress.handle, captured.snapshot)).toBe(false);
    expect(runtime.consumeCurrent(joined.handle, captured.snapshot)).toBe(true);
  });
});
