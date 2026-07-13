import type { EditorPosition } from "../domain/languageServerFeatures";
import { type NetteControlCache } from "./netteControlContracts";
import { type NettePresenterCache } from "./nettePresenterLinkDiscovery";
import {
  type LatteTemplateCache,
  type NetteTemplateCacheEntry,
} from "./netteTemplateDiscovery";
import {
  type LatteCompletionItem,
} from "./latteCompletionItems";
import { isLatteMemberReferenceAt } from "./latteExpressionDetection";
import { netteLatteFrameworkCapabilities } from "./latteFrameworkCapabilities";
import { type LatteViewDataCache } from "./latteExpressionIntelligence";
import type { LatteTemplateTypeCache } from "./netteTemplateTypes";
import type {
  LatteFrameworkCapabilities,
  LatteIntelligence,
} from "./latteIntelligenceContracts";
import type { LatteIntelligenceDependencies } from "./latteIntelligenceContracts";
import type { NavigationRequest } from "./navigationRequest";
import { type LatteProviderFlowFactoryOptions } from "./latteProviderFlowContext";
import {
  provideLatteDefinition as provideLatteDefinitionFlow,
} from "./latteDefinitionProvider";
import {
  provideLatteCompletions as provideLatteCompletionsFlow,
} from "./latteCompletionProvider";
import {
  provideLatteCodeActions as provideLatteCodeActionsFlow,
} from "./latteTemplateCodeActions";
import {
  listLatteTemplateRelativePaths,
} from "./netteTemplateDiscovery";
import {
  createLattePhpPresenterLinkFlow,
} from "./lattePhpPresenterLinkFlow";
import {
  LATTE_TEMPLATE_CACHE_TTL_MS,
  LATTE_TEMPLATE_SCAN_DIRECTORIES,
  MAX_LATTE_SCAN_DEPTH,
  MAX_LATTE_TEMPLATE_FILES,
} from "./latteProviderFlowContext";
import { latteProviderRequestContext } from "./latteProviderRequestContext";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";

export interface LatteProviderFlows {
  collectCompleteLatteTemplateRelativePaths(): Promise<readonly string[]>;
  collectLatteTemplateRelativePaths(): Promise<readonly string[]>;
  provideLatteCodeActions(
    source: string,
    range: PhpCodeActionRange,
  ): Promise<PhpCodeActionDescriptor[]>;
  provideLatteCompletions(
    source: string,
    position: EditorPosition,
  ): Promise<LatteCompletionItem[]>;
  provideLatteDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
  providePhpPresenterLinkCompletions(
    source: string,
    offset: number,
  ): Promise<LatteCompletionItem[] | null>;
  isPhpPresenterLinkCompletionContext(source: string, offset: number): boolean;
  providePhpPresenterLinkDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
  /**
   * @deprecated Use {@link providePhpPresenterLinkCompletions}.
   */
  provideNettePhpLinkCompletions(
    source: string,
    offset: number,
  ): Promise<LatteCompletionItem[] | null>;
  /**
   * @deprecated Use {@link providePhpPresenterLinkDefinition}.
   */
  provideNettePhpLinkDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
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
  const phpPresenterLinks = createLattePhpPresenterLinkFlow(options);

  return {
    collectCompleteLatteTemplateRelativePaths: async () => {
      const entry = await collectLatteTemplateEntry(options);

      return entry?.complete ? entry.relativePaths : [];
    },
    collectLatteTemplateRelativePaths: () =>
      collectLatteTemplateRelativePaths(options),
    provideLatteCodeActions: (source, range) =>
      provideLatteCodeActionsFlow(options, source, range),
    provideLatteCompletions: (source, position) =>
      provideLatteCompletionsFlow(options, source, position),
    provideLatteDefinition: (source, offset, request) =>
      provideLatteDefinitionFlow(options, source, offset, request),
    ...phpPresenterLinks,
  };
}

async function collectLatteTemplateRelativePaths(
  options: LatteProviderFlowFactoryOptions,
): Promise<readonly string[]> {
  const entry = await collectLatteTemplateEntry(options);

  return entry?.relativePaths ?? [];
}

async function collectLatteTemplateEntry(
  options: LatteProviderFlowFactoryOptions,
): Promise<NetteTemplateCacheEntry | null> {
  const request = latteProviderRequestContext(options);

  if (!request) {
    return null;
  }

  await listLatteTemplateRelativePaths({
    cache: options.caches.templateCache,
    deps: request.deps,
    isRequestedRootActive: request.isRequestedRootActive,
    maxDepth: MAX_LATTE_SCAN_DEPTH,
    maxTemplates: MAX_LATTE_TEMPLATE_FILES,
    requestedRoot: request.requestedRoot,
    scanDirectories: LATTE_TEMPLATE_SCAN_DIRECTORIES,
    ttlMs: LATTE_TEMPLATE_CACHE_TTL_MS,
  });

  return options.caches.templateCache[request.requestedRoot] ?? null;
}
