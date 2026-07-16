import {
  resolveLatteExpressionVariableType,
  type LatteExpressionResolutionContext,
} from "./latteExpressionIntelligence";
import {
  resolveLatteTemplateCandidatePaths,
} from "../domain/nettePathResolution";
import {
  loadLatteFilterRegistrations,
  type LatteFilterDiscoveryContext,
} from "./latteFilterDiscovery";
import { resolveLatteProjectFilters } from "./latteFilterCallableResolution";
import type { NetteControlCompletionContext } from "./netteControlContracts";
import type {
  NettePresenterDiscoveryContext,
} from "./nettePresenterLinkDiscovery";
import type { NetteTemplateCompletionContext } from "./netteTemplateCompletions";
import {
  isLatteScanSkippedDirectory,
  listLatteTemplateRelativePaths,
} from "./netteTemplateDiscovery";
import { netteIncludedTemplateArguments } from "./netteIncludedTemplateArguments";
import {
  LATTE_COMPONENT_CACHE_TTL_MS,
  LATTE_FILTER_CACHE_TTL_MS,
  LATTE_MAX_COMPLETIONS,
  LATTE_PRESENTER_CACHE_TTL_MS,
  LATTE_PRESENTER_MAPPING_CACHE_TTL_MS,
  LATTE_TEMPLATE_CACHE_TTL_MS,
  LATTE_TEMPLATE_SCAN_DIRECTORIES,
  MAX_LATTE_FILTER_CONFIG_FILES,
  MAX_LATTE_INCLUDE_ARGUMENT_DEPTH,
  MAX_LATTE_INCLUDE_ARGUMENT_TRAVERSAL_STATES,
  MAX_LATTE_SCAN_DEPTH,
  MAX_LATTE_PRESENTER_MAPPING_SEARCH_RESULTS,
  MAX_LATTE_TEMPLATE_FILES,
  captureLatteExpressionGeneration,
} from "./latteProviderFlowContext";
import { loadNeonProjectConfig } from "./neonProjectConfigDiscovery";
import type {
  LatteProviderFlowFactoryOptions,
} from "./latteProviderFlowContext";
import type {
  LatteProviderRequestContext,
} from "./latteProviderRequestContext";
import {
  captureNettePresenterMappingGeneration,
  loadNettePresenterMappings,
  type NettePresenterMappingDiscoveryContext,
} from "./nettePresenterMappingDiscovery";

export function latteExpressionResolutionContext(
  options: LatteProviderFlowFactoryOptions,
  request: LatteProviderRequestContext,
): LatteExpressionResolutionContext {
  const generationFence = captureLatteExpressionGeneration(
    options.caches,
    request.requestedRoot,
  );
  const { generation, rootKey } = generationFence;
  const isRequestedRootActive = () =>
    request.isRequestedRootActive() && generationFence.isCurrent();
  const shared = {
    collectProjectFilters: async (prefix: string) => {
      const registrations = await loadLatteFilterRegistrations(
        latteFilterDiscoveryContext(options, request),
      );

      if (!isRequestedRootActive()) {
        return [];
      }

      return resolveLatteProjectFilters(
        latteFilterCallableResolutionContext(options, request),
        registrations.filter((registration) =>
          registration.name.toLowerCase().startsWith(prefix.toLowerCase()),
        ),
      );
    },
    deps: request.deps,
    frameworkCapabilities: options.frameworkCapabilities,
    isRequestedRootActive,
    maxCompletions: LATTE_MAX_COMPLETIONS,
    requestedRoot: request.requestedRoot,
    templateTypeCache: options.caches.templateTypeCache,
    templateTypeInFlight: options.inFlight.templateTypeInFlight,
    viewDataCache: options.caches.viewDataCache,
    viewDataInFlight: options.inFlight.viewDataInFlight,
  };
  const forTemplate = (
    currentTemplateRelativePath: string,
  ): LatteExpressionResolutionContext => {
    const context: LatteExpressionResolutionContext = {
      ...shared,
      currentTemplateRelativePath,
      forTemplate,
      loadIncludedTemplateArguments: (targetRelativePath) =>
        netteIncludedTemplateArguments(
          {
            cache: options.caches.includeArgumentCache,
            currentGeneration: () =>
              options.caches.includeArgumentGenerationByRoot[
                rootKey
              ] ?? 0,
            deps: {
              enumerateTemplateRelativePaths: () =>
                enumerateCompleteTemplateRelativePaths(options, {
                  ...request,
                  isRequestedRootActive,
                }),
              joinPath: request.deps.joinPath,
              readFileContent: request.deps.readFileContent,
              resolveCallerVariableType: (
                callerRelativePath,
                source,
                offset,
                variableName,
              ) =>
                resolveLatteExpressionVariableType(
                  context.forTemplate(callerRelativePath),
                  source,
                  offset,
                  variableName,
                ),
              resolveTemplateCandidatePaths:
                resolveLatteTemplateCandidatePaths,
            },
            generation,
            inFlight: options.inFlight.includeArgumentInFlight,
            isRequestedRootActive,
            maxDepth: MAX_LATTE_INCLUDE_ARGUMENT_DEPTH,
            maxTraversalStates:
              MAX_LATTE_INCLUDE_ARGUMENT_TRAVERSAL_STATES,
            requestedRoot: rootKey,
          },
          targetRelativePath,
        ),
    };

    return context;
  };

  return forTemplate(request.currentTemplateRelativePath);
}

