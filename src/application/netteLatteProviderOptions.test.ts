import { describe, expect, it, vi } from "vitest";
import type { LatteIntelligenceDependencies } from "./latteIntelligenceContracts";
import {
  evictLatteProviderCaches,
  type LatteProviderFlowFactoryOptions,
} from "./latteProviderFlowContext";
import type { LatteProviderRequestContext } from "./latteProviderRequestContext";
import {
  latteFilterDiscoveryContext,
  latteExpressionResolutionContext,
  latteTemplateCompletionContext,
} from "./netteLatteProviderOptions";
import { createLatteProviderFlows } from "./latteProviderFlows";
import { loadLatteFilterRegistrations } from "./latteFilterDiscovery";
import { listLatteTemplateRelativePaths } from "./netteTemplateDiscovery";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";

describe("latteExpressionResolutionContext", () => {
  it("defaults to the request path and derives immutable template contexts", () => {
    const request = requestContext("app/UI/Home/default.latte");
    const context = latteExpressionResolutionContext(options(), request);
    const derived = context.forTemplate("app/UI/Admin/default.latte");

    expect(context.currentTemplateRelativePath).toBe(
      "app/UI/Home/default.latte",
    );
    expect(derived.currentTemplateRelativePath).toBe(
      "app/UI/Admin/default.latte",
    );
    expect(context.currentTemplateRelativePath).toBe(
      "app/UI/Home/default.latte",
    );
    expect(derived).not.toBe(context);
    expect(derived.requestedRoot).toBe(context.requestedRoot);
    expect(derived.deps).toBe(context.deps);
    expect(derived.viewDataCache).toBe(context.viewDataCache);
    expect(derived.isRequestedRootActive).toBe(
      context.isRequestedRootActive,
    );
    expect(context.loadFactoryTemplateOwner).toBe(
      request.loadFactoryTemplateOwner,
    );
    expect(derived.loadFactoryTemplateOwner).toBe(
      request.loadFactoryTemplateOwner,
    );
  });

  it("canonicalizes equivalent include cache and generation roots", () => {
    const flowOptions = options();
    const entry = includeArgumentCacheEntry(2);
    flowOptions.caches.includeArgumentCache["/workspace/"] = entry;
    flowOptions.caches.includeArgumentGenerationByRoot["/workspace/"] = 2;

    latteExpressionResolutionContext(
      flowOptions,
      requestContext("app/UI/Home/default.latte"),
    );

    expect(flowOptions.caches.includeArgumentCache).toEqual({
      "/workspace": entry,
    });
    expect(flowOptions.caches.includeArgumentGenerationByRoot).toEqual({
      "/workspace": 2,
    });
  });

  it("loads included arguments from the complete template cache", async () => {
    const caller = "app/UI/Home/default.latte";
    const target = "app/UI/Home/partial.latte";
    const files: Record<string, string> = {
      [caller]:
        "{varType App\\Model\\Product $product}\n" +
        "{include 'partial.latte', product: $product}",
      [target]: "{$product}",
    };
    const deps = dependencies();
    deps.readFileContent = vi.fn(async (path) => {
      const relativePath = path.replace("/workspace/", "");
      return files[relativePath] ?? "";
    });
    const flowOptions = options(deps);
    flowOptions.caches.templateCache["/workspace"] = {
      complete: true,
      expiresAt: Number.POSITIVE_INFINITY,
      relativePaths: [caller, target],
    };
    const context = latteExpressionResolutionContext(
      flowOptions,
      requestContext(target, deps),
    );

    const [argument] = await context.loadIncludedTemplateArguments(target);

    expect(argument).toMatchObject({
      expression: "$product",
      name: "product",
      sourceTemplateRelativePath: caller,
      targetTemplateRelativePath: target,
      type: "App\\Model\\Product",
    });
    expect(deps.listDirectory).not.toHaveBeenCalled();
  });

  it("does not let an invalidated graph scan repopulate its root cache", async () => {
    let resolveRead!: (source: string) => void;
    const pendingRead = new Promise<string>((resolve) => {
      resolveRead = resolve;
    });
    const deps = dependencies();
    deps.readFileContent = vi.fn(() => pendingRead);
    const flowOptions = options(deps);
    const target = "app/UI/Home/partial.latte";
    flowOptions.caches.templateCache["/workspace"] = {
      complete: true,
      expiresAt: Number.POSITIVE_INFINITY,
      relativePaths: [target],
    };
    const context = latteExpressionResolutionContext(
      flowOptions,
      requestContext(target, deps),
    );
    const load = context.loadIncludedTemplateArguments(target);
    await vi.waitFor(() => expect(deps.readFileContent).toHaveBeenCalledOnce());

    createLatteProviderFlows(
      flowOptions,
    ).invalidateLatteExpressionDataForPath(
      "/workspace",
      "/workspace/app/Presenters/HomePresenter.php",
    );
    resolveRead("{$product}");

    await expect(load).resolves.toEqual([]);
    expect(flowOptions.caches.includeArgumentCache["/workspace"]).toBeUndefined();
  });

  it("does not let an invalidated template scan repopulate its cache", async () => {
    let resolveDirectory!: (
      entries: Array<{ kind: "file"; path: string }>,
    ) => void;
    const pendingDirectory = new Promise<Array<{ kind: "file"; path: string }>>(
      (resolve) => {
        resolveDirectory = resolve;
      },
    );
    const deps = dependencies();
    deps.listDirectory = vi.fn(() => pendingDirectory);
    const flowOptions = options(deps);
    const request = requestContext(
      "app/UI/Home/default.latte",
      deps,
      "/workspace/",
    );
    const scan = listLatteTemplateRelativePaths(
      latteTemplateCompletionContext(flowOptions, request),
    );
    await vi.waitFor(() => expect(deps.listDirectory).toHaveBeenCalledOnce());

    createLatteProviderFlows(
      flowOptions,
    ).invalidateLatteExpressionDataForPath(
      "/workspace",
      "/workspace/app/UI/Home/changed.latte",
    );
    resolveDirectory([
      { kind: "file", path: "/workspace/app/UI/Home/stale.latte" },
    ]);

    await expect(scan).resolves.toEqual([]);
    expect(flowOptions.caches.templateCache).toEqual({});
    expect(flowOptions.caches.includeArgumentGenerationByRoot).toEqual({
      "/workspace": 1,
    });
  });

  it("does not let an invalidated PHP filter scan repopulate its cache", async () => {
    let resolveDirectory!: (
      entries: Array<{ kind: "file"; path: string }>,
    ) => void;
    const pendingDirectory = new Promise<Array<{ kind: "file"; path: string }>>(
      (resolve) => {
        resolveDirectory = resolve;
      },
    );
    const deps = dependencies();
    deps.listDirectory = vi.fn(() => pendingDirectory);
    const flowOptions = options(deps);
    const request = requestContext(
      "app/UI/Home/default.latte",
      deps,
      "/workspace/",
    );
    const scan = loadLatteFilterRegistrations(
      latteFilterDiscoveryContext(flowOptions, request),
    );
    await vi.waitFor(() => expect(deps.listDirectory).toHaveBeenCalledOnce());

    createLatteProviderFlows(
      flowOptions,
    ).invalidateLatteExpressionDataForPath(
      "/workspace",
      "/workspace/app/Latte/ProjectExtension.php",
    );
    resolveDirectory([
      {
        kind: "file",
        path: "/workspace/app/Latte/ProjectExtension.php",
      },
    ]);

    await expect(scan).resolves.toEqual([]);
    expect(flowOptions.caches.filterCache).toEqual({});
    expect(flowOptions.inFlight.filterInFlight).toEqual(new Map());
    expect(flowOptions.caches.includeArgumentGenerationByRoot).toEqual({
      "/workspace": 1,
    });
  });

  it("clears equivalent-root filter state for NEON invalidation", () => {
    const flowOptions = options();
    flowOptions.caches.filterCache["/workspace/"] = {
      expiresAt: Number.POSITIVE_INFINITY,
      registrations: [],
    };
    flowOptions.inFlight.filterInFlight.set(
      "/workspace/",
      Promise.resolve([]),
    );

    createLatteProviderFlows(flowOptions).invalidateLatteFilterDataForPath(
      "/workspace",
      "/workspace/app/config/config.neon",
    );

    expect(flowOptions.caches.filterCache).toEqual({});
    expect(flowOptions.inFlight.filterInFlight).toEqual(new Map());
    expect(flowOptions.caches.includeArgumentGenerationByRoot).toEqual({
      "/workspace": 1,
    });
  });

  it("starts a fresh A filter scan after a rapid A to B to A switch", async () => {
    let resolveOldA!: (
      entries: Array<{ kind: "file"; path: string }>,
    ) => void;
    const oldADirectory = new Promise<Array<{ kind: "file"; path: string }>>(
      (resolve) => {
        resolveOldA = resolve;
      },
    );
    const freshConfigPath = "/workspace-a/app/config.neon";
    const deps = dependencies();
    deps.listDirectory = vi
      .fn()
      .mockImplementationOnce(() => oldADirectory)
      .mockImplementationOnce(async () => [
        { kind: "file" as const, path: freshConfigPath },
      ])
      .mockImplementation(async () => []);
    deps.readFileContent = vi.fn(async () => `services:
  filterLoader:
    setup:
      - register('freshFilter', [@helper, process])
`);
    const flowOptions = options(deps);
    const oldA = loadLatteFilterRegistrations(
      latteFilterDiscoveryContext(
        flowOptions,
        requestContext("app/default.latte", deps, "/workspace-a/"),
      ),
    );
    await vi.waitFor(() => expect(deps.listDirectory).toHaveBeenCalledOnce());

    const bInFlight = Promise.resolve([]);
    flowOptions.inFlight.filterInFlight.set("/workspace-b/", bInFlight);
    evictLatteProviderCaches(
      flowOptions.caches,
      "/workspace-b",
      flowOptions.inFlight.includeArgumentInFlight,
      flowOptions.inFlight.filterInFlight,
      flowOptions.inFlight.factoryTemplateOwnerInFlight,
    );
    expect(flowOptions.inFlight.filterInFlight).toEqual(
      new Map([["/workspace-b/", bInFlight]]),
    );

    evictLatteProviderCaches(
      flowOptions.caches,
      "/workspace-a",
      flowOptions.inFlight.includeArgumentInFlight,
      flowOptions.inFlight.filterInFlight,
      flowOptions.inFlight.factoryTemplateOwnerInFlight,
    );
    const freshA = loadLatteFilterRegistrations(
      latteFilterDiscoveryContext(
        flowOptions,
        requestContext("app/default.latte", deps, "/workspace-a"),
      ),
    );

    await expect(freshA).resolves.toMatchObject([{ name: "freshFilter" }]);
    expect(deps.listDirectory).toHaveBeenCalledTimes(3);

    resolveOldA([
      { kind: "file", path: "/workspace-a/app/stale.neon" },
    ]);
    await expect(oldA).resolves.toEqual([]);
    expect(flowOptions.caches.filterCache["/workspace-a"]).toMatchObject({
      registrations: [expect.objectContaining({ name: "freshFilter" })],
    });
  });
});

