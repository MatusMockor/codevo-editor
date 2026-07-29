import type * as Monaco from "monaco-editor";
import type {
  IdentifiedLanguageServerRequest,
  LanguageServerSemanticTokens,
} from "../domain/languageServerFeatures";
import { cancelJavaScriptTypeScriptLanguageServerRequest } from "../infrastructure/tauriLanguageServerRuntimeGateway";

interface CancellationToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested?(listener: (event?: unknown) => unknown): Monaco.IDisposable;
}
type CancelRequest = (rootPath: string, sessionId: number, requestId: number) => Promise<void>;

export function toMonacoSemanticTokens(
  tokens: LanguageServerSemanticTokens | null,
): Monaco.languages.SemanticTokens | null {
  if (!tokens || tokens.data.length === 0) {
    return null;
  }

  return {
    data: Uint32Array.from(tokens.data),
    ...(tokens.resultId ? { resultId: tokens.resultId } : {}),
  };
}

export const HOVER_FEATURE_REQUEST_TIMEOUT_MS = 700;
export const DOCUMENT_HIGHLIGHT_REQUEST_TIMEOUT_MS = 700;
export const LINKED_EDITING_RANGE_REQUEST_TIMEOUT_MS = 700;
export const CODE_ACTION_REQUEST_TIMEOUT_MS = 1_200;
export const CODE_ACTION_RESOLVE_REQUEST_TIMEOUT_MS = 1_200;
export const FEATURE_REQUEST_TIMED_OUT = Symbol("featureRequestTimedOut");
export const FEATURE_REQUEST_CANCELLED = Symbol("featureRequestCancelled");
const INTERACTIVE_FEATURE_REQUEST_TIMEOUT_MS = 2500;

export function runBoundedLanguageServerRequest<T>(
  request: IdentifiedLanguageServerRequest<T>,
  token: CancellationToken | undefined,
  rootPath: string,
  timeoutMs: number = INTERACTIVE_FEATURE_REQUEST_TIMEOUT_MS,
  cancelRequest: CancelRequest = cancelJavaScriptTypeScriptLanguageServerRequest,
): IdentifiedLanguageServerRequest<
  T | typeof FEATURE_REQUEST_CANCELLED | typeof FEATURE_REQUEST_TIMED_OUT
> {
  let pending = true;
  let cancelIssued = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let subscription: Monaco.IDisposable | undefined;
  let resolveCancellation: (() => void) | undefined;
  const cancellation = new Promise<typeof FEATURE_REQUEST_CANCELLED>((resolve) => {
    resolveCancellation = () => resolve(FEATURE_REQUEST_CANCELLED);
  });
  const cancelOnce = (settleRequest = true) => {
    if (!pending || cancelIssued) {
      return;
    }
    cancelIssued = true;
    void cancelRequest(rootPath, request.sessionId, request.requestId).catch(() => undefined);
    if (settleRequest) {
      resolveCancellation?.();
    }
  };

  const timeout = new Promise<typeof FEATURE_REQUEST_TIMED_OUT>((resolve) => {
    timeoutHandle = setTimeout(() => {
      cancelOnce(false);
      resolve(FEATURE_REQUEST_TIMED_OUT);
    }, timeoutMs);
  });

  if (token?.onCancellationRequested) {
    subscription = token.onCancellationRequested(() => cancelOnce());
  }
  if (token?.isCancellationRequested) {
    cancelOnce();
  }

  return identifiedRequest(
    Promise.race([request, timeout, cancellation]).finally(() => {
      pending = false;
      clearTimeout(timeoutHandle);
      subscription?.dispose();
    }),
    request.sessionId,
    request.requestId,
  );
}

export function raceInteractiveFeatureRequest<T>(
  request: Promise<T>,
  timeoutMs: number = INTERACTIVE_FEATURE_REQUEST_TIMEOUT_MS,
): Promise<T | typeof FEATURE_REQUEST_TIMED_OUT> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof FEATURE_REQUEST_TIMED_OUT>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(FEATURE_REQUEST_TIMED_OUT), timeoutMs);
  });

  return Promise.race([request, timeout]).finally(() => {
    clearTimeout(timeoutHandle);
  });
}

function identifiedRequest<T>(
  request: Promise<T>,
  sessionId: number,
  requestId: number,
): IdentifiedLanguageServerRequest<T> {
  return Object.assign(request, { requestId, sessionId });
}
