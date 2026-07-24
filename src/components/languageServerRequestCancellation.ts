import type * as Monaco from "monaco-editor";
import type { LanguageServerSemanticTokens } from "../domain/languageServerFeatures";
import { cancelJavaScriptTypeScriptLanguageServerRequest } from "../infrastructure/tauriLanguageServerRuntimeGateway";

interface CancellationToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested?(listener: (event?: unknown) => unknown): Monaco.IDisposable;
}
type IdentifiedRequest<T> = Promise<T> & { readonly requestId?: unknown };
type CancelRequest = (rootPath: string, requestId: number) => Promise<void>;

export function observeLanguageServerRequestCancellation<T>(
  request: IdentifiedRequest<T>,
  token: CancellationToken | undefined,
  rootPath: string,
  cancelRequest: CancelRequest = cancelJavaScriptTypeScriptLanguageServerRequest,
): Promise<T> {
  if (!token?.onCancellationRequested || !isRequestId(request.requestId)) {
    return request;
  }

  let pending = true;
  let cancelled = false;
  const cancel = () => {
    if (!pending || cancelled) {
      return;
    }
    cancelled = true;
    void cancelRequest(rootPath, request.requestId as number).catch(() => undefined);
  };
  const subscription = token.onCancellationRequested(cancel);
  if (token.isCancellationRequested) {
    cancel();
  }

  return request.finally(() => {
    pending = false;
    subscription.dispose();
  });
}

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
export const FEATURE_REQUEST_TIMED_OUT = Symbol("featureRequestTimedOut");
const INTERACTIVE_FEATURE_REQUEST_TIMEOUT_MS = 2500;

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

function isRequestId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
