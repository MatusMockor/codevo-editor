import { highlightBatchWith } from "../../application/codeHighlight/codeHighlightBatch";
import type {
  CodeHighlightBatchOutcome,
  CodeHighlighter,
  CodeHighlightOutcome,
} from "../../application/codeHighlight/codeHighlighter";
import {
  exceedsHighlightBatchBudget,
  exceedsHighlightBudget,
} from "../../domain/codeHighlight/highlightedCode";
import {
  parseWorkerResponse,
  type CodeHighlightWorkerRequest,
  type CodeHighlightWorkerResponse,
} from "./codeHighlightProtocol";
import { createInlineCodeHighlighter } from "./inlineCodeHighlighter";
import { shikiLanguageFor } from "./shikiCodeTokens";

export const MAX_PENDING_WORKER_HIGHLIGHTS = 64;
export const WORKER_HIGHLIGHT_TIMEOUT_MS = 20_000;

export type CodeHighlightWorker = Pick<
  Worker,
  "onerror" | "onmessage" | "onmessageerror" | "postMessage" | "terminate"
>;

export interface WorkerCodeHighlighterOptions {
  readonly createWorker?: () => CodeHighlightWorker;
  readonly fallback?: () => CodeHighlighter;
  readonly timeoutMs?: number;
  readonly maxPending?: number;
}

export interface DisposableCodeHighlighter extends Required<CodeHighlighter> {
  dispose(): void;
}