async function enumerateCompleteTemplateRelativePaths(
  options: LatteProviderFlowFactoryOptions,
  request: LatteProviderRequestContext,
): Promise<readonly string[]> {
  await listLatteTemplateRelativePaths(
    latteTemplateCompletionContext(options, request),
  );

  const entry = options.caches.templateCache[request.requestedRoot];
  return entry?.complete ? entry.relativePaths : [];
}

export function latteFilterDefinitionContext(
  options: LatteProviderFlowFactoryOptions,
  request: LatteProviderRequestContext,
) {
  const { neonConfigCache, neonConfigInFlight } = options;
  const generation = captureLatteExpressionGeneration(
    options.caches,
    request.requestedRoot,
  );
  const isRequestedRootActive = () =>
    request.isRequestedRootActive() && generation.isCurrent();

  return {
    deps: request.deps,
    isRequestedRootActive,
    loadFilterRegistrations: () =>
      loadLatteFilterRegistrations(latteFilterDiscoveryContext(options, request)),
    ...(neonConfigCache && neonConfigInFlight
      ? {
          loadProjectConfig: () =>
            loadNeonProjectConfig({
              configCache: neonConfigCache,
              configInFlight: neonConfigInFlight,
              deps: {
                ...request.deps,
                getActiveDocument: () => null,
              },
              isRequestedRootActive,
              requestedRoot: request.requestedRoot,
            }),
        }
      : {}),
  };
}

function latteFilterCallableResolutionContext(
  options: LatteProviderFlowFactoryOptions,
  request: LatteProviderRequestContext,
) {
  const { neonConfigCache, neonConfigInFlight } = options;
  const generation = captureLatteExpressionGeneration(
    options.caches,
    request.requestedRoot,
  );
  const isRequestedRootActive = () =>
    request.isRequestedRootActive() && generation.isCurrent();

  return {
    deps: request.deps,
    isRequestedRootActive,
    ...(neonConfigCache && neonConfigInFlight
      ? {
          loadProjectConfig: () =>
            loadNeonProjectConfig({
              configCache: neonConfigCache,
              configInFlight: neonConfigInFlight,
              deps: {
                ...request.deps,
                getActiveDocument: () => null,
              },
              isRequestedRootActive,
              requestedRoot: request.requestedRoot,
            }),
        }
      : {}),
  };
}

export function latteFilterDiscoveryContext(
  options: LatteProviderFlowFactoryOptions,
  request: LatteProviderRequestContext,
): LatteFilterDiscoveryContext {
  const generation = captureLatteExpressionGeneration(
    options.caches,
    request.requestedRoot,
  );

  return {
    cache: options.caches.filterCache,
    deps: request.deps,
    inFlight: options.inFlight.filterInFlight,
    isDirectorySkipped: isLatteScanSkippedDirectory,
    isRequestedRootActive: () =>
      request.isRequestedRootActive() && generation.isCurrent(),
    maxConfigFiles: MAX_LATTE_FILTER_CONFIG_FILES,
    maxDepth: MAX_LATTE_SCAN_DEPTH,
    requestedRoot: request.requestedRoot,
    scanDirectories: LATTE_TEMPLATE_SCAN_DIRECTORIES,
    ttlMs: LATTE_FILTER_CACHE_TTL_MS,
  };
}

export function latteTemplateCompletionContext(
  options: LatteProviderFlowFactoryOptions,
  request: LatteProviderRequestContext,
): NetteTemplateCompletionContext {
  const generation = captureLatteExpressionGeneration(
    options.caches,
    request.requestedRoot,
  );

  return {
    cache: options.caches.templateCache,
    currentTemplateRelativePath: request.currentTemplateRelativePath,
    deps: request.deps,
    isRequestedRootActive: request.isRequestedRootActive,
    isCacheWriteCurrent: generation.isCurrent,
    maxCompletions: LATTE_MAX_COMPLETIONS,
    maxDepth: MAX_LATTE_SCAN_DEPTH,
    maxTemplates: MAX_LATTE_TEMPLATE_FILES,
    requestedRoot: request.requestedRoot,
    scanDirectories: LATTE_TEMPLATE_SCAN_DIRECTORIES,
    ttlMs: LATTE_TEMPLATE_CACHE_TTL_MS,
  };
}

