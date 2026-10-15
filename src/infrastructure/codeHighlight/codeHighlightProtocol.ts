import type {
  CodeHighlightBatchOutcome,
  CodeHighlightBatchRequest,
  CodeHighlightOutcome,
  CodeHighlightRequest,
  CodePlainReason,
} from "../../application/codeHighlight/codeHighlighter";
import { isCodeLanguageId, type CodeLanguageId } from "../../domain/codeHighlight/codeLanguage";
import { MAX_HIGHLIGHT_BATCH_TEXTS } from "../../domain/codeHighlight/highlightedCode";
import type { MonacoAppTheme } from "../../domain/settings";

export type CodeHighlightWorkerRequest =
  | {
      readonly type: "highlight";
      readonly requestId: number;
      readonly request: CodeHighlightRequest;
    }
  | {
      readonly type: "highlightBatch";
      readonly requestId: number;
      readonly request: CodeHighlightBatchRequest;
    }
  | { readonly type: "cancel"; readonly requestId: number };

export type CodeHighlightWorkerResponse =
  | {
      readonly type: "result";
      readonly requestId: number;
      readonly outcome: CodeHighlightOutcome;
    }
  | {
      readonly type: "batchResult";
      readonly requestId: number;
      readonly outcome: CodeHighlightBatchOutcome;
    }
  | { readonly type: "failed"; readonly requestId: number };

export function parseWorkerRequest(value: unknown): CodeHighlightWorkerRequest | null {
  if (!isRecord(value) || !isRequestId(value.requestId)) return null;
  if (value.type === "cancel") {
    if (!hasOnlyKeys(value, ["type", "requestId"])) return null;
    return { type: "cancel", requestId: value.requestId };
  }
  if (!hasOnlyKeys(value, ["type", "requestId", "request"])) return null;
  if (value.type === "highlightBatch") return parseBatchRequest(value.requestId, value.request);
  if (value.type !== "highlight") return null;
  const request = value.request;
  if (!isRecord(request) || !hasOnlyKeys(request, ["text", "language", "theme"])) return null;
  if (typeof request.text !== "string") return null;
  const target = parseTarget(request);
  if (target === null) return null;
  const parsed: CodeHighlightRequest = { text: request.text, ...target };
  return { type: "highlight", requestId: value.requestId, request: parsed };
}

function parseBatchRequest(requestId: number, request: unknown): CodeHighlightWorkerRequest | null {
  if (!isRecord(request) || !hasOnlyKeys(request, ["texts", "language", "theme"])) return null;
  const texts = request.texts;
  if (!Array.isArray(texts) || texts.length > MAX_HIGHLIGHT_BATCH_TEXTS) return null;
  if (!texts.every((text): text is string => typeof text === "string")) return null;
  const target = parseTarget(request);
  if (target === null) return null;
  return { type: "highlightBatch", requestId, request: { texts, ...target } };
}

function parseTarget(
  request: Record<string, unknown>,
): { readonly language: CodeLanguageId; readonly theme: MonacoAppTheme } | null {
  if (typeof request.language !== "string" || !isCodeLanguageId(request.language)) return null;
  if (typeof request.theme !== "string" || request.theme.length === 0) return null;
  return { language: request.language, theme: request.theme as MonacoAppTheme };
}

export function parseWorkerResponse(value: unknown): CodeHighlightWorkerResponse | null {
  if (!isRecord(value) || !isRequestId(value.requestId)) return null;
  if (value.type === "failed") return { type: "failed", requestId: value.requestId };
  if (value.type === "batchResult") return parseBatchResponse(value.requestId, value.outcome);
  if (value.type !== "result" || !isRecord(value.outcome)) return null;
  const outcome = value.outcome;
  if (outcome.kind === "plain") {
    const reason = plainReason(outcome.reason);
    if (reason === null) return null;
    return { type: "result", requestId: value.requestId, outcome: { kind: "plain", reason } };
  }
  if (outcome.kind !== "highlighted" || !Array.isArray(outcome.lines)) return null;
  return {
    type: "result",
    requestId: value.requestId,
    outcome: outcome as unknown as CodeHighlightOutcome,
  };
}

function parseBatchResponse(
  requestId: number,
  outcome: unknown,
): CodeHighlightWorkerResponse | null {
  if (!isRecord(outcome)) return null;
  if (outcome.kind === "plain") {
    const reason = plainReason(outcome.reason);
    if (reason === null) return null;
    return { type: "batchResult", requestId, outcome: { kind: "plain", reason } };
  }
  if (outcome.kind !== "highlighted" || !Array.isArray(outcome.texts)) return null;
  if (!outcome.texts.every((lines) => Array.isArray(lines))) return null;
  return {
    type: "batchResult",
    requestId,
    outcome: outcome as unknown as CodeHighlightBatchOutcome,
  };
}

function plainReason(reason: unknown): CodePlainReason | null {
  if (reason === "unsupported-language" || reason === "too-large" || reason === "unavailable") {
    return reason;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
