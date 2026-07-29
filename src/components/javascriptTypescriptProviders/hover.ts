import type * as Monaco from "monaco-editor";
import type { JavaScriptTypeScriptLanguageServerFeaturesGateway } from "../../domain/languageServerFeatures";
import { HOVER_FEATURE_REQUEST_TIMEOUT_MS } from "../languageServerRequestCancellation";
import {
  javaScriptTypeScriptProviderRequestDidNotComplete,
  runBoundedJavaScriptTypeScriptProviderRequest,
} from "../javascriptTypescriptProviderRequestBoundary";
import type { JavaScriptTypeScriptProviderRequestBoundary } from "./requestBoundary";

interface HoverProviderContext {
  cancelRequest?(rootPath: string, sessionId: number, requestId: number): Promise<void>;
  featuresGateway: Pick<JavaScriptTypeScriptLanguageServerFeaturesGateway, "hover">;
}

export async function provideJavaScriptTypeScriptHover<Context extends HoverProviderContext>(
  context: Context,
  boundary: JavaScriptTypeScriptProviderRequestBoundary<Context>,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.Hover | null> {
  const request = boundary.createFeatureRequest(context, model, position, "hover");
  if (!request) {
    return null;
  }

  try {
    if (!(await boundary.flushActiveRequest(context, request))) {
      return null;
    }
    const hover = await runBoundedJavaScriptTypeScriptProviderRequest(
      context.featuresGateway.hover(request.rootPath, request.position, request.sessionId),
      request.sessionId,
      token,
      request.rootPath,
      HOVER_FEATURE_REQUEST_TIMEOUT_MS,
      context.cancelRequest,
    );
    if (
      javaScriptTypeScriptProviderRequestDidNotComplete(hover) ||
      token?.isCancellationRequested ||
      !boundary.isActiveRequest(context, request)
    ) {
      return null;
    }
    return hover ? { contents: [{ value: hover.contents }] } : null;
  } catch (error) {
    if (!token?.isCancellationRequested) {
      boundary.reportActiveRequestError(context, request, error);
    }
    return null;
  }
}
