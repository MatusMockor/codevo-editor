// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { LanguageServerFeaturesGateway } from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { emptyLanguageServerCapabilities } from "../domain/languageServerRuntime";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import {
  createWorkspaceRuntimeOwner,
  transferWorkspaceRuntimeOwner,
  type WorkspaceRuntimeOwner,
} from "../domain/workspaceRuntimeOwner";
import {
  useWorkbenchLanguageNavigation,
  type WorkbenchLanguageNavigation,
  type WorkbenchLanguageNavigationDependencies,
} from "./useWorkbenchLanguageNavigation";
import type { NavigationRequest } from "./navigationRequest";

const ROOT = "/workspace";

function offsetAtPosition(source: string, position: { column: number; lineNumber: number }) {
  const lines = source.split("\n");
  let offset = 0;

  for (let index = 0; index < position.lineNumber - 1; index += 1) {
    offset += (lines[index] ?? "").length + 1;
  }

  return offset + position.column - 1;
}

function positionAtNeedle(source: string, needle: string) {
  const offset = source.indexOf(needle);
  const before = source.slice(0, offset);
  const lineNumber = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: offset - lineStart + 1, lineNumber };
}

function languageServerGateway(): LanguageServerFeaturesGateway {
  return {
    codeActions: vi.fn(async () => []),
    codeLenses: vi.fn(async () => []),
    completion: vi.fn(async () => ({ isIncomplete: false, items: [] })),
    declaration: vi.fn(async () => []),
    definition: vi.fn(async () => []),
    didChangeConfiguration: vi.fn(async () => undefined),
    didChangeWatchedFiles: vi.fn(async () => undefined),
    didCreateFiles: vi.fn(async () => undefined),
    didDeleteFiles: vi.fn(async () => undefined),
    didRenameFiles: vi.fn(async () => undefined),
    documentHighlights: vi.fn(async () => []),
    documentLinks: vi.fn(async () => []),
    documentSymbols: vi.fn(async () => []),
    executeCommand: vi.fn(async () => null),
    executeCommandLocations: vi.fn(async () => []),
    foldingRanges: vi.fn(async () => []),
    formatting: vi.fn(async () => []),
    hover: vi.fn(async () => null),
    implementation: vi.fn(async () => []),
    incomingCalls: vi.fn(async () => []),
    inlayHints: vi.fn(async () => []),
    linkedEditingRanges: vi.fn(async () => null),
    onTypeFormatting: vi.fn(async () => []),
    outgoingCalls: vi.fn(async () => []),
    prepareCallHierarchy: vi.fn(async () => []),
    prepareRename: vi.fn(async () => null),
    prepareTypeHierarchy: vi.fn(async () => []),
    rangeFormatting: vi.fn(async () => []),
    rangeSemanticTokens: vi.fn(async () => null),
    references: vi.fn(async () => []),
    rename: vi.fn(async () => null),
    resolveCodeAction: vi.fn(async (action) => action),
    resolveCodeLens: vi.fn(async (lens) => lens),
    resolveCompletionItem: vi.fn(async (item) => item),
    resolveDocumentLink: vi.fn(async (link) => link),
    resolveInlayHint: vi.fn(async (hint) => hint),
    selectionRanges: vi.fn(async () => []),
    semanticTokens: vi.fn(async () => null),
    signatureHelp: vi.fn(async () => null),
    sourceDefinition: vi.fn(async () => []),
    typeDefinition: vi.fn(async () => []),
    typeHierarchySubtypes: vi.fn(async () => []),
    typeHierarchySupertypes: vi.fn(async () => []),
    willCreateFiles: vi.fn(async () => null),
    willDeleteFiles: vi.fn(async () => null),
    willRenameFiles: vi.fn(async () => null),
    workspaceSymbols: vi.fn(async () => []),
  };
}

