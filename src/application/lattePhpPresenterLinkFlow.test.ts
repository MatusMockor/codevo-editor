import { describe, expect, it, vi } from "vitest";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import {
  createLattePhpPresenterLinkFlow,
  type LattePhpPresenterLinkFlowDriver,
} from "./lattePhpPresenterLinkFlow";
import type { LatteFrameworkCapabilities } from "./latteIntelligenceContracts";
import type { LatteProviderFlowFactoryOptions } from "./latteProviderFlowContext";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";

const ROOT = "/ws";
const FRAMEWORK_PROVIDER: PhpFrameworkProvider = {
  id: "latte-presenter-links",
  latte: {
    supportsPresenterLinkIntelligence: true,
    supportsTemplateIntelligence: true,
  },
};

describe("createLattePhpPresenterLinkFlow", () => {
  it("binds provider options once and keeps Nette aliases on the generic PHP presenter-link flow", async () => {
    const options = factoryOptions();
    const completions = [
      {
        insertText: "Product:show",
        kind: "link" as const,
        label: "Product:show",
      },
    ];
    const driver: LattePhpPresenterLinkFlowDriver = {
      isPhpPresenterLinkCompletionContext: vi.fn(() => true),
      providePhpPresenterLinkCompletions: vi.fn(async () => completions),
      providePhpPresenterLinkDefinition: vi.fn(async () => true),
    };
    const flow = createLattePhpPresenterLinkFlow(options, driver);
    const source = "$this->link('Product:show');";
    const offset = source.indexOf("Product:show");

    await expect(
      flow.providePhpPresenterLinkCompletions(source, offset),
    ).resolves.toBe(completions);
    await expect(
      flow.provideNettePhpLinkCompletions(source, offset),
    ).resolves.toBe(completions);
    await expect(
      flow.providePhpPresenterLinkDefinition(source, offset),
    ).resolves.toBe(true);
    await expect(
      flow.provideNettePhpLinkDefinition(source, offset),
    ).resolves.toBe(true);
    expect(flow.isPhpPresenterLinkCompletionContext(source, offset)).toBe(true);

    expect(driver.providePhpPresenterLinkCompletions).toHaveBeenCalledWith(
      options,
      source,
      offset,
    );
    expect(driver.providePhpPresenterLinkCompletions).toHaveBeenCalledTimes(2);
    expect(driver.providePhpPresenterLinkDefinition).toHaveBeenCalledWith(
      options,
      source,
      offset,
    );
    expect(driver.providePhpPresenterLinkDefinition).toHaveBeenCalledTimes(2);
    expect(driver.isPhpPresenterLinkCompletionContext).toHaveBeenCalledWith(
      options,
      source,
      offset,
    );
  });
});

function factoryOptions(): LatteProviderFlowFactoryOptions {
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
    frameworkCapabilities: frameworkCapabilities(),
    getDependencies: () => ({
      collectTranslationTargets: vi.fn(async () => []),
      currentWorkspaceRootRef: { current: ROOT },
      findTranslationTarget: vi.fn(async () => null),
      frameworkIntelligence: createPhpFrameworkIntelligence({
        matchedProviderIds: [FRAMEWORK_PROVIDER.id],
        profile: "generic",
        providers: [FRAMEWORK_PROVIDER],
      }),
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
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
        source: `${variableName}:${typeName}`,
      }),
      toRelativePath: (rootPath, path) =>
        path.startsWith(`${rootPath}/`) ? path.slice(rootPath.length + 1) : path,
      workspaceRoot: ROOT,
    }),
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

function frameworkCapabilities(): LatteFrameworkCapabilities {
  return {
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
  };
}
