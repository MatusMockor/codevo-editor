import type * as Monaco from "monaco-editor";
import type {
  JavaScriptTypeScriptLanguageServerFeaturesGateway,
  LanguageServerLocation,
} from "../../domain/languageServerFeatures";
import type {
  JavaScriptTypeScriptNavigationFeature,
  JavaScriptTypeScriptPreparedNavigationTarget,
} from "../javascriptTypescriptMonacoProviderRegistration";
import {
  javaScriptTypeScriptProviderRequestDidNotComplete,
  prepareJavaScriptTypeScriptProviderNavigationModels,
  runBoundedJavaScriptTypeScriptProviderRequest,
  type JavaScriptTypeScriptProviderRequestCancellationPort,
} from "./requestBoundary";
import { preparedJavaScriptTypeScriptNavigationTargetsToMonacoLocations } from "../javascriptTypescriptMonacoNavigationLocations";
import type {
  JavaScriptTypeScriptFeatureRequest,
  JavaScriptTypeScriptProviderRequestBoundary,
} from "./requestBoundary";

type NavigationFeature =
  "declaration" | "definition" | "implementation" | "references" | "typeDefinition";

interface NavigationContext {
  cancelRequest?: JavaScriptTypeScriptProviderRequestCancellationPort;
  featuresGateway: JavaScriptTypeScriptLanguageServerFeaturesGateway;
  prepareNavigationModels?(
    locations: readonly LanguageServerLocation[],
    isCurrent: () => boolean,
    feature: JavaScriptTypeScriptNavigationFeature,
  ): Promise<readonly JavaScriptTypeScriptPreparedNavigationTarget[]>;
  recordLatency?(feature: "completion" | "definition", durationMs: number, rootPath: string): void;
}

async function prepareTargets<Context extends NavigationContext>(
  context: Context,
  boundary: JavaScriptTypeScriptProviderRequestBoundary<Context>,
  request: JavaScriptTypeScriptFeatureRequest,
  locations: readonly LanguageServerLocation[],
  feature: JavaScriptTypeScriptNavigationFeature,
  token?: Monaco.CancellationToken,
): Promise<readonly JavaScriptTypeScriptPreparedNavigationTarget[] | null> {
  return prepareJavaScriptTypeScriptProviderNavigationModels({
    feature,
    isActive: () => boundary.isActiveRequest(context, request),
    locations,
    prepare: context.prepareNavigationModels,
    token,
  });
}

async function provideNavigation<Context extends NavigationContext>(
  monaco: typeof Monaco,
  context: Context,
  boundary: JavaScriptTypeScriptProviderRequestBoundary<Context>,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  feature: NavigationFeature,
  token?: Monaco.CancellationToken,
  preserveTargetRange = true,
): Promise<Monaco.languages.Definition | null> {
  const request = boundary.createFeatureRequest(context, model, position, feature);
  if (!request) {
    return null;
  }
  try {
    if (!(await boundary.flushActiveRequest(context, request))) {
      return null;
    }
    const startedAt = performance.now();
    const requestMethod = context.featuresGateway[feature].bind(context.featuresGateway);
    const locations = await runBoundedJavaScriptTypeScriptProviderRequest(
      requestMethod(request.rootPath, request.position, request.sessionId),
      request.sessionId,
      token,
      request.rootPath,
      undefined,
      context.cancelRequest,
    );
    if (
      javaScriptTypeScriptProviderRequestDidNotComplete(locations) ||
      token?.isCancellationRequested ||
      !boundary.isActiveRequest(context, request)
    ) {
      return null;
    }
    if (feature === "definition") {
      context.recordLatency?.("definition", performance.now() - startedAt, request.rootPath);
    }
    const prepared = await prepareTargets(context, boundary, request, locations, feature, token);
    return prepared
      ? preparedJavaScriptTypeScriptNavigationTargetsToMonacoLocations(
          monaco,
          prepared,
          request.rootPath,
          preserveTargetRange,
        )
      : null;
  } catch (error) {
    if (!token?.isCancellationRequested) {
      boundary.reportActiveRequestError(context, request, error);
    }
    return null;
  }
}

export const provideJavaScriptTypeScriptDefinition = <Context extends NavigationContext>(
  monaco: typeof Monaco,
  context: Context,
  boundary: JavaScriptTypeScriptProviderRequestBoundary<Context>,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  token?: Monaco.CancellationToken,
) => provideNavigation(monaco, context, boundary, model, position, "definition", token);

export const provideJavaScriptTypeScriptDeclaration = <Context extends NavigationContext>(
  monaco: typeof Monaco,
  context: Context,
  boundary: JavaScriptTypeScriptProviderRequestBoundary<Context>,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  token?: Monaco.CancellationToken,
) => provideNavigation(monaco, context, boundary, model, position, "declaration", token);

export const provideJavaScriptTypeScriptImplementation = <Context extends NavigationContext>(
  monaco: typeof Monaco,
  context: Context,
  boundary: JavaScriptTypeScriptProviderRequestBoundary<Context>,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  token?: Monaco.CancellationToken,
) => provideNavigation(monaco, context, boundary, model, position, "implementation", token);

export const provideJavaScriptTypeScriptTypeDefinition = <Context extends NavigationContext>(
  monaco: typeof Monaco,
  context: Context,
  boundary: JavaScriptTypeScriptProviderRequestBoundary<Context>,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  token?: Monaco.CancellationToken,
) => provideNavigation(monaco, context, boundary, model, position, "typeDefinition", token);

export const provideJavaScriptTypeScriptReferences = async <Context extends NavigationContext>(
  monaco: typeof Monaco,
  context: Context,
  boundary: JavaScriptTypeScriptProviderRequestBoundary<Context>,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.Location[] | null> =>
  (await provideNavigation(
    monaco,
    context,
    boundary,
    model,
    position,
    "references",
    token,
    false,
  )) as Monaco.languages.Location[] | null;
