// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DiffViewWorkerRequest,
  DiffViewWorkerResponse,
} from "../application/diffViewComputation";
import { computeLineDiff } from "../domain/diffView/lineDiff";
import { BrowserDiffViewGateway, MAX_PENDING_DIFF_VIEW_REQUESTS } from "./browserDiffViewGateway";

class FakeWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<DiffViewWorkerResponse>) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posted: DiffViewWorkerRequest[] = [];
  terminated = false;

  postMessage(request: DiffViewWorkerRequest): void {
    this.posted.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(index: number): void {
    const request = this.posted[index];
    if (request === undefined) return;
    const result = computeLineDiff(request.original, request.modified, {
      ignoreWhitespace: request.ignoreWhitespace,
    });
    this.onmessage?.(
      new MessageEvent("message", { data: { requestId: request.requestId, result } }),
    );
  }
}

function gateway(timeoutMs = 5_000) {
  const workers: FakeWorker[] = [];
  const instance = new BrowserDiffViewGateway(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  }, timeoutMs);
  return { instance, workers };
}

describe("BrowserDiffViewGateway", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends one request at a time and posts the next only after the previous settles", async () => {
    const { instance, workers } = gateway();
    const first = instance.compute(
      { original: "a", modified: "b", ignoreWhitespace: false },
      new AbortController().signal,
    );
    const second = instance.compute(
      { original: "x", modified: "x", ignoreWhitespace: false },
      new AbortController().signal,
    );
    expect(workers[0]?.posted).toHaveLength(1);

    workers[0]?.reply(0);
    await expect(first).resolves.toMatchObject({ kind: "ready", added: 1, deleted: 1 });
    expect(workers[0]?.posted).toHaveLength(2);

    workers[0]?.reply(1);
    await expect(second).resolves.toMatchObject({ kind: "ready", added: 0 });
  });

  it("ignores a response whose request id is not the one in flight", async () => {
    const { instance, workers } = gateway();
    const pending = instance.compute(
      { original: "a", modified: "b", ignoreWhitespace: false },
      new AbortController().signal,
    );
    const worker = workers[0];
    expect(worker).toBeDefined();
    worker?.onmessage?.(
      new MessageEvent("message", {
        data: { requestId: 999, result: computeLineDiff("z", "z", { ignoreWhitespace: false }) },
      }),
    );
    worker?.reply(0);

    await expect(pending).resolves.toMatchObject({ kind: "ready", added: 1, deleted: 1 });
  });

  it("drops an aborted queued request without posting it or touching the worker", async () => {
    const { instance, workers } = gateway();
    const first = instance.compute(
      { original: "a", modified: "b", ignoreWhitespace: false },
      new AbortController().signal,
    );
    const controller = new AbortController();
    const queued = instance.compute(
      { original: "q", modified: "r", ignoreWhitespace: false },
      controller.signal,
    );
    const third = instance.compute(
      { original: "x", modified: "y", ignoreWhitespace: false },
      new AbortController().signal,
    );
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(workers[0]?.terminated).toBe(false);

    workers[0]?.reply(0);
    await expect(first).resolves.toMatchObject({ kind: "ready" });
    workers[0]?.reply(1);
    await expect(third).resolves.toMatchObject({ kind: "ready", added: 1, deleted: 1 });
    expect(workers[0]?.posted.map((request) => request.original)).toEqual(["a", "x"]);
    expect(workers).toHaveLength(1);
  });

  it("restarts the worker when the in-flight request is aborted and continues the queue", async () => {
    const { instance, workers } = gateway();
    const controller = new AbortController();
    const inFlight = instance.compute(
      { original: "a", modified: "b", ignoreWhitespace: false },
      controller.signal,
    );
    const next = instance.compute(
      { original: "x", modified: "y", ignoreWhitespace: false },
      new AbortController().signal,
    );
    controller.abort();

    await expect(inFlight).rejects.toMatchObject({ name: "AbortError" });
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[1]?.posted.map((request) => request.original)).toEqual(["x"]);

    workers[1]?.reply(0);
    await expect(next).resolves.toMatchObject({ kind: "ready", added: 1, deleted: 1 });
  });

  it("measures the timeout from when a request is sent, not when it is enqueued", async () => {
    vi.useFakeTimers();
    const { instance, workers } = gateway(100);
    const first = instance.compute(
      { original: "a", modified: "b", ignoreWhitespace: false },
      new AbortController().signal,
    );
    const second = instance.compute(
      { original: "x", modified: "y", ignoreWhitespace: false },
      new AbortController().signal,
    );
    vi.advanceTimersByTime(90);
    workers[0]?.reply(0);
    await expect(first).resolves.toMatchObject({ kind: "ready" });

    vi.advanceTimersByTime(90);
    workers[0]?.reply(1);
    await expect(second).resolves.toMatchObject({ kind: "ready", added: 1, deleted: 1 });
    expect(workers[0]?.terminated).toBe(false);
  });

  it("times out only the in-flight request and keeps the queued ones alive", async () => {
    vi.useFakeTimers();
    const { instance, workers } = gateway(100);
    const hung = instance.compute(
      { original: "a", modified: "b", ignoreWhitespace: false },
      new AbortController().signal,
    );
    const queued = instance.compute(
      { original: "x", modified: "y", ignoreWhitespace: false },
      new AbortController().signal,
    );
    const hungSettled = expect(hung).rejects.toThrow("Diff calculation timed out.");
    vi.advanceTimersByTime(100);
    await hungSettled;
    expect(workers[0]?.terminated).toBe(true);

    workers[1]?.reply(0);
    await expect(queued).resolves.toMatchObject({ kind: "ready", added: 1, deleted: 1 });
  });

  it("fails only the in-flight request when the worker reports an error", async () => {
    const { instance, workers } = gateway();
    const failing = instance.compute(
      { original: "a", modified: "b", ignoreWhitespace: false },
      new AbortController().signal,
    );
    const queued = instance.compute(
      { original: "x", modified: "y", ignoreWhitespace: false },
      new AbortController().signal,
    );
    workers[0]?.onerror?.(new ErrorEvent("error", { message: "boom" }));

    await expect(failing).rejects.toThrow("boom");
    workers[1]?.reply(0);
    await expect(queued).resolves.toMatchObject({ kind: "ready" });
  });

  it("rejects truthfully when the bounded queue is full", async () => {
    const { instance } = gateway();
    for (let index = 0; index < MAX_PENDING_DIFF_VIEW_REQUESTS; index += 1) {
      void instance
        .compute(
          { original: "a", modified: "b", ignoreWhitespace: false },
          new AbortController().signal,
        )
        .catch(() => undefined);
    }
    await expect(
      instance.compute(
        { original: "a", modified: "b", ignoreWhitespace: false },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Too many diff calculations are pending.");
  });

  it("rejects an aborted request and ignores its late response", async () => {
    const { instance, workers } = gateway();
    const controller = new AbortController();
    const pending = instance.compute(
      { original: "a", modified: "b", ignoreWhitespace: false },
      controller.signal,
    );
    controller.abort();
    workers[0]?.reply(0);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("terminates a hung worker on timeout and starts a fresh one", async () => {
    const { instance, workers } = gateway(10);
    const hung = instance.compute(
      { original: "a", modified: "b", ignoreWhitespace: false },
      new AbortController().signal,
    );
    await expect(hung).rejects.toThrow("Diff calculation timed out.");
    expect(workers[0]?.terminated).toBe(true);

    const next = instance.compute(
      { original: "a", modified: "a", ignoreWhitespace: false },
      new AbortController().signal,
    );
    workers[1]?.reply(0);
    await expect(next).resolves.toMatchObject({ kind: "ready" });
  });
});
