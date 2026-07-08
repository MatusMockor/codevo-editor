import type { LatteExpressionResolutionContext } from "./latteExpressionIntelligence";
import { LATTE_MAX_COMPLETIONS } from "./latteProviderFlowContext";
import type {
  LatteProviderFlowFactoryOptions,
  LatteProviderRequestContext,
} from "./latteProviderFlowContext";

export function latteExpressionResolutionContext(
  options: LatteProviderFlowFactoryOptions,
  request: LatteProviderRequestContext,
): LatteExpressionResolutionContext {
  return {
    deps: request.deps,
    frameworkCapabilities: options.frameworkCapabilities,
    isRequestedRootActive: request.isRequestedRootActive,
    maxCompletions: LATTE_MAX_COMPLETIONS,
    requestedRoot: request.requestedRoot,
    templateTypeCache: options.caches.templateTypeCache,
    templateTypeInFlight: options.inFlight.templateTypeInFlight,
    viewDataCache: options.caches.viewDataCache,
    viewDataInFlight: options.inFlight.viewDataInFlight,
  };
}
