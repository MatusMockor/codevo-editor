import { describe, expect, it, vi } from "vitest";
import type { LatteIntelligenceDependencies } from "./latteIntelligenceContracts";
import type { LatteProviderFlowFactoryOptions } from "./latteProviderFlowContext";
import type { LatteProviderRequestContext } from "./latteProviderRequestContext";
import { latteExpressionResolutionContext } from "./netteLatteProviderOptions";
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
  });
});

function requestContext(
  currentTemplateRelativePath: string,
): LatteProviderRequestContext {
  return {
    currentTemplateRelativePath,
    deps: dependencies(),
    isRequestedRootActive: () => true,
    requestedRoot: "/workspace",
  };
}

function options(): LatteProviderFlowFactoryOptions {
  return {
    caches: {
      componentCache: {},
      filterCache: {},
      presenterCache: {},
      templateCache: {},
      templateTypeCache: {},
      viewDataCache: {},
    },
    frameworkCapabilities: {
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
    getDependencies: dependencies,
    inFlight: {
      filterInFlight: new Map(),
      presenterInFlight: new Map(),
      templateTypeInFlight: new Map(),
      viewDataInFlight: new Map(),
    },
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
