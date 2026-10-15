import { describe, expect, it } from "vitest";
import type {
  CodeHighlightOutcome,
  CodeHighlightRequest,
} from "../../application/codeHighlight/codeHighlighter";
import type { CodeHighlightWorkerResponse } from "./codeHighlightProtocol";
import { MAX_HIGHLIGHT_BATCH_TEXTS } from "../../domain/codeHighlight/highlightedCode";
import { createCodeHighlightWorkerHandler } from "./codeHighlightWorkerHandler";
import { createAppHighlighter } from "../shikiHighlighter";
import { highlightWithShiki } from "./shikiCodeTokens";

interface Deferred {
  readonly request: CodeHighlightRequest;
  readonly resolve: (outcome: CodeHighlightOutcome) => void;
  readonly reject: (error: unknown) => void;
}

function controlledHandler(maxQueued?: number) {
  const started: Deferred[] = [];
  const posted: CodeHighlightWorkerResponse[] = [];
  const handler = createCodeHighlightWorkerHandler({
    highlight: (request) =>
      new Promise<CodeHighlightOutcome>((resolve, reject) => {
        started.push({ request, resolve, reject });
      }),
    post: (response) => posted.push(response),
    maxQueued,
  });
  return { handler, started, posted };
}

function highlight(requestId: number, text: string) {
  return {
    type: "highlight",
    requestId,
    request: { text, language: "json", theme: "dark-plus" },
  };
}

const PLAIN: CodeHighlightOutcome = { kind: "plain", reason: "unsupported-language" };

