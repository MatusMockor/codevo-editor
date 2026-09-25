// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorChangeHunk } from "../domain/editorChangeMarkers";
import type { LiveDocumentAuthority } from "../domain/liveDocumentContentAuthority";
import type {
  EditorChangeHunksComputationGateway,
  EditorChangeHunksComputationRequest,
  EditorChangeHunksComputationResponse,
} from "./editorChangeHunksComputation";
import type {
  EditorChangeHunksBaseline,
  EditorChangeHunksSnapshotPort,
} from "./editorChangeHunksSnapshotPort";
import type {
  CaptureLiveDocumentSnapshotReceipt,
  LiveDocumentSnapshot,
} from "./liveDocumentSnapshotBroker";
import type { LiveModelRevision, LiveModelSourceHandle } from "./liveModelIngressCoordinator";
import {
  useOwnedEditorChangeHunks,
  type OwnedEditorChangeHunksInput,
  type OwnedEditorChangeHunksState,
  type SnapshotOwnedEditorChangeHunksInput,
} from "./useOwnedEditorChangeHunks";

type RejectedCaptureReason = Extract<
  CaptureLiveDocumentSnapshotReceipt,
  { readonly status: "rejected" }
>["reason"];
type RetryableCaptureReason = Extract<RejectedCaptureReason, "stale" | "capture-in-flight">;

const RETRY_TEST_COALESCE_MS = 50;

const SMALL_FILE_POLICY = {
  characterLimit: 16 * 1024,
  lineLimit: 500,
};

interface DeferredResponse {
  readonly request: EditorChangeHunksComputationRequest;
  readonly signal: AbortSignal;
  resolve(response: EditorChangeHunksComputationResponse): void;
}

function Harness({
  input,
  onState,
}: {
  readonly input: OwnedEditorChangeHunksInput;
  readonly onState: (state: OwnedEditorChangeHunksState) => void;
}) {
  onState(useOwnedEditorChangeHunks(input));
  return null;
}

class DeferredGateway implements EditorChangeHunksComputationGateway {
  readonly calls: DeferredResponse[] = [];

  compute(
    request: EditorChangeHunksComputationRequest,
    signal: AbortSignal,
  ): Promise<EditorChangeHunksComputationResponse> {
    return new Promise((resolve) => {
      this.calls.push({ request, resolve, signal });
    });
  }
}

interface FakeLiveDocument {
  readonly authority: LiveDocumentAuthority;
  content: string;
  readonly handle: LiveModelSourceHandle;
  revision: LiveModelRevision;
}

class FakeSnapshotPort implements EditorChangeHunksSnapshotPort {
  readonly captures: LiveModelSourceHandle[] = [];
  readonly consumes: LiveDocumentSnapshot[] = [];
  readonly releases: LiveDocumentSnapshot[] = [];
  private readonly documents = new Map<LiveModelSourceHandle, FakeLiveDocument>();
  private readonly listeners = new Map<
    LiveModelSourceHandle,
    Set<(revision: LiveModelRevision) => void>
  >();
  private readonly retained = new Set<LiveDocumentSnapshot>();

  add(document: FakeLiveDocument): void {
    this.documents.set(document.handle, document);
  }

  capture(handle: LiveModelSourceHandle, signal: AbortSignal): CaptureLiveDocumentSnapshotReceipt {
    this.captures.push(handle);
    const document = this.documents.get(handle);
    if (!document || signal.aborted) {
      return { reason: "aborted", status: "rejected" };
    }
    const snapshot = Object.freeze({
      alternativeVersionId: document.revision.alternativeVersionId,
      authority: document.authority,
      content: document.content,
      contentVersion: document.revision.contentVersion,
      modelAuthority: handle.modelAuthority,
      modelVersionId: document.revision.modelVersionId,
      purpose: "change-hunks",
      reservationAuthority: handle.channelAuthority,
      snapshotAuthority: Object.freeze({}),
      sourceAuthority: Object.freeze({}),
      utf16Length: document.content.length,
      utf8BytesUpperBound: document.content.length * 3,
    }) satisfies LiveDocumentSnapshot;
    this.retained.add(snapshot);
    return { snapshot, status: "captured" };
  }

