import type { LatteExpressionResolutionContext } from "./latteExpressionIntelligence";
import type { NetteControlCompletionContext } from "./netteControlContracts";
import type {
  NettePresenterDiscoveryContext,
} from "./nettePresenterLinkDiscovery";
import type { NetteTemplateCompletionContext } from "./netteTemplateCompletions";
import { isLatteScanSkippedDirectory } from "./netteTemplateDiscovery";
import {
  LATTE_COMPONENT_CACHE_TTL_MS,
  LATTE_MAX_COMPLETIONS,
  LATTE_PRESENTER_CACHE_TTL_MS,
  LATTE_TEMPLATE_CACHE_TTL_MS,
  LATTE_TEMPLATE_SCAN_DIRECTORIES,
  MAX_LATTE_SCAN_DEPTH,
  MAX_LATTE_TEMPLATE_FILES,
} from "./latteProviderFlowContext";
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

export function latteTemplateCompletionContext(
  options: LatteProviderFlowFactoryOptions,
  request: LatteProviderRequestContext,
): NetteTemplateCompletionContext {
  return {
    cache: options.caches.templateCache,
    currentTemplateRelativePath: request.currentTemplateRelativePath,
    deps: request.deps,
    isRequestedRootActive: request.isRequestedRootActive,
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
  return {
    cache: options.caches.presenterCache,
    currentRelativePath: request.currentTemplateRelativePath,
    deps: request.deps,
    frameworkCapabilities: options.frameworkCapabilities,
    inFlight: options.inFlight.presenterInFlight,
    isDirectorySkipped: isLatteScanSkippedDirectory,
    isRequestedRootActive: request.isRequestedRootActive,
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
  return {
    currentRelativePath: request.currentTemplateRelativePath,
    deps: request.deps,
    frameworkCapabilities: options.frameworkCapabilities,
    isDirectorySkipped: isLatteScanSkippedDirectory,
    isRequestedRootActive: request.isRequestedRootActive,
    maxDepth: MAX_LATTE_SCAN_DEPTH,
    maxPresenters: MAX_LATTE_TEMPLATE_FILES,
    requestedRoot: request.requestedRoot,
  };
}

export function netteControlCompletionContext(
  options: LatteProviderFlowFactoryOptions,
  request: LatteProviderRequestContext,
): NetteControlCompletionContext {
  return {
    componentCache: options.caches.componentCache,
    deps: request.deps,
    isRequestedRootActive: request.isRequestedRootActive,
    maxCompletions: LATTE_MAX_COMPLETIONS,
    requestedRoot: request.requestedRoot,
    templateRelativePath: request.currentTemplateRelativePath,
    ttlMs: LATTE_COMPONENT_CACHE_TTL_MS,
  };
}