async function flush(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("createCodeHighlightWorkerHandler", () => {
  it("highlights one request at a time in arrival order", async () => {
    const { handler, started, posted } = controlledHandler();
    handler.receive(highlight(1, "a"));
    handler.receive(highlight(2, "b"));
    expect(started.map((item) => item.request.text)).toEqual(["a"]);
    started[0]?.resolve(PLAIN);
    await flush();
    expect(posted).toEqual([{ type: "result", requestId: 1, outcome: PLAIN }]);
    expect(started.map((item) => item.request.text)).toEqual(["a", "b"]);
  });

  it("drops cancelled queued work and suppresses a cancelled in-flight result", async () => {
    const { handler, started, posted } = controlledHandler();
    handler.receive(highlight(1, "a"));
    handler.receive(highlight(2, "b"));
    handler.receive(highlight(3, "c"));
    handler.receive({ type: "cancel", requestId: 2 });
    handler.receive({ type: "cancel", requestId: 1 });
    started[0]?.resolve(PLAIN);
    await flush();
    expect(started.map((item) => item.request.text)).toEqual(["a", "c"]);
    started[1]?.resolve(PLAIN);
    await handler.idle();
    expect(posted).toEqual([{ type: "result", requestId: 3, outcome: PLAIN }]);
  });

  it("serves repeated content from the cache, even after a cancelled run", async () => {
    const { handler, started, posted } = controlledHandler();
    handler.receive(highlight(1, "a"));
    handler.receive({ type: "cancel", requestId: 1 });
    started[0]?.resolve(PLAIN);
    await handler.idle();
    handler.receive(highlight(2, "a"));
    expect(started).toHaveLength(1);
    expect(posted).toEqual([{ type: "result", requestId: 2, outcome: PLAIN }]);
  });

  it("bounds the queue by failing the oldest queued request", () => {
    const { handler, posted } = controlledHandler(2);
    handler.receive(highlight(1, "a"));
    handler.receive(highlight(2, "b"));
    handler.receive(highlight(3, "c"));
    handler.receive(highlight(4, "d"));
    expect(posted).toEqual([{ type: "failed", requestId: 2 }]);
  });

  it("reports a failed highlight and keeps processing", async () => {
    const { handler, started, posted } = controlledHandler();
    handler.receive(highlight(1, "a"));
    handler.receive(highlight(2, "b"));
    started[0]?.reject(new Error("boom"));
    await flush();
    started[1]?.resolve(PLAIN);
    await handler.idle();
    expect(posted).toEqual([
      { type: "failed", requestId: 1 },
      { type: "result", requestId: 2, outcome: PLAIN },
    ]);
  });

  it("ignores malformed and unknown messages", () => {
    const { handler, started, posted } = controlledHandler();
    for (const message of [
      null,
      "x",
      {
        type: "highlight",
        requestId: 0,
        request: { text: "", language: "json", theme: "dark-plus" },
      },
      {
        type: "highlight",
        requestId: 1,
        request: { text: "", language: "cobol", theme: "dark-plus" },
      },
      {
        type: "highlight",
        requestId: 1,
        request: { text: 1, language: "json", theme: "dark-plus" },
      },
      { ...highlight(1, "a"), extra: true },
      { type: "cancel", requestId: 1, extra: true },
      { type: "eval", requestId: 1 },
    ]) {
      handler.receive(message);
    }
    expect(started).toHaveLength(0);
    expect(posted).toHaveLength(0);
  });

  it("runs the real Shiki pipeline through the protocol", async () => {
    const posted: CodeHighlightWorkerResponse[] = [];
    const handler = createCodeHighlightWorkerHandler({
      highlight: async (request) => highlightWithShiki(await createAppHighlighter(), request),
      post: (response) => posted.push(response),
    });
    handler.receive(highlight(7, '{"a": 1}'));
    await handler.idle();
    const response = posted[0];
    expect(response?.type).toBe("result");
    if (response?.type !== "result") return;
    expect(response.outcome.kind).toBe("highlighted");
  });

  it("tokenizes every text of a batch on its own with real Shiki", async () => {
    const posted: CodeHighlightWorkerResponse[] = [];
    const handler = createCodeHighlightWorkerHandler({
      highlight: async (request) => highlightWithShiki(await createAppHighlighter(), request),
      post: (response) => posted.push(response),
    });
    handler.receive(batch(8, ["/* opened and never closed", "const value = 1;"], "typescript"));
    await handler.idle();
    const response = posted[0];
    expect(response?.type).toBe("batchResult");
    if (response?.type !== "batchResult" || response.outcome.kind !== "highlighted") {
      throw new Error("expected a highlighted batch");
    }
    expect(response.outcome.texts).toHaveLength(2);
    const second = response.outcome.texts[1]?.[0] ?? [];
    expect(second.map((token) => token.text).join("")).toBe("const value = 1;");
    expect(new Set(second.map((token) => token.color)).size).toBeGreaterThan(1);
  });

  it("stops a cancelled batch between texts and posts nothing", async () => {
    const { handler, started, posted } = controlledHandler();
    handler.receive(batch(1, ["a", "b", "c"]));
    expect(started.map((item) => item.request.text)).toEqual(["a"]);
    handler.receive({ type: "cancel", requestId: 1 });
    started[0]?.resolve({ kind: "highlighted", lines: [[]] });
    await flush();
    expect(started).toHaveLength(1);
    expect(posted).toEqual([]);
  });

  it("lets a cancel message arrive between texts of a warm batch", async () => {
    const highlighted: string[] = [];
    const posted: CodeHighlightWorkerResponse[] = [];
    const handler = createCodeHighlightWorkerHandler({
      highlight: (request) => {
        highlighted.push(request.text);
        return Promise.resolve({ kind: "highlighted", lines: [[]] });
      },
      post: (response) => posted.push(response),
    });
    handler.receive(batch(1, ["a", "b", "c", "d"]));
    deliverAsWorkerMessage(handler, { type: "cancel", requestId: 1 });
    await handler.idle();
    expect(highlighted.length).toBeLessThan(4);
    expect(posted).toEqual([]);
  });

  it("lets a cancel message reach queued work behind a warm request", async () => {
    const highlighted: string[] = [];
    const posted: CodeHighlightWorkerResponse[] = [];
    const handler = createCodeHighlightWorkerHandler({
      highlight: (request) => {
        highlighted.push(request.text);
        return Promise.resolve({ kind: "highlighted", lines: [[]] });
      },
      post: (response) => posted.push(response),
    });
    handler.receive(highlight(1, "a"));
    handler.receive(highlight(2, "b"));
    deliverAsWorkerMessage(handler, { type: "cancel", requestId: 2 });
    await handler.idle();
    expect(highlighted).toEqual(["a"]);
    expect(posted.map((response) => response.requestId)).toEqual([1]);
  });

  it("answers a batch with the first plain outcome", async () => {
    const { handler, started, posted } = controlledHandler();
    handler.receive(batch(3, ["a", "b"]));
    started[0]?.resolve(PLAIN);
    await flush();
    expect(posted).toEqual([{ type: "batchResult", requestId: 3, outcome: PLAIN }]);
  });

  it("rejects malformed and oversized batches", () => {
    const { handler, started, posted } = controlledHandler();
    for (const message of [
      batch(
        1,
        Array.from({ length: MAX_HIGHLIGHT_BATCH_TEXTS + 1 }, () => "x"),
      ),
      { ...batch(1, ["a"]), extra: true },
      {
        type: "highlightBatch",
        requestId: 1,
        request: { texts: [1], language: "json", theme: "t" },
      },
      {
        type: "highlightBatch",
        requestId: 1,
        request: { texts: ["a"], language: "json", theme: "t", extra: 1 },
      },
      {
        type: "highlightBatch",
        requestId: 1,
        request: { texts: "a", language: "json", theme: "t" },
      },
    ]) {
      handler.receive(message);
    }
    expect(started).toHaveLength(0);
    expect(posted).toHaveLength(0);
  });
});

function batch(requestId: number, texts: readonly string[], language = "json") {
  return { type: "highlightBatch", requestId, request: { texts, language, theme: "dark-plus" } };
}

function deliverAsWorkerMessage(
  handler: ReturnType<typeof createCodeHighlightWorkerHandler>,
  message: unknown,
): void {
  const channel = new MessageChannel();
  channel.port1.onmessage = (event: MessageEvent<unknown>) => {
    channel.port1.close();
    handler.receive(event.data);
  };
  channel.port2.postMessage(message);
}