function workspaceFiles(): WorkspaceFileGateway {
  return {
    applyWorkspaceEdit: vi.fn(async () => 0),
    createDirectory: vi.fn(async () => undefined),
    createTextFile: vi.fn(async () => undefined),
    deletePath: vi.fn(async () => undefined),
    readDirectory: vi.fn(async () => []),
    readTextFile: vi.fn(async () => ""),
    renamePath: vi.fn(async () => undefined),
    writeTextFile: vi.fn(async () => undefined),
  };
}

function renderNavigation(
  overrides: Partial<WorkbenchLanguageNavigationDependencies> = {},
) {
  const owner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
  const source = "{varType App\\Model\\Consent $consent}\n{$consent->name}";
  const activeDocument: EditorDocument = {
    content: source,
    language: "latte",
    name: "addVersion.latte",
    path: `${ROOT}/app/modules/consentModule/templates/ConsentAdmin/addVersion.latte`,
    savedContent: source,
  };
  const activeDocumentRef = { current: activeDocument };
  const activeEditorPositionRef = {
    current: positionAtNeedle(source, "name"),
  };
  const deps: WorkbenchLanguageNavigationDependencies = {
    activeDocumentRef,
    activeEditorPositionRef,
    currentNavigationLocation: () => null,
    documentOffsetAtEditorPosition: offsetAtPosition,
    documents: {},
    flushPendingDocumentChange: vi.fn(async () => undefined),
    flushPendingJavaScriptTypeScriptDocumentChange: vi.fn(async () => undefined),
    goToContextualPhpDefinition: vi.fn(async () => false),
    goToIndexedPhpImplementation: vi.fn(async () => false),
    goToIndexedSymbolDefinition: vi.fn(async () => false),
    identifierAtEditorPosition: () => "name",
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: vi.fn(() => true),
    isLanguageServerSessionActiveForRoot: vi.fn(() => true),
    javaScriptTypeScriptLanguageServerFeaturesGateway: languageServerGateway(),
    javaScriptTypeScriptLanguageServerRuntimeStatus: null,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot: null,
    languageServerFeaturesGateway: languageServerGateway(),
    languageServerRuntimeStatus: null as LanguageServerRuntimeStatus | null,
    languageServerRuntimeStatusRoot: null,
    latencyTrackerForRoot: () => ({
      clear: vi.fn(),
      record: vi.fn(),
      snapshot: vi.fn(() => []),
      statsFor: vi.fn(() => null),
    }),
    openPathForNavigation: vi.fn(async () => true),
    provideBladeDefinition: vi.fn(async () => false),
    provideLatteDefinitionOutcome: vi.fn(async () => ({
      handled: false,
      shouldBlockFallback: false,
    })),
    provideNeonDefinition: vi.fn(async () => false),
    providePhpFrameworkDefinition: vi.fn(async () => false),
    recordNavigationLocationSnapshot: vi.fn(),
    resolveCurrentWorkspaceRuntimeOwner: () => owner,
    reportErrorForActiveWorkspaceRoot: vi.fn(),
    reportLanguageServerErrorForActiveWorkspaceRoot: vi.fn(),
    setEditorRevealTarget: vi.fn(),
    setImplementationChooser: vi.fn(),
    setMessage: vi.fn(),
    workspaceFiles: workspaceFiles(),
    workspaceRoot: ROOT,
    ...overrides,
  };
  let api: WorkbenchLanguageNavigation | null = null;
  const host = document.createElement("div");
  const root = createRoot(host);

  function Harness() {
    api = useWorkbenchLanguageNavigation(deps);
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return { api: () => api as WorkbenchLanguageNavigation, deps, root, source };
}

describe("useWorkbenchLanguageNavigation Latte definition fallback", () => {
  it("does not run indexed workspace-symbol fallback for unresolved Latte property expressions", async () => {
    const goToIndexedSymbolDefinition = vi.fn(async () => false);
    const { api, deps, root, source } = renderNavigation({
      goToIndexedSymbolDefinition,
      provideLatteDefinitionOutcome: vi.fn(async () => ({
        handled: false,
        shouldBlockFallback: true,
      })),
    });

    await act(async () => {
      await api().goToDefinition();
    });

    expect(deps.provideLatteDefinitionOutcome).toHaveBeenCalledWith(
      source,
      source.indexOf("name"),
      expect.objectContaining({ canNavigate: expect.any(Function) }),
    );
    expect(goToIndexedSymbolDefinition).not.toHaveBeenCalled();

    root.unmount();
  });

  it("keeps generic fallback available when the Latte cursor is not provider-owned", async () => {
    const goToIndexedSymbolDefinition = vi.fn(async () => false);
    const { api, root } = renderNavigation({
      goToIndexedSymbolDefinition,
    });

    await act(async () => {
      await api().goToDefinition();
    });

    expect(goToIndexedSymbolDefinition).toHaveBeenCalledTimes(1);

    root.unmount();
  });
});

describe("useWorkbenchLanguageNavigation app-owned definition providers", () => {
  it("runs PHP framework definitions after contextual and before indexed fallbacks", async () => {
    const calls: string[] = [];
    const source = "<?php $user->related('orders');";
    const providePhpFrameworkDefinition = vi.fn(async () => {
      calls.push("framework");
      return false;
    });
    const goToContextualPhpDefinition = vi.fn(async () => {
      calls.push("contextual");
      return false;
    });
    const goToIndexedSymbolDefinition = vi.fn(async () => {
      calls.push("indexed");
      return false;
    });
    const harness = renderNavigation({
      activeDocumentRef: {
        current: {
          content: source,
          language: "php",
          name: "Users.php",
          path: `${ROOT}/src/Users.php`,
          savedContent: source,
        },
      },
      activeEditorPositionRef: {
        current: positionAtNeedle(source, "orders"),
      },
      goToContextualPhpDefinition,
      goToIndexedSymbolDefinition,
      providePhpFrameworkDefinition,
    });

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(calls).toEqual(["contextual", "framework", "indexed"]);
    expect(providePhpFrameworkDefinition).toHaveBeenCalledWith(
      source,
      source.indexOf("orders"),
      expect.objectContaining({ canNavigate: expect.any(Function) }),
    );

    harness.root.unmount();
  });

  it("lets NEON definitions handle Cmd+B before generic fallbacks", async () => {
    const source = "services:\n    mailer: App\\Mailer";
    const provideNeonDefinition = vi.fn(async () => true);
    const goToIndexedSymbolDefinition = vi.fn(async () => false);
    const harness = renderNavigation({
      activeDocumentRef: {
        current: {
          content: source,
          language: "neon",
          name: "services.neon",
          path: `${ROOT}/config/services.neon`,
          savedContent: source,
        },
      },
      activeEditorPositionRef: {
        current: positionAtNeedle(source, "Mailer"),
      },
      goToIndexedSymbolDefinition,
      provideNeonDefinition,
    });

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(provideNeonDefinition).toHaveBeenCalledWith(
      source,
      source.indexOf("Mailer"),
      expect.objectContaining({ canNavigate: expect.any(Function) }),
    );
    expect(goToIndexedSymbolDefinition).not.toHaveBeenCalled();

    harness.root.unmount();
  });

  it("stops later fallbacks after a framework provider replaces the workspace owner", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    const replacementOwner = createWorkspaceRuntimeOwner("workspace-b", ROOT);
    let currentOwner = firstOwner;
    const source = "<?php view('users');";
    const goToContextualPhpDefinition = vi.fn(async () => false);
    const goToIndexedSymbolDefinition = vi.fn(async () => false);
    const providePhpFrameworkDefinition = vi.fn(async () => {
      currentOwner = replacementOwner;
      return false;
    });
    const harness = renderNavigation({
      activeDocumentRef: {
        current: {
          content: source,
          language: "php",
          name: "Users.php",
          path: `${ROOT}/src/Users.php`,
          savedContent: source,
        },
      },
      activeEditorPositionRef: {
        current: positionAtNeedle(source, "users"),
      },
      goToContextualPhpDefinition,
      goToIndexedSymbolDefinition,
      providePhpFrameworkDefinition,
      resolveCurrentWorkspaceRuntimeOwner: () => currentOwner,
    });

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(goToContextualPhpDefinition).toHaveBeenCalledTimes(1);
    expect(goToIndexedSymbolDefinition).not.toHaveBeenCalled();

    harness.root.unmount();
  });

  it("uses the displayed PHP source while preserving diff-tab fallback", async () => {
    const source = "<?php config('app.name');";
    const providePhpFrameworkDefinition = vi.fn(async () => false);
    const goToContextualPhpDefinition = vi.fn(async () => false);
    const harness = renderNavigation({
      activeDocumentRef: {
        current: {
          content: source,
          language: "php",
          name: "app.php (Diff)",
          path: `mockor-git-diff:worktree:${ROOT}/config/app.php`,
          savedContent: source,
        },
      },
      activeEditorPositionRef: {
        current: positionAtNeedle(source, "app.name"),
      },
      goToContextualPhpDefinition,
      providePhpFrameworkDefinition,
    });

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(providePhpFrameworkDefinition).toHaveBeenCalledWith(
      source,
      source.indexOf("app.name"),
      expect.objectContaining({ canNavigate: expect.any(Function) }),
    );
    expect(goToContextualPhpDefinition).toHaveBeenCalledTimes(1);

    harness.root.unmount();
  });
});

