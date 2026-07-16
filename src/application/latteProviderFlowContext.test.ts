import { describe, expect, it } from "vitest";
import {
  LATTE_MAX_COMPLETIONS,
  evictLatteProviderCaches,
  type LatteProviderFlowCaches,
} from "./latteProviderFlowContext";

describe("latteProviderFlowContext", () => {
  it("keeps the shared completion cap explicit", () => {
    expect(LATTE_MAX_COMPLETIONS).toBe(100);
  });

  it("evicts every per-root provider cache except the requested root", () => {
    const caches = providerCaches();
    const inFlight = includeArgumentInFlight();
    const filterInFlight = new Map([
      ["/active/", Promise.resolve([])],
      ["/stale", Promise.resolve([])],
    ]);
    const factoryTemplateOwnerInFlight = new Map([
      ["/active\0template", Promise.resolve(null)],
      ["/stale\0template", Promise.resolve(null)],
    ]);

    evictLatteProviderCaches(
      caches,
      "/active/",
      inFlight,
      filterInFlight,
      factoryTemplateOwnerInFlight,
    );

    expect(Object.keys(caches.componentCache)).toEqual(["/active"]);
    expect(Object.keys(caches.filterCache)).toEqual(["/active"]);
    expect(Object.keys(caches.factoryTemplateOwnerCache)).toEqual(["/active"]);
    expect(Array.from(factoryTemplateOwnerInFlight.keys())).toEqual([
      "/active\0template",
    ]);
    expect(caches.factoryTemplateOwnerGeneration.roots).toEqual({
      "/active": 1,
    });
    expect(Object.keys(caches.includeArgumentCache)).toEqual(["/active"]);
    expect(caches.includeArgumentGenerationByRoot).toEqual({
      "/active": 1,
      "/stale": 3,
    });
    expect(Array.from(inFlight.graphs.keys())).toEqual([
      "/active\0generation",
    ]);
    expect(Array.from(filterInFlight.keys())).toEqual(["/active/"]);
    expect(Object.keys(caches.presenterCache)).toEqual(["/active"]);
    expect(Object.keys(caches.presenterMappingCache)).toEqual(["/active"]);
    expect(Object.keys(caches.templateCache)).toEqual(["/active"]);
    expect(Object.keys(caches.templateTypeCache)).toEqual(["/active"]);
    expect(Object.keys(caches.viewDataCache)).toEqual(["/active"]);
  });

  it("clears provider caches when no workspace is active", () => {
    const caches = providerCaches();
    const inFlight = includeArgumentInFlight();
    const filterInFlight = new Map([
      ["/active", Promise.resolve([])],
      ["/stale", Promise.resolve([])],
    ]);
    const factoryTemplateOwnerInFlight = new Map([
      ["/active\0template", Promise.resolve(null)],
      ["/stale\0template", Promise.resolve(null)],
    ]);

    evictLatteProviderCaches(
      caches,
      null,
      inFlight,
      filterInFlight,
      factoryTemplateOwnerInFlight,
    );

    expect(caches.componentCache).toEqual({});
    expect(caches.filterCache).toEqual({});
    expect(caches.factoryTemplateOwnerCache).toEqual({});
    expect(caches.factoryTemplateOwnerGeneration.roots).toEqual({});
    expect(factoryTemplateOwnerInFlight.size).toBe(0);
    expect(caches.includeArgumentCache).toEqual({});
    expect(caches.includeArgumentGenerationByRoot).toEqual({
      "/active": 2,
      "/stale": 3,
    });
    expect(inFlight.graphs.size).toBe(0);
    expect(filterInFlight.size).toBe(0);
    expect(caches.presenterCache).toEqual({});
    expect(caches.presenterMappingCache).toEqual({});
    expect(caches.templateCache).toEqual({});
    expect(caches.templateTypeCache).toEqual({});
    expect(caches.viewDataCache).toEqual({});
  });
});

function providerCaches(): LatteProviderFlowCaches {
  return {
    componentCache: {
      "/active": {
        componentNames: [],
        expiresAt: 1,
        templateRelativePath: "app/UI/Home/default.latte",
      },
      "/stale": {
        componentNames: [],
        expiresAt: 1,
        templateRelativePath: "app/UI/Home/default.latte",
      },
    },
    filterCache: {
      "/active": { expiresAt: 1, registrations: [] },
      "/stale": { expiresAt: 1, registrations: [] },
    },
    factoryTemplateOwnerCache: {
      "/active": { dependencyPaths: [], ownersByTemplatePath: {} },
      "/stale": { dependencyPaths: [], ownersByTemplatePath: {} },
    },
    factoryTemplateOwnerGeneration: {
      next: 2,
      roots: { "/active": 1, "/stale": 2 },
    },
    includeArgumentCache: {
      "/active": includeArgumentCacheEntry(),
      "/stale": includeArgumentCacheEntry(),
    },
    includeArgumentGenerationByRoot: {
      "/active": 1,
      "/stale": 2,
    },
    presenterCache: {
      "/active": { expiresAt: 1, targets: [] },
      "/stale": { expiresAt: 1, targets: [] },
    },
    presenterMappingCache: {
      "/active": { expiresAt: 1, mappings: [] },
      "/stale": { expiresAt: 1, mappings: [] },
    },
    presenterMappingGeneration: { next: 2, roots: {} },
    templateCache: {
      "/active": { complete: true, expiresAt: 1, relativePaths: [] },
      "/stale": { complete: true, expiresAt: 1, relativePaths: [] },
    },
    templateTypeCache: {
      "/active": { expiresAt: 1, sightingsByTypeName: {} },
      "/stale": { expiresAt: 1, sightingsByTypeName: {} },
    },
    viewDataCache: {
      "/active": { entries: [], expiresAt: 1 },
      "/stale": { entries: [], expiresAt: 1 },
    },
  };
}

function includeArgumentInFlight() {
  return {
    graphs: new Map([
      ["/active\0generation", Promise.resolve(null)],
      ["/stale\0generation", Promise.resolve(null)],
    ]),
    queries: new Map<string, Promise<readonly never[]>>(),
  };
}

function includeArgumentCacheEntry() {
  return {
    generation: 1,
    graph: {
      cycleAnalysisOperations: 0,
      cyclicEdgeIds: new Set<string>(),
      edges: [],
      filesByPath: new Map(),
      incomingByTarget: new Map(),
      outgoingBySource: new Map(),
    },
    queryResults: new Map(),
  };
}
