import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  detectLatteIncludeCompletionAt,
  detectLatteTagCompletionAt,
} from "../domain/latteNavigation";
import {
  latteTagCompletions as buildLatteTagCompletions,
  type LatteCompletionItem,
} from "./latteCompletionItems";
import {
  latteExpressionCompletions,
} from "./latteExpressionIntelligence";
import {
  activeLatteWorkspaceContext,
  currentTemplatePath,
  isLattePresenterLinkIntelligenceActive,
  offsetAtEditorPosition,
} from "./latteIntelligenceRuntime";
import {
  latteControlCompletionAt,
  latteControlCompletions,
  latteFormNameCompletionAt,
} from "./netteControlComponents";
import {
  lattePresenterLinkCompletions,
} from "./nettePresenterLinks";
import {
  isLatteScanSkippedDirectory,
  latteTemplateCompletions,
} from "./netteTemplates";
import {
  evictLatteProviderCaches,
  LATTE_COMPONENT_CACHE_TTL_MS,
  LATTE_MAX_COMPLETIONS,
  LATTE_PRESENTER_CACHE_TTL_MS,
  LATTE_TEMPLATE_CACHE_TTL_MS,
  LATTE_TEMPLATE_SCAN_DIRECTORIES,
  MAX_LATTE_SCAN_DEPTH,
  MAX_LATTE_TEMPLATE_FILES,
  type LatteProviderFlowFactoryOptions,
} from "./latteProviderFlowContext";

export async function provideLatteCompletions(
  options: LatteProviderFlowFactoryOptions,
  source: string,
  position: EditorPosition,
): Promise<LatteCompletionItem[]> {
  const deps = options.getDependencies();
  evictLatteProviderCaches(options.caches, deps.workspaceRoot);

  const workspaceContext = activeLatteWorkspaceContext(
    deps,
    options.frameworkCapabilities,
  );

  if (!workspaceContext) {
    return [];
  }

  const { isRequestedRootActive, requestedRoot } = workspaceContext;
  const offset = offsetAtEditorPosition(source, position);
  const includeCompletion = detectLatteIncludeCompletionAt(source, offset);

  if (includeCompletion) {
    return latteTemplateCompletions(
      {
        cache: options.caches.templateCache,
        currentTemplateRelativePath: currentTemplatePath(deps, requestedRoot),
        deps,
        isRequestedRootActive,
        maxCompletions: LATTE_MAX_COMPLETIONS,
        maxDepth: MAX_LATTE_SCAN_DEPTH,
        maxTemplates: MAX_LATTE_TEMPLATE_FILES,
        requestedRoot,
        scanDirectories: LATTE_TEMPLATE_SCAN_DIRECTORIES,
        ttlMs: LATTE_TEMPLATE_CACHE_TTL_MS,
      },
      includeCompletion,
    );
  }

  const tagCompletion = detectLatteTagCompletionAt(source, offset);

  if (tagCompletion) {
    return buildLatteTagCompletions(
      tagCompletion.prefix,
      tagCompletion.start,
      offset,
      LATTE_MAX_COMPLETIONS,
    );
  }

  if (isLattePresenterLinkIntelligenceActive(deps, options.frameworkCapabilities)) {
    const linkCompletion =
      options.frameworkCapabilities.presenterLinkCompletionContextAt(
        source,
        offset,
        "latte",
      );

    if (linkCompletion) {
      return lattePresenterLinkCompletions(
        {
          cache: options.caches.presenterCache,
          currentRelativePath: currentTemplatePath(deps, requestedRoot),
          deps,
          frameworkCapabilities: options.frameworkCapabilities,
          inFlight: options.inFlight.presenterInFlight,
          isDirectorySkipped: isLatteScanSkippedDirectory,
          isRequestedRootActive,
          maxDepth: MAX_LATTE_SCAN_DEPTH,
          maxPresenters: MAX_LATTE_TEMPLATE_FILES,
          requestedRoot,
          ttlMs: LATTE_PRESENTER_CACHE_TTL_MS,
        },
        linkCompletion,
      );
    }
  }

  const controlCompletion = latteControlCompletionAt(source, offset);

  if (controlCompletion) {
    return latteControlCompletions(
      {
        componentCache: options.caches.componentCache,
        deps,
        isRequestedRootActive,
        maxCompletions: LATTE_MAX_COMPLETIONS,
        requestedRoot,
        templateRelativePath: currentTemplatePath(deps, requestedRoot),
        ttlMs: LATTE_COMPONENT_CACHE_TTL_MS,
      },
      controlCompletion,
    );
  }

  const formNameCompletion = latteFormNameCompletionAt(source, offset);

  if (formNameCompletion) {
    return latteControlCompletions(
      {
        componentCache: options.caches.componentCache,
        deps,
        isRequestedRootActive,
        maxCompletions: LATTE_MAX_COMPLETIONS,
        requestedRoot,
        templateRelativePath: currentTemplatePath(deps, requestedRoot),
        ttlMs: LATTE_COMPONENT_CACHE_TTL_MS,
      },
      formNameCompletion,
    );
  }

  return latteExpressionCompletions(
    {
      deps,
      frameworkCapabilities: options.frameworkCapabilities,
      isRequestedRootActive,
      maxCompletions: LATTE_MAX_COMPLETIONS,
      requestedRoot,
      templateTypeCache: options.caches.templateTypeCache,
      templateTypeInFlight: options.inFlight.templateTypeInFlight,
      viewDataCache: options.caches.viewDataCache,
      viewDataInFlight: options.inFlight.viewDataInFlight,
    },
    source,
    offset,
  );
}