export function nettePresenterLinkCompletionContext(
  options: LatteProviderFlowFactoryOptions,
  request: LatteProviderRequestContext,
): NettePresenterDiscoveryContext {
  const mappingGeneration = captureNettePresenterMappingGeneration(
    options.caches.presenterMappingGeneration,
    request.requestedRoot,
  );

  return {
    cache: options.caches.presenterCache,
    currentRelativePath: request.currentTemplateRelativePath,
    deps: request.deps,
    frameworkCapabilities: options.frameworkCapabilities,
    inFlight: options.inFlight.presenterInFlight,
    isDirectorySkipped: isLatteScanSkippedDirectory,
    isCacheWriteCurrent: mappingGeneration.isCurrent,
    isRequestedRootActive: request.isRequestedRootActive,
    isPresenterMappingGenerationCurrent: mappingGeneration.isCurrent,
    loadPresenterMappings: () =>
      loadNettePresenterMappings(
        nettePresenterMappingDiscoveryContext(options, request),
      ),
    maxDepth: MAX_LATTE_SCAN_DEPTH,
    maxPresenters: MAX_LATTE_TEMPLATE_FILES,
    requestedRoot: request.requestedRoot,
    ttlMs: LATTE_PRESENTER_CACHE_TTL_MS,
  };
}

export function nettePresenterLinkDefinitionContext(
  options: LatteProviderFlowFactoryOptions,
  request: LatteProviderRequestContext,
): Omit<NettePresenterDiscoveryContext, "cache" | "inFlight" | "ttlMs"> {
  const mappingGeneration = captureNettePresenterMappingGeneration(
    options.caches.presenterMappingGeneration,
    request.requestedRoot,
  );

  return {
    currentRelativePath: request.currentTemplateRelativePath,
    deps: request.deps,
    frameworkCapabilities: options.frameworkCapabilities,
    isDirectorySkipped: isLatteScanSkippedDirectory,
    isRequestedRootActive: request.isRequestedRootActive,
    isPresenterMappingGenerationCurrent: mappingGeneration.isCurrent,
    loadPresenterMappings: () =>
      loadNettePresenterMappings(
        nettePresenterMappingDiscoveryContext(options, request),
      ),
    maxDepth: MAX_LATTE_SCAN_DEPTH,
    maxPresenters: MAX_LATTE_TEMPLATE_FILES,
    requestedRoot: request.requestedRoot,
  };
}

export function nettePresenterMappingDiscoveryContext(
  options: LatteProviderFlowFactoryOptions,
  request: LatteProviderRequestContext,
): NettePresenterMappingDiscoveryContext {
  return {
    cache: options.caches.presenterMappingCache,
    deps: request.deps,
    generation: options.caches.presenterMappingGeneration,
    inFlight: options.inFlight.presenterMappingInFlight,
    isRequestedRootActive: request.isRequestedRootActive,
    maxSearchResults: MAX_LATTE_PRESENTER_MAPPING_SEARCH_RESULTS,
    requestedRoot: request.requestedRoot,
    ttlMs: LATTE_PRESENTER_MAPPING_CACHE_TTL_MS,
  };
}

export function netteControlCompletionContext(
  options: LatteProviderFlowFactoryOptions,
  request: LatteProviderRequestContext,
): NetteControlCompletionContext {
  const { neonConfigCache, neonConfigInFlight } = options;

  return {
    componentCache: options.caches.componentCache,
    deps: request.deps,
    isRequestedRootActive: request.isRequestedRootActive,
    ...(neonConfigCache && neonConfigInFlight
      ? {
          loadProjectConfig: () =>
            loadNeonProjectConfig({
              configCache: neonConfigCache,
              configInFlight: neonConfigInFlight,
              deps: {
                ...request.deps,
                getActiveDocument: () => null,
              },
              isRequestedRootActive: request.isRequestedRootActive,
              requestedRoot: request.requestedRoot,
            }),
        }
      : {}),
    maxCompletions: LATTE_MAX_COMPLETIONS,
    requestedRoot: request.requestedRoot,
    templateRelativePath: request.currentTemplateRelativePath,
    ttlMs: LATTE_COMPONENT_CACHE_TTL_MS,
  };
}
