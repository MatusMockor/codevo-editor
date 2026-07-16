import {
  evictOtherRootCacheEntries,
} from "./latteIntelligenceRuntime";
import type {
  LatteFrameworkCapabilities,
  LatteIntelligenceDependencies,
} from "./latteIntelligenceContracts";
import {
  evictLatteInheritedViewDataCaches,
  type LatteViewDataCache,
} from "./latteExpressionIntelligence";
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
import type {
  NeonConfigCache,
  NeonConfigInFlight,
} from "./neonProjectConfigDiscovery";
import type {
  NetteIncludedTemplateArgumentCache,
  NetteIncludedTemplateArgumentInFlight,
} from "./netteIncludedTemplateArguments";
import type { LatteIncludeArgumentGenerationByRoot } from "./latteIntelligenceCaches";
import {
  normalizedWorkspaceRootKey,
  workspaceRootKeysEqual,
} from "../domain/workspaceRootKey";

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
export const MAX_LATTE_INCLUDE_ARGUMENT_DEPTH = 8;
export const MAX_LATTE_INCLUDE_ARGUMENT_TRAVERSAL_STATES = 2_000;

export interface LatteProviderFlowCaches {
  componentCache: NetteControlCache;
  filterCache: LatteFilterCache;
  includeArgumentCache: NetteIncludedTemplateArgumentCache;
  includeArgumentGenerationByRoot: LatteIncludeArgumentGenerationByRoot;
  presenterCache: NettePresenterCache;
  templateCache: LatteTemplateCache;
  templateTypeCache: LatteTemplateTypeCache;
  viewDataCache: LatteViewDataCache;
}

export interface LatteProviderFlowInFlight {
  filterInFlight: LatteFilterInFlight;
  includeArgumentInFlight: NetteIncludedTemplateArgumentInFlight;
  presenterInFlight: NettePresenterInFlight;
  templateTypeInFlight: LatteTemplateTypeInFlight;
  viewDataInFlight: LatteViewDataInFlight;
}

export interface LatteProviderFlowFactoryOptions {
  caches: LatteProviderFlowCaches;
  frameworkCapabilities: LatteFrameworkCapabilities;
  getDependencies(): LatteIntelligenceDependencies;
  inFlight: LatteProviderFlowInFlight;
  neonConfigCache?: NeonConfigCache;
  neonConfigInFlight?: NeonConfigInFlight;
}

export interface LatteExpressionGenerationFence {
  generation: number;
  isCurrent(): boolean;
  rootKey: string;
}

export function captureLatteExpressionGeneration(
  caches: LatteProviderFlowCaches,
  rootPath: string,
): LatteExpressionGenerationFence {
  const rootKey = normalizedWorkspaceRootKey(rootPath);
  const generation = mergeEquivalentGenerationKeys(caches, rootKey);
  mergeEquivalentIncludeArgumentCacheKeys(caches, rootKey);

  return {
    generation,
    isCurrent: () =>
      caches.includeArgumentGenerationByRoot[rootKey] === generation,
    rootKey,
  };
}

export function bumpLatteExpressionGeneration(
  caches: LatteProviderFlowCaches,
  rootPath: string,
): LatteExpressionGenerationFence {
  const current = captureLatteExpressionGeneration(caches, rootPath);
  caches.includeArgumentGenerationByRoot[current.rootKey] =
    current.generation + 1;

  return captureLatteExpressionGeneration(caches, current.rootKey);
}

export function evictLatteProviderCaches(
  caches: LatteProviderFlowCaches,
  requestedRoot: string | null,
  includeArgumentInFlight: NetteIncludedTemplateArgumentInFlight,
): void {
  fenceEvictedIncludeArgumentRoots(caches, requestedRoot);
  evictLatteInheritedViewDataCaches(caches.viewDataCache, requestedRoot);
  evictOtherRootCacheEntries(caches.templateCache, requestedRoot);
  evictOtherRootCacheEntries(caches.viewDataCache, requestedRoot);
  evictOtherRootCacheEntries(caches.presenterCache, requestedRoot);
  evictOtherRootCacheEntries(caches.componentCache, requestedRoot);
  evictOtherRootCacheEntries(caches.templateTypeCache, requestedRoot);
  evictOtherRootCacheEntries(caches.filterCache, requestedRoot);
  evictOtherRootCacheEntries(caches.includeArgumentCache, requestedRoot);
  evictIncludeArgumentInFlight(includeArgumentInFlight, requestedRoot);
}

function fenceEvictedIncludeArgumentRoots(
  caches: LatteProviderFlowCaches,
  requestedRoot: string | null,
): void {
  for (const root of Object.keys(caches.includeArgumentGenerationByRoot)) {
    if (workspaceRootKeysEqual(root, requestedRoot)) {
      continue;
    }

    caches.includeArgumentGenerationByRoot[root] =
      (caches.includeArgumentGenerationByRoot[root] ?? 0) + 1;
  }
}

function evictIncludeArgumentInFlight(
  inFlight: NetteIncludedTemplateArgumentInFlight,
  requestedRoot: string | null,
): void {
  for (const key of inFlight.graphs.keys()) {
    if (keyRootMatches(key, requestedRoot)) {
      continue;
    }

    inFlight.graphs.delete(key);
  }

  for (const key of inFlight.queries.keys()) {
    if (keyRootMatches(key, requestedRoot)) {
      continue;
    }

    inFlight.queries.delete(key);
  }
}

function keyRootMatches(key: string, requestedRoot: string | null): boolean {
  const separator = key.indexOf("\0");
  const root = separator < 0 ? key : key.slice(0, separator);

  return workspaceRootKeysEqual(root, requestedRoot);
}

function mergeEquivalentGenerationKeys(
  caches: LatteProviderFlowCaches,
  rootKey: string,
): number {
  let generation = caches.includeArgumentGenerationByRoot[rootKey] ?? 0;

  for (const existingRoot of Object.keys(
    caches.includeArgumentGenerationByRoot,
  )) {
    if (
      existingRoot === rootKey ||
      !workspaceRootKeysEqual(existingRoot, rootKey)
    ) {
      continue;
    }

    generation = Math.max(
      generation,
      caches.includeArgumentGenerationByRoot[existingRoot] ?? 0,
    );
    delete caches.includeArgumentGenerationByRoot[existingRoot];
  }

  caches.includeArgumentGenerationByRoot[rootKey] = generation;
  return generation;
}

function mergeEquivalentIncludeArgumentCacheKeys(
  caches: LatteProviderFlowCaches,
  rootKey: string,
): void {
  for (const existingRoot of Object.keys(caches.includeArgumentCache)) {
    if (
      existingRoot === rootKey ||
      !workspaceRootKeysEqual(existingRoot, rootKey)
    ) {
      continue;
    }

    const existing = caches.includeArgumentCache[existingRoot];
    const canonical = caches.includeArgumentCache[rootKey];

    if (existing && (!canonical || existing.generation > canonical.generation)) {
      caches.includeArgumentCache[rootKey] = existing;
    }

    delete caches.includeArgumentCache[existingRoot];
  }
}
