import type { EditorPosition } from "../domain/languageServerFeatures";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import { type NetteControlCache } from "./netteControlContracts";
import { type NettePresenterCache } from "./nettePresenterLinkDiscovery";
import {
  type LatteTemplateCache,
  type NetteTemplateCacheEntry,
} from "./netteTemplateDiscovery";
import {
  type LatteCompletionItem,
} from "./latteCompletionItems";
import { createLatteFrameworkCapabilities } from "./latteFrameworkCapabilities";
import {
  invalidateLatteInheritedViewDataForRoot,
  type LatteViewDataCache,
} from "./latteExpressionIntelligence";
import type { LatteFilterCache } from "./latteFilterDiscovery";
import type { LatteTemplateTypeCache } from "./netteTemplateTypes";
import type {
  NetteIncludedTemplateArgumentCache,
  NetteIncludedTemplateArgumentInFlight,
} from "./netteIncludedTemplateArguments";
import type { LatteIncludeArgumentGenerationByRoot } from "./latteIntelligenceCaches";
import type {
  LatteDefinitionOutcome,
  LatteFrameworkCapabilities,
  LatteIntelligence,
} from "./latteIntelligenceContracts";
import type { LatteIntelligenceDependencies } from "./latteIntelligenceContracts";
import type { NavigationRequest } from "./navigationRequest";
import { type LatteProviderFlowFactoryOptions } from "./latteProviderFlowContext";
import type {
  NeonConfigCache,
  NeonConfigInFlight,
} from "./neonProjectConfigDiscovery";
import { invalidateNeonConfigCacheForPath } from "./neonProjectConfigDiscovery";
import {
  provideLatteDefinition as provideLatteDefinitionFlow,
  provideLatteDefinitionOutcome as provideLatteDefinitionOutcomeFlow,
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
  nettePresenterLinkDiagnostics,
} from "./nettePresenterLinkDiagnostics";
import { nettePresenterLinkDefinitionContext } from "./netteLatteProviderOptions";
import {
  createNettePresenterMappingGeneration,
  invalidateNettePresenterMappingsForPath,
  type NettePresenterMappingCache,
  type NettePresenterMappingGeneration,
  type NettePresenterMappingInFlight,
} from "./nettePresenterMappingDiscovery";
import {
  bumpLatteExpressionGeneration,
  captureLatteExpressionGeneration,
  LATTE_TEMPLATE_CACHE_TTL_MS,
  LATTE_TEMPLATE_SCAN_DIRECTORIES,
  MAX_LATTE_SCAN_DEPTH,
  MAX_LATTE_TEMPLATE_FILES,
} from "./latteProviderFlowContext";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { latteProviderRequestContext } from "./latteProviderRequestContext";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionContext,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";
import {
  createNetteFactoryTemplateOwnerGeneration,
  invalidateNetteFactoryTemplateOwnersForPath,
  type NetteFactoryTemplateOwnerCache,
  type NetteFactoryTemplateOwnerGeneration,
  type NetteFactoryTemplateOwnerInFlight,
} from "./netteFactoryTemplateOwners";

