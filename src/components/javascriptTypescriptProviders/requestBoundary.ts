import type * as Monaco from "monaco-editor";
import type {
  IdentifiedLanguageServerRequest,
  LanguageServerLocation,
  LanguageServerTextDocumentPosition,
} from "../../domain/languageServerFeatures";
import type {
  JavaScriptTypeScriptDocumentRequestAuthority,
  StoredJavaScriptTypeScriptDocumentAuthority,
} from "../javascriptTypescriptProviderDocumentAuthority";
import type {
  JavaScriptTypeScriptNavigationFeature,
  JavaScriptTypeScriptPreparedNavigationTarget,
  JavaScriptTypeScriptTransientNavigationModels,
} from "../javascriptTypescriptMonacoProviderRegistration";
import { prepareJavaScriptTypeScriptNavigationModels } from "../javascriptTypescriptMonacoProviderRegistration";

export type JavaScriptTypeScriptProviderRequestCancellationPort = (
  rootPath: string,
  sessionId: number,
  requestId: number,
) => Promise<void>;

const ignoreProviderRequestCancellation: JavaScriptTypeScriptProviderRequestCancellationPort =
  async () => undefined;
const providerRequestCancelled = Symbol("javaScriptTypeScriptProviderRequestCancelled");
const providerRequestTimedOut = Symbol("javaScriptTypeScriptProviderRequestTimedOut");
const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 2_500;

export type JavaScriptTypeScriptInteractiveFeature =
  | "completion"
  | "declaration"
  | "definition"
  | "hover"
  | "implementation"
  | "prepareRename"
  | "references"
  | "rename"
  | "signatureHelp"
  | "typeDefinition";

export interface JavaScriptTypeScriptFeatureRequest extends JavaScriptTypeScriptDocumentRequestAuthority {
  readonly position: LanguageServerTextDocumentPosition;
  readonly sessionId: number;
}

export interface JavaScriptTypeScriptStoredProviderPayload extends StoredJavaScriptTypeScriptDocumentAuthority {
  __languageServerSessionId?: number;
  __sourcePath?: string;
  __workspaceRoot?: string;
}

export interface JavaScriptTypeScriptProviderRequestBoundary<Context> {
  attachStoredAuthority<T extends object>(
    payload: T,
    authority:
      JavaScriptTypeScriptDocumentRequestAuthority | StoredJavaScriptTypeScriptDocumentAuthority,
  ): T;
  createFeatureRequest(
    context: Context,
    model: Monaco.editor.ITextModel,
    position: Monaco.Position,
    feature: JavaScriptTypeScriptInteractiveFeature,
  ): JavaScriptTypeScriptFeatureRequest | null;
  flushActiveRequest(
    context: Context,
    request: JavaScriptTypeScriptFeatureRequest,
  ): Promise<boolean>;
  flushStoredPayload(
    context: Context,
    payload: JavaScriptTypeScriptStoredProviderPayload,
  ): Promise<boolean>;
  isActiveRequest(context: Context, request: JavaScriptTypeScriptFeatureRequest): boolean;
  isStoredPayloadActive(
    context: Context,
    payload: JavaScriptTypeScriptStoredProviderPayload,
  ): boolean;
  isStoredSessionActive(context: Context, rootPath: string, sessionId: number): boolean;
  reportActiveRequestError(
    context: Context,
    request: JavaScriptTypeScriptFeatureRequest,
    error: unknown,
  ): void;
  reportStoredPayloadError(
    context: Context,
    payload: JavaScriptTypeScriptStoredProviderPayload,
    error: unknown,
  ): void;
}

export function runBoundedJavaScriptTypeScriptProviderRequest<T>(
  request: IdentifiedLanguageServerRequest<T>,
  expectedSessionId: number,
  token: Monaco.CancellationToken | undefined,
  rootPath: string,
  timeoutMs: number | undefined,
  cancelRequest?: JavaScriptTypeScriptProviderRequestCancellationPort,
): Promise<T | typeof providerRequestCancelled | typeof providerRequestTimedOut> {
  if (request.sessionId !== expectedSessionId) {
    void request.catch(() => undefined);
    if (
      cancelRequest &&
      Number.isSafeInteger(request.sessionId) &&
      request.sessionId > 0 &&
      Number.isSafeInteger(request.requestId) &&
      request.requestId > 0
    ) {
      void cancelRequest(rootPath, request.sessionId, request.requestId).catch(() => undefined);
    }
    return Promise.resolve(providerRequestTimedOut);
  }

  const cancellationPort = cancelRequest ?? ignoreProviderRequestCancellation;
  let pending = true;
  let cancelIssued = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let subscription: Monaco.IDisposable | undefined;
  let settleCancellation: (() => void) | undefined;
  const cancellation = new Promise<typeof providerRequestCancelled>((resolve) => {
    settleCancellation = () => resolve(providerRequestCancelled);
  });
  const cancelOnce = (settleRequest = true) => {
    if (!pending || cancelIssued) {
      return;
    }
    cancelIssued = true;
    void cancellationPort(rootPath, request.sessionId, request.requestId).catch(() => undefined);
    if (settleRequest) {
      settleCancellation?.();
    }
  };
  const timeout = new Promise<typeof providerRequestTimedOut>((resolve) => {
    timeoutHandle = setTimeout(() => {
      cancelOnce(false);
      resolve(providerRequestTimedOut);
    }, timeoutMs ?? DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS);
  });
  if (token?.onCancellationRequested) {
    subscription = token.onCancellationRequested(() => cancelOnce());
  }
  if (token?.isCancellationRequested) {
    cancelOnce();
  }
  return Promise.race([request, timeout, cancellation]).finally(() => {
    pending = false;
    clearTimeout(timeoutHandle);
    subscription?.dispose();
  });
}

export function javaScriptTypeScriptProviderRequestDidNotComplete(
  result: unknown,
): result is typeof providerRequestCancelled | typeof providerRequestTimedOut {
  return result === providerRequestCancelled || result === providerRequestTimedOut;
}

export async function prepareJavaScriptTypeScriptProviderNavigationModels({
  feature,
  isActive,
  locations,
  prepare,
  token,
}: {
  feature: JavaScriptTypeScriptNavigationFeature;
  isActive(): boolean;
  locations: readonly LanguageServerLocation[];
  prepare: JavaScriptTypeScriptTransientNavigationModels["prepare"] | undefined;
  token: Monaco.CancellationToken | undefined;
}): Promise<readonly JavaScriptTypeScriptPreparedNavigationTarget[] | null> {
  const isCurrent = () => token?.isCancellationRequested !== true && isActive();
  return prepareJavaScriptTypeScriptNavigationModels(prepare, locations, isCurrent, feature);
}
