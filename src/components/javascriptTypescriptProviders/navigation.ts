import type * as Monaco from "monaco-editor";
import type {
  JavaScriptTypeScriptLanguageServerFeaturesGateway,
  LanguageServerLocation,
} from "../../domain/languageServerFeatures";
import type { LatencyOperationKind } from "../../domain/latencyTracker";
import type {
  JavaScriptTypeScriptNavigationFeature,
  JavaScriptTypeScriptPreparedNavigationTarget,
} from "../javascriptTypescriptMonacoProviderRegistration";
import { recordPerfProviderSample } from "../perfScenarioBridge";
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
  recordLatency?(feature: LatencyOperationKind, durationMs: number, rootPath: string): void;
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
  includeDeclaration = true,
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
    const locationsRequest = (() => {
      switch (feature) {
        case "declaration":
          return context.featuresGateway.declaration(
            request.rootPath,
            request.position,
            request.sessionId,
          );
        case "definition":
          return context.featuresGateway.definition(
            request.rootPath,
            request.position,
            request.sessionId,
          );
        case "implementation":
          return context.featuresGateway.implementation(
            request.rootPath,
            request.position,
            request.sessionId,
          );
        case "references":
          return context.featuresGateway.references(
            request.rootPath,
            request.position,
            includeDeclaration,
            request.sessionId,
          );
        case "typeDefinition":
          return context.featuresGateway.typeDefinition(
            request.rootPath,
            request.position,
            request.sessionId,
          );
      }
    })();
    const locations = await runBoundedJavaScriptTypeScriptProviderRequest(
      locationsRequest,
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
    const prepared = await prepareTargets(context, boundary, request, locations, feature, token);
    if (!prepared) {
      return null;
    }
    const converted = preparedJavaScriptTypeScriptNavigationTargetsToMonacoLocations(
      monaco,
      prepared,
      request.rootPath,
      preserveTargetRange,
    );
    if (feature === "definition" || feature === "references") {
      const durationMs = performance.now() - startedAt;
      context.recordLatency?.(feature, durationMs, request.rootPath);
      recordPerfProviderSample(
        feature,
        {
          ms: durationMs,
          resultCount: navigationResultCount(converted),
        },
        token,
      );
    }
    return converted;
  } catch (error) {
    if (!token?.isCancellationRequested) {
      boundary.reportActiveRequestError(context, request, error);
    }
    return null;
  }
}

function navigationResultCount(converted: Monaco.languages.Definition | null): number {
  if (!converted) {
    return 0;
  }

  if (Array.isArray(converted)) {
    return converted.length;
  }

  return 1;
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
  includeDeclaration: boolean,
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
    includeDeclaration,
  )) as Monaco.languages.Location[] | null;
