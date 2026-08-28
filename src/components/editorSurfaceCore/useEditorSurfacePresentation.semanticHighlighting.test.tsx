// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isLargeSmartDocumentContent,
  LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  LARGE_SMART_DOCUMENT_LINE_LIMIT,
} from "../../domain/largeDocumentPolicy";
import type { EditorDocument } from "../../domain/workspace";
import {
  largeDocumentFeatureNotice,
  largeDocumentPresentationStatus,
  useEditorSurfacePresentation,
} from "./useEditorSurfacePresentation";

vi.mock("../monacoRuntimeLoader", () => ({
  initializeMonacoRuntime: vi.fn(async () => undefined),
}));

const monacoEditorProbe = vi.hoisted(() => ({
  optionsHistory: [] as Record<string, unknown>[],
}));

vi.mock("@monaco-editor/react", async () => {
  const React = await import("react");

  return {
    default: function MonacoEditorMock(props: { options?: Record<string, unknown> }) {
      if (props.options) {
        monacoEditorProbe.optionsHistory.push(props.options);
      }

      return React.createElement("div", { "data-testid": "monaco-editor" });
    },
  };
});

type PresentationOptions = Parameters<typeof useEditorSurfacePresentation>[0];

const SEMANTIC_HIGHLIGHTING_OPTION = "semanticHighlighting.enabled";

const LARGE_DOCUMENT_DISABLED_OPTIONS = {
  bracketPairColorization: { enabled: false },
  codeLens: false,
  folding: false,
  minimap: { enabled: false },
  occurrencesHighlight: "off",
  parameterHints: { enabled: false, cycle: true },
  quickSuggestions: false,
  selectionHighlight: false,
  [SEMANTIC_HIGHLIGHTING_OPTION]: false,
  stickyScroll: { enabled: false },
  suggestOnTriggerCharacters: false,
  wordBasedSuggestions: "off",
} as const;

const SMALL_DOCUMENT_ENABLED_OPTIONS = {
  bracketPairColorization: { enabled: true },
  codeLens: true,
  folding: true,
  occurrencesHighlight: "singleFile",
  parameterHints: { enabled: true, cycle: true },
  quickSuggestions: { other: true, comments: false, strings: true },
  selectionHighlight: true,
  [SEMANTIC_HIGHLIGHTING_OPTION]: true,
  stickyScroll: { enabled: true },
  suggestOnTriggerCharacters: true,
  wordBasedSuggestions: "matchingDocuments",
} as const;