  consumeCurrent(handle: LiveModelSourceHandle, snapshot: LiveDocumentSnapshot): boolean {
    this.consumes.push(snapshot);
    const document = this.documents.get(handle);
    if (
      !document ||
      !this.retained.delete(snapshot) ||
      document.revision.contentVersion !== snapshot.contentVersion ||
      document.revision.modelVersionId !== snapshot.modelVersionId
    ) {
      return false;
    }
    return true;
  }

  release(_handle: LiveModelSourceHandle, snapshot: LiveDocumentSnapshot): boolean {
    this.releases.push(snapshot);
    return this.retained.delete(snapshot);
  }

  subscribe(
    handle: LiveModelSourceHandle,
    listener: (revision: LiveModelRevision) => void,
  ): () => void {
    const listeners = this.listeners.get(handle) ?? new Set();
    listeners.add(listener);
    this.listeners.set(handle, listeners);
    return () => {
      listeners.delete(listener);
    };
  }

  edit(document: FakeLiveDocument, content: string): void {
    document.content = content;
    document.revision = Object.freeze({
      ...document.revision,
      alternativeVersionId: document.revision.alternativeVersionId + 1,
      contentVersion: document.revision.contentVersion + 1,
      modelVersionId: document.revision.modelVersionId + 1,
      utf16Length: content.length,
    });
    this.listeners.get(document.handle)?.forEach((listener) => listener(document.revision));
  }

  publish(document: FakeLiveDocument): void {
    this.listeners.get(document.handle)?.forEach((listener) => listener(document.revision));
  }

  listenerCount(handle: LiveModelSourceHandle): number {
    return this.listeners.get(handle)?.size ?? 0;
  }

  retainedCount(): number {
    return this.retained.size;
  }
}

class ScriptedRejectionPort implements EditorChangeHunksSnapshotPort {
  readonly captures: LiveModelSourceHandle[] = [];
  private readonly rejections: RejectedCaptureReason[] = [];

  constructor(private readonly base: FakeSnapshotPort) {}

  rejectNext(...reasons: readonly RejectedCaptureReason[]): void {
    this.rejections.push(...reasons);
  }

  capturesOf(handle: LiveModelSourceHandle): number {
    return this.captures.filter((captured) => captured === handle).length;
  }

  capture(handle: LiveModelSourceHandle, signal: AbortSignal): CaptureLiveDocumentSnapshotReceipt {
    this.captures.push(handle);
    const reason = this.rejections.shift();
    if (reason) return { reason, status: "rejected" };
    return this.base.capture(handle, signal);
  }

  consumeCurrent(handle: LiveModelSourceHandle, snapshot: LiveDocumentSnapshot): boolean {
    return this.base.consumeCurrent(handle, snapshot);
  }

  release(handle: LiveModelSourceHandle, snapshot: LiveDocumentSnapshot): boolean {
    return this.base.release(handle, snapshot);
  }

  subscribe(
    handle: LiveModelSourceHandle,
    listener: (revision: LiveModelRevision) => void,
  ): () => void {
    return this.base.subscribe(handle, listener);
  }
}

