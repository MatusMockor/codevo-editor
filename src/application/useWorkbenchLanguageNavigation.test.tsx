// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
  IdentifiedLanguageServerRequest,
  IdentifiedLanguageServerRequestsPort,
  JavaScriptTypeScriptLanguageServerFeaturesGateway,
  LanguageServerFeaturesGateway,
} from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { emptyLanguageServerCapabilities } from "../domain/languageServerRuntime";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import {
  createWorkspaceRuntimeOwner,
  transferWorkspaceRuntimeOwner,
  type WorkspaceRuntimeOwner,
} from "../domain/workspaceRuntimeOwner";
import {
  MAX_NAVIGATION_LOCATION_TARGETS,
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

let nextRequestId = 1;

function identifiedRequest<T>(value: T, sessionId: number): IdentifiedLanguageServerRequest<T> {
  return Object.assign(Promise.resolve(value), {
    requestId: nextRequestId++,
    sessionId,
  });
}

function deferredIdentifiedRequest<T>(requestId: number, sessionId = 7) {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise: Object.assign(promise, { requestId, sessionId }),
    reject,
    resolve,
  };
}

function installRequestCancellation(gateway: JavaScriptTypeScriptLanguageServerFeaturesGateway) {
  const cancelRequest = vi.fn(async () => undefined);
  Object.assign(gateway, {
    identifiedRequests: {
      cancelRequest,
    } as unknown as IdentifiedLanguageServerRequestsPort,
  });
  return cancelRequest;
}

function javaScriptTypeScriptLanguageServerGateway(): JavaScriptTypeScriptLanguageServerFeaturesGateway {
  return {
    ...languageServerGateway(),
    codeActions: vi.fn((_rootPath, _path, _range, _context, sessionId) =>
      identifiedRequest([], sessionId),
    ),
    workspaceSymbols: vi.fn((_rootPath, _query, sessionId) => identifiedRequest([], sessionId)),
    completion: vi.fn((_rootPath, _position, sessionId) =>
      identifiedRequest({ isIncomplete: false, items: [] }, sessionId),
    ),
    declaration: vi.fn((_rootPath, _position, sessionId) => identifiedRequest([], sessionId)),
    definition: vi.fn((_rootPath, _position, sessionId) => identifiedRequest([], sessionId)),
    executeCommandLocations: vi.fn((_rootPath, _command, sessionId) =>
      identifiedRequest([], sessionId),
    ),
    documentHighlights: vi.fn((_rootPath, _position, sessionId) =>
      identifiedRequest([], sessionId),
    ),
    hover: vi.fn((_rootPath, _position, sessionId) => identifiedRequest(null, sessionId)),
    implementation: vi.fn((_rootPath, _position, sessionId) => identifiedRequest([], sessionId)),
    linkedEditingRanges: vi.fn((_rootPath, _position, sessionId) =>
      identifiedRequest(null, sessionId),
    ),
    rangeSemanticTokens: vi.fn((_rootPath, _path, _range, sessionId) =>
      identifiedRequest(null, sessionId),
    ),
    references: vi.fn((_rootPath, _position, sessionId) => identifiedRequest([], sessionId)),
    resolveCodeAction: vi.fn((_rootPath, action, sessionId) =>
      identifiedRequest(action, sessionId),
    ),
    semanticTokens: vi.fn((_rootPath, _path, sessionId) => identifiedRequest(null, sessionId)),
    signatureHelp: vi.fn((_rootPath, _position, sessionId) => identifiedRequest(null, sessionId)),
    sourceDefinition: vi.fn((_rootPath, _position, sessionId) => identifiedRequest([], sessionId)),
    typeDefinition: vi.fn((_rootPath, _position, sessionId) => identifiedRequest([], sessionId)),
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
    readTextFileBounded: vi.fn(async () => ({ content: "", status: "ok" as const })),
    renamePath: vi.fn(async () => undefined),
    writeTextFile: vi.fn(async () => undefined),
  };
}

