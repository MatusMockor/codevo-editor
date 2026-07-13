import { describe, expect, it, vi } from "vitest";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { LatteIntelligenceDependencies } from "./latteIntelligenceContracts";
import { netteLatteFrameworkCapabilities } from "./latteFrameworkCapabilities";
import {
  type LatteProviderFlowCaches,
  type LatteProviderFlowFactoryOptions,
} from "./latteProviderFlowContext";
import {
  latteProviderRequestContext,
} from "./latteProviderRequestContext";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";

const root = "/active";
const staleRoot = "/stale";
const frameworkProvider: PhpFrameworkProvider = {
  id: "latte-template-test",
  latte: {
    supportsTemplateIntelligence: true,
  },
};
const frameworkIntelligence = createPhpFrameworkIntelligence({
  matchedProviderIds: [frameworkProvider.id],
  profile: "generic",
  providers: [frameworkProvider],
});

describe("latteProviderRequestContext", () => {
  it("returns request context for an active Latte workspace and evicts stale roots", () => {
    const caches = providerCaches();
    const request = latteProviderRequestContext(options(deps(), caches));

    expect(request).toMatchObject({
      currentTemplateRelativePath: "app/UI/Home/default.latte",
      deps: expect.any(Object),
      requestedRoot: root,
    });
    expect(request?.isRequestedRootActive()).toBe(true);
    expect(cacheRoots(caches)).toEqual({
      componentCache: [root],
      presenterCache: [root],
      templateCache: [root],
      templateTypeCache: [root],
      viewDataCache: [root],
    });
  });

  it("keeps the root-active guard tied to the captured requested root", () => {
    const currentWorkspaceRootRef = { current: root };
    const request = latteProviderRequestContext(
      options(deps({ currentWorkspaceRootRef }), providerCaches()),
    );

    currentWorkspaceRootRef.current = "/other";

    expect(request?.requestedRoot).toBe(root);
    expect(request?.isRequestedRootActive()).toBe(false);
  });

  it("returns null and clears stale caches when no workspace root is requested", () => {
    const caches = providerCaches();
    const request = latteProviderRequestContext(
      options(deps({ workspaceRoot: null }), caches),
    );

    expect(request).toBeNull();
    expect(cacheRoots(caches)).toEqual({
      componentCache: [],
      presenterCache: [],
      templateCache: [],
      templateTypeCache: [],
      viewDataCache: [],
    });
  });

  it("returns null when Latte semantic intelligence is unavailable", () => {
    expect(
      latteProviderRequestContext(
        options(deps({ isSemanticIntelligenceActive: false }), providerCaches()),
      ),
    ).toBeNull();
  });
});

function deps(
  overrides: Partial<LatteIntelligenceDependencies> = {},
): LatteIntelligenceDependencies {
  return {
    currentWorkspaceRootRef: { current: root },
    frameworkIntelligence,
    getActiveDocument: () => ({ path: `${root}/app/UI/Home/default.latte` }),
    isSemanticIntelligenceActive: true,
    joinPath: (rootPath, relativePath) => `${rootPath}/${relativePath}`,
    listDirectory: vi.fn(async () => []),
    openPhpMethodTarget: vi.fn(async () => false),
    openPhpPropertyTarget: vi.fn(async () => false),
    openTarget: vi.fn(async () => false),
    readFileContent: vi.fn(async () => ""),
    resolveDeclaredType: (_source, typeHint) => typeHint,
    resolveExpressionType: vi.fn(async () => null),
    resolvePhpReceiverCompletions: vi.fn(async () => []),
    searchText: vi.fn(async () => []),
    synthesizeTypedReceiverSource: (variableName, typeName) => ({
      position: { column: 1, lineNumber: 1 },
      source: `<?php /** @var ${typeName} $${variableName} */`,
    }),
    toRelativePath: (rootPath, path) =>
      path.startsWith(`${rootPath}/`) ? path.slice(rootPath.length + 1) : path,
    workspaceRoot: root,
    ...overrides,
  };
}

function options(
  dependencies: LatteIntelligenceDependencies,
  caches: LatteProviderFlowCaches,
): LatteProviderFlowFactoryOptions {
  return {
    caches,
    frameworkCapabilities: netteLatteFrameworkCapabilities,
    getDependencies: () => dependencies,
    inFlight: {
      presenterInFlight: new Map(),
      templateTypeInFlight: new Map(),
      viewDataInFlight: new Map(),
    },
  };
}

function providerCaches(): LatteProviderFlowCaches {
  return {
    componentCache: {
      [root]: {
        componentNames: [],
        expiresAt: 1,
        templateRelativePath: "app/UI/Home/default.latte",
      },
      [staleRoot]: {
        componentNames: [],
        expiresAt: 1,
        templateRelativePath: "app/UI/Home/default.latte",
      },
    },
    presenterCache: {
      [root]: { expiresAt: 1, targets: [] },
      [staleRoot]: { expiresAt: 1, targets: [] },
    },
    templateCache: {
      [root]: { expiresAt: 1, relativePaths: [] },
      [staleRoot]: { expiresAt: 1, relativePaths: [] },
    },
    templateTypeCache: {
      [root]: { expiresAt: 1, sightingsByTypeName: {} },
      [staleRoot]: { expiresAt: 1, sightingsByTypeName: {} },
    },
    viewDataCache: {
      [root]: { entries: [], expiresAt: 1 },
      [staleRoot]: { entries: [], expiresAt: 1 },
    },
  };
}

function cacheRoots(caches: LatteProviderFlowCaches) {
  return {
    componentCache: Object.keys(caches.componentCache),
    presenterCache: Object.keys(caches.presenterCache),
    templateCache: Object.keys(caches.templateCache),
    templateTypeCache: Object.keys(caches.templateTypeCache),
    viewDataCache: Object.keys(caches.viewDataCache),
  };
}
