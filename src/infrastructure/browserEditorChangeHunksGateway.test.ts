// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  EditorChangeHunksComputationRequest,
  EditorChangeHunksComputationResponse,
} from "../application/editorChangeHunksComputation";
import { BrowserEditorChangeHunksGateway } from "./browserEditorChangeHunksGateway";

class FakeWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<EditorChangeHunksComputationResponse>) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
}

describe("BrowserEditorChangeHunksGateway", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("terminates an active worker when its exact request is aborted", async () => {
    const worker = new FakeWorker();
    const gateway = gatewayFor(worker);
    const abortController = new AbortController();
    const pending = gateway.compute(request(1), abortController.signal);

    abortController.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates and rejects a worker that exceeds its deadline", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const gateway = gatewayFor(worker, 25);
    const pending = gateway.compute(request(1), new AbortController().signal);

    vi.advanceTimersByTime(25);

    await expect(pending).rejects.toThrow("timed out");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("cleans up when postMessage throws synchronously", async () => {
    const worker = new FakeWorker();
    worker.postMessage.mockImplementationOnce(() => {
      throw new Error("clone failed");
    });
    const gateway = gatewayFor(worker);

    await expect(gateway.compute(request(1), new AbortController().signal)).rejects.toThrow(
      "clone failed",
    );
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("turns a synchronous worker-construction failure into a rejected promise", async () => {
    const worker = new FakeWorker();
    const factory = vi
      .fn<() => Worker>()
      .mockImplementationOnce(() => {
        throw new Error("worker unavailable");
      })
      .mockImplementationOnce(() => worker as unknown as Worker);
    const gateway = new BrowserEditorChangeHunksGateway(factory);
    const failedAbortController = new AbortController();
    let failedRequest: Promise<EditorChangeHunksComputationResponse> | undefined;

    expect(() => {
      failedRequest = gateway.compute(request(1), failedAbortController.signal);
    }).not.toThrow();
    await expect(failedRequest).rejects.toThrow("worker unavailable");

    const nextRequest = gateway.compute(request(2), new AbortController().signal);
    failedAbortController.abort();
    worker.onmessage?.(
      new MessageEvent("message", {
        data: response(2),
      }),
    );

    await expect(nextRequest).resolves.toEqual(response(2));
    expect(factory).toHaveBeenCalledTimes(2);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("rejects unreadable responses and reuses a worker after successful work", async () => {
    const worker = new FakeWorker();
    const factory = vi.fn(() => worker as unknown as Worker);
    const gateway = new BrowserEditorChangeHunksGateway(factory);
    const first = gateway.compute(request(1), new AbortController().signal);
    worker.onmessage?.(
      new MessageEvent("message", {
        data: response(1),
      }),
    );
    await expect(first).resolves.toEqual(response(1));

    const second = gateway.compute(request(2), new AbortController().signal);
    worker.onmessageerror?.(new MessageEvent("messageerror"));
    await expect(second).rejects.toThrow("unreadable");

    expect(factory).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});

function gatewayFor(worker: FakeWorker, timeoutMs?: number): BrowserEditorChangeHunksGateway {
  return new BrowserEditorChangeHunksGateway(() => worker as unknown as Worker, timeoutMs);
}

function request(generation: number): EditorChangeHunksComputationRequest {
  return {
    baselineContent: "before",
    content: "after",
    generation,
    ownerKey: "owner",
    path: "/workspace/file.ts",
    policy: { characterLimit: 16 * 1024, lineLimit: 500 },
  };
}

function response(generation: number): EditorChangeHunksComputationResponse {
  return {
    generation,
    hunks: [],
    ownerKey: "owner",
    path: "/workspace/file.ts",
    status: "ready",
  };
}
