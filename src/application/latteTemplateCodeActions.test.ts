import { describe, expect, it, vi } from "vitest";
import type { LatteIntelligenceDependencies } from "./latteIntelligenceContracts";
import type { LatteProviderFlowFactoryOptions } from "./latteProviderFlowContext";
import { provideLatteCodeActions } from "./latteTemplateCodeActions";

const ROOT = "/ws";
const TEMPLATE_PATH = `${ROOT}/app/UI/Home/default.latte`;

function makeOptions(
  overrides: {
    currentRoot?: string | null;
    currentWorkspaceRootRef?: { current: string | null };
    readFileContent?: (path: string) => Promise<string>;
    relativePaths?: string[];
    workspaceRoot?: string | null;
  } = {},
): LatteProviderFlowFactoryOptions {
  const workspaceRoot = overrides.workspaceRoot ?? ROOT;
  const currentWorkspaceRootRef =
    overrides.currentWorkspaceRootRef ??
    ({ current: overrides.currentRoot === undefined ? ROOT : overrides.currentRoot });
  const deps: LatteIntelligenceDependencies = {
    currentWorkspaceRootRef,
    frameworkIntelligence: {
      activityLabel: null,
      capabilities: {
        hasProvider: () => true,
        providerSignature: "nette",
        supports: (capability) => capability === "latteTemplateIntelligence",
        supportsTargetCollection: () => false,
      },
      hasProvider: () => true,
      isLaravel: false,
      isNette: true,
      matchedProviderIds: ["nette"],
      profile: "nette",
      providerIds: ["nette"],
      providerSignature: "nette",
      providers: [],
    },
    getActiveDocument: () => ({ path: TEMPLATE_PATH }),
    isSemanticIntelligenceActive: true,
    joinPath: (rootPath, relativePath) => `${rootPath}/${relativePath}`,
    listDirectory: vi.fn(async () => []),
    openPhpMethodTarget: vi.fn(async () => false),
    openPhpPropertyTarget: vi.fn(async () => false),
    openTarget: vi.fn(async () => false),
    readFileContent:
      overrides.readFileContent ??
      vi.fn(async () => {
        throw new Error("missing file");
      }),
    resolveDeclaredType: () => null,
    resolveExpressionType: vi.fn(async () => null),
    resolvePhpReceiverCompletions: vi.fn(async () => []),
    searchText: vi.fn(async () => []),
    synthesizeTypedReceiverSource: () => ({
      position: { column: 1, lineNumber: 1 },
      source: "",
    }),
    toRelativePath: (rootPath, path) =>
      path.startsWith(`${rootPath}/`) ? path.slice(rootPath.length + 1) : path,
    workspaceRoot,
  };

  return {
    caches: {
      componentCache: {},
      presenterCache: {},
      templateCache: {
        [ROOT]: {
          complete: true,
          expiresAt: Date.now() + 60_000,
          relativePaths: overrides.relativePaths ?? [
            "app/UI/Home/default.latte",
          ],
        },
      },
      templateTypeCache: {},
      viewDataCache: {},
    },
    frameworkCapabilities: {} as never,
    getDependencies: () => deps,
    inFlight: {
      presenterInFlight: new Map(),
      templateTypeInFlight: new Map(),
      viewDataInFlight: new Map(),
    },
  };
}

describe("provideLatteCodeActions", () => {
  it("creates a missing Latte template action for a static include", async () => {
    const source = "{include 'partials/menu'}";
    const actions = await provideLatteCodeActions(makeOptions(), source, {
      end: source.indexOf("menu") + "menu".length,
      start: source.indexOf("menu"),
    });

    expect(actions).toEqual([
      {
        edits: [],
        isPreferred: true,
        kind: "quickfix",
        newFile: {
          content: "",
          path: "/ws/app/UI/Home/partials/menu.latte",
          title: "Create Latte Template",
        },
        title: "Create Latte template partials/menu",
      },
    ]);
  });

  it("keeps existing missing-template actions unchanged when diagnostics are supplied", async () => {
    const source = "{include 'partials/menu'}";
    const actions = await provideLatteCodeActions(
      makeOptions(),
      source,
      {
        end: source.indexOf("menu") + "menu".length,
        start: source.indexOf("menu"),
      },
      {
        diagnostics: [
          {
            code: "nette.missingPresenterMethod",
            data: {
              candidateMethodNames: ["renderMenu"],
              kind: "missing-presenter-method",
              presenterPath: "/ws/app/UI/Home/HomePresenter.php",
              target: "Home:menu",
            },
            message: "Missing presenter method.",
            range: {
              endColumn: 22,
              endLineNumber: 1,
              startColumn: 11,
              startLineNumber: 1,
            },
            source: "Nette",
          },
        ],
      },
    );

    expect(actions).toEqual([
      {
        edits: [],
        isPreferred: true,
        kind: "quickfix",
        newFile: {
          content: "",
          path: "/ws/app/UI/Home/partials/menu.latte",
          title: "Create Latte Template",
        },
        title: "Create Latte template partials/menu",
      },
    ]);
  });

  it("does not create an action when an indexed candidate already exists", async () => {
    const source = "{include 'partials/menu'}";
    const actions = await provideLatteCodeActions(
      makeOptions({
        relativePaths: [
          "app/UI/Home/default.latte",
          "app/UI/Home/partials/menu.latte",
        ],
      }),
      source,
      {
        end: source.indexOf("menu") + "menu".length,
        start: source.indexOf("menu"),
      },
    );

    expect(actions).toEqual([]);
  });

  it("does not create an action when the target file already exists on disk", async () => {
    const source = "{include 'partials/menu'}";
    const actions = await provideLatteCodeActions(
      makeOptions({ readFileContent: vi.fn(async () => "body") }),
      source,
      {
        end: source.indexOf("menu") + "menu".length,
        start: source.indexOf("menu"),
      },
    );

    expect(actions).toEqual([]);
  });

  it("drops the action when the workspace root changes before the file probe resolves", async () => {
    const source = "{include 'partials/menu'}";
    const currentWorkspaceRootRef = { current: ROOT };
    const options = makeOptions({
      currentWorkspaceRootRef,
      readFileContent: async () => {
        currentWorkspaceRootRef.current = "/other";
        throw new Error("missing file");
      },
    });
    const actions = await provideLatteCodeActions(options, source, {
      end: source.indexOf("menu") + "menu".length,
      start: source.indexOf("menu"),
    });

    expect(actions).toEqual([]);
  });
});