interface PendingHighlight {
  readonly message: CodeHighlightWorkerRequest;
  readonly signal: AbortSignal | undefined;
  readonly settleResponse: (response: CodeHighlightWorkerResponse) => void;
  readonly settleUnavailable: () => void;
  readonly replay: (fallback: CodeHighlighter) => void;
  readonly reject: (error: unknown) => void;
  readonly onAbort: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

type PendingSettlers = Pick<PendingHighlight, "settleResponse" | "settleUnavailable" | "replay">;

const UNAVAILABLE: CodeHighlightOutcome = { kind: "plain", reason: "unavailable" };
const BATCH_UNAVAILABLE: CodeHighlightBatchOutcome = { kind: "plain", reason: "unavailable" };

export function createWorkerCodeHighlighter(
  options: WorkerCodeHighlighterOptions = {},
): DisposableCodeHighlighter {
  const createWorker = options.createWorker ?? defaultWorkerFactory;
  const timeoutMs = Math.max(1, options.timeoutMs ?? WORKER_HIGHLIGHT_TIMEOUT_MS);
  const maxPending = Math.max(1, options.maxPending ?? MAX_PENDING_WORKER_HIGHLIGHTS);
  const pending = new Map<number, PendingHighlight>();
  let worker: CodeHighlightWorker | null = null;
  let fallback: CodeHighlighter | null = null;
  let nextRequestId = 1;

  const fallbackHighlighter = (): CodeHighlighter => {
    fallback ??= (options.fallback ?? createInlineCodeHighlighter)();
    return fallback;
  };

  const settle = (requestId: number): PendingHighlight | null => {
    const entry = pending.get(requestId);
    if (entry === undefined) return null;
    pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener("abort", entry.onAbort);
    return entry;
  };

  const post = (message: CodeHighlightWorkerRequest): boolean => {
    if (worker === null) return false;
    try {
      worker.postMessage(message);
      return true;
    } catch {
      return false;
    }
  };

  const discardWorker = () => {
    const current = worker;
    worker = null;
    if (current === null) return;
    current.onmessage = null;
    current.onerror = null;
    current.onmessageerror = null;
    current.terminate();
  };

  const failOver = () => {
    discardWorker();
    fallbackHighlighter();
    for (const requestId of [...pending.keys()]) {
      const entry = settle(requestId);
      if (entry === null) continue;
      entry.replay(fallbackHighlighter());
    }
  };

  const ensureWorker = (): CodeHighlightWorker | null => {
    if (worker !== null) return worker;
    if (fallback !== null) return null;
    try {
      const created = createWorker();
      created.onmessage = (event: MessageEvent<unknown>) => {
        if (created !== worker) return;
        const response = parseWorkerResponse(event.data);
        if (response === null) return;
        const entry = settle(response.requestId);
        if (entry === null) return;
        entry.settleResponse(response);
      };
      created.onerror = (event) => {
        event.preventDefault();
        if (created === worker) failOver();
      };
      created.onmessageerror = () => {
        if (created === worker) failOver();
      };
      worker = created;
      return created;
    } catch {
      fallbackHighlighter();
      return null;
    }
  };

  const restartWorker = () => {
    discardWorker();
    if (pending.size === 0) return;
    if (ensureWorker() === null) {
      failOver();
      return;
    }
    for (const entry of pending.values()) {
      if (post(entry.message)) continue;
      failOver();
      return;
    }
  };

  const dispatch = <T>(
    signal: AbortSignal | undefined,
    message: (requestId: number) => CodeHighlightWorkerRequest,
    settlers: (resolve: (outcome: T) => void, reject: (error: unknown) => void) => PendingSettlers,
  ): Promise<T> => {
    const requestId = nextRequestId;
    nextRequestId += 1;
    return new Promise<T>((resolve, reject) => {
      const handlers = settlers(resolve, reject);
      const onAbort = () => {
        const entry = settle(requestId);
        if (entry === null) return;
        post({ type: "cancel", requestId });
        entry.reject(abortError());
      };
      const timer = setTimeout(() => {
        const entry = settle(requestId);
        if (entry === null) return;
        entry.settleUnavailable();
        restartWorker();
      }, timeoutMs);
      const request = message(requestId);
      pending.set(requestId, { ...handlers, message: request, signal, reject, onAbort, timer });
      signal?.addEventListener("abort", onAbort, { once: true });
      if (!post(request)) failOver();
    });
  };

  return {
    highlight(request, signal) {
      if (signal?.aborted === true) return Promise.reject(abortError());
      if (exceedsHighlightBudget(request.text)) {
        return Promise.resolve({ kind: "plain", reason: "too-large" });
      }
      if (shikiLanguageFor(request.language) === null) {
        return Promise.resolve({ kind: "plain", reason: "unsupported-language" });
      }
      if (pending.size >= maxPending) return Promise.resolve(UNAVAILABLE);
      const target = ensureWorker();
      if (target === null) return fallbackHighlighter().highlight(request, signal);
      return dispatch<CodeHighlightOutcome>(
        signal,
        (requestId) => ({ type: "highlight", requestId, request }),
        (resolve, reject) => ({
          settleResponse: (response) =>
            resolve(response.type === "result" ? response.outcome : UNAVAILABLE),
          settleUnavailable: () => resolve(UNAVAILABLE),
          replay: (fallback) => fallback.highlight(request, signal).then(resolve, reject),
        }),
      );
    },
    highlightBatch(request, signal) {
      if (signal?.aborted === true) return Promise.reject(abortError());
      if (exceedsHighlightBatchBudget(request.texts)) {
        return Promise.resolve({ kind: "plain", reason: "too-large" });
      }
      if (shikiLanguageFor(request.language) === null) {
        return Promise.resolve({ kind: "plain", reason: "unsupported-language" });
      }
      if (pending.size >= maxPending) return Promise.resolve(BATCH_UNAVAILABLE);
      const target = ensureWorker();
      const replay = (fallback: CodeHighlighter) =>
        highlightBatchWith(fallback, request, signal ?? new AbortController().signal);
      if (target === null) return replay(fallbackHighlighter());
      return dispatch<CodeHighlightBatchOutcome>(
        signal,
        (requestId) => ({ type: "highlightBatch", requestId, request }),
        (resolve, reject) => ({
          settleResponse: (response) =>
            resolve(response.type === "batchResult" ? response.outcome : BATCH_UNAVAILABLE),
          settleUnavailable: () => resolve(BATCH_UNAVAILABLE),
          replay: (fallback) => replay(fallback).then(resolve, reject),
        }),
      );
    },
    dispose() {
      discardWorker();
      fallback = null;
      for (const requestId of [...pending.keys()]) settle(requestId)?.reject(abortError());
    },
  };
}

function defaultWorkerFactory(): CodeHighlightWorker {
  return new Worker(new URL("./codeHighlight.worker.ts", import.meta.url), { type: "module" });
}

function abortError(): DOMException {
  return new DOMException("Code highlighting was cancelled.", "AbortError");
}