describe("useWorkbenchLanguageNavigation fallback owner requests", () => {
  it("passes the owner request to every definition fallback collaborator", async () => {
    const bladeSource = "<x-panel />";
    const bladeHarness = renderNavigation({
      activeDocumentRef: {
        current: {
          content: bladeSource,
          language: "php",
          name: "panel.blade.php",
          path: `${ROOT}/resources/views/panel.blade.php`,
          savedContent: bladeSource,
        },
      },
      activeEditorPositionRef: { current: { column: 2, lineNumber: 1 } },
    });

    await act(async () => {
      await bladeHarness.api().goToDefinition();
    });

    const bladeRequest = vi.mocked(bladeHarness.deps.provideBladeDefinition)
      .mock.calls[0]?.[2];
    expect(bladeRequest?.canNavigate()).toBe(true);

    const latteHarness = renderNavigation();

    await act(async () => {
      await latteHarness.api().goToDefinition();
    });

    const latteRequest = vi.mocked(
      latteHarness.deps.provideLatteDefinitionOutcome,
    ).mock.calls[0]?.[2];
    const contextualRequest = vi.mocked(
      latteHarness.deps.goToContextualPhpDefinition,
    ).mock.calls[0]?.[0];
    const indexedRequest = vi.mocked(
      latteHarness.deps.goToIndexedSymbolDefinition,
    ).mock.calls[0]?.[0];

    expect(latteRequest?.canNavigate()).toBe(true);
    expect(contextualRequest?.canNavigate()).toBe(true);
    expect(indexedRequest?.canNavigate()).toBe(true);

    bladeHarness.root.unmount();
    latteHarness.root.unmount();
  });

  it("passes the owner request after the optional implementation position", async () => {
    const goToIndexedPhpImplementation = vi.fn(async () => false);
    const harness = renderNavigation({ goToIndexedPhpImplementation });
    const position = { column: 4, lineNumber: 2 };

    await act(async () => {
      await harness.api().goToImplementation();
      await harness.api().goToImplementationAt(position);
    });

    expect(goToIndexedPhpImplementation).toHaveBeenNthCalledWith(
      1,
      undefined,
      expect.objectContaining({ canNavigate: expect.any(Function) }),
    );
    expect(goToIndexedPhpImplementation).toHaveBeenNthCalledWith(
      2,
      position,
      expect.objectContaining({ canNavigate: expect.any(Function) }),
    );

    harness.root.unmount();
  });

  it("stops the definition chain and mutations when ownership changes inside a collaborator", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    const replacementOwner = createWorkspaceRuntimeOwner("workspace-b", ROOT);
    let currentOwner: WorkspaceRuntimeOwner = firstOwner;
    const recordNavigationLocationSnapshot = vi.fn();
    const setImplementationChooser = vi.fn();
    const collaboratorMutation = vi.fn();
    const goToContextualPhpDefinition = vi.fn(async () => false);
    const goToIndexedSymbolDefinition = vi.fn(async () => false);
    const provideLatteDefinitionOutcome = vi.fn(async (
      _source: string,
      _offset: number,
      request?: NavigationRequest,
    ) => {
      currentOwner = replacementOwner;

      if (request?.canNavigate()) {
        collaboratorMutation();
        recordNavigationLocationSnapshot(null);
        setImplementationChooser({ targets: [], title: "stale" });
      }

      return { handled: false, shouldBlockFallback: false };
    });
    const harness = renderNavigation({
      goToContextualPhpDefinition,
      goToIndexedSymbolDefinition,
      provideLatteDefinitionOutcome,
      recordNavigationLocationSnapshot,
      resolveCurrentWorkspaceRuntimeOwner: () => currentOwner,
      setImplementationChooser,
    });

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(provideLatteDefinitionOutcome).toHaveBeenCalledWith(
      harness.source,
      harness.source.indexOf("name"),
      expect.objectContaining({ canNavigate: expect.any(Function) }),
    );
    expect(collaboratorMutation).not.toHaveBeenCalled();
    expect(goToContextualPhpDefinition).not.toHaveBeenCalled();
    expect(goToIndexedSymbolDefinition).not.toHaveBeenCalled();
    expect(recordNavigationLocationSnapshot).not.toHaveBeenCalled();
    expect(setImplementationChooser).not.toHaveBeenCalled();

    harness.root.unmount();
  });

  it("blocks stale indexed implementation chooser and history mutations", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    const replacementOwner = createWorkspaceRuntimeOwner("workspace-b", ROOT);
    let currentOwner: WorkspaceRuntimeOwner = firstOwner;
    const recordNavigationLocationSnapshot = vi.fn();
    const setImplementationChooser = vi.fn();
    const collaboratorMutation = vi.fn();
    const goToIndexedPhpImplementation = vi.fn(async (
      _position?: { column: number; lineNumber: number },
      request?: NavigationRequest,
    ) => {
      currentOwner = replacementOwner;

      if (request?.canNavigate()) {
        collaboratorMutation();
        recordNavigationLocationSnapshot(null);
        setImplementationChooser({ targets: [], title: "stale" });
      }

      return false;
    });
    const harness = renderNavigation({
      goToIndexedPhpImplementation,
      recordNavigationLocationSnapshot,
      resolveCurrentWorkspaceRuntimeOwner: () => currentOwner,
      setImplementationChooser,
    });

    await act(async () => {
      await harness.api().goToImplementation();
    });

    expect(goToIndexedPhpImplementation).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ canNavigate: expect.any(Function) }),
    );
    expect(collaboratorMutation).not.toHaveBeenCalled();
    expect(recordNavigationLocationSnapshot).not.toHaveBeenCalled();
    expect(setImplementationChooser).not.toHaveBeenCalled();

    harness.root.unmount();
  });
});

