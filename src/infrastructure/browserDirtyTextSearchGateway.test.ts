// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DirtyTextSearchComputationRequest,
  DirtyTextSearchComputationResponse,
} from "../application/dirtyTextSearchComputation";
import { defaultTextSearchOptions } from "../domain/workspace";
import { BrowserDirtyTextSearchGateway } from "./browserDirtyTextSearchGateway";

class FakeWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
}

describe("BrowserDirtyTextSearchGateway", () => {
  afterEach(() => vi.useRealTimers());

  it("physically supersedes an active request and rejects its owner immediately", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const factory = vi
      .fn()
      .mockReturnValueOnce(firstWorker as unknown as Worker)
      .mockReturnValueOnce(secondWorker as unknown as Worker);
    const gateway = new BrowserDirtyTextSearchGateway(factory);
    const first = gateway.compute(request(1), new AbortController().signal);
    const second = gateway.compute(request(2), new AbortController().signal);

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(firstWorker.terminate).toHaveBeenCalledOnce();
    secondWorker.onmessage?.(
      new MessageEvent("message", {
        data: response(request(2)),
      }),
    );
    await expect(second).resolves.toEqual(response(request(2)));
    expect(secondWorker.onmessage).toBeNull();
    expect(secondWorker.onerror).toBeNull();
    expect(secondWorker.onmessageerror).toBeNull();
  });

  it("terminates on abort, timeout, unreadable response, and sync clone failure", async () => {
    vi.useFakeTimers();

    const abortedWorker = new FakeWorker();
    const abortGateway = gatewayFor(abortedWorker);
    const controller = new AbortController();
    const aborted = abortGateway.compute(request(1), controller.signal);
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    expect(abortedWorker.terminate).toHaveBeenCalledOnce();

    const timedWorker = new FakeWorker();
    const timed = gatewayFor(timedWorker, 20).compute(request(2), new AbortController().signal);
    vi.advanceTimersByTime(20);
    await expect(timed).rejects.toThrow("timed out");
    expect(timedWorker.terminate).toHaveBeenCalledOnce();

    const unreadableWorker = new FakeWorker();
    const unreadable = gatewayFor(unreadableWorker).compute(
      request(3),
      new AbortController().signal,
    );
    unreadableWorker.onmessageerror?.(new MessageEvent("messageerror"));
    await expect(unreadable).rejects.toThrow("unreadable");
    expect(unreadableWorker.terminate).toHaveBeenCalledOnce();

    const cloneWorker = new FakeWorker();
    cloneWorker.postMessage.mockImplementationOnce(() => {
      throw new Error("clone failed");
    });
    await expect(
      gatewayFor(cloneWorker).compute(request(4), new AbortController().signal),
    ).rejects.toThrow("clone failed");
    expect(cloneWorker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects a late A response after exact A-B-A generation replacement", async () => {
    const worker = new FakeWorker();
    const gateway = gatewayFor(worker);
    const current = gateway.compute(request(3), new AbortController().signal);

    worker.onmessage?.(
      new MessageEvent("message", {
        data: response(request(1)),
      }),
    );

    await expect(current).rejects.toThrow("invalid authority");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects foreign result paths and impossible Unicode preview spans", async () => {
    const foreignWorker = new FakeWorker();
    const foreign = gatewayFor(foreignWorker).compute(request(1), new AbortController().signal);
    foreignWorker.onmessage?.(
      new MessageEvent("message", {
        data: {
          ...response(request(1)),
          results: [
            {
              column: 1,
              lineNumber: 1,
              lineText: "needle",
              matchEnd: 6,
              matchStart: 0,
              matchTruncated: false,
              path: "/workspace/foreign.ts",
              previewTruncated: false,
              relativePath: "foreign.ts",
            },
          ],
        },
      }),
    );
    await expect(foreign).rejects.toThrow("invalid authority or payload");

    const spanWorker = new FakeWorker();
    const span = gatewayFor(spanWorker).compute(request(2), new AbortController().signal);
    spanWorker.onmessage?.(
      new MessageEvent("message", {
        data: {
          ...response(request(2)),
          results: [
            {
              column: 1,
              lineNumber: 1,
              lineText: "😀",
              matchEnd: 2,
              matchStart: 0,
              matchTruncated: false,
              path: "/workspace/file.ts",
              previewTruncated: false,
              relativePath: "file.ts",
            },
          ],
        },
      }),
    );
    await expect(span).rejects.toThrow("invalid authority or payload");
  });

  it("rejects malformed result inventory immediately instead of timing out", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const pending = gatewayFor(worker, 20).compute(request(1), new AbortController().signal);
    worker.onmessage?.(
      new MessageEvent("message", {
        data: {
          ...response(request(1)),
          results: [null],
        },
      }),
    );

    await expect(pending).rejects.toThrow("invalid authority or payload");
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

function gatewayFor(worker: FakeWorker, timeoutMs?: number) {
  return new BrowserDirtyTextSearchGateway(() => worker as unknown as Worker, timeoutMs);
}

function request(generation: number): DirtyTextSearchComputationRequest {
  return {
    authority: {
      dirtySnapshotGeneration: generation,
      requestGeneration: `request-${generation}`,
      root: "/workspace",
      searchGeneration: generation,
      workspaceOwnerKey: "owner",
    },
    dirtyPaths: ["/workspace/file.ts"],
    documents: [
      {
        content: "needle",
        documentRevision: generation,
        path: "/workspace/file.ts",
        relativePath: "file.ts",
      },
    ],
    limit: 100,
    options: defaultTextSearchOptions(),
    preflightLimitations: [],
    query: "needle",
  };
}

function response(
  requested: DirtyTextSearchComputationRequest,
): DirtyTextSearchComputationResponse {
  return {
    authority: requested.authority,
    dirtyPaths: requested.dirtyPaths,
    limitations: [],
    results: [],
    truncated: false,
  };
}
