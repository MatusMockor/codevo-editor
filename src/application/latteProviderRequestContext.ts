import {
  activeLatteWorkspaceContext,
  currentTemplatePath,
} from "./latteIntelligenceRuntime";
import {
  evictLatteProviderCaches,
  type LatteProviderFlowFactoryOptions,
} from "./latteProviderFlowContext";
import { evictOtherRootConfigCacheEntries } from "./neonProjectConfigDiscovery";
import { evictOtherRootPresenterMappingEntries } from "./nettePresenterMappingDiscovery";
import type {
  LatteIntelligenceDependencies,
} from "./latteIntelligenceContracts";
import { canNavigate, type NavigationRequest } from "./navigationRequest";
import {
  loadNetteFactoryTemplateOwner,
  type NetteFactoryTemplateOwner,
} from "./netteFactoryTemplateOwners";
import {
  MAX_NETTE_FACTORY_TEMPLATE_OWNER_SEARCH_RESULTS,
  NETTE_FACTORY_TEMPLATE_OWNER_CACHE_TTL_MS,
} from "./latteProviderFlowContext";

export interface LatteProviderRequestContext {
  currentTemplateRelativePath: string;
  deps: LatteIntelligenceDependencies;
  isRequestedRootActive(): boolean;
  loadFactoryTemplateOwner(
    templatePath: string,
  ): Promise<NetteFactoryTemplateOwner | null>;
  requestedRoot: string;
}

export function latteProviderRequestContext(
  options: LatteProviderFlowFactoryOptions,
): LatteProviderRequestContext | null {
  const deps = options.getDependencies();
  evictLatteProviderCaches(
    options.caches,
    deps.workspaceRoot,
    options.inFlight.includeArgumentInFlight,
    options.inFlight.filterInFlight,
    options.inFlight.factoryTemplateOwnerInFlight,
  );
  evictOtherRootPresenterMappingEntries(
    options.caches.presenterMappingCache,
    options.inFlight.presenterMappingInFlight,
    options.caches.presenterMappingGeneration,
    deps.workspaceRoot,
  );

  if (options.neonConfigCache) {
    evictOtherRootConfigCacheEntries(options.neonConfigCache, deps.workspaceRoot);
  }

  const workspaceContext = activeLatteWorkspaceContext(
    deps,
    options.frameworkCapabilities,
  );

  if (!workspaceContext) {
    return null;
  }

  const { isRequestedRootActive, requestedRoot } = workspaceContext;
  const loadFactoryTemplateOwner = (templatePath: string) => {
    if (
      !options.frameworkCapabilities.supportsFactoryTemplateOwnerIntelligence()
    ) {
      return Promise.resolve(null);
    }

    const resolvePhpClassSourcePaths = deps.resolvePhpClassSourcePaths;

    if (!resolvePhpClassSourcePaths) {
      return Promise.resolve(null);
    }

    return loadNetteFactoryTemplateOwner(
      {
        cache: options.caches.factoryTemplateOwnerCache,
        deps: {
          readFileContent: deps.readFileContent,
          resolvePhpClassSourcePaths: async (className) => [
            ...(await resolvePhpClassSourcePaths(className)),
          ],
          searchText: deps.searchText,
        },
        generation: options.caches.factoryTemplateOwnerGeneration,
        inFlight: options.inFlight.factoryTemplateOwnerInFlight,
        isRequestedRootActive,
        maxSearchResults:
          MAX_NETTE_FACTORY_TEMPLATE_OWNER_SEARCH_RESULTS,
        requestedRoot,
        ttlMs: NETTE_FACTORY_TEMPLATE_OWNER_CACHE_TTL_MS,
      },
      templatePath,
    );
  };

  return {
    currentTemplateRelativePath: currentTemplatePath(deps, requestedRoot),
    deps,
    isRequestedRootActive,
    loadFactoryTemplateOwner,
    requestedRoot,
  };
}

export function guardedLatteProviderRequestContext(
  request: LatteProviderRequestContext | null,
  navigationRequest?: NavigationRequest,
): LatteProviderRequestContext | null {
  if (!request) {
    return null;
  }

  const canOpen = () =>
    request.isRequestedRootActive() && canNavigate(navigationRequest);

  return {
    ...request,
    deps: {
      ...request.deps,
      openPhpMethodTarget: (className, methodName) => {
        if (!canOpen()) {
          return Promise.resolve(false);
        }

        return navigationRequest
          ? request.deps.openPhpMethodTarget(
              className,
              methodName,
              navigationRequest,
            )
          : request.deps.openPhpMethodTarget(className, methodName);
      },
      openPhpPropertyTarget: (className, propertyName) => {
        if (!canOpen()) {
          return Promise.resolve(false);
        }

        return request.deps.openPhpPropertyTarget(className, propertyName);
      },
      openTarget: (path, position, label) => {
        if (!canOpen()) {
          return Promise.resolve(false);
        }

        return request.deps.openTarget(path, position, label);
      },
    },
    isRequestedRootActive: canOpen,
  };
}