function requestContext(
  currentTemplateRelativePath: string,
  deps = dependencies(),
  requestedRoot = "/workspace",
): LatteProviderRequestContext {
  return {
    currentTemplateRelativePath,
    deps,
    isRequestedRootActive: () => true,
    loadFactoryTemplateOwner: async () => null,
    requestedRoot,
  };
}

function options(
  deps: LatteIntelligenceDependencies = dependencies(),
): LatteProviderFlowFactoryOptions {
  return {
    caches: {
      componentCache: {},
      filterCache: {},
      factoryTemplateOwnerCache: {},
      factoryTemplateOwnerGeneration: { next: 0, roots: {} },
      includeArgumentCache: {},
      includeArgumentGenerationByRoot: {},
      presenterCache: {},
      presenterMappingCache: {},
      presenterMappingGeneration: { next: 0, roots: {} },
      templateCache: {},
      templateTypeCache: {},
      viewDataCache: {},
    },
    frameworkCapabilities: {
      supportsFactoryTemplateOwnerIntelligence: () => false,
      detectLattePresenterLinkAt: () => null,
      isPresenterSourcePath: () => false,
      lattePresenterLinkCompletionContextAt: () => null,
      parsePresenterLinkTarget: () => null,
      presenterActionMethodCandidates: () => [],
      presenterClassCandidatePathsForLink: () => [],
      presenterLinkTargetsFromSource: () => [],
      presenterScanDirectories: [],
      viewDataEntryFromSource: () => null,
      viewDataSearchQueries: () => [],
    },
    getDependencies: () => deps,
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

function includeArgumentCacheEntry(generation: number) {
  return {
    generation,
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

function dependencies(): LatteIntelligenceDependencies {
  return {
    collectTranslationTargets: vi.fn(async () => []),
    currentWorkspaceRootRef: { current: "/workspace" },
    findTranslationTarget: vi.fn(async () => null),
    frameworkIntelligence: createPhpFrameworkIntelligence({
      matchedProviderIds: [],
      profile: "generic",
      providers: [],
    }),
    getActiveDocument: () => ({ path: "/workspace/active.latte" }),
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
    synthesizeTypedReceiverSource: () => ({
      position: { column: 1, lineNumber: 1 },
      source: "<?php",
    }),
    toRelativePath: (_rootPath, path) => path,
    workspaceRoot: "/workspace",
  };
}