describe("useWorkbenchLanguageNavigation PHP target delegation", () => {
  function renderPhpNavigation(targetPath: string) {
    const gateway = languageServerGateway();
    vi.mocked(gateway.definition).mockResolvedValue([
      {
        range: {
          end: { character: 8, line: 3 },
          start: { character: 2, line: 3 },
        },
        uri: `file://${targetPath}`,
      },
    ]);
    const source = "<?php $service->run();";
    const activeDocument: EditorDocument = {
      content: source,
      language: "php",
      name: "Controller.php",
      path: `${ROOT}/app/Http/Controller.php`,
      savedContent: source,
    };

    return renderNavigation({
      activeDocumentRef: { current: activeDocument },
      activeEditorPositionRef: { current: { column: 17, lineNumber: 1 } },
      goToContextualPhpDefinition: vi.fn(async () => false),
      languageServerFeaturesGateway: gateway,
      languageServerRuntimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          definition: true,
        },
        kind: "running",
        rootPath: ROOT,
        sessionId: 7,
      },
      languageServerRuntimeStatusRoot: ROOT,
    });
  }

  it("delegates a vendor PHP definition to the centralized open boundary", async () => {
    const harness = renderPhpNavigation(
      `${ROOT}/vendor/acme/package/src/Service.php`,
    );

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(harness.deps.openPathForNavigation).toHaveBeenCalledWith(
      `${ROOT}/vendor/acme/package/src/Service.php`,
      expect.objectContaining({ shouldCommit: expect.any(Function) }),
    );

    harness.root.unmount();
  });

  it("delegates an in-app PHP definition without site-specific options", async () => {
    const harness = renderPhpNavigation(`${ROOT}/app/Services/Service.php`);

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(harness.deps.openPathForNavigation).toHaveBeenCalledWith(
      `${ROOT}/app/Services/Service.php`,
      expect.objectContaining({ shouldCommit: expect.any(Function) }),
    );

    harness.root.unmount();
  });

  it("leaves selected PHP implementation policy to the open boundary", async () => {
    const harness = renderNavigation();

    await act(async () => {
      await harness.api().openImplementationTarget({
        detail: "Service.php:4",
        id: "service",
        label: "Service::run",
        path: `${ROOT}/vendor/acme/package/src/Service.php`,
        position: { column: 3, lineNumber: 4 },
      });
    });

    expect(harness.deps.openPathForNavigation).toHaveBeenCalledWith(
      `${ROOT}/vendor/acme/package/src/Service.php`,
      expect.objectContaining({
        readOnly: false,
        shouldCommit: expect.any(Function),
      }),
    );

    harness.root.unmount();
  });
});

