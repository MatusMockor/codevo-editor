import {
  activeLatteWorkspaceContext,
  currentTemplatePath,
} from "./latteIntelligenceRuntime";
import {
  evictLatteProviderCaches,
  type LatteProviderFlowFactoryOptions,
} from "./latteProviderFlowContext";
import type {
  LatteIntelligenceDependencies,
} from "./latteIntelligenceContracts";

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
  evictLatteProviderCaches(options.caches, deps.workspaceRoot);

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
