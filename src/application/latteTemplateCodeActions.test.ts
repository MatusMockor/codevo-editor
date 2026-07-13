import { describe, expect, it, vi } from "vitest";
import {
  nettePresenterActionMethodCandidates,
  nettePresenterClassCandidatePathsForLink,
  parseNetteLinkTarget,
} from "../domain/latteLinkNavigation";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import type { LatteIntelligenceDependencies } from "./latteIntelligenceContracts";
import type { LatteProviderFlowFactoryOptions } from "./latteProviderFlowContext";
import { provideLatteCodeActions } from "./latteTemplateCodeActions";
import { nettePresenterLinkDiagnostics } from "./nettePresenterLinkDiagnostics";
import type { PhpCodeActionContext } from "./phpCodeActionTypes";

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

  it("creates presenter-method actions from Nette missing-method diagnostics", async () => {
    const source = "{link Home:detail}";
    const presenterPath = "/ws/app/UI/Home/HomePresenter.php";
    const actions = await provideLatteCodeActions(
      makeOptions({
        readFileContent: async (path) => {
          if (path === presenterPath) {
            return `<?php

use Nette\\Application\\UI\\Presenter;

class HomePresenter extends Presenter
{
}
`;
          }

          throw new Error("missing file");
        },
      }),
      source,
      {
        end: source.indexOf("detail") + "detail".length,
        start: source.indexOf("detail"),
      },
      {
        diagnostics: [
          {
            code: "nette.missingPresenterMethod",
            data: {
              candidateMethodNames: ["actionDetail", "renderDetail"],
              kind: "missing-presenter-method",
              presenterPath,
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
      },
    );

    expect(actions.map((action) => action.title)).toEqual([
      "Create actionDetail",
      "Create renderDetail",
    ]);
    expect(actions[0]).toMatchObject({
      isPreferred: true,
      kind: "quickfix",
    });
    expect(actions[0]?.edits[0]).toEqual(
      expect.objectContaining({
        path: presenterPath,
        text: expect.stringContaining("public function actionDetail()"),
      }),
    );
  });

  it("turns Nette missing-method diagnostics into presenter-method code actions", async () => {
    const source = "{link Home:detail}";
    const presenterPath = "/ws/app/UI/Home/HomePresenter.php";
    const presenterSource = `<?php

use Nette\\Application\\UI\\Presenter;

class HomePresenter extends Presenter
{
}
`;
    const diagnostics = await nettePresenterLinkDiagnostics(
      {
        currentRelativePath: "app/UI/Home/default.latte",
        deps: {
          joinPath: (root, relativePath) => `${root}/${relativePath}`,
          readFileContent: async (path) => {
            if (path === presenterPath) {
              return presenterSource;
            }

            throw new Error(`missing ${path}`);
          },
        },
        frameworkCapabilities: {
          parsePresenterLinkTarget: parseNetteLinkTarget,
          presenterActionMethodCandidates: nettePresenterActionMethodCandidates,
          presenterClassCandidatePathsForLink:
            nettePresenterClassCandidatePathsForLink,
        },
        isRequestedRootActive: () => true,
        requestedRoot: ROOT,
      },
      source,
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("nette.missingPresenterMethod");

    const actions = await provideLatteCodeActions(
      makeOptions({
        readFileContent: async (path) => {
          if (path === presenterPath) {
            return presenterSource;
          }

          throw new Error(`missing ${path}`);
        },
      }),
      source,
      {
        end: source.indexOf("detail") + "detail".length,
        start: source.indexOf("detail"),
      },
      codeActionContextFromDiagnostics(diagnostics),
    );

    expect(actions.map((action) => action.title)).toEqual([
      "Create actionDetail",
      "Create renderDetail",
    ]);
    expect(actions[0]).toMatchObject({
      isPreferred: true,
      kind: "quickfix",
    });
    expect(actions[0]?.edits[0]).toEqual(
      expect.objectContaining({
        path: presenterPath,
        text: expect.stringContaining("public function actionDetail()"),
      }),
    );
  });

  it("does not create presenter-method actions outside the diagnostic range", async () => {
    const source = "{link Home:detail}";
    const presenterPath = "/ws/app/UI/Home/HomePresenter.php";
    const actions = await provideLatteCodeActions(
      makeOptions({
        readFileContent: async () => {
          throw new Error("should not read presenter");
        },
      }),
      source,
      {
        end: source.indexOf("Home") + "Home".length,
        start: source.indexOf("Home"),
      },
      {
        diagnostics: [
          {
            code: "nette.missingPresenterMethod",
            data: {
              candidateMethodNames: ["renderDetail"],
              kind: "missing-presenter-method",
              presenterPath,
              target: "Home:detail",
            },
            message: "Missing presenter method.",
            range: {
              endColumn: 18,
              endLineNumber: 1,
              startColumn: 12,
              startLineNumber: 1,
            },
            source: "Nette",
          },
        ],
      },
    );

    expect(actions).toEqual([]);
  });

  it("does not create presenter-method actions for stale diagnostic targets", async () => {
    const source = "{link Home:other}";
    const presenterPath = "/ws/app/UI/Home/HomePresenter.php";
    const readFileContent = vi.fn(async () => `<?php

use Nette\\Application\\UI\\Presenter;

class HomePresenter extends Presenter
{
}
`);
    const actions = await provideLatteCodeActions(
      makeOptions({ readFileContent }),
      source,
      {
        end: source.indexOf("other") + "other".length,
        start: source.indexOf("other"),
      },
      {
        diagnostics: [
          {
            code: "nette.missingPresenterMethod",
            data: {
              candidateMethodNames: ["renderDetail"],
              kind: "missing-presenter-method",
              presenterPath,
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
      },
    );

    expect(actions).toEqual([]);
    expect(readFileContent).not.toHaveBeenCalledWith(presenterPath);
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

function codeActionContextFromDiagnostics(
  diagnostics: readonly LanguageServerDiagnostic[],
): PhpCodeActionContext {
  return {
    diagnostics: diagnostics.map((diagnostic) => ({
      ...(diagnostic.code ? { code: diagnostic.code } : {}),
      ...(diagnostic.data ? { data: diagnostic.data } : {}),
      ...(diagnostic.source ? { source: diagnostic.source } : {}),
      message: diagnostic.message,
      range: {
        endColumn: (diagnostic.endCharacter ?? diagnostic.character) + 1,
        endLineNumber: (diagnostic.endLine ?? diagnostic.line) + 1,
        startColumn: diagnostic.character + 1,
        startLineNumber: diagnostic.line + 1,
      },
    })),
  };
}
