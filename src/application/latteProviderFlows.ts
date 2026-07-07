import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  detectLatteIncludeCompletionAt,
  detectLatteReferenceAt,
  detectLatteTagCompletionAt,
} from "../domain/latteNavigation";
import {
  detectNetteCreateComponentAt,
} from "../domain/netteComponents";
import {
  latteControlCompletionAt,
  latteControlCompletions,
  latteFormNameCompletionAt,
  netteControlReferenceAt,
  resolveNetteControlDefinition,
  resolveNetteCreateComponentReverse,
  type NetteControlCache,
} from "./netteControlComponents";
import {
  lattePresenterLinkCompletions,
  resolveNetteLinkDefinition,
  resolveNettePresenterLink,
  type NettePresenterCache,
  type NettePresenterInFlight,
} from "./nettePresenterLinks";
import {
  isLatteScanSkippedDirectory,
  latteTemplateCompletions,
  resolveLatteTemplateDefinition,
  type LatteTemplateCache,
} from "./netteTemplates";
import {
  latteTagCompletions as buildLatteTagCompletions,
  type LatteCompletionItem,
} from "./latteCompletionItems";
import { isLatteMemberReferenceAt } from "./latteExpressionDetection";
import { netteLatteFrameworkCapabilities } from "./latteFrameworkCapabilities";
import {
  resolveLatteBlockDefinition,
} from "./latteBlockDefinitions";
import {
  latteExpressionCompletions,
  resolveLatteMemberDefinition,
  resolveNettePresenterVariableDefinition,
  type LatteViewDataCache,
  type LatteViewDataInFlight,
} from "./latteExpressionIntelligence";
import type {
  LatteTemplateTypeCache,
  LatteTemplateTypeInFlight,
} from "./netteTemplateTypes";
import {
  activeLatteWorkspaceContext,
  currentTemplatePath,
  evictOtherRootCacheEntries,
  isLattePresenterLinkIntelligenceActive,
  offsetAtEditorPosition,
} from "./latteIntelligenceRuntime";
import type {
  LatteFrameworkCapabilities,
  LatteIntelligence,
  LatteIntelligenceDependencies,
} from "./latteIntelligenceContracts";

const LATTE_TEMPLATE_SCAN_DIRECTORIES: readonly string[] = ["app", "templates"];
const LATTE_TEMPLATE_CACHE_TTL_MS = 5_000;
const LATTE_MAX_COMPLETIONS = 100;
const LATTE_PRESENTER_CACHE_TTL_MS = 5_000;
const LATTE_COMPONENT_CACHE_TTL_MS = 5_000;
const MAX_LATTE_SCAN_DEPTH = 12;
const MAX_LATTE_TEMPLATE_FILES = 2_000;

export interface LatteProviderFlowCaches {
  componentCache: NetteControlCache;
  presenterCache: NettePresenterCache;
  templateCache: LatteTemplateCache;
  templateTypeCache: LatteTemplateTypeCache;
  viewDataCache: LatteViewDataCache;
}

export interface LatteProviderFlowInFlight {
  presenterInFlight: NettePresenterInFlight;
  templateTypeInFlight: LatteTemplateTypeInFlight;
  viewDataInFlight: LatteViewDataInFlight;
}

export interface LatteProviderFlowFactoryOptions {
  caches: LatteProviderFlowCaches;
  frameworkCapabilities: LatteFrameworkCapabilities;
  getDependencies(): LatteIntelligenceDependencies;
  inFlight: LatteProviderFlowInFlight;
}

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
  const provideLatteDefinition = async (
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
    const currentTemplateRelativePath = currentTemplatePath(deps, requestedRoot);

    if (isLattePresenterLinkIntelligenceActive(deps, options.frameworkCapabilities)) {
      const linkHandled = await resolveNetteLinkDefinition(
        {
          currentRelativePath: currentTemplateRelativePath,
          deps,
          frameworkCapabilities: options.frameworkCapabilities,
          isDirectorySkipped: isLatteScanSkippedDirectory,
          isRequestedRootActive,
          maxDepth: MAX_LATTE_SCAN_DEPTH,
          maxPresenters: MAX_LATTE_TEMPLATE_FILES,
          requestedRoot,
        },
        options.frameworkCapabilities.detectLattePresenterLinkAt(source, offset),
      );

      if (linkHandled) {
        return true;
      }
    }

    const controlHandled = await resolveNetteControlDefinition(
      deps,
      requestedRoot,
      isRequestedRootActive,
      netteControlReferenceAt(source, offset),
      currentTemplateRelativePath,
    );

    if (controlHandled) {
      return true;
    }

    const variableHandled = await resolveNettePresenterVariableDefinition(
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

    if (variableHandled) {
      return true;
    }

    const memberHandled = await resolveLatteMemberDefinition(
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

    if (memberHandled) {
      return true;
    }

    const reference = detectLatteReferenceAt(source, offset);

    if (reference?.kind === "control") {
      return resolveNetteControlDefinition(
        deps,
        requestedRoot,
        isRequestedRootActive,
        { name: reference.name },
        currentTemplateRelativePath,
      );
    }

    if (reference?.kind === "block") {
      return resolveLatteBlockDefinition(
        deps,
        source,
        reference,
        currentTemplateRelativePath,
      );
    }

    if (reference && reference.kind !== "template") {
      return false;
    }

    return resolveLatteTemplateDefinition(
      {
        currentTemplateRelativePath,
        deps,
        isRequestedRootActive,
        requestedRoot,
      },
      reference,
      source,
      offset,
    );
  };

  const provideLatteCompletions = async (
    source: string,
    position: EditorPosition,
  ): Promise<LatteCompletionItem[]> => {
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
  };

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
    provideLatteCompletions,
    provideLatteDefinition,
    provideNettePhpLinkCompletions,
    provideNettePhpLinkDefinition,
  };
}

function evictLatteProviderCaches(
  caches: LatteProviderFlowCaches,
  requestedRoot: string | null,
): void {
  evictOtherRootCacheEntries(caches.templateCache, requestedRoot);
  evictOtherRootCacheEntries(caches.viewDataCache, requestedRoot);
  evictOtherRootCacheEntries(caches.presenterCache, requestedRoot);
  evictOtherRootCacheEntries(caches.componentCache, requestedRoot);
  evictOtherRootCacheEntries(caches.templateTypeCache, requestedRoot);
}