export interface LatteProviderFlows {
  collectCompleteLatteTemplateRelativePaths(): Promise<readonly string[]>;
  collectLatteTemplateRelativePaths(): Promise<readonly string[]>;
  invalidateLatteExpressionDataForPath(rootPath: string, path: string): void;
  invalidateLatteFilterDataForPath(rootPath: string, path: string): void;
  invalidateNettePresenterMappingDataForPath(rootPath: string, path: string): void;
  provideLatteCodeActions(
    source: string,
    range: PhpCodeActionRange,
    context?: PhpCodeActionContext,
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
  provideLatteDefinitionOutcome(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<LatteDefinitionOutcome>;
  provideLattePresenterLinkDiagnostics(
    source: string,
    currentTemplateRelativePath: string,
  ): Promise<LanguageServerDiagnostic[]>;
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
  frameworkCapabilities: LatteFrameworkCapabilities = createLatteFrameworkCapabilities(
    () => getDependencies().frameworkIntelligence.providers,
  ),
  filterCache: LatteFilterCache = {},
  includeArgumentCache: NetteIncludedTemplateArgumentCache = {},
  includeArgumentInFlight: NetteIncludedTemplateArgumentInFlight = {
    graphs: new Map(),
    queries: new Map(),
  },
  includeArgumentGenerationByRoot: LatteIncludeArgumentGenerationByRoot = {},
  presenterMappingCache: NettePresenterMappingCache = {},
  presenterMappingInFlight: NettePresenterMappingInFlight = new Map(),
  presenterMappingGeneration: NettePresenterMappingGeneration =
    createNettePresenterMappingGeneration(),
  factoryTemplateOwnerCache: NetteFactoryTemplateOwnerCache = {},
  factoryTemplateOwnerInFlight: NetteFactoryTemplateOwnerInFlight = new Map(),
  factoryTemplateOwnerGeneration: NetteFactoryTemplateOwnerGeneration =
    createNetteFactoryTemplateOwnerGeneration(),
): LatteIntelligence {
  const neonConfigCache: NeonConfigCache = {};
  const neonConfigInFlight: NeonConfigInFlight = new Map();
  const flows = createLatteProviderFlows({
    caches: {
      componentCache,
      filterCache,
      factoryTemplateOwnerCache,
      factoryTemplateOwnerGeneration,
      includeArgumentCache,
      includeArgumentGenerationByRoot,
      presenterCache,
      presenterMappingCache,
      presenterMappingGeneration,
      templateCache,
      templateTypeCache,
      viewDataCache,
    },
    frameworkCapabilities,
    getDependencies,
    inFlight: {
      filterInFlight: new Map(),
      factoryTemplateOwnerInFlight,
      includeArgumentInFlight,
      presenterInFlight: new Map(),
      presenterMappingInFlight,
      templateTypeInFlight: new Map(),
      viewDataInFlight: new Map(),
    },
    neonConfigCache,
    neonConfigInFlight,
  });

  return {
    ...flows,
    invalidateNeonConfigForPath: (rootPath, path) => {
      invalidateNeonConfigCacheForPath(
        neonConfigCache,
        neonConfigInFlight,
        rootPath,
        path,
      );
      flows.invalidateLatteFilterDataForPath(rootPath, path);
      flows.invalidateNettePresenterMappingDataForPath(rootPath, path);
    },
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
    invalidateLatteExpressionDataForPath: (rootPath, path) =>
      invalidateLatteExpressionDataForPath(options, rootPath, path),
    invalidateLatteFilterDataForPath: (rootPath, path) =>
      invalidateLatteFilterDataForPath(options, rootPath, path),
    invalidateNettePresenterMappingDataForPath: (rootPath, path) =>
      invalidateNettePresenterMappingDataForPath(options, rootPath, path),
    provideLatteCodeActions: (source, range, context) =>
      provideLatteCodeActionsFlow(options, source, range, context),
    provideLatteCompletions: (source, position) =>
      provideLatteCompletionsFlow(options, source, position),
    provideLatteDefinition: (source, offset, request) =>
      provideLatteDefinitionFlow(options, source, offset, request),
    provideLatteDefinitionOutcome: (source, offset, request) =>
      provideLatteDefinitionOutcomeFlow(options, source, offset, request),
    provideLattePresenterLinkDiagnostics: (source, currentTemplateRelativePath) =>
      provideLattePresenterLinkDiagnostics(
        options,
        source,
        currentTemplateRelativePath,
      ),
    ...phpPresenterLinks,
  };
}

function invalidateLatteExpressionDataForPath(
  options: LatteProviderFlowFactoryOptions,
  rootPath: string,
  path: string,
): void {
  if (!path.endsWith(".latte") && !path.endsWith(".php")) {
    return;
  }

  const generation = bumpLatteExpressionGeneration(options.caches, rootPath);
  invalidateNetteFactoryTemplateOwnersForPath(
    options.caches.factoryTemplateOwnerCache,
    options.inFlight.factoryTemplateOwnerInFlight,
    options.caches.factoryTemplateOwnerGeneration,
    rootPath,
    path,
  );
  invalidateNettePresenterMappingDataForPath(options, rootPath, path);
  invalidateLatteFilterDataForPath(options, rootPath, path, true);
  deleteCacheEntriesForRoot(options.caches.includeArgumentCache, rootPath);
  deleteCacheEntriesForRoot(options.caches.viewDataCache, rootPath);
  deleteCacheEntriesForRoot(options.caches.templateTypeCache, rootPath);

  if (path.endsWith(".latte")) {
    deleteCacheEntriesForRoot(options.caches.templateCache, rootPath);
  }

  deleteInFlightForRoot(options.inFlight.viewDataInFlight, rootPath);
  deleteInFlightForRoot(options.inFlight.templateTypeInFlight, rootPath);
  deleteInFlightForRoot(
    options.inFlight.includeArgumentInFlight.graphs,
    generation.rootKey,
  );
  deleteInFlightForRoot(
    options.inFlight.includeArgumentInFlight.queries,
    generation.rootKey,
  );
  invalidateLatteInheritedViewDataForRoot(
    options.caches.viewDataCache,
    rootPath,
  );
}

function invalidateNettePresenterMappingDataForPath(
  options: LatteProviderFlowFactoryOptions,
  rootPath: string,
  path: string,
): void {
  invalidateNettePresenterMappingsForPath(
    options.caches.presenterMappingCache,
    options.inFlight.presenterMappingInFlight,
    options.caches.presenterMappingGeneration,
    rootPath,
    path,
  );
  deleteCacheEntriesForRoot(options.caches.presenterCache, rootPath);
  deleteInFlightForRoot(options.inFlight.presenterInFlight, rootPath);
}

function invalidateLatteFilterDataForPath(
  options: LatteProviderFlowFactoryOptions,
  rootPath: string,
  path: string,
  generationAlreadyBumped = false,
): void {
  if (!path.endsWith(".php") && !path.endsWith(".neon")) {
    return;
  }

  if (!generationAlreadyBumped) {
    bumpLatteExpressionGeneration(options.caches, rootPath);
  }

  deleteCacheEntriesForRoot(options.caches.filterCache, rootPath);
  deleteInFlightForRoot(options.inFlight.filterInFlight, rootPath);
}

function deleteInFlightForRoot(
  inFlight: Map<string, unknown>,
  rootPath: string,
): void {
  for (const key of inFlight.keys()) {
    const separator = key.indexOf("\0");
    const keyRoot = separator < 0 ? key : key.slice(0, separator);

    if (workspaceRootKeysEqual(keyRoot, rootPath)) {
      inFlight.delete(key);
    }
  }
}

function deleteCacheEntriesForRoot<Entry>(
  cache: Record<string, Entry>,
  rootPath: string,
): void {
  for (const cachedRoot of Object.keys(cache)) {
    if (workspaceRootKeysEqual(cachedRoot, rootPath)) {
      delete cache[cachedRoot];
    }
  }
}

async function provideLattePresenterLinkDiagnostics(
  options: LatteProviderFlowFactoryOptions,
  source: string,
  currentTemplateRelativePath: string,
): Promise<LanguageServerDiagnostic[]> {
  const request = latteProviderRequestContext(options);

  if (!request) {
    return [];
  }

  return nettePresenterLinkDiagnostics(
    nettePresenterLinkDefinitionContext(options, {
      ...request,
      currentTemplateRelativePath,
    }),
    source,
  );
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

  const generation = captureLatteExpressionGeneration(
    options.caches,
    request.requestedRoot,
  );

  await listLatteTemplateRelativePaths({
    cache: options.caches.templateCache,
    deps: request.deps,
    isRequestedRootActive: request.isRequestedRootActive,
    isCacheWriteCurrent: generation.isCurrent,
    maxDepth: MAX_LATTE_SCAN_DEPTH,
    maxTemplates: MAX_LATTE_TEMPLATE_FILES,
    requestedRoot: request.requestedRoot,
    scanDirectories: LATTE_TEMPLATE_SCAN_DIRECTORIES,
    ttlMs: LATTE_TEMPLATE_CACHE_TTL_MS,
  });

  return options.caches.templateCache[request.requestedRoot] ?? null;
}
