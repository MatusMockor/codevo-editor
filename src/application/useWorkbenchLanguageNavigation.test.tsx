// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { LanguageServerFeaturesGateway } from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import {
  useWorkbenchLanguageNavigation,
  type WorkbenchLanguageNavigation,
  type WorkbenchLanguageNavigationDependencies,
} from "./useWorkbenchLanguageNavigation";

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
    provideLatteDefinition: vi.fn(async () => false),
    recordNavigationLocationSnapshot: vi.fn(),
    reportErrorForActiveWorkspaceRoot: vi.fn(),
    reportLanguageServerErrorForActiveWorkspaceRoot: vi.fn(),
    setEditorRevealTarget: vi.fn(),
    setImplementationChooser: vi.fn(),
    setMessage: vi.fn(),
    shouldBlockLatteDefinitionFallback: vi.fn(() => false),
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
    const shouldBlockLatteDefinitionFallback = vi.fn(() => true);
    const goToIndexedSymbolDefinition = vi.fn(async () => false);
    const { api, deps, root, source } = renderNavigation({
      goToIndexedSymbolDefinition,
      shouldBlockLatteDefinitionFallback,
    });

    await act(async () => {
      await api().goToDefinition();
    });

    expect(deps.provideLatteDefinition).toHaveBeenCalledWith(
      source,
      source.indexOf("name"),
    );
    expect(shouldBlockLatteDefinitionFallback).toHaveBeenCalledWith(
      source,
      source.indexOf("name"),
    );
    expect(goToIndexedSymbolDefinition).not.toHaveBeenCalled();

    root.unmount();
  });

  it("keeps generic fallback available when the Latte cursor is not provider-owned", async () => {
    const goToIndexedSymbolDefinition = vi.fn(async () => false);
    const { api, root } = renderNavigation({
      goToIndexedSymbolDefinition,
      shouldBlockLatteDefinitionFallback: vi.fn(() => false),
    });

    await act(async () => {
      await api().goToDefinition();
    });

    expect(goToIndexedSymbolDefinition).toHaveBeenCalledTimes(1);

    root.unmount();
  });
});