describe("useEditorSurfacePresentation semantic highlighting", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    monacoEditorProbe.optionsHistory = [];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("arms semantic highlighting for a document the large-file policy accepts", async () => {
    const document = smallDocument();

    await renderPresentation(root, document, isLargeSmartDocumentContent(document.content));

    expect(latestOptions()[SEMANTIC_HIGHLIGHTING_OPTION]).toBe(true);
  });

  it("keeps semantic highlighting armed at the exact policy line boundary", async () => {
    const document = documentWithLines(LARGE_SMART_DOCUMENT_LINE_LIMIT);
    const large = isLargeSmartDocumentContent(document.content);

    await renderPresentation(root, document, large);

    expect(large).toBe(false);
    expect(latestOptions()[SEMANTIC_HIGHLIGHTING_OPTION]).toBe(true);
  });

  it("keeps semantic highlighting armed at the exact policy byte boundary", async () => {
    const document = documentWithCharacters(LARGE_SMART_DOCUMENT_CHARACTER_LIMIT);
    const large = isLargeSmartDocumentContent(document.content);

    await renderPresentation(root, document, large);

    expect(large).toBe(false);
    expect(latestOptions()[SEMANTIC_HIGHLIGHTING_OPTION]).toBe(true);
  });

  it("never arms semantic highlighting for a policy-large document", async () => {
    const document = documentWithLines(LARGE_SMART_DOCUMENT_LINE_LIMIT + 1);
    const large = isLargeSmartDocumentContent(document.content);

    await renderPresentation(root, document, large);

    expect(large).toBe(true);
    expect(
      monacoEditorProbe.optionsHistory.every(
        (options) => options[SEMANTIC_HIGHLIGHTING_OPTION] === false,
      ),
    ).toBe(true);
  });

  it("disables structural Monaco features that can monopolize the UI thread for a large document", async () => {
    const document = documentWithLines(LARGE_SMART_DOCUMENT_LINE_LIMIT + 1);

    await renderPresentation(root, document, true, true);

    expect(latestOptions()).toMatchObject({
      autoIndent: "keep",
      ...LARGE_DOCUMENT_DISABLED_OPTIONS,
    });
  });

  it("truthfully lists the user-visible features reduced for a large document", async () => {
    const document = documentWithLines(LARGE_SMART_DOCUMENT_LINE_LIMIT + 1);

    await renderPresentation(root, document, true, true);

    const notice = host.querySelector('[data-testid="editor-large-file-notice"]');
    expect(notice?.getAttribute("role")).toBe("status");
    expect(notice?.textContent).toBe(
      "Large file mode: semantic highlighting, code folding, the minimap, CodeLens, and automatic suggestions are turned off to keep editing responsive.",
    );
    expect(notice?.getAttribute("title")).toBe(notice?.textContent);
  });

  it("does not claim that the minimap was reduced when it was already disabled", () => {
    const notice = largeDocumentFeatureNotice(false);

    expect(notice).toContain("semantic highlighting");
    expect(notice).toContain("code folding");
    expect(notice).toContain("CodeLens");
    expect(notice).toContain("automatic suggestions");
    expect(notice).not.toContain("minimap");
  });

  it("distinguishes interactive JS/TS degradation from editing-only hard-limit mode", () => {
    const interactive = largeDocumentFeatureNotice(false, "editing-degraded-interactive-lsp");
    const editingOnly = largeDocumentFeatureNotice(false, "editing-only");

    expect(interactive).toContain(
      "Manual completion, definition, references, and rename remain available",
    );
    expect(interactive).not.toContain("unavailable");
    expect(editingOnly).toContain("language features are unavailable");
    expect(editingOnly).toContain("hard synchronization safety limits");
    expect(editingOnly).toContain("Essential editing remains available");
    expect(largeDocumentPresentationStatus(false, "editing-only")).toEqual({
      label: "Large file mode",
      title: editingOnly,
    });
    expect(largeDocumentPresentationStatus(false, "eligible")).toBeNull();
  });

  it.each([
    [
      "editing-degraded-interactive-lsp" as const,
      "Manual completion, definition, references, and rename remain available",
    ],
    ["editing-only" as const, "language features are unavailable"],
  ])("renders the %s tier-specific notice", async (mode, expectedText) => {
    await renderPresentation(root, documentWithLines(20_000), true, false, mode);

    expect(host.querySelector('[data-testid="editor-large-file-notice"]')?.textContent).toContain(
      expectedText,
    );
  });

  it("removes the degraded notice when the exact document becomes eligible again", async () => {
    const large = documentWithLines(LARGE_SMART_DOCUMENT_LINE_LIMIT + 1);

    await renderPresentation(root, large, true, true);
    expect(host.querySelector('[data-testid="editor-large-file-notice"]')).not.toBeNull();

    const shrunk: EditorDocument = { ...large, content: "const value = 1;\n" };
    await renderPresentation(root, shrunk, false, true);

    expect(host.querySelector('[data-testid="editor-large-file-notice"]')).toBeNull();
  });

  it("keeps the degraded notice scoped to the active document across switches", async () => {
    const large = documentWithLines(LARGE_SMART_DOCUMENT_LINE_LIMIT + 1);

    await renderPresentation(root, large, true);
    expect(host.querySelectorAll('[data-testid="editor-large-file-notice"]')).toHaveLength(1);

    await renderPresentation(root, smallDocument(), false);
    expect(host.querySelector('[data-testid="editor-large-file-notice"]')).toBeNull();

    await renderPresentation(root, large, true);
    expect(host.querySelectorAll('[data-testid="editor-large-file-notice"]')).toHaveLength(1);
  });

  it("never arms semantic highlighting for a document over the character limit", async () => {
    const document = documentWithCharacters(LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1);
    const large = isLargeSmartDocumentContent(document.content);

    await renderPresentation(root, document, large);

    expect(large).toBe(true);
    expect(latestOptions()[SEMANTIC_HIGHLIGHTING_OPTION]).toBe(false);
  });

  it("re-enables semantic highlighting for the exact document that becomes eligible again", async () => {
    const large = documentWithLines(LARGE_SMART_DOCUMENT_LINE_LIMIT + 1);

    await renderPresentation(root, large, true);
    expect(latestOptions()[SEMANTIC_HIGHLIGHTING_OPTION]).toBe(false);

    const shrunk: EditorDocument = { ...large, content: "const value = 1;\n" };
    await renderPresentation(root, shrunk, isLargeSmartDocumentContent(shrunk.content));

    expect(latestOptions()[SEMANTIC_HIGHLIGHTING_OPTION]).toBe(true);
  });

  it("re-evaluates semantic highlighting across a document switch in both directions", async () => {
    const small = smallDocument();
    const large = documentWithLines(LARGE_SMART_DOCUMENT_LINE_LIMIT + 1);

    await renderPresentation(root, small, false);
    const smallOptions = latestOptions();
    expect(smallOptions[SEMANTIC_HIGHLIGHTING_OPTION]).toBe(true);

    await renderPresentation(root, large, true);
    const largeOptions = latestOptions();
    expect(largeOptions[SEMANTIC_HIGHLIGHTING_OPTION]).toBe(false);
    expect(largeOptions).not.toBe(smallOptions);

    await renderPresentation(root, small, false);
    expect(latestOptions()).toMatchObject({
      autoIndent: "full",
      minimap: { enabled: false },
      ...SMALL_DOCUMENT_ENABLED_OPTIONS,
    });
    expect(latestOptions()).not.toBe(largeOptions);
  });

  it("restores all structural features and the user's minimap setting after returning to a small document", async () => {
    const small = smallDocument();
    const large = documentWithLines(LARGE_SMART_DOCUMENT_LINE_LIMIT + 1);

    await renderPresentation(root, large, true, true);
    expect(latestOptions()).toMatchObject(LARGE_DOCUMENT_DISABLED_OPTIONS);

    await renderPresentation(root, small, false, true);
    expect(latestOptions()).toMatchObject({
      autoIndent: "full",
      minimap: { enabled: true },
      ...SMALL_DOCUMENT_ENABLED_OPTIONS,
    });
  });

  it("keeps the options object stable while typing in a policy-large document", async () => {
    const first = documentWithLines(LARGE_SMART_DOCUMENT_LINE_LIMIT + 1);

    await renderPresentation(root, first, true);
    const optionsBefore = latestOptions();

    const edited: EditorDocument = { ...first, content: `${first.content}const typed = 1;\n` };
    await renderPresentation(root, edited, isLargeSmartDocumentContent(edited.content));

    expect(latestOptions()).toBe(optionsBefore);
    expect(optionsBefore[SEMANTIC_HIGHLIGHTING_OPTION]).toBe(false);
  });
});