describe("useOwnedEditorChangeHunks", () => {
  let host: HTMLDivElement;
  let root: Root;
  let rootMounted: boolean;
  let current: OwnedEditorChangeHunksState | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    rootMounted = true;
    current = null;
  });

  afterEach(() => {
    if (rootMounted) {
      act(() => root.unmount());
    }
    host.remove();
    vi.useRealTimers();
  });

  function render(input: OwnedEditorChangeHunksInput) {
    act(() =>
      root.render(
        <Harness
          input={input}
          onState={(state) => {
            current = state;
          }}
        />,
      ),
    );
  }

  async function publishReady(gateway: DeferredGateway, id: string): Promise<EditorChangeHunk> {
    await act(async () => vi.advanceTimersByTime(RETRY_TEST_COALESCE_MS));
    const published = hunk(id);
    const call = gateway.calls[gateway.calls.length - 1];
    expect(call).toBeDefined();
    await act(async () => resolveReady(call!, [published]));
    expect(current).toEqual({ hunks: [published], status: "ready" });
    return published;
  }

  it("observes a rapid revision storm without a React render or snapshot per edit", async () => {
    const gateway = new DeferredGateway();
    const snapshots = new FakeSnapshotPort();
    const document = liveDocument("workspace-a", "/workspace-a/value.ts", "const value = 0;");
    snapshots.add(document);
    let renderCount = 0;
    const input = snapshotInput(document, gateway, snapshots, { coalesceMs: 25 });

    act(() =>
      root.render(
        <Harness
          input={input}
          onState={(state) => {
            current = state;
            renderCount += 1;
          }}
        />,
      ),
    );
    const rendersBeforeTyping = renderCount;
    act(() => {
      for (let revision = 1; revision <= 100; revision += 1) {
        snapshots.edit(document, `const value = ${revision};`);
      }
    });

    expect(renderCount).toBe(rendersBeforeTyping);
    expect(snapshots.captures).toHaveLength(0);
    await act(async () => vi.advanceTimersByTime(25));

    expect(snapshots.captures).toHaveLength(1);
    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0].request.content).toBe("const value = 100;");
    expect(current?.status).toBe("pending");
  });

  it("captures only after the debounce and consumes current immediately before publication", async () => {
    const gateway = new DeferredGateway();
    const snapshots = new FakeSnapshotPort();
    const document = liveDocument("workspace-a", "/workspace-a/value.ts", "after");
    snapshots.add(document);
    render(snapshotInput(document, gateway, snapshots, { coalesceMs: 120 }));

    await act(async () => vi.advanceTimersByTime(119));
    expect(snapshots.captures).toHaveLength(0);
    await act(async () => vi.advanceTimersByTime(1));
    expect(snapshots.captures).toHaveLength(1);

    const hunkValue = hunk("current");
    await act(async () => {
      resolveReady(gateway.calls[0], [hunkValue]);
    });

    expect(snapshots.consumes).toHaveLength(1);
    expect(snapshots.releases).toHaveLength(0);
    expect(snapshots.retainedCount()).toBe(0);
    expect(current).toEqual({ hunks: [hunkValue], status: "ready" });
  });

  it("releases and suppresses a worker result made stale by a newer compact revision", async () => {
    const gateway = new DeferredGateway();
    const snapshots = new FakeSnapshotPort();
    const document = liveDocument("workspace-a", "/workspace-a/value.ts", "first");
    snapshots.add(document);
    render(snapshotInput(document, gateway, snapshots, { coalesceMs: 0 }));
    await act(async () => vi.runOnlyPendingTimers());
    const stale = gateway.calls[0];

    act(() => snapshots.edit(document, "second"));
    expect(stale.signal.aborted).toBe(true);
    expect(snapshots.releases).toHaveLength(1);
    expect(snapshots.retainedCount()).toBe(0);
    await act(async () => vi.runOnlyPendingTimers());
    expect(gateway.calls).toHaveLength(2);

    await act(async () => resolveReady(stale, [hunk("stale")]));
    expect(current?.status).toBe("pending");
  });

  it("never lets an older runner cleanup release a newer runner snapshot", async () => {
    const gateway = new DeferredGateway();
    const snapshots = new FakeSnapshotPort();
    const document = liveDocument("workspace-a", "/workspace-a/value.ts", "first");
    snapshots.add(document);
    render(snapshotInput(document, gateway, snapshots, { coalesceMs: 0 }));
    await act(async () => vi.runOnlyPendingTimers());
    const older = gateway.calls[0];

    act(() => snapshots.edit(document, "second"));
    await act(async () => vi.runOnlyPendingTimers());
    const newer = gateway.calls[1];
    expect(snapshots.retainedCount()).toBe(1);

    await act(async () => resolveReady(older, [hunk("older")]));
    expect(snapshots.retainedCount()).toBe(1);

    await act(async () => resolveReady(newer, [hunk("newer")]));
    expect(snapshots.retainedCount()).toBe(0);
    expect(current).toEqual({ hunks: [hunk("newer")], status: "ready" });
  });

  it("rejects a late A result after an A to B to A exact-handle sequence", async () => {
    const gateway = new DeferredGateway();
    const snapshots = new FakeSnapshotPort();
    const firstA = liveDocument("owner-a", "/a/file.ts", "first-a");
    const documentB = liveDocument("owner-b", "/b/file.ts", "value-b");
    const secondA = liveDocument("owner-a", "/a/file.ts", "second-a");
    snapshots.add(firstA);
    snapshots.add(documentB);
    snapshots.add(secondA);

    render(snapshotInput(firstA, gateway, snapshots, { coalesceMs: 0 }));
    await act(async () => vi.runOnlyPendingTimers());
    const staleA = gateway.calls[0];
    render(snapshotInput(documentB, gateway, snapshots, { coalesceMs: 0 }));
    await act(async () => vi.runOnlyPendingTimers());
    render(snapshotInput(secondA, gateway, snapshots, { coalesceMs: 0 }));
    await act(async () => vi.runOnlyPendingTimers());
    const currentA = gateway.calls[2];

    const latestHunk = hunk("latest");
    await act(async () => resolveReady(currentA, [latestHunk]));
    expect(current).toEqual({ hunks: [latestHunk], status: "ready" });

    await act(async () => resolveReady(staleA, [hunk("stale")]));
    expect(current).toEqual({ hunks: [latestHunk], status: "ready" });
  });

  it("fails closed when the worker settles after the captured snapshot became stale", async () => {
    const gateway = new DeferredGateway();
    const snapshots = new FakeSnapshotPort();
    const document = liveDocument("workspace-a", "/workspace-a/value.ts", "first");
    snapshots.add(document);
    render(snapshotInput(document, gateway, snapshots, { coalesceMs: 0 }));
    await act(async () => vi.runOnlyPendingTimers());

    document.revision = Object.freeze({
      ...document.revision,
      contentVersion: document.revision.contentVersion + 1,
    });
    await act(async () => resolveReady(gateway.calls[0], [hunk("stale")]));

    expect(snapshots.consumes).toHaveLength(1);
    expect(current?.status).toBe("pending");
    expect(snapshots.retainedCount()).toBe(0);
  });

  it("rejects a baseline from a foreign exact document before worker dispatch", async () => {
    const gateway = new DeferredGateway();
    const snapshots = new FakeSnapshotPort();
    const document = liveDocument("workspace-a", "/workspace-a/value.ts", "after");
    snapshots.add(document);
    const input = snapshotInput(document, gateway, snapshots, { coalesceMs: 0 });
    render({
      ...input,
      baseline: {
        ...input.baseline!,
        documentIncarnation: Object.freeze({}),
      },
    });
    await act(async () => vi.runOnlyPendingTimers());

    expect(gateway.calls).toHaveLength(0);
    expect(snapshots.releases).toHaveLength(1);
    expect(snapshots.retainedCount()).toBe(0);
  });

  it("fails closed if capture reentrantly schedules a newer exact revision", async () => {
    const gateway = new DeferredGateway();
    const basePort = new FakeSnapshotPort();
    const document = liveDocument("workspace-a", "/workspace-a/value.ts", "first");
    basePort.add(document);
    let reentered = false;
    const snapshots: EditorChangeHunksSnapshotPort = {
      capture: (handle, signal) => {
        const result = basePort.capture(handle, signal);
        if (!reentered) {
          reentered = true;
          basePort.edit(document, "second");
        }
        return result;
      },
      consumeCurrent: (handle, snapshot) => basePort.consumeCurrent(handle, snapshot),
      release: (handle, snapshot) => basePort.release(handle, snapshot),
      subscribe: (handle, listener) => basePort.subscribe(handle, listener),
    };
    render({
      ...snapshotInput(document, gateway, basePort, { coalesceMs: 0 }),
      snapshots,
    });

    await act(async () => vi.runOnlyPendingTimers());
    expect(gateway.calls).toHaveLength(0);
    expect(basePort.releases).toHaveLength(1);
    expect(basePort.retainedCount()).toBe(0);

    await act(async () => vi.runOnlyPendingTimers());
    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0].request.content).toBe("second");
  });

  it("publishes one degraded render for 100 large revisions and recovers when eligible", async () => {
    const gateway = new DeferredGateway();
    const snapshots = new FakeSnapshotPort();
    const document = liveDocument("workspace-a", "/workspace-a/large.ts", "small");
    snapshots.add(document);
    let renderCount = 0;
    act(() =>
      root.render(
        <Harness
          input={snapshotInput(document, gateway, snapshots, { coalesceMs: 0 })}
          onState={(state) => {
            current = state;
            renderCount += 1;
          }}
        />,
      ),
    );
    const rendersBeforeLargeRevisions = renderCount;
    const largeContent = "x".repeat(SMALL_FILE_POLICY.characterLimit + 1);
    for (let revision = 0; revision < 100; revision += 1) {
      act(() => snapshots.edit(document, largeContent));
    }

    await act(async () => vi.runAllTimers());
    expect(snapshots.captures).toHaveLength(0);
    expect(gateway.calls).toHaveLength(0);
    expect(renderCount).toBe(rendersBeforeLargeRevisions + 1);
    expect(current).toEqual({
      hunks: [],
      reason: "large-file",
      status: "degraded",
    });

    act(() => snapshots.edit(document, "eligible"));
    await act(async () => vi.runOnlyPendingTimers());
    expect(snapshots.captures).toHaveLength(1);
    expect(gateway.calls).toHaveLength(1);
  });

  it("contains explicit subscription rejection as an error state", () => {
    const gateway = new DeferredGateway();
    const snapshots = new FakeSnapshotPort();
    const document = liveDocument("workspace-a", "/workspace-a/file.ts", "after");
    snapshots.add(document);
    const rejectingSnapshots: EditorChangeHunksSnapshotPort = {
      capture: (handle, signal) => snapshots.capture(handle, signal),
      consumeCurrent: (handle, snapshot) => snapshots.consumeCurrent(handle, snapshot),
      release: (handle, snapshot) => snapshots.release(handle, snapshot),
      subscribe: () => {
        throw new Error("observer capacity exhausted");
      },
    };

    expect(() =>
      render({
        ...snapshotInput(document, gateway, snapshots, { coalesceMs: 0 }),
        snapshots: rejectingSnapshots,
      }),
    ).not.toThrow();
    expect(current).toEqual({
      hunks: [],
      message: "observer capacity exhausted",
      status: "error",
    });
  });

  it.each<RejectedCaptureReason>(["not-live", "aborted"])(
    "keeps a %s capture rejection idle and recovers on the next edit",
    async (reason) => {
      const gateway = new DeferredGateway();
      const snapshots = new FakeSnapshotPort();
      const document = liveDocument("workspace-a", "/workspace-a/file.ts", "after");
      snapshots.add(document);
      let rejectNext = true;
      const rejectingOnce: EditorChangeHunksSnapshotPort = {
        capture: (handle, signal) => {
          if (!rejectNext) return snapshots.capture(handle, signal);
          rejectNext = false;
          return { reason, status: "rejected" };
        },
        consumeCurrent: (handle, snapshot) => snapshots.consumeCurrent(handle, snapshot),
        release: (handle, snapshot) => snapshots.release(handle, snapshot),
        subscribe: (handle, listener) => snapshots.subscribe(handle, listener),
      };
      render({
        ...snapshotInput(document, gateway, snapshots, { coalesceMs: 0 }),
        snapshots: rejectingOnce,
      });
      await act(async () => vi.runOnlyPendingTimers());

      expect(current).toEqual({ hunks: [], status: "idle" });
      expect(gateway.calls).toHaveLength(0);

      act(() => snapshots.edit(document, "edited"));
      await act(async () => vi.runOnlyPendingTimers());
      const hunkValue = hunk("edited");
      await act(async () => {
        resolveReady(gateway.calls[0], [hunkValue]);
      });

      expect(current).toEqual({ hunks: [hunkValue], status: "ready" });
    },
  );

  it.each<RetryableCaptureReason>(["stale", "capture-in-flight"])(
    "keeps the previous publication on a %s rejection and publishes after one retry",
    async (reason) => {
      const gateway = new DeferredGateway();
      const base = new FakeSnapshotPort();
      const document = liveDocument("workspace-a", "/workspace-a/file.ts", "after");
      base.add(document);
      const snapshots = new ScriptedRejectionPort(base);
      render(snapshotInput(document, gateway, snapshots, { coalesceMs: RETRY_TEST_COALESCE_MS }));
      const previous = await publishReady(gateway, "previous");

      snapshots.rejectNext(reason);
      act(() => base.edit(document, "edited"));
      await act(async () => vi.advanceTimersByTime(RETRY_TEST_COALESCE_MS));

      expect(snapshots.captures).toHaveLength(2);
      expect(current).toEqual({ hunks: [previous], status: "ready" });
      expect(gateway.calls).toHaveLength(1);

      await act(async () => vi.advanceTimersByTime(RETRY_TEST_COALESCE_MS - 1));
      expect(snapshots.captures).toHaveLength(2);
      await act(async () => vi.advanceTimersByTime(1));
      expect(snapshots.captures).toHaveLength(3);
      expect(gateway.calls).toHaveLength(2);
      expect(gateway.calls[1].request.content).toBe("edited");

      const retried = hunk("retried");
      await act(async () => resolveReady(gateway.calls[1], [retried]));
      expect(current).toEqual({ hunks: [retried], status: "ready" });
    },
  );

  it.each<RetryableCaptureReason>(["stale", "capture-in-flight"])(
    "retries a %s rejection at most once per episode and then publishes a bounded error",
    async (reason) => {
      const gateway = new DeferredGateway();
      const base = new FakeSnapshotPort();
      const document = liveDocument("workspace-a", "/workspace-a/file.ts", "after");
      base.add(document);
      const snapshots = new ScriptedRejectionPort(base);
      render(snapshotInput(document, gateway, snapshots, { coalesceMs: RETRY_TEST_COALESCE_MS }));
      await publishReady(gateway, "previous");

      snapshots.rejectNext(reason, reason);
      act(() => base.edit(document, "edited"));
      await act(async () => vi.advanceTimersByTime(RETRY_TEST_COALESCE_MS * 20));

      expect(snapshots.captures).toHaveLength(3);
      expect(gateway.calls).toHaveLength(1);
      expect(current).toEqual({
        hunks: [],
        message: `Editor snapshot unavailable (${reason}, retry exhausted).`,
        status: "error",
      });

      snapshots.rejectNext(reason);
      act(() => base.edit(document, "edited again"));
      await act(async () => vi.advanceTimersByTime(RETRY_TEST_COALESCE_MS * 20));

      expect(snapshots.captures).toHaveLength(5);
      expect(gateway.calls).toHaveLength(2);
      expect(gateway.calls[1].request.content).toBe("edited again");
    },
  );

  it("clears a scheduled capture retry on unmount", async () => {
    const gateway = new DeferredGateway();
    const base = new FakeSnapshotPort();
    const document = liveDocument("workspace-a", "/workspace-a/file.ts", "after");
    base.add(document);
    const snapshots = new ScriptedRejectionPort(base);
    render(snapshotInput(document, gateway, snapshots, { coalesceMs: RETRY_TEST_COALESCE_MS }));
    await publishReady(gateway, "previous");

    snapshots.rejectNext("stale");
    act(() => base.edit(document, "edited"));
    await act(async () => vi.advanceTimersByTime(RETRY_TEST_COALESCE_MS));
    expect(snapshots.captures).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(1);

    act(() => root.unmount());
    rootMounted = false;

    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTime(RETRY_TEST_COALESCE_MS * 20));
    expect(snapshots.captures).toHaveLength(2);
    expect(gateway.calls).toHaveLength(1);
  });

  it("drops a scheduled capture retry across an A to B to A owner change", async () => {
    const gateway = new DeferredGateway();
    const base = new FakeSnapshotPort();
    const firstA = liveDocument("owner-a", "/a/file.ts", "first-a");
    const documentB = liveDocument("owner-b", "/b/file.ts", "value-b");
    const secondA = liveDocument("owner-a", "/a/file.ts", "second-a");
    base.add(firstA);
    base.add(documentB);
    base.add(secondA);
    const snapshots = new ScriptedRejectionPort(base);
    render(snapshotInput(firstA, gateway, snapshots, { coalesceMs: RETRY_TEST_COALESCE_MS }));
    await publishReady(gateway, "first-a");

    snapshots.rejectNext("capture-in-flight");
    act(() => base.edit(firstA, "first-a edited"));
    await act(async () => vi.advanceTimersByTime(RETRY_TEST_COALESCE_MS));
    const firstACaptures = snapshots.capturesOf(firstA.handle);

    render(snapshotInput(documentB, gateway, snapshots, { coalesceMs: RETRY_TEST_COALESCE_MS }));
    render(snapshotInput(secondA, gateway, snapshots, { coalesceMs: RETRY_TEST_COALESCE_MS }));
    await act(async () => vi.advanceTimersByTime(RETRY_TEST_COALESCE_MS * 20));

    expect(snapshots.capturesOf(firstA.handle)).toBe(firstACaptures);
    expect(snapshots.capturesOf(documentB.handle)).toBe(0);
    expect(snapshots.capturesOf(secondA.handle)).toBe(1);
    expect(gateway.calls).toHaveLength(2);
    expect(gateway.calls[1].request.content).toBe("second-a");

    const latest = hunk("second-a");
    await act(async () => resolveReady(gateway.calls[1], [latest]));
    expect(current).toEqual({ hunks: [latest], status: "ready" });
  });

  it.each<RejectedCaptureReason>([
    "source-unavailable",
    "source-failed",
    "outstanding-limit",
    "aggregate-limit",
  ])("reports a %s capture rejection as an error state without retrying", async (reason) => {
    const gateway = new DeferredGateway();
    const snapshots = new FakeSnapshotPort();
    const document = liveDocument("workspace-a", "/workspace-a/file.ts", "after");
    snapshots.add(document);
    let capturesAfterRejection = 0;
    const rejecting: EditorChangeHunksSnapshotPort = {
      capture: () => {
        capturesAfterRejection += 1;
        return { reason, status: "rejected" };
      },
      consumeCurrent: (handle, snapshot) => snapshots.consumeCurrent(handle, snapshot),
      release: (handle, snapshot) => snapshots.release(handle, snapshot),
      subscribe: (handle, listener) => snapshots.subscribe(handle, listener),
    };
    render({
      ...snapshotInput(document, gateway, snapshots, { coalesceMs: 0 }),
      snapshots: rejecting,
    });
    await act(async () => vi.runOnlyPendingTimers());

    expect(current).toEqual({
      hunks: [],
      message: `Editor snapshot unavailable (${reason}).`,
      status: "error",
    });
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(capturesAfterRejection).toBe(1);
  });

  it("aborts work, releases its snapshot, and unsubscribes on unmount", async () => {
    const gateway = new DeferredGateway();
    const snapshots = new FakeSnapshotPort();
    const document = liveDocument("workspace-a", "/workspace-a/file.ts", "after");
    snapshots.add(document);
    render(snapshotInput(document, gateway, snapshots, { coalesceMs: 0 }));
    await act(async () => vi.runOnlyPendingTimers());

    expect(gateway.calls[0].signal.aborted).toBe(false);
    expect(snapshots.listenerCount(document.handle)).toBe(1);
    act(() => root.unmount());
    rootMounted = false;

    expect(gateway.calls[0].signal.aborted).toBe(true);
    expect(snapshots.releases).toHaveLength(1);
    expect(snapshots.retainedCount()).toBe(0);
    expect(snapshots.listenerCount(document.handle)).toBe(0);
  });

  it("keeps the temporary closed legacy input operational during composition migration", async () => {
    const gateway = new DeferredGateway();
    render({
      baselineContent: "before",
      coalesceMs: 0,
      content: "after",
      gateway,
      ownerKey: "workspace-a",
      path: "/workspace-a/file.ts",
      policy: SMALL_FILE_POLICY,
    });
    await act(async () => vi.runOnlyPendingTimers());

    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0].request).toMatchObject({
      baselineContent: "before",
      content: "after",
      ownerKey: "workspace-a",
      path: "/workspace-a/file.ts",
    });
    const legacyHunk = hunk("legacy");
    await act(async () => resolveReady(gateway.calls[0], [legacyHunk]));
    expect(current).toEqual({ hunks: [legacyHunk], status: "ready" });
  });
});

