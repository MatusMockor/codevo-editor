import {
  evictOtherRootCacheEntries,
} from "./latteIntelligenceRuntime";
import type {
  LatteFrameworkCapabilities,
  LatteIntelligenceDependencies,
} from "./latteIntelligenceContracts";
import type { LatteViewDataCache } from "./latteExpressionIntelligence";
import type { LatteViewDataInFlight } from "./latteExpressionIntelligence";
import type {
  LatteFilterCache,
  LatteFilterInFlight,
} from "./latteFilterDiscovery";
import type { NetteControlCache } from "./netteControlContracts";
import type {
  NettePresenterCache,
  NettePresenterInFlight,
} from "./nettePresenterLinkDiscovery";
import type { LatteTemplateCache } from "./netteTemplateDiscovery";
import type {
  LatteTemplateTypeCache,
  LatteTemplateTypeInFlight,
} from "./netteTemplateTypes";

export const LATTE_TEMPLATE_SCAN_DIRECTORIES: readonly string[] = [
  "app",
  "templates",
];
export const LATTE_TEMPLATE_CACHE_TTL_MS = 5_000;
export const LATTE_MAX_COMPLETIONS = 100;
export const LATTE_PRESENTER_CACHE_TTL_MS = 5_000;
export const LATTE_COMPONENT_CACHE_TTL_MS = 5_000;
export const LATTE_FILTER_CACHE_TTL_MS = 5_000;
export const MAX_LATTE_SCAN_DEPTH = 12;
export const MAX_LATTE_TEMPLATE_FILES = 2_000;
export const MAX_LATTE_FILTER_CONFIG_FILES = 500;

export interface LatteProviderFlowCaches {
  componentCache: NetteControlCache;
  filterCache: LatteFilterCache;
  presenterCache: NettePresenterCache;
  templateCache: LatteTemplateCache;
  templateTypeCache: LatteTemplateTypeCache;
  viewDataCache: LatteViewDataCache;
}

export interface LatteProviderFlowInFlight {
  filterInFlight: LatteFilterInFlight;
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

export function evictLatteProviderCaches(
  caches: LatteProviderFlowCaches,
  requestedRoot: string | null,
): void {
  evictOtherRootCacheEntries(caches.templateCache, requestedRoot);
  evictOtherRootCacheEntries(caches.viewDataCache, requestedRoot);
  evictOtherRootCacheEntries(caches.presenterCache, requestedRoot);
  evictOtherRootCacheEntries(caches.componentCache, requestedRoot);
  evictOtherRootCacheEntries(caches.templateTypeCache, requestedRoot);
  evictOtherRootCacheEntries(caches.filterCache, requestedRoot);
}
