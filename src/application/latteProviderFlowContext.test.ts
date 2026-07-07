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

    evictLatteProviderCaches(caches, "/active");

    expect(Object.keys(caches.componentCache)).toEqual(["/active"]);
    expect(Object.keys(caches.presenterCache)).toEqual(["/active"]);
    expect(Object.keys(caches.templateCache)).toEqual(["/active"]);
    expect(Object.keys(caches.templateTypeCache)).toEqual(["/active"]);
    expect(Object.keys(caches.viewDataCache)).toEqual(["/active"]);
  });

  it("clears provider caches when no workspace is active", () => {
    const caches = providerCaches();

    evictLatteProviderCaches(caches, null);

    expect(caches.componentCache).toEqual({});
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
    presenterCache: {
      "/active": { expiresAt: 1, targets: [] },
      "/stale": { expiresAt: 1, targets: [] },
    },
    templateCache: {
      "/active": { expiresAt: 1, relativePaths: [] },
      "/stale": { expiresAt: 1, relativePaths: [] },
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