function liveDocument(ownerKey: string, path: string, content: string): FakeLiveDocument {
  const modelAuthority = Object.freeze({});
  const authority = Object.freeze({
    canonicalRoot: `/${ownerKey}`,
    documentIdentityKey: path,
    documentIncarnation: Object.freeze({}),
    modelId: path,
    modelIncarnation: Object.freeze({}),
    ownerGeneration: 1,
    ownerIncarnation: Object.freeze({}),
    ownerKey,
    path,
  }) satisfies LiveDocumentAuthority;
  const revision = Object.freeze({
    alternativeVersionId: 1,
    contentVersion: 1,
    mode: "incremental",
    modelVersionId: 1,
    utf16Length: content.length,
  }) satisfies LiveModelRevision;
  const document = {} as FakeLiveDocument;
  const handle = Object.freeze({
    channelAuthority: Object.freeze({}),
    currentRevision: () => document.revision,
    handleAuthority: Object.freeze({}),
    modelAuthority,
    recordChange: () => ({ revision: document.revision, status: "committed" as const }),
    release: () => ({ status: "released" as const }),
  }) satisfies LiveModelSourceHandle;
  Object.assign(document, { authority, content, handle, revision });
  return document;
}

function baselineFor(document: FakeLiveDocument): EditorChangeHunksBaseline {
  const { authority } = document;
  return {
    authority: Object.freeze({}),
    canonicalRoot: authority.canonicalRoot,
    content: "before",
    documentIdentityKey: authority.documentIdentityKey,
    documentIncarnation: authority.documentIncarnation,
    ownerGeneration: authority.ownerGeneration,
    ownerIncarnation: authority.ownerIncarnation,
    ownerKey: authority.ownerKey,
    path: authority.path,
  };
}

function snapshotInput(
  document: FakeLiveDocument,
  gateway: DeferredGateway,
  snapshots: EditorChangeHunksSnapshotPort,
  options: { readonly coalesceMs: number },
): SnapshotOwnedEditorChangeHunksInput {
  return {
    baseline: baselineFor(document),
    coalesceMs: options.coalesceMs,
    gateway,
    liveDocument: { handle: document.handle },
    mode: "snapshot",
    policy: SMALL_FILE_POLICY,
    snapshots,
  };
}

function resolveReady(call: DeferredResponse, hunks: readonly EditorChangeHunk[]): void {
  call.resolve({
    generation: call.request.generation,
    hunks,
    ownerKey: call.request.ownerKey,
    path: call.request.path,
    status: "ready",
  });
}

function hunk(id: string): EditorChangeHunk {
  return {
    currentLines: ["after"],
    endLineNumber: 1,
    id,
    kind: "modified",
    originalLines: ["before"],
    originalStartLineNumber: 1,
    startLineNumber: 1,
  };
}
