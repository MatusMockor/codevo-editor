import type * as Monaco from "monaco-editor";
import type { LanguageServerMonacoProviderContext } from "./languageServerProviderContext";
import { projectLanguageServerHover } from "../languageServerHoverMonacoProjection";
import {
  FEATURE_REQUEST_CANCELLED,
  FEATURE_REQUEST_TIMED_OUT,
  HOVER_FEATURE_REQUEST_TIMEOUT_MS,
  featureRequestContext,
  flushPendingDocumentChangeForActiveRequest,
  isFeatureRequestActive,
  reportErrorForActiveRequest,
  runOptionalIdentifiedFeatureRequest,
} from "./providerRequestLifecycle";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;

export async function provideHover(
  _monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: Monaco.Position,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.Hover | null> {
  const request = featureRequestContext(context, model, position, "hover");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const hover = await runOptionalIdentifiedFeatureRequest(
      context.featuresGateway,
      request.rootPath,
      request.sessionId,
      token,
      HOVER_FEATURE_REQUEST_TIMEOUT_MS,
      () => context.featuresGateway.hover(request.rootPath, request.position),
      (port, sessionId) => port.hover(request.rootPath, request.position, sessionId),
    );

    if (
      hover === FEATURE_REQUEST_TIMED_OUT ||
      hover === FEATURE_REQUEST_CANCELLED ||
      token?.isCancellationRequested ||
      !isFeatureRequestActive(context, request) ||
      !hover
    ) {
      return null;
    }

    return projectLanguageServerHover(hover, model, position);
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}