const fencedLanguageFeatures = [
  ["definition", "goToDefinition"],
  ["declaration", "goToDeclaration"],
  ["typeDefinition", "goToTypeDefinition"],
  ["implementation", "goToImplementation"],
] as const;

function navigationLocation(path: string, line = 3) {
  return {
    range: {
      end: { character: 8, line },
      start: { character: 2, line },
    },
    uri: `file://${path}`,
  };
}

describe.each([
  ["PHP", "php"],
  ["JavaScript/TypeScript", "typescript"],
] as const)("useWorkbenchLanguageNavigation %s owner fence", (_label, language) => {
  it.each(fencedLanguageFeatures)(
    "drops a replaced owner's %s result before open or UI mutations",
    async (feature, command) => {
      const firstOwner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
      const replacementOwner = createWorkspaceRuntimeOwner("workspace-b", ROOT);
      let currentOwner: WorkspaceRuntimeOwner = firstOwner;
      const gateway = languageServerGateway();
      const locations =
        feature === "implementation"
          ? [
              navigationLocation(`${ROOT}/src/First.ts`, 1),
              navigationLocation(`${ROOT}/src/Second.ts`, 2),
            ]
          : [navigationLocation(`${ROOT}/src/Target.ts`)];
      vi.mocked(gateway[feature]).mockImplementation(async () => {
        currentOwner = replacementOwner;
        return locations;
      });
      const source = language === "php" ? "<?php service();" : "service();";
      const activeDocument: EditorDocument = {
        content: source,
        language,
        name: language === "php" ? "Source.php" : "source.ts",
        path: `${ROOT}/src/${language === "php" ? "Source.php" : "source.ts"}`,
        savedContent: source,
      };
      const status: LanguageServerRuntimeStatus = {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          [feature]: true,
        },
        kind: "running",
        rootPath: ROOT,
        sessionId: 7,
      };
      const harness = renderNavigation({
        activeDocumentRef: { current: activeDocument },
        activeEditorPositionRef: { current: { column: 2, lineNumber: 1 } },
        javaScriptTypeScriptLanguageServerFeaturesGateway: gateway,
        javaScriptTypeScriptLanguageServerRuntimeStatus:
          language === "typescript" ? status : null,
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot:
          language === "typescript" ? ROOT : null,
        languageServerFeaturesGateway: gateway,
        languageServerRuntimeStatus: language === "php" ? status : null,
        languageServerRuntimeStatusRoot: language === "php" ? ROOT : null,
        resolveCurrentWorkspaceRuntimeOwner: () => currentOwner,
      });

      await act(async () => {
        await harness.api()[command]();
      });

      expect(harness.deps.openPathForNavigation).not.toHaveBeenCalled();
      expect(harness.deps.recordNavigationLocationSnapshot).not.toHaveBeenCalled();
      expect(harness.deps.setEditorRevealTarget).not.toHaveBeenCalled();
      expect(harness.deps.setMessage).not.toHaveBeenCalled();
      expect(harness.deps.setImplementationChooser).not.toHaveBeenCalledWith(
        expect.objectContaining({ targets: expect.any(Array) }),
      );
      expect(harness.deps.goToIndexedPhpImplementation).not.toHaveBeenCalled();
      expect(harness.deps.goToIndexedSymbolDefinition).not.toHaveBeenCalled();

      harness.root.unmount();
    },
  );
});

