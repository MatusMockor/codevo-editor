import { describe, expect, it } from "vitest";
import type { CodeHighlightRequest } from "../../application/codeHighlight/codeHighlighter";
import {
  MAX_HIGHLIGHT_BATCH_TEXTS,
  MAX_HIGHLIGHT_CHARS,
} from "../../domain/codeHighlight/highlightedCode";
import { createAppHighlighter } from "../shikiHighlighter";
import { createCodeHighlightWorkerHandler } from "./codeHighlightWorkerHandler";
import { highlightWithShiki } from "./shikiCodeTokens";
import { createWorkerCodeHighlighter, type CodeHighlightWorker } from "./workerCodeHighlighter";

const JSON_REQUEST: CodeHighlightRequest = {
  text: '{"a": [1, true]}',
  language: "json",
  theme: "dark-plus",
};

class InProcessWorker implements CodeHighlightWorker {
  onerror: CodeHighlightWorker["onerror"] = null;
  onmessage: CodeHighlightWorker["onmessage"] = null;
  onmessageerror: CodeHighlightWorker["onmessageerror"] = null;
  readonly sent: unknown[] = [];
  terminated = false;
  paused = false;
  private readonly held: unknown[] = [];
  private readonly handler = createCodeHighlightWorkerHandler({
    highlight: async (request) => highlightWithShiki(await createAppHighlighter(), request),
    post: (response) => {
      if (this.paused) {
        this.held.push(response);
        return;
      }
      this.deliver(response);
    },
  });

  postMessage(message: unknown): void {
    this.sent.push(message);
    queueMicrotask(() => this.handler.receive(structuredClone(message)));
  }

  terminate(): void {
    this.terminated = true;
  }

  release(): void {
    this.paused = false;
    for (const response of this.held.splice(0)) this.deliver(response);
  }

  fail(): void {
    const event = { message: "crash", preventDefault() {} } as unknown as ErrorEvent;
    this.onerror?.call(this as unknown as Worker, event);
  }

  idle(): Promise<void> {
    return this.handler.idle();
  }

  private deliver(response: unknown): void {
    const event = { data: structuredClone(response) } as MessageEvent;
    setTimeout(() => this.onmessage?.call(this as unknown as Worker, event), 0);
  }
}

function harness() {
  const workers: InProcessWorker[] = [];
  const highlighter = createWorkerCodeHighlighter({
    createWorker: () => {
      const worker = new InProcessWorker();
      workers.push(worker);
      return worker;
    },
  });
  return { highlighter, workers };
}

