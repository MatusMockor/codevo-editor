import type * as Monaco from "monaco-editor";
import type {
  IdentifiedLanguageServerRequest,
  LanguageServerLocation,
} from "../domain/languageServerFeatures";
import {
  FEATURE_REQUEST_CANCELLED,
  FEATURE_REQUEST_TIMED_OUT,
  runBoundedLanguageServerRequest,
} from "./languageServerRequestCancellation";
import {
  prepareJavaScriptTypeScriptNavigationModels,
  type JavaScriptTypeScriptNavigationFeature,
  type JavaScriptTypeScriptPreparedNavigationTarget,
  type JavaScriptTypeScriptTransientNavigationModels,
} from "./javascriptTypescriptMonacoProviderRegistration";

type CancelRequest = (rootPath: string, sessionId: number, requestId: number) => Promise<void>;

export function runBoundedJavaScriptTypeScriptProviderRequest<T>(
  request: IdentifiedLanguageServerRequest<T>,
  expectedSessionId: number,
  token: Monaco.CancellationToken | undefined,
  rootPath: string,
  timeoutMs: number | undefined,
  cancelRequest?: CancelRequest,
): Promise<T | typeof FEATURE_REQUEST_CANCELLED | typeof FEATURE_REQUEST_TIMED_OUT> {
  if (request.sessionId !== expectedSessionId) {
    void request.catch(() => undefined);
    return Promise.resolve(FEATURE_REQUEST_TIMED_OUT);
  }
  return runBoundedLanguageServerRequest(request, token, rootPath, timeoutMs, cancelRequest);
}

export function javaScriptTypeScriptProviderRequestDidNotComplete(
  result: unknown,
): result is typeof FEATURE_REQUEST_CANCELLED | typeof FEATURE_REQUEST_TIMED_OUT {
  return result === FEATURE_REQUEST_CANCELLED || result === FEATURE_REQUEST_TIMED_OUT;
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