describe("useWorkbenchLanguageNavigation owner alias transfer", () => {
  it("keeps a pending request valid when the same owner transfers roots", async () => {
    const owner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    let currentOwner: WorkspaceRuntimeOwner = owner;
    const gateway = languageServerGateway();
    vi.mocked(gateway.definition).mockImplementation(async () => {
      currentOwner = transferWorkspaceRuntimeOwner(owner, "/workspace-alias");
      return [navigationLocation(`${ROOT}/src/Target.php`)];
    });
    const isSessionActive = vi.fn(() => true);
    const openPathForNavigation = vi.fn(async (
      _path: string,
      options?: { shouldCommit?: () => boolean },
    ) => options?.shouldCommit?.() !== false);
    const source = "<?php service();";
    const harness = renderNavigation({
      activeDocumentRef: {
        current: {
          content: source,
          language: "php",
          name: "Source.php",
          path: `${ROOT}/src/Source.php`,
          savedContent: source,
        },
      },
      activeEditorPositionRef: { current: { column: 2, lineNumber: 1 } },
      isLanguageServerSessionActiveForRoot: isSessionActive,
      languageServerFeaturesGateway: gateway,
      languageServerRuntimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          definition: true,
        },
        kind: "running",
        rootPath: ROOT,
        sessionId: 7,
      },
      languageServerRuntimeStatusRoot: ROOT,
      openPathForNavigation,
      resolveCurrentWorkspaceRuntimeOwner: () => currentOwner,
    });

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(isSessionActive).toHaveBeenCalledWith(ROOT, 7, owner);
    expect(openPathForNavigation).toHaveBeenCalledTimes(1);
    expect(harness.deps.recordNavigationLocationSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.deps.setEditorRevealTarget).toHaveBeenCalledTimes(1);
    expect(harness.deps.setMessage).toHaveBeenCalledTimes(1);

    harness.root.unmount();
  });
});