describe("createWorkerCodeHighlighter", () => {
  it("highlights through the worker protocol with real Shiki", async () => {
    const { highlighter, workers } = harness();
    const outcome = await highlighter.highlight(JSON_REQUEST);
    expect(outcome.kind).toBe("highlighted");
    expect(workers).toHaveLength(1);
    highlighter.dispose();
    expect(workers[0]?.terminated).toBe(true);
  });

  it("answers oversized and plaintext requests without starting a worker", async () => {
    const { highlighter, workers } = harness();
    await expect(
      highlighter.highlight({ ...JSON_REQUEST, text: "x".repeat(MAX_HIGHLIGHT_CHARS + 1) }),
    ).resolves.toEqual({ kind: "plain", reason: "too-large" });
    await expect(
      highlighter.highlight({ ...JSON_REQUEST, language: "plaintext" }),
    ).resolves.toEqual({
      kind: "plain",
      reason: "unsupported-language",
    });
    expect(workers).toHaveLength(0);
  });

  it("cancels an aborted request and ignores its late response", async () => {
    const { highlighter, workers } = harness();
    await highlighter.highlight(JSON_REQUEST);
    const worker = workers[0];
    if (worker === undefined) throw new Error("worker missing");
    worker.paused = true;
    const controller = new AbortController();
    const aborted = highlighter.highlight({ ...JSON_REQUEST, text: "[1]" }, controller.signal);
    const kept = highlighter.highlight({ ...JSON_REQUEST, text: "[2]" });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.sent).toContainEqual({ type: "cancel", requestId: 2 });
    await worker.idle();
    worker.release();
    const outcome = await kept;
    expect(outcome.kind).toBe("highlighted");
    if (outcome.kind !== "highlighted") return;
    expect(outcome.lines[0]?.map((token) => token.text).join("")).toBe("[2]");
  });

  it("falls back to the inline highlighter when the worker cannot be created", async () => {
    const highlighter = createWorkerCodeHighlighter({
      createWorker: () => {
        throw new Error("no workers here");
      },
    });
    await expect(highlighter.highlight(JSON_REQUEST)).resolves.toMatchObject({
      kind: "highlighted",
    });
  });

  it("reroutes pending work to the fallback when the worker crashes", async () => {
    const { highlighter, workers } = harness();
    await highlighter.highlight(JSON_REQUEST);
    const worker = workers[0];
    if (worker === undefined) throw new Error("worker missing");
    worker.paused = true;
    const pending = highlighter.highlight({ ...JSON_REQUEST, text: "[3]" });
    await worker.idle();
    worker.fail();
    await expect(pending).resolves.toMatchObject({ kind: "highlighted" });
    expect(worker.terminated).toBe(true);
    await highlighter.highlight({ ...JSON_REQUEST, text: "[4]" });
    expect(workers).toHaveLength(1);
  });

  it("resolves a stuck request as unavailable after the timeout", async () => {
    const workers: InProcessWorker[] = [];
    const highlighter = createWorkerCodeHighlighter({
      timeoutMs: 5,
      createWorker: () => {
        const worker = new InProcessWorker();
        worker.paused = true;
        workers.push(worker);
        return worker;
      },
    });
    await expect(highlighter.highlight(JSON_REQUEST)).resolves.toEqual({
      kind: "plain",
      reason: "unavailable",
    });
    expect(workers[0]?.terminated).toBe(true);
  });

  it("terminates a worker past its deadline and reroutes the other pending work", async () => {
    await highlightWithShiki(await createAppHighlighter(), JSON_REQUEST);
    const workers: InProcessWorker[] = [];
    const highlighter = createWorkerCodeHighlighter({
      timeoutMs: 400,
      createWorker: () => {
        const worker = new InProcessWorker();
        worker.paused = workers.length === 0;
        workers.push(worker);
        return worker;
      },
    });
    const stuck = highlighter.highlight({ ...JSON_REQUEST, text: "[1]" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const rerouted = highlighter.highlightBatch({
      texts: ["[2]", "[3]"],
      language: "json",
      theme: "dark-plus",
    });

    await expect(stuck).resolves.toEqual({ kind: "plain", reason: "unavailable" });
    expect(workers[0]?.terminated).toBe(true);
    const outcome = await rerouted;
    expect(outcome.kind).toBe("highlighted");
    expect(workers).toHaveLength(2);
    expect(workers[1]?.sent).toEqual([
      {
        type: "highlightBatch",
        requestId: 2,
        request: { texts: ["[2]", "[3]"], language: "json", theme: "dark-plus" },
      },
    ]);
    highlighter.dispose();
  });

  it("rejects pending work on dispose and starts a fresh worker afterwards", async () => {
    const { highlighter, workers } = harness();
    await highlighter.highlight(JSON_REQUEST);
    const first = workers[0];
    if (first === undefined) throw new Error("worker missing");
    first.paused = true;
    const pending = highlighter.highlight({ ...JSON_REQUEST, text: "[5]" });
    highlighter.dispose();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    first.release();
    await expect(highlighter.highlight({ ...JSON_REQUEST, text: "[6]" })).resolves.toMatchObject({
      kind: "highlighted",
    });
    expect(workers).toHaveLength(2);
  });

  it("highlights a batch with one worker message and keeps texts independent", async () => {
    const { highlighter, workers } = harness();
    const outcome = await highlighter.highlightBatch({
      texts: ['{"a": 1}', "[true]"],
      language: "json",
      theme: "dark-plus",
    });
    expect(outcome.kind).toBe("highlighted");
    if (outcome.kind !== "highlighted") return;
    expect(outcome.texts.map((lines) => lines[0]?.map((token) => token.text).join(""))).toEqual([
      '{"a": 1}',
      "[true]",
    ]);
    expect(workers[0]?.sent.filter((message) => isBatchMessage(message))).toHaveLength(1);
  });

  it("answers an oversized batch without starting a worker", async () => {
    const { highlighter, workers } = harness();
    await expect(
      highlighter.highlightBatch({
        texts: Array.from({ length: MAX_HIGHLIGHT_BATCH_TEXTS + 1 }, () => "1"),
        language: "json",
        theme: "dark-plus",
      }),
    ).resolves.toEqual({ kind: "plain", reason: "too-large" });
    expect(workers).toHaveLength(0);
  });

  it("cancels an aborted batch in the worker", async () => {
    const { highlighter, workers } = harness();
    await highlighter.highlight(JSON_REQUEST);
    const worker = workers[0];
    if (worker === undefined) throw new Error("worker missing");
    worker.paused = true;
    const controller = new AbortController();
    const aborted = highlighter.highlightBatch(
      { texts: ["[1]", "[2]"], language: "json", theme: "dark-plus" },
      controller.signal,
    );
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.sent).toContainEqual({ type: "cancel", requestId: 2 });
  });

  it("reroutes a pending batch to the fallback when the worker crashes", async () => {
    const { highlighter, workers } = harness();
    await highlighter.highlight(JSON_REQUEST);
    const worker = workers[0];
    if (worker === undefined) throw new Error("worker missing");
    worker.paused = true;
    const pending = highlighter.highlightBatch({
      texts: ["[3]"],
      language: "json",
      theme: "dark-plus",
    });
    await worker.idle();
    worker.fail();
    await expect(pending).resolves.toMatchObject({ kind: "highlighted" });
  });
});

function isBatchMessage(message: unknown): boolean {
  return typeof message === "object" && message !== null && "type" in message
    ? message.type === "highlightBatch"
    : false;
}
