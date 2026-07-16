import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PhpCodeActionContext } from "./phpCodeActionTypes";
import type { LatteProviderFlowFactoryOptions } from "./latteProviderFlowContext";
import { createLatteProviderFlows } from "./latteProviderFlows";
import {
  provideLatteCodeActions as provideLatteCodeActionsFlow,
} from "./latteTemplateCodeActions";

vi.mock("./latteTemplateCodeActions", () => ({
  provideLatteCodeActions: vi.fn(async () => []),
}));

describe("createLatteProviderFlows", () => {
  beforeEach(() => {
    vi.mocked(provideLatteCodeActionsFlow).mockClear();
  });

  it("forwards diagnostic context to the Latte code-action flow", async () => {
    const options = flowOptions();
    const range = { end: 17, start: 6 };
    const context: PhpCodeActionContext = {
      diagnostics: [
        {
          code: "nette.missingPresenterMethod",
          data: {
            candidateMethodNames: ["renderDetail"],
            kind: "missing-presenter-method",
            presenterPath: "/ws/app/UI/Home/HomePresenter.php",
            target: "Home:detail",
          },
          message: "Missing presenter method.",
          range: {
            endColumn: 18,
            endLineNumber: 1,
            startColumn: 7,
            startLineNumber: 1,
          },
          source: "Nette",
        },
      ],
    };

    await createLatteProviderFlows(options).provideLatteCodeActions(
      "{link Home:detail}",
      range,
      context,
    );

    expect(provideLatteCodeActionsFlow).toHaveBeenCalledWith(
      options,
      "{link Home:detail}",
      range,
      context,
    );
  });

  it("invalidates Latte expression state per root and ignores unrelated files", () => {
    const options = flowOptions();
    const otherRoot = "/other";
    options.caches.includeArgumentGenerationByRoot = {
      "/workspace/": 4,
      [otherRoot]: 7,
    };
    options.caches.includeArgumentCache = {
      "/workspace/": includeArgumentEntry(4),
      [otherRoot]: includeArgumentEntry(7),
    };
    options.caches.templateCache = {
      "/workspace/": templateEntry(),
      [otherRoot]: templateEntry(),
    };
    options.caches.templateTypeCache = {
      "/workspace/": { expiresAt: 1, sightingsByTypeName: {} },
      [otherRoot]: { expiresAt: 1, sightingsByTypeName: {} },
    };
    options.caches.viewDataCache = {
      "/workspace/": { entries: [], expiresAt: 1 },
      [otherRoot]: { entries: [], expiresAt: 1 },
    };
    options.inFlight.includeArgumentInFlight.graphs.set(
      `/workspace/\0${4}`,
      Promise.resolve(null),
    );
    options.inFlight.includeArgumentInFlight.graphs.set(
      `${otherRoot}\0${7}`,
      Promise.resolve(null),
    );
    const flows = createLatteProviderFlows(options);

    flows.invalidateLatteExpressionDataForPath(
      "/workspace",
      "/workspace/app/UI/Home/default.latte",
    );

    expect(options.caches.includeArgumentGenerationByRoot).toEqual({
      "/workspace": 5,
      [otherRoot]: 7,
    });
    expect(Object.keys(options.caches.includeArgumentCache)).toEqual([
      otherRoot,
    ]);
    expect(Object.keys(options.caches.templateCache)).toEqual([otherRoot]);
    expect(Object.keys(options.caches.templateTypeCache)).toEqual([otherRoot]);
    expect(Object.keys(options.caches.viewDataCache)).toEqual([otherRoot]);
    expect(
      Array.from(options.inFlight.includeArgumentInFlight.graphs.keys()),
    ).toEqual([`${otherRoot}\0${7}`]);

    flows.invalidateLatteExpressionDataForPath(
      "/workspace",
      "/workspace/README.md",
    );
    expect(options.caches.includeArgumentGenerationByRoot["/workspace"]).toBe(
      5,
    );
  });

  it("invalidates presenter mapping and completion state for PHP and NEON", () => {
    const options = flowOptions();
    options.caches.presenterCache["/workspace"] = {
      expiresAt: 1,
      targets: ["Home:default"],
    };
    options.caches.presenterMappingCache["/workspace"] = {
      expiresAt: 1,
      mappings: [],
    };
    options.caches.presenterMappingGeneration.roots["/workspace"] = 1;
    options.caches.factoryTemplateOwnerCache["/workspace"] = {
      dependencyPaths: ["/workspace/app/Factory.php"],
      ownersByTemplatePath: {},
    };
    options.caches.factoryTemplateOwnerGeneration.roots["/workspace"] = 1;
    const flows = createLatteProviderFlows(options);

    flows.invalidateLatteExpressionDataForPath(
      "/workspace",
      "/workspace/app/DI/Extension.php",
    );

    expect(options.caches.presenterCache).toEqual({});
    expect(options.caches.presenterMappingCache).toEqual({});
    expect(options.caches.presenterMappingGeneration.roots["/workspace"])
      .toBeGreaterThan(1);
    expect(options.caches.factoryTemplateOwnerCache).toEqual({});
    expect(options.caches.factoryTemplateOwnerGeneration.roots["/workspace"])
      .toBeGreaterThan(1);

    options.caches.presenterMappingCache["/workspace"] = {
      expiresAt: 1,
      mappings: [],
    };
    flows.invalidateNettePresenterMappingDataForPath(
      "/workspace",
      "/workspace/app/config/config.neon",
    );

    expect(options.caches.presenterMappingCache).toEqual({});
  });
});

function includeArgumentEntry(generation: number) {
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

function templateEntry() {
  return { complete: true, expiresAt: 1, relativePaths: [] };
}

function flowOptions(): LatteProviderFlowFactoryOptions {
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
    frameworkCapabilities: {} as never,
    getDependencies: vi.fn(),
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