function renderNavigation(
  overrides: Partial<WorkbenchLanguageNavigationDependencies> = {},
  strict = false,
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
    requestLanguageServerDocumentLease: vi.fn(async (rootPath, path) => ({
      lifecycleIdentity: 1,
      path,
      rootPath,
      sessionId: 7,
      syncGeneration: 0,
    })),
    isLanguageServerDocumentRequestLeaseCurrent: vi.fn(() => true),
    flushPendingJavaScriptTypeScriptDocumentChange: vi.fn(async () => undefined),
    goToContextualPhpDefinition: vi.fn(async () => false),
    goToIndexedPhpImplementation: vi.fn(async () => false),
    goToIndexedSymbolDefinition: vi.fn(async () => false),
    identifierAtEditorPosition: () => "name",
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: vi.fn(() => true),
    isLanguageServerSessionActiveForRoot: vi.fn(() => true),
    javaScriptTypeScriptLanguageServerFeaturesGateway: javaScriptTypeScriptLanguageServerGateway(),
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
    root.render(
      strict ? (
        <StrictMode>
          <Harness />
        </StrictMode>
      ) : (
        <Harness />
      ),
    );
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

    const bladeRequest = vi.mocked(bladeHarness.deps.provideBladeDefinition).mock.calls[0]?.[2];
    expect(bladeRequest?.canNavigate()).toBe(false);

    const latteHarness = renderNavigation();

    await act(async () => {
      await latteHarness.api().goToDefinition();
    });

    const latteRequest = vi.mocked(latteHarness.deps.provideLatteDefinitionOutcome).mock
      .calls[0]?.[2];
    const contextualRequest = vi.mocked(latteHarness.deps.goToContextualPhpDefinition).mock
      .calls[0]?.[0];
    const indexedRequest = vi.mocked(latteHarness.deps.goToIndexedSymbolDefinition).mock
      .calls[0]?.[0];

    expect(latteRequest?.canNavigate()).toBe(false);
    expect(contextualRequest?.canNavigate()).toBe(false);
    expect(indexedRequest?.canNavigate()).toBe(false);

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
    const provideLatteDefinitionOutcome = vi.fn(
      async (_source: string, _offset: number, request?: NavigationRequest) => {
        currentOwner = replacementOwner;

        if (request?.canNavigate()) {
          collaboratorMutation();
          recordNavigationLocationSnapshot(null);
          setImplementationChooser({ targets: [], title: "stale" });
        }

        return { handled: false, shouldBlockFallback: false };
      },
    );
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
    const goToIndexedPhpImplementation = vi.fn(
      async (_position?: { column: number; lineNumber: number }, request?: NavigationRequest) => {
        currentOwner = replacementOwner;

        if (request?.canNavigate()) {
          collaboratorMutation();
          recordNavigationLocationSnapshot(null);
          setImplementationChooser({ targets: [], title: "stale" });
        }

        return false;
      },
    );
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
  function renderPhpNavigation(
    targetPath: string,
    overrides: Partial<WorkbenchLanguageNavigationDependencies> = {},
  ) {
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
      ...overrides,
    });
  }

  it("delegates a vendor PHP definition to the centralized open boundary", async () => {
    const harness = renderPhpNavigation(`${ROOT}/vendor/acme/package/src/Service.php`);

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

  it("fails closed and cancels generic definition metadata from a foreign session", async () => {
    const gateway = languageServerGateway();
    const cancelRequest = vi.fn(async () => undefined);
    const foreignRequest = Object.assign(
      Promise.resolve([navigationLocation(`${ROOT}/src/foreign.php`)]),
      { requestId: 107, sessionId: 8 },
    );
    Object.assign(gateway, {
      identifiedRequests: {
        cancelRequest,
        definition: vi.fn(() => foreignRequest),
      } as unknown as IdentifiedLanguageServerRequestsPort,
    });
    const harness = renderPhpNavigation(`${ROOT}/src/unused.php`, {
      languageServerFeaturesGateway: gateway,
    });

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(cancelRequest).toHaveBeenCalledExactlyOnceWith(ROOT, 8, 107);
    expect(harness.deps.openPathForNavigation).not.toHaveBeenCalled();
    expect(harness.deps.setEditorRevealTarget).not.toHaveBeenCalled();
    harness.root.unmount();
  });

  it("does not call phpactor when an explicit-root document lease is unavailable", async () => {
    const requestLease = vi.fn(async () => null);
    const harness = renderPhpNavigation(`${ROOT}/app/Services/Service.php`, {
      requestLanguageServerDocumentLease: requestLease,
    });

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(requestLease).toHaveBeenCalledWith(ROOT, harness.deps.activeDocumentRef.current?.path);
    expect(harness.deps.languageServerFeaturesGateway.definition).not.toHaveBeenCalled();

    harness.root.unmount();
  });

  it("revalidates the document lease immediately before calling phpactor", async () => {
    const isLeaseCurrent = vi.fn(() => false);
    const harness = renderPhpNavigation(`${ROOT}/app/Services/Service.php`, {
      isLanguageServerDocumentRequestLeaseCurrent: isLeaseCurrent,
    });

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(isLeaseCurrent).toHaveBeenCalledTimes(1);
    expect(harness.deps.languageServerFeaturesGateway.definition).not.toHaveBeenCalled();

    harness.root.unmount();
  });

  it("drops target resolution when the lease expires after the gateway reply", async () => {
    let leaseCurrent = true;
    const gateway = languageServerGateway();
    vi.mocked(gateway.implementation).mockResolvedValue([
      navigationLocation(`${ROOT}/src/First.php`, 1),
      navigationLocation(`${ROOT}/src/Second.php`, 2),
    ]);
    const files = workspaceFiles();
    vi.mocked(files.readTextFileBounded!).mockImplementation(async () => {
      leaseCurrent = false;
      return { content: "<?php function service() {}", status: "ok" };
    });
    const harness = renderPhpNavigation(`${ROOT}/src/Unused.php`, {
      isLanguageServerDocumentRequestLeaseCurrent: vi.fn(() => leaseCurrent),
      languageServerFeaturesGateway: gateway,
      languageServerRuntimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          implementation: true,
        },
        kind: "running",
        rootPath: ROOT,
        sessionId: 7,
      },
      workspaceFiles: files,
    });

    await act(async () => {
      await harness.api().goToImplementation();
    });

    expect(files.readTextFileBounded).toHaveBeenCalledTimes(1);
    expect(harness.deps.setImplementationChooser).not.toHaveBeenCalledWith(
      expect.objectContaining({ targets: expect.any(Array) }),
    );
    expect(harness.deps.openPathForNavigation).not.toHaveBeenCalled();

    harness.root.unmount();
  });

  it("rejects chooser commit after its PHP lease expires", async () => {
    let leaseCurrent = true;
    const gateway = languageServerGateway();
    vi.mocked(gateway.implementation).mockResolvedValue([
      navigationLocation(`${ROOT}/src/First.php`, 1),
      navigationLocation(`${ROOT}/src/Second.php`, 2),
    ]);
    const harness = renderPhpNavigation(`${ROOT}/src/Unused.php`, {
      isLanguageServerDocumentRequestLeaseCurrent: vi.fn(() => leaseCurrent),
      languageServerFeaturesGateway: gateway,
      languageServerRuntimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          implementation: true,
        },
        kind: "running",
        rootPath: ROOT,
        sessionId: 7,
      },
    });

    await act(async () => {
      await harness.api().goToImplementation();
    });

    const chooser = vi
      .mocked(harness.deps.setImplementationChooser)
      .mock.calls.find(([value]) => value?.targets.length === 2)?.[0];
    expect(chooser).not.toBeNull();
    leaseCurrent = false;

    await act(async () => {
      await harness.api().openImplementationTarget(chooser!.targets[0]!);
    });

    expect(harness.deps.openPathForNavigation).not.toHaveBeenCalled();

    harness.root.unmount();
  });

  it("passes the PHP lease predicate to the open commit boundary", async () => {
    let leaseCurrent = true;
    const openPathForNavigation = vi.fn(
      async (_path: string, options?: { shouldCommit?: () => boolean }) => {
        leaseCurrent = false;
        return options?.shouldCommit?.() !== false;
      },
    );
    const harness = renderPhpNavigation(`${ROOT}/app/Services/Service.php`, {
      isLanguageServerDocumentRequestLeaseCurrent: vi.fn(() => leaseCurrent),
      openPathForNavigation,
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

describe("useWorkbenchLanguageNavigation JavaScript and TypeScript definitions", () => {
  function renderTypeScriptDefinitionNavigation(
    locations: ReturnType<typeof navigationLocation>[],
    gateway = javaScriptTypeScriptLanguageServerGateway(),
  ) {
    vi.mocked(gateway.definition).mockImplementation((_rootPath, _position, sessionId) =>
      identifiedRequest(locations, sessionId),
    );
    const source = "service();";

    return renderNavigation({
      activeDocumentRef: {
        current: {
          content: source,
          language: "typescript",
          name: "source.ts",
          path: `${ROOT}/packages/app/src/source.ts`,
          savedContent: source,
        },
      },
      activeEditorPositionRef: { current: { column: 2, lineNumber: 1 } },
      javaScriptTypeScriptLanguageServerFeaturesGateway: gateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          definition: true,
        },
        kind: "running",
        rootPath: ROOT,
        sessionId: 7,
      },
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: ROOT,
    });
  }

  it("keeps Cmd+B on the custom cross-file opener", async () => {
    const targetPath = `${ROOT}/packages/service/src/definition.ts`;
    const harness = renderTypeScriptDefinitionNavigation([navigationLocation(targetPath)]);

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(harness.deps.openPathForNavigation).toHaveBeenCalledWith(
      targetPath,
      expect.objectContaining({
        readOnly: false,
        shouldCommit: expect.any(Function),
      }),
    );
    expect(harness.deps.setEditorRevealTarget).toHaveBeenCalledWith({
      path: targetPath,
      position: { column: 3, lineNumber: 4 },
    });
    harness.root.unmount();
  });

  it("finalizes reveal and history after the opener activates the expected target model", async () => {
    const targetPath = `${ROOT}/packages/service/src/activated.ts`;
    const harness = renderTypeScriptDefinitionNavigation([navigationLocation(targetPath)]);
    vi.mocked(harness.deps.openPathForNavigation).mockImplementation(async (path) => {
      harness.deps.activeDocumentRef.current = {
        content: "export const activated = true;",
        language: "typescript",
        name: "activated.ts",
        path,
        savedContent: "export const activated = true;",
      };
      return true;
    });

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(harness.deps.recordNavigationLocationSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.deps.setEditorRevealTarget).toHaveBeenCalledWith({
      path: targetPath,
      position: { column: 3, lineNumber: 4 },
    });
    expect(harness.deps.setMessage).toHaveBeenCalledWith("Opened definition activated.ts:4:3");
    harness.root.unmount();
  });

  it("opens an outside-workspace definition read-only", async () => {
    const targetPath = "/Library/Developer/TypeScript/lib/lib.es2022.d.ts";
    const harness = renderTypeScriptDefinitionNavigation([navigationLocation(targetPath)]);

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(harness.deps.openPathForNavigation).toHaveBeenCalledWith(
      targetPath,
      expect.objectContaining({
        readOnly: true,
        shouldCommit: expect.any(Function),
      }),
    );
    harness.root.unmount();
  });

  it("shows the ImplementationChooser for multiple definition locations", async () => {
    const firstPath = `${ROOT}/packages/service/src/first.ts`;
    const secondPath = `${ROOT}/packages/service/src/second.ts`;
    const harness = renderTypeScriptDefinitionNavigation([
      navigationLocation(firstPath, 1),
      navigationLocation(secondPath, 2),
    ]);

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(harness.deps.setImplementationChooser).toHaveBeenCalledWith({
      targets: expect.arrayContaining([
        expect.objectContaining({ path: firstPath }),
        expect.objectContaining({ path: secondPath }),
      ]),
      title: "Definitions for name",
    });
    expect(harness.deps.openPathForNavigation).not.toHaveBeenCalled();
    harness.root.unmount();
  });

  it("passes the captured session and drops an A-B-A result after session replacement", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a-generation-1", ROOT);
    const replacementOwner = createWorkspaceRuntimeOwner("workspace-b", ROOT);
    const secondOwner = createWorkspaceRuntimeOwner("workspace-a-generation-2", ROOT);
    let currentOwner: WorkspaceRuntimeOwner = firstOwner;
    let currentSessionId = 7;
    const gateway = javaScriptTypeScriptLanguageServerGateway();
    vi.mocked(gateway.definition).mockImplementation((_rootPath, _position, sessionId) => {
      currentOwner = replacementOwner;
      currentOwner = secondOwner;
      currentSessionId = 8;
      return identifiedRequest(
        [navigationLocation(`${ROOT}/packages/service/src/stale.ts`)],
        sessionId,
      );
    });
    const source = "service();";
    const harness = renderNavigation({
      activeDocumentRef: {
        current: {
          content: source,
          language: "typescript",
          name: "source.ts",
          path: `${ROOT}/packages/app/src/source.ts`,
          savedContent: source,
        },
      },
      activeEditorPositionRef: { current: { column: 2, lineNumber: 1 } },
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: vi.fn(
        (_rootPath, sessionId) => sessionId === currentSessionId,
      ),
      javaScriptTypeScriptLanguageServerFeaturesGateway: gateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          definition: true,
        },
        kind: "running",
        rootPath: ROOT,
        sessionId: 7,
      },
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: ROOT,
      resolveCurrentWorkspaceRuntimeOwner: () => currentOwner,
    });

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(gateway.definition).toHaveBeenCalledWith(
      ROOT,
      {
        character: 1,
        line: 0,
        path: `${ROOT}/packages/app/src/source.ts`,
      },
      7,
    );
    expect(harness.deps.openPathForNavigation).not.toHaveBeenCalled();
    expect(harness.deps.recordNavigationLocationSnapshot).not.toHaveBeenCalled();
    expect(harness.deps.setEditorRevealTarget).not.toHaveBeenCalled();
    expect(harness.deps.setMessage).not.toHaveBeenCalled();
    expect(harness.deps.setImplementationChooser).not.toHaveBeenCalledWith(
      expect.objectContaining({ targets: expect.any(Array) }),
    );
    harness.root.unmount();
  });

  it("fails closed and cancels a definition response identified for a foreign session", async () => {
    const gateway = javaScriptTypeScriptLanguageServerGateway();
    const cancelRequest = installRequestCancellation(gateway);
    const harness = renderTypeScriptDefinitionNavigation([], gateway);
    vi.mocked(gateway.definition).mockReturnValue(
      Object.assign(Promise.resolve([navigationLocation(`${ROOT}/src/foreign.ts`)]), {
        requestId: 106,
        sessionId: 8,
      }),
    );

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(cancelRequest).toHaveBeenCalledExactlyOnceWith(ROOT, 8, 106);
    expect(harness.deps.openPathForNavigation).not.toHaveBeenCalled();
    expect(harness.deps.setEditorRevealTarget).not.toHaveBeenCalled();
    harness.root.unmount();
  });

  it("recreates the definition coordinator after the StrictMode effect probe", async () => {
    const gateway = javaScriptTypeScriptLanguageServerGateway();
    vi.mocked(gateway.definition).mockImplementation((_rootPath, _position, sessionId) =>
      identifiedRequest([navigationLocation(`${ROOT}/src/strict.ts`)], sessionId),
    );
    const source = "service();";
    const harness = renderNavigation(
      {
        activeDocumentRef: {
          current: {
            content: source,
            language: "typescript",
            name: "source.ts",
            path: `${ROOT}/src/source.ts`,
            savedContent: source,
          },
        },
        activeEditorPositionRef: { current: { column: 2, lineNumber: 1 } },
        javaScriptTypeScriptLanguageServerFeaturesGateway: gateway,
        javaScriptTypeScriptLanguageServerRuntimeStatus: {
          capabilities: {
            ...emptyLanguageServerCapabilities(),
            definition: true,
          },
          kind: "running",
          rootPath: ROOT,
          sessionId: 7,
        },
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot: ROOT,
      },
      true,
    );

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(harness.deps.openPathForNavigation).toHaveBeenCalledWith(
      `${ROOT}/src/strict.ts`,
      expect.any(Object),
    );
    harness.root.unmount();
  });

  it("cancels a superseded click and only opens the latest reverse-order result", async () => {
    const first = deferredIdentifiedRequest<ReturnType<typeof navigationLocation>[]>(101);
    const second = deferredIdentifiedRequest<ReturnType<typeof navigationLocation>[]>(102);
    const gateway = javaScriptTypeScriptLanguageServerGateway();
    const cancelRequest = installRequestCancellation(gateway);
    vi.mocked(gateway.definition)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const harness = renderTypeScriptDefinitionNavigation([], gateway);
    let firstNavigation!: Promise<void>;
    let secondNavigation!: Promise<void>;

    await act(async () => {
      firstNavigation = harness.api().goToDefinition();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      secondNavigation = harness.api().goToDefinition();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cancelRequest).toHaveBeenCalledExactlyOnceWith(ROOT, 7, 101);

    second.resolve([navigationLocation(`${ROOT}/src/latest.ts`, 2)]);
    await act(async () => {
      await secondNavigation;
    });
    first.resolve([navigationLocation(`${ROOT}/src/stale.ts`, 1)]);
    await act(async () => {
      await firstNavigation;
    });

    expect(harness.deps.openPathForNavigation).toHaveBeenCalledTimes(1);
    expect(harness.deps.openPathForNavigation).toHaveBeenCalledWith(
      `${ROOT}/src/latest.ts`,
      expect.objectContaining({ shouldCommit: expect.any(Function) }),
    );
    harness.root.unmount();
  });

  it("revalidates the exact latest request after an older target open settles", async () => {
    let resolveStaleOpen!: (opened: boolean) => void;
    const staleOpen = new Promise<boolean>((resolve) => {
      resolveStaleOpen = resolve;
    });
    const gateway = javaScriptTypeScriptLanguageServerGateway();
    vi.mocked(gateway.definition)
      .mockReturnValueOnce(identifiedRequest([navigationLocation(`${ROOT}/src/stale.ts`)], 7))
      .mockReturnValueOnce(identifiedRequest([navigationLocation(`${ROOT}/src/latest.ts`)], 7));
    const harness = renderTypeScriptDefinitionNavigation([], gateway);
    vi.mocked(harness.deps.openPathForNavigation).mockImplementation(async (path) =>
      path.endsWith("/stale.ts") ? staleOpen : true,
    );
    let firstNavigation!: Promise<void>;

    await act(async () => {
      firstNavigation = harness.api().goToDefinition();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await harness.api().goToDefinition();
      await firstNavigation;
    });
    resolveStaleOpen(true);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.deps.setEditorRevealTarget).toHaveBeenCalledTimes(1);
    expect(harness.deps.setEditorRevealTarget).toHaveBeenCalledWith({
      path: `${ROOT}/src/latest.ts`,
      position: { column: 3, lineNumber: 4 },
    });
    expect(harness.deps.recordNavigationLocationSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.deps.setMessage).toHaveBeenCalledTimes(1);
    harness.root.unmount();
  });

  it("drops a pending definition after the exact document model changes", async () => {
    const pending = deferredIdentifiedRequest<ReturnType<typeof navigationLocation>[]>(103);
    const gateway = javaScriptTypeScriptLanguageServerGateway();
    installRequestCancellation(gateway);
    vi.mocked(gateway.definition).mockReturnValue(pending.promise);
    const harness = renderTypeScriptDefinitionNavigation([], gateway);
    const activeDocumentRef = harness.deps.activeDocumentRef;
    const original = activeDocumentRef.current as EditorDocument;
    let navigation!: Promise<void>;

    await act(async () => {
      navigation = harness.api().goToDefinition();
      await Promise.resolve();
      await Promise.resolve();
    });
    activeDocumentRef.current = {
      ...original,
      content: "service(edited);",
    };
    pending.resolve([navigationLocation(`${ROOT}/src/stale.ts`)]);

    await act(async () => {
      await navigation;
    });

    expect(harness.deps.openPathForNavigation).not.toHaveBeenCalled();
    expect(harness.deps.setEditorRevealTarget).not.toHaveBeenCalled();
    harness.root.unmount();
  });

  it("times out and cancels a hung backend definition request", async () => {
    vi.useFakeTimers();
    try {
      const pending = deferredIdentifiedRequest<ReturnType<typeof navigationLocation>[]>(104);
      const gateway = javaScriptTypeScriptLanguageServerGateway();
      const cancelRequest = installRequestCancellation(gateway);
      const harness = renderTypeScriptDefinitionNavigation([], gateway);
      vi.mocked(gateway.definition).mockReturnValue(pending.promise);
      let navigation!: Promise<void>;

      await act(async () => {
        navigation = harness.api().goToDefinition();
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_500);
        await navigation;
      });

      expect(cancelRequest).toHaveBeenCalledExactlyOnceWith(ROOT, 7, 104);
      expect(harness.deps.openPathForNavigation).not.toHaveBeenCalled();
      harness.root.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending backend definition request on unmount", async () => {
    const pending = deferredIdentifiedRequest<ReturnType<typeof navigationLocation>[]>(105);
    const gateway = javaScriptTypeScriptLanguageServerGateway();
    const cancelRequest = installRequestCancellation(gateway);
    const harness = renderTypeScriptDefinitionNavigation([], gateway);
    vi.mocked(gateway.definition).mockReturnValue(pending.promise);
    let navigation!: Promise<void>;

    await act(async () => {
      navigation = harness.api().goToDefinition();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      harness.root.unmount();
      await navigation;
    });

    expect(cancelRequest).toHaveBeenCalledExactlyOnceWith(ROOT, 7, 105);
    expect(harness.deps.openPathForNavigation).not.toHaveBeenCalled();
  });

  it("bounds huge definition projections and reports the incomplete chooser truthfully", async () => {
    const locations = Array.from({ length: 1_000 }, (_, index) =>
      navigationLocation(`${ROOT}/src/target-${index}.ts`, index),
    );
    const harness = renderTypeScriptDefinitionNavigation(locations);

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(harness.deps.workspaceFiles.readTextFileBounded).toHaveBeenCalledTimes(
      MAX_NAVIGATION_LOCATION_TARGETS,
    );
    const chooserCalls = vi.mocked(harness.deps.setImplementationChooser).mock.calls;
    const chooser = chooserCalls[chooserCalls.length - 1]?.[0];
    expect(chooser?.targets).toHaveLength(MAX_NAVIGATION_LOCATION_TARGETS);
    expect(chooser?.title).toBe("Definitions for name (showing a bounded subset of 1000)");
    harness.root.unmount();
  });

  it("caps the total source bytes retained while preparing definition targets", async () => {
    const locations = Array.from({ length: 20 }, (_, index) =>
      navigationLocation(`${ROOT}/src/target-${index}.ts`, index),
    );
    const harness = renderTypeScriptDefinitionNavigation(locations);
    vi.mocked(harness.deps.workspaceFiles.readTextFileBounded!).mockImplementation(
      async (_path, maximumBytes) => ({
        content: "x".repeat(maximumBytes),
        status: "ok",
      }),
    );

    await act(async () => {
      await harness.api().goToDefinition();
    });

    expect(harness.deps.workspaceFiles.readTextFileBounded).toHaveBeenCalledTimes(4);
    expect(
      vi
        .mocked(harness.deps.workspaceFiles.readTextFileBounded!)
        .mock.calls.reduce((total, call) => total + call[1], 0),
    ).toBe(512 * 1024);
    harness.root.unmount();
  });

  it("stops target disk preparation when a newer click supersedes it", async () => {
    let resolveRead!: (source: string) => void;
    const blockedRead = new Promise<string>((resolve) => {
      resolveRead = resolve;
    });
    const gateway = javaScriptTypeScriptLanguageServerGateway();
    vi.mocked(gateway.definition)
      .mockReturnValueOnce(
        identifiedRequest(
          [
            navigationLocation(`${ROOT}/src/slow-a.ts`),
            navigationLocation(`${ROOT}/src/slow-b.ts`),
          ],
          7,
        ),
      )
      .mockReturnValueOnce(identifiedRequest([navigationLocation(`${ROOT}/src/latest.ts`)], 7));
    const readTextFileBounded = vi
      .fn()
      .mockReturnValueOnce(blockedRead.then((content) => ({ content, status: "ok" as const })))
      .mockResolvedValue({ content: "export const latest = true;", status: "ok" as const });
    const harness = renderTypeScriptDefinitionNavigation([], gateway);
    harness.deps.workspaceFiles.readTextFileBounded = readTextFileBounded;
    let firstNavigation!: Promise<void>;

    await act(async () => {
      firstNavigation = harness.api().goToDefinition();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await harness.api().goToDefinition();
    });
    resolveRead("export const stale = true;");
    await act(async () => {
      await firstNavigation;
    });

    expect(readTextFileBounded).toHaveBeenCalledTimes(1);
    expect(readTextFileBounded).not.toHaveBeenCalledWith(
      `${ROOT}/src/slow-b.ts`,
      expect.any(Number),
    );
    expect(harness.deps.openPathForNavigation).toHaveBeenCalledTimes(1);
    expect(harness.deps.openPathForNavigation).toHaveBeenCalledWith(
      `${ROOT}/src/latest.ts`,
      expect.any(Object),
    );
    harness.root.unmount();
  });
});

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
      const gateway = javaScriptTypeScriptLanguageServerGateway();
      const genericGateway = languageServerGateway();
      const locations =
        feature === "implementation"
          ? [
              navigationLocation(`${ROOT}/src/First.ts`, 1),
              navigationLocation(`${ROOT}/src/Second.ts`, 2),
            ]
          : [navigationLocation(`${ROOT}/src/Target.ts`)];
      vi.mocked(gateway[feature]).mockImplementation((_rootPath, _position, sessionId) => {
        currentOwner = replacementOwner;
        return identifiedRequest(locations, sessionId);
      });
      vi.mocked(genericGateway[feature]).mockImplementation(async () => {
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
        javaScriptTypeScriptLanguageServerRuntimeStatus: language === "typescript" ? status : null,
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot:
          language === "typescript" ? ROOT : null,
        languageServerFeaturesGateway: genericGateway,
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
    const openPathForNavigation = vi.fn(
      async (_path: string, options?: { shouldCommit?: () => boolean }) =>
        options?.shouldCommit?.() !== false,
    );
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
    const gateway = javaScriptTypeScriptLanguageServerGateway();
    const genericGateway = languageServerGateway();
    vi.mocked(gateway.implementation).mockResolvedValue([
      navigationLocation(`${ROOT}/src/First.ts`, 1),
      navigationLocation(`${ROOT}/src/Second.ts`, 2),
    ]);
    vi.mocked(genericGateway.implementation).mockResolvedValue([
      navigationLocation(`${ROOT}/src/First.ts`, 1),
      navigationLocation(`${ROOT}/src/Second.ts`, 2),
    ]);
    const files = workspaceFiles();
    vi.mocked(files.readTextFileBounded!).mockImplementation(async () => {
      currentOwner = replacementOwner;
      return { content: "export function service() {}", status: "ok" };
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
      javaScriptTypeScriptLanguageServerRuntimeStatus: language === "typescript" ? status : null,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: language === "typescript" ? ROOT : null,
      languageServerFeaturesGateway: genericGateway,
      languageServerRuntimeStatus: language === "php" ? status : null,
      languageServerRuntimeStatusRoot: language === "php" ? ROOT : null,
      resolveCurrentWorkspaceRuntimeOwner: () => currentOwner,
      workspaceFiles: files,
    });

    await act(async () => {
      await harness.api().goToImplementation();
    });

    expect(files.readTextFileBounded).toHaveBeenCalledTimes(1);
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
    vi.mocked(gateway.definition).mockResolvedValue([navigationLocation(`${ROOT}/src/Target.php`)]);
    const openPathForNavigation = vi.fn(
      async (_path: string, options?: { shouldCommit?: () => boolean }) => {
        currentOwner = replacementOwner;
        return options?.shouldCommit?.() !== false;
      },
    );
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
