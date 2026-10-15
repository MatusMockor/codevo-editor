import {
  highlightBatchSequentially,
  yieldToEventLoop,
  type YieldToEventLoop,
} from "../../application/codeHighlight/codeHighlightBatch";
import type {
  CodeHighlightBatchRequest,
  CodeHighlightOutcome,
  CodeHighlightRequest,
} from "../../application/codeHighlight/codeHighlighter";
import { parseWorkerRequest, type CodeHighlightWorkerResponse } from "./codeHighlightProtocol";
import { createHighlightCache, type HighlightCache } from "./highlightCache";

export const MAX_QUEUED_WORKER_HIGHLIGHTS = 32;

export interface CodeHighlightWorkerHandlerDeps {
  readonly highlight: (request: CodeHighlightRequest) => Promise<CodeHighlightOutcome>;
  readonly post: (response: CodeHighlightWorkerResponse) => void;
  readonly cache?: HighlightCache;
  readonly maxQueued?: number;
  readonly yieldBetween?: YieldToEventLoop;
}

export interface CodeHighlightWorkerHandler {
  receive(message: unknown): void;
  idle(): Promise<void>;
}

type QueuedHighlight =
  | { readonly kind: "single"; readonly requestId: number; readonly request: CodeHighlightRequest }
  | {
      readonly kind: "batch";
      readonly requestId: number;
      readonly request: CodeHighlightBatchRequest;
    };

export function createCodeHighlightWorkerHandler(
  deps: CodeHighlightWorkerHandlerDeps,
): CodeHighlightWorkerHandler {
  const cache = deps.cache ?? createHighlightCache();
  const maxQueued = Math.max(1, deps.maxQueued ?? MAX_QUEUED_WORKER_HIGHLIGHTS);
  const yieldBetween = deps.yieldBetween ?? yieldToEventLoop;
  const queue: QueuedHighlight[] = [];
  let running: { readonly requestId: number; cancelled: boolean } | null = null;
  let draining = false;
  let drained: Promise<void> = Promise.resolve();

  const execute = async (item: QueuedHighlight): Promise<void> => {
    const current = { requestId: item.requestId, cancelled: false };
    running = current;
    try {
      if (item.kind === "batch") {
        const outcome = await highlightBatchSequentially(
          item.request,
          deps.highlight,
          () => current.cancelled,
          yieldBetween,
        );
        if (outcome === null || current.cancelled) return;
        deps.post({ type: "batchResult", requestId: item.requestId, outcome });
        return;
      }
      const outcome = await deps.highlight(item.request);
      cache.set(item.request, outcome);
      if (current.cancelled) return;
      deps.post({ type: "result", requestId: item.requestId, outcome });
    } catch {
      if (current.cancelled) return;
      deps.post({ type: "failed", requestId: item.requestId });
    } finally {
      running = null;
    }
  };

  const drain = async (): Promise<void> => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await execute(item);
      if (queue.length > 0) await yieldBetween();
    }
  };

  const pump = () => {
    if (draining) return;
    draining = true;
    drained = drain().finally(() => {
      draining = false;
    });
  };

  return {
    receive(message) {
      const parsed = parseWorkerRequest(message);
      if (parsed === null) return;
      if (parsed.type === "cancel") {
        const index = queue.findIndex((item) => item.requestId === parsed.requestId);
        if (index !== -1) queue.splice(index, 1);
        if (running?.requestId === parsed.requestId) running.cancelled = true;
        return;
      }
      if (parsed.type === "highlight") {
        const cached = cache.get(parsed.request);
        if (cached !== null) {
          deps.post({ type: "result", requestId: parsed.requestId, outcome: cached });
          return;
        }
      }
      while (queue.length >= maxQueued) {
        const dropped = queue.shift();
        if (dropped === undefined) break;
        deps.post({ type: "failed", requestId: dropped.requestId });
      }
      queue.push(
        parsed.type === "highlight"
          ? { kind: "single", requestId: parsed.requestId, request: parsed.request }
          : { kind: "batch", requestId: parsed.requestId, request: parsed.request },
      );
      pump();
    },
    idle() {
      return drained;
    },
  };
}
