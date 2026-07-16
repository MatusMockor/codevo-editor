import { describe, expect, it, vi } from "vitest";
import {
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import type { LatteIntelligenceDependencies } from "./latteIntelligenceContracts";
import { createLatteFrameworkCapabilities } from "./latteFrameworkCapabilities";
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
const netteFrameworkIntelligence = createPhpFrameworkIntelligence({
  matchedProviderIds: [phpNetteFrameworkProvider.id],
  profile: "nette",
  providers: [phpNetteFrameworkProvider],
});
const laravelFrameworkIntelligence = createPhpFrameworkIntelligence({
  matchedProviderIds: [phpLaravelFrameworkProvider.id],
  profile: "laravel",
  providers: [phpLaravelFrameworkProvider],
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
      filterCache: [root],
      factoryTemplateOwnerCache: [root],
      includeArgumentCache: [root],
      presenterCache: [root],
      presenterMappingCache: [root],
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

  it("loads a factory template owner through captured workspace dependencies", async () => {
    const factoryPath = `${root}/app/UI/Home/HomeFactory.php`;
    const ownerPath = `${root}/vendor/acme/Widget.php`;
    const factorySource = String.raw`<?php
namespace App\UI\Home;
use Acme\Widget;
class HomeFactory {
    public function create(): Widget {
        $widget = new Widget();
        $widget->setTemplateFile(__DIR__ . '/default.latte');
        return $widget;
    }
}`;
    const ownerSource = String.raw`<?php
namespace Acme;
class Widget {}`;
    const request = latteProviderRequestContext(
      options(
        deps({
          frameworkIntelligence: netteFrameworkIntelligence,
          readFileContent: vi.fn(async (path) =>
            path === ownerPath ? ownerSource : factorySource,
          ),
          resolvePhpClassSourcePaths: vi.fn(async () => [ownerPath]),
          searchText: vi.fn(async () => [{ path: factoryPath }]),
        }),
        providerCaches(),
      ),
    );

    await expect(
      request?.loadFactoryTemplateOwner(
        `${root}/app/UI/Home/default.latte`,
      ),
    ).resolves.toMatchObject({
      className: "Acme\\Widget",
      path: ownerPath,
      source: ownerSource,
    });
  });

  it("does not discover factory owners for a custom Latte provider", async () => {
    const readFileContent = vi.fn(async () => "");
    const resolvePhpClassSourcePaths = vi.fn(async () => []);
    const searchText = vi.fn(async () => []);
    const request = latteProviderRequestContext(
      options(
        deps({
          readFileContent,
          resolvePhpClassSourcePaths,
          searchText,
        }),
        providerCaches(),
      ),
    );

    await expect(
      request?.loadFactoryTemplateOwner(
        `${root}/app/UI/Home/default.latte`,
      ),
    ).resolves.toBeNull();
    expect(searchText).not.toHaveBeenCalled();
    expect(readFileContent).not.toHaveBeenCalled();
    expect(resolvePhpClassSourcePaths).not.toHaveBeenCalled();
  });

  it("does not run factory-owner discovery for Laravel-only projects", () => {
    const readFileContent = vi.fn(async () => "");
    const resolvePhpClassSourcePaths = vi.fn(async () => []);
    const searchText = vi.fn(async () => []);
    const request = latteProviderRequestContext(
      options(
        deps({
          frameworkIntelligence: laravelFrameworkIntelligence,
          readFileContent,
          resolvePhpClassSourcePaths,
          searchText,
        }),
        providerCaches(),
      ),
    );

    expect(request).toBeNull();
    expect(searchText).not.toHaveBeenCalled();
    expect(readFileContent).not.toHaveBeenCalled();
    expect(resolvePhpClassSourcePaths).not.toHaveBeenCalled();
  });

  it("returns null and clears stale caches when no workspace root is requested", () => {
    const caches = providerCaches();
    const request = latteProviderRequestContext(
      options(deps({ workspaceRoot: null }), caches),
    );

    expect(request).toBeNull();
    expect(cacheRoots(caches)).toEqual({
      componentCache: [],
      filterCache: [],
      factoryTemplateOwnerCache: [],
      includeArgumentCache: [],
      presenterCache: [],
      presenterMappingCache: [],
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
    collectTranslationTargets: vi.fn(async () => []),
    currentWorkspaceRootRef: { current: root },
    findTranslationTarget: vi.fn(async () => null),
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
    frameworkCapabilities: createLatteFrameworkCapabilities(
      () => frameworkIntelligence.providers,
    ),
    getDependencies: () => dependencies,
    inFlight: {
      filterInFlight: new Map(),
      factoryTemplateOwnerInFlight: new Map(),
      includeArgumentInFlight: { graphs: new Map(), queries: new Map() },
      presenterInFlight: new Map(),
      presenterMappingInFlight: new Map(),
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
    filterCache: {
      [root]: { expiresAt: 1, registrations: [] },
      [staleRoot]: { expiresAt: 1, registrations: [] },
    },
    factoryTemplateOwnerCache: {
      [root]: { dependencyPaths: [], ownersByTemplatePath: {} },
      [staleRoot]: { dependencyPaths: [], ownersByTemplatePath: {} },
    },
    factoryTemplateOwnerGeneration: {
      next: 2,
      roots: { [root]: 1, [staleRoot]: 2 },
    },
    includeArgumentCache: {
      [root]: includedArgumentEntry(),
      [staleRoot]: includedArgumentEntry(),
    },
    includeArgumentGenerationByRoot: {},
    presenterCache: {
      [root]: { expiresAt: 1, targets: [] },
      [staleRoot]: { expiresAt: 1, targets: [] },
    },
    presenterMappingCache: {
      [root]: { expiresAt: 1, mappings: [] },
      [staleRoot]: { expiresAt: 1, mappings: [] },
    },
    presenterMappingGeneration: {
      next: 2,
      roots: { [root]: 1, [staleRoot]: 2 },
    },
    templateCache: {
      [root]: { complete: true, expiresAt: 1, relativePaths: [] },
      [staleRoot]: { complete: true, expiresAt: 1, relativePaths: [] },
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
    filterCache: Object.keys(caches.filterCache),
    factoryTemplateOwnerCache: Object.keys(caches.factoryTemplateOwnerCache),
    includeArgumentCache: Object.keys(caches.includeArgumentCache),
    presenterCache: Object.keys(caches.presenterCache),
    presenterMappingCache: Object.keys(caches.presenterMappingCache),
    templateCache: Object.keys(caches.templateCache),
    templateTypeCache: Object.keys(caches.templateTypeCache),
    viewDataCache: Object.keys(caches.viewDataCache),
  };
}

function includedArgumentEntry() {
  return {
    generation: 0,
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
