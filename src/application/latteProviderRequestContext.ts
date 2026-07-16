import {
  activeLatteWorkspaceContext,
  currentTemplatePath,
} from "./latteIntelligenceRuntime";
import {
  evictLatteProviderCaches,
  type LatteProviderFlowFactoryOptions,
} from "./latteProviderFlowContext";
import { evictOtherRootConfigCacheEntries } from "./neonProjectConfigDiscovery";
import type {
  LatteIntelligenceDependencies,
} from "./latteIntelligenceContracts";
import { canNavigate, type NavigationRequest } from "./navigationRequest";

export interface LatteProviderRequestContext {
  currentTemplateRelativePath: string;
  deps: LatteIntelligenceDependencies;
  isRequestedRootActive(): boolean;
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

  return {
    currentTemplateRelativePath: currentTemplatePath(deps, requestedRoot),
    deps,
    isRequestedRootActive,
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
