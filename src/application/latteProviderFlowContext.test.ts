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

    evictLatteProviderCaches(caches, "/active/", inFlight);

    expect(Object.keys(caches.componentCache)).toEqual(["/active"]);
    expect(Object.keys(caches.filterCache)).toEqual(["/active"]);
    expect(Object.keys(caches.includeArgumentCache)).toEqual(["/active"]);
    expect(caches.includeArgumentGenerationByRoot).toEqual({
      "/active": 1,
      "/stale": 3,
    });
    expect(Array.from(inFlight.graphs.keys())).toEqual([
      "/active\0generation",
    ]);
    expect(Object.keys(caches.presenterCache)).toEqual(["/active"]);
    expect(Object.keys(caches.templateCache)).toEqual(["/active"]);
    expect(Object.keys(caches.templateTypeCache)).toEqual(["/active"]);
    expect(Object.keys(caches.viewDataCache)).toEqual(["/active"]);
  });

  it("clears provider caches when no workspace is active", () => {
    const caches = providerCaches();
    const inFlight = includeArgumentInFlight();

    evictLatteProviderCaches(caches, null, inFlight);

    expect(caches.componentCache).toEqual({});
    expect(caches.filterCache).toEqual({});
    expect(caches.includeArgumentCache).toEqual({});
    expect(caches.includeArgumentGenerationByRoot).toEqual({
      "/active": 2,
      "/stale": 3,
    });
    expect(inFlight.graphs.size).toBe(0);
    expect(caches.presenterCache).toEqual({});
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