describe.each([
  ["PHP", "php"],
  ["JavaScript/TypeScript", "typescript"],
] as const)("useWorkbenchLanguageNavigation %s implementation target fence", (_label, language) => {
  it("drops ownership replaced while reading chooser target source", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    const replacementOwner = createWorkspaceRuntimeOwner("workspace-b", ROOT);
    let currentOwner: WorkspaceRuntimeOwner = firstOwner;
    const gateway = languageServerGateway();
    vi.mocked(gateway.implementation).mockResolvedValue([
      navigationLocation(`${ROOT}/src/First.ts`, 1),
      navigationLocation(`${ROOT}/src/Second.ts`, 2),
    ]);
    const files = workspaceFiles();
    vi.mocked(files.readTextFile).mockImplementation(async () => {
      currentOwner = replacementOwner;
      return "export function service() {}";
    });
    const source = language === "php" ? "<?php service();" : "service();";
    const status: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        implementation: true,
      },
      kind: "running",
      rootPath: ROOT,
      sessionId: 7,
    };
    const harness = renderNavigation({
      activeDocumentRef: {
        current: {
          content: source,
          language,
          name: language === "php" ? "Source.php" : "source.ts",
          path: `${ROOT}/src/${language === "php" ? "Source.php" : "source.ts"}`,
          savedContent: source,
        },
      },
      activeEditorPositionRef: { current: { column: 2, lineNumber: 1 } },
      javaScriptTypeScriptLanguageServerFeaturesGateway: gateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus:
        language === "typescript" ? status : null,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot:
        language === "typescript" ? ROOT : null,
      languageServerFeaturesGateway: gateway,
      languageServerRuntimeStatus: language === "php" ? status : null,
      languageServerRuntimeStatusRoot: language === "php" ? ROOT : null,
      resolveCurrentWorkspaceRuntimeOwner: () => currentOwner,
      workspaceFiles: files,
    });

    await act(async () => {
      await harness.api().goToImplementation();
    });

    expect(files.readTextFile).toHaveBeenCalledTimes(1);
    expect(harness.deps.openPathForNavigation).not.toHaveBeenCalled();
    expect(harness.deps.setImplementationChooser).not.toHaveBeenCalledWith(
      expect.objectContaining({ targets: expect.any(Array) }),
    );
    expect(harness.deps.setMessage).not.toHaveBeenCalled();

    harness.root.unmount();
  });
});