function latestOptions(): Record<string, unknown> {
  const history = monacoEditorProbe.optionsHistory;
  const options = history[history.length - 1];
  expect(options).toBeDefined();
  return options ?? {};
}

async function renderPresentation(
  root: Root,
  activeDocument: EditorDocument,
  activeDocumentIsLargeSmart: boolean,
  minimapEnabled = false,
  activeDocumentLargeSmartMode?: PresentationOptions["activeDocumentLargeSmartMode"],
): Promise<void> {
  await act(async () => {
    root.render(
      createElement(PresentationHarness, {
        activeDocument,
        activeDocumentIsLargeSmart,
        activeDocumentLargeSmartMode,
        minimapEnabled,
      }),
    );
    await Promise.resolve();
  });
}

function PresentationHarness({
  activeDocument,
  activeDocumentIsLargeSmart,
  activeDocumentLargeSmartMode,
  minimapEnabled,
}: {
  readonly activeDocument: EditorDocument;
  readonly activeDocumentIsLargeSmart: boolean;
  readonly activeDocumentLargeSmartMode?: PresentationOptions["activeDocumentLargeSmartMode"];
  readonly minimapEnabled: boolean;
}) {
  return useEditorSurfacePresentation({
    ...presentationOptions(activeDocument, activeDocumentIsLargeSmart, minimapEnabled),
    activeDocumentLargeSmartMode,
  });
}

function presentationOptions(
  activeDocument: EditorDocument,
  activeDocumentIsLargeSmart: boolean,
  minimapEnabled: boolean,
): PresentationOptions {
  return {
    activateEditorGroupFromInteraction: () => undefined,
    activeDocument,
    activeDocumentContentReady: true,
    activeDocumentIsLargeSmart,
    beforeMountTheme: "calm-dark",
    breadcrumbSymbols: [],
    breakpoints: [],
    changeHunksRef: { current: [] },
    changePreview: null,
    cursorTrackingActive: false,
    editor: null,
    editorFontFamily: "monospace",
    editorFontSize: 13,
    editorSessionOwnerKey: null,
    embeddedInGroupPanel: false,
    formatOnPaste: false,
    groupId: "group-1",
    handleMount: () => undefined,
    isOpeningFile: false,
    minimapEnabled,
    modelIdentity: null,
    monaco: null,
    monacoFontLigatures: false,
    onMutationError: () => undefined,
    onRevertChangeHunk: () => undefined,
    runtime: null,
    setChangePreview: () => undefined,
    setSurroundWithRequest: () => undefined,
    surroundWithRequest: null,
    wordWrapEnabled: false,
    workspaceRoot: "/workspace",
  };
}

function smallDocument(): EditorDocument {
  return editorDocument("const value = 1;\nconst other = 2;\n");
}

function documentWithLines(lineCount: number): EditorDocument {
  return editorDocument("x\n".repeat(lineCount - 1).concat("x"));
}

function documentWithCharacters(characterCount: number): EditorDocument {
  return editorDocument("x".repeat(characterCount));
}

function editorDocument(content: string): EditorDocument {
  return {
    content,
    language: "typescript",
    name: "example.ts",
    path: "/workspace/src/example.ts",
    savedContent: content,
  };
}
