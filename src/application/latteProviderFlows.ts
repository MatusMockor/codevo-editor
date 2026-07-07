import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  detectNetteCreateComponentAt,
} from "../domain/netteComponents";
import {
  resolveNetteCreateComponentReverse,
  type NetteControlCache,
} from "./netteControlComponents";
import {
  lattePresenterLinkCompletions,
  resolveNettePresenterLink,
  type NettePresenterCache,
} from "./nettePresenterLinks";
import {
  isLatteScanSkippedDirectory,
  type LatteTemplateCache,
} from "./netteTemplates";
import {
  type LatteCompletionItem,
} from "./latteCompletionItems";
import { isLatteMemberReferenceAt } from "./latteExpressionDetection";
import { netteLatteFrameworkCapabilities } from "./latteFrameworkCapabilities";
import { type LatteViewDataCache } from "./latteExpressionIntelligence";
import type { LatteTemplateTypeCache } from "./netteTemplateTypes";
import {
  activeLatteWorkspaceContext,
  currentTemplatePath,
  isLattePresenterLinkIntelligenceActive,
} from "./latteIntelligenceRuntime";
import type {
  LatteFrameworkCapabilities,
  LatteIntelligence,
} from "./latteIntelligenceContracts";
import type { LatteIntelligenceDependencies } from "./latteIntelligenceContracts";
import {
  evictLatteProviderCaches,
  LATTE_PRESENTER_CACHE_TTL_MS,
  MAX_LATTE_SCAN_DEPTH,
  MAX_LATTE_TEMPLATE_FILES,
  type LatteProviderFlowFactoryOptions,
} from "./latteProviderFlowContext";
import {
  provideLatteDefinition as provideLatteDefinitionFlow,
} from "./latteDefinitionProvider";
import {
  provideLatteCompletions as provideLatteCompletionsFlow,
} from "./latteCompletionProvider";

export interface LatteProviderFlows {
  provideLatteCompletions(
    source: string,
    position: EditorPosition,
  ): Promise<LatteCompletionItem[]>;
  provideLatteDefinition(source: string, offset: number): Promise<boolean>;
  provideNettePhpLinkCompletions(
    source: string,
    offset: number,
  ): Promise<LatteCompletionItem[] | null>;
  provideNettePhpLinkDefinition(
    source: string,
    offset: number,
  ): Promise<boolean>;
}

export function createLatteIntelligence(
  getDependencies: () => LatteIntelligenceDependencies,
  templateCache: LatteTemplateCache = {},
  viewDataCache: LatteViewDataCache = {},
  presenterCache: NettePresenterCache = {},
  componentCache: NetteControlCache = {},
  templateTypeCache: LatteTemplateTypeCache = {},
  frameworkCapabilities: LatteFrameworkCapabilities = netteLatteFrameworkCapabilities,
): LatteIntelligence {
  const flows = createLatteProviderFlows({
    caches: {
      componentCache,
      presenterCache,
      templateCache,
      templateTypeCache,
      viewDataCache,
    },
    frameworkCapabilities,
    getDependencies,
    inFlight: {
      presenterInFlight: new Map(),
      templateTypeInFlight: new Map(),
      viewDataInFlight: new Map(),
    },
  });

  return {
    ...flows,
    shouldBlockLatteDefinitionFallback: isLatteMemberReferenceAt,
  };
}

export function createLatteProviderFlows(
  options: LatteProviderFlowFactoryOptions,
): LatteProviderFlows {
  const provideNettePhpLinkDefinition = async (
    source: string,
    offset: number,
  ): Promise<boolean> => {
    const deps = options.getDependencies();
    evictLatteProviderCaches(options.caches, deps.workspaceRoot);

    const workspaceContext = activeLatteWorkspaceContext(
      deps,
      options.frameworkCapabilities,
    );

    if (!workspaceContext) {
      return false;
    }

    const { isRequestedRootActive, requestedRoot } = workspaceContext;
    const detection = options.frameworkCapabilities.detectPhpPresenterLinkAt(
      source,
      offset,
    );

    if (detection) {
      if (!isLattePresenterLinkIntelligenceActive(deps, options.frameworkCapabilities)) {
        return false;
      }

      return resolveNettePresenterLink(
        {
          currentRelativePath: currentTemplatePath(deps, requestedRoot),
          deps,
          frameworkCapabilities: options.frameworkCapabilities,
          isDirectorySkipped: isLatteScanSkippedDirectory,
          isRequestedRootActive,
          maxDepth: MAX_LATTE_SCAN_DEPTH,
          maxPresenters: MAX_LATTE_TEMPLATE_FILES,
          requestedRoot,
        },
        options.frameworkCapabilities.parsePresenterLinkTarget(detection.target),
        detection.target,
      );
    }

    return resolveNetteCreateComponentReverse(
      deps,
      requestedRoot,
      isRequestedRootActive,
      detectNetteCreateComponentAt(source, offset),
      source,
      currentTemplatePath(deps, requestedRoot),
    );
  };

  const provideNettePhpLinkCompletions = async (
    source: string,
    offset: number,
  ): Promise<LatteCompletionItem[] | null> => {
    const deps = options.getDependencies();
    evictLatteProviderCaches(options.caches, deps.workspaceRoot);

    const workspaceContext = activeLatteWorkspaceContext(
      deps,
      options.frameworkCapabilities,
    );

    if (!workspaceContext) {
      return null;
    }

    if (!isLattePresenterLinkIntelligenceActive(deps, options.frameworkCapabilities)) {
      return null;
    }

    const linkCompletion =
      options.frameworkCapabilities.presenterLinkCompletionContextAt(
        source,
        offset,
        "php",
      );

    if (!linkCompletion) {
      return null;
    }

    const { isRequestedRootActive, requestedRoot } = workspaceContext;

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
  };

  return {
    provideLatteCompletions: (source, position) =>
      provideLatteCompletionsFlow(options, source, position),
    provideLatteDefinition: (source, offset) =>
      provideLatteDefinitionFlow(options, source, offset),
    provideNettePhpLinkCompletions,
    provideNettePhpLinkDefinition,
  };
}