describe("useWorkbenchLanguageNavigation target-open fence", () => {
  it("lets the open boundary reject ownership replaced during target open", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    const replacementOwner = createWorkspaceRuntimeOwner("workspace-b", ROOT);
    let currentOwner: WorkspaceRuntimeOwner = firstOwner;
    const gateway = languageServerGateway();
    vi.mocked(gateway.definition).mockResolvedValue([
      navigationLocation(`${ROOT}/src/Target.php`),
    ]);
    const openPathForNavigation = vi.fn(async (
      _path: string,
      options?: { shouldCommit?: () => boolean },
    ) => {
      currentOwner = replacementOwner;
      return options?.shouldCommit?.() !== false;
    });
    const source = "<?php service();";
    const harness = renderNavigation({
      activeDocumentRef: {
        current: {
          content: source,
          language: "php",
          name: "Source.php",
          path: `${ROOT}/src/Source.php`,
          savedContent: source,
        },
      },
      activeEditorPositionRef: { current: { column: 2, lineNumber: 1 } },
      languageServerFeaturesGateway: gateway,
      languageServerRuntimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          definition: true,
        },
        kind: "running",
        rootPath: ROOT,
        sessionId: 7,
      },
      languageServerRuntimeStatusRoot: ROOT,
      openPathForNavigation,
      resolveCurrentWorkspaceRuntimeOwner: () => currentOwner,
    });

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(openPathForNavigation).toHaveBeenCalledTimes(1);
    expect(harness.deps.recordNavigationLocationSnapshot).not.toHaveBeenCalled();
    expect(harness.deps.setEditorRevealTarget).not.toHaveBeenCalled();
    expect(harness.deps.setMessage).not.toHaveBeenCalled();

    harness.root.unmount();
  });
});
