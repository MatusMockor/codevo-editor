// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { EditorDocument } from "../domain/workspace";
import { EditorSurface } from "./EditorSurface";

interface FakeModel {
  uri: {
    fsPath: string;
    path: string;
  };
}

interface FakeEditor {
  addAction: ReturnType<typeof vi.fn>;
  deltaDecorations: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  getModel: ReturnType<typeof vi.fn>;
  getPosition: ReturnType<typeof vi.fn>;
  mouseDownHandler: ((event: FakeMouseDownEvent) => void) | null;
  onDidChangeCursorPosition: ReturnType<typeof vi.fn>;
  onMouseDown: ReturnType<typeof vi.fn>;
  revealPositionInCenter: ReturnType<typeof vi.fn>;
  setPosition: ReturnType<typeof vi.fn>;
}

interface FakeMouseDownEvent {
  event: {
    preventDefault: ReturnType<typeof vi.fn>;
    stopPropagation: ReturnType<typeof vi.fn>;
  };
  target: {
    position?: EditorPosition;
    type: number;
  };
}

const editorSurfaceMocks = vi.hoisted(() => ({
  editor: null as FakeEditor | null,
  monaco: null as ReturnType<typeof createMonaco> | null,
}));

vi.mock("@monaco-editor/react", async () => {
  const React = await import("react");

  return {
    default: function MonacoEditorMock(props: {
      onMount(editor: FakeEditor, monaco: ReturnType<typeof createMonaco>): void;
    }) {
      React.useEffect(() => {
        if (!editorSurfaceMocks.editor || !editorSurfaceMocks.monaco) {
          throw new Error("EditorSurface test Monaco mocks were not prepared.");
        }

        props.onMount(editorSurfaceMocks.editor, editorSurfaceMocks.monaco);
      }, [props]);

      return React.createElement("div", { "data-testid": "monaco-editor" });
    },
  };
});

describe("EditorSurface", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    editorSurfaceMocks.editor = null;
    editorSurfaceMocks.monaco = null;
  });

  it("renders clickable implementation gutter icons for PHP interface methods", async () => {
    const activeDocument: EditorDocument = {
      content: `<?php

interface ParserFactory
{
    public function getParser(string $apiVersion): ParserInterface;
}
`,
      language: "php",
      name: "ParserFactory.php",
      path: "/workspace/src/ParserFactory.php",
      savedContent: "",
    };
    const model: FakeModel = {
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    const onGoToImplementationAt = vi.fn();
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          monacoTheme="vs-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={onGoToImplementationAt}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    const decorationCall = editor.deltaDecorations.mock.calls.find(
      ([, decorations]) => decorations.length === 1,
    );
    expect(decorationCall?.[1]).toEqual([
      {
        options: expect.objectContaining({
          glyphMargin: {
            position: monaco.editor.GlyphMarginLane.Center,
          },
          glyphMarginClassName: "implementation-gutter-glyph",
        }),
        range: expect.objectContaining({
          endColumn: 1,
          endLineNumber: 5,
          startColumn: 1,
          startLineNumber: 5,
        }),
      },
    ]);

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    act(() => {
      editor.mouseDownHandler?.({
        event: {
          preventDefault,
          stopPropagation,
        },
        target: {
          position: {
            column: 1,
            lineNumber: 5,
          },
          type: monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN,
        },
      });
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(onGoToImplementationAt).toHaveBeenCalledWith({
      column: 21,
      lineNumber: 5,
    });
  });
});

function createEditor(model: FakeModel): FakeEditor {
  const editor: FakeEditor = {
    addAction: vi.fn(() => ({ dispose: vi.fn() })),
    deltaDecorations: vi.fn((_oldDecorations: string[], decorations: any[]) =>
      decorations.map((_, index) => `implementation-gutter-${index}`),
    ),
    focus: vi.fn(),
    getModel: vi.fn(() => model),
    getPosition: vi.fn(() => ({
      column: 1,
      lineNumber: 1,
    })),
    mouseDownHandler: null,
    onDidChangeCursorPosition: vi.fn(() => ({ dispose: vi.fn() })),
    onMouseDown: vi.fn((handler: (event: FakeMouseDownEvent) => void) => {
      editor.mouseDownHandler = handler;

      return { dispose: vi.fn() };
    }),
    revealPositionInCenter: vi.fn(),
    setPosition: vi.fn(),
  };

  return editor;
}

function createMonaco(model: FakeModel) {
  return {
    editor: {
      defineTheme: vi.fn(),
      getModels: vi.fn(() => [model]),
      GlyphMarginLane: { Center: 2 },
      MouseTargetType: { GUTTER_GLYPH_MARGIN: 4 },
      setModelMarkers: vi.fn(),
      TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
    },
    KeyCode: {
      BracketLeft: 5,
      BracketRight: 6,
      KeyB: 1,
      KeyO: 2,
      KeyP: 3,
      KeyR: 4,
      KeyW: 7,
    },
    KeyMod: { CtrlCmd: 2048 },
    languages: {
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      CompletionItemKind: { Method: 2, Text: 1, Variable: 6 },
      registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
      registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() })),
      registerSignatureHelpProvider: vi.fn(() => ({ dispose: vi.fn() })),
      SignatureHelpTriggerKind: { Invoke: 1 },
    },
    MarkerSeverity: {
      Error: 8,
      Hint: 1,
      Info: 2,
      Warning: 4,
    },
    Range: class FakeRange {
      endColumn: number;
      endLineNumber: number;
      startColumn: number;
      startLineNumber: number;

      constructor(
        startLineNumber: number,
        startColumn: number,
        endLineNumber: number,
        endColumn: number,
      ) {
        this.startLineNumber = startLineNumber;
        this.startColumn = startColumn;
        this.endLineNumber = endLineNumber;
        this.endColumn = endColumn;
      }
    },
  };
}

function languageServerFeaturesGateway() {
  return {
    completion: vi.fn(),
    definition: vi.fn(),
    hover: vi.fn(),
    implementation: vi.fn(),
    signatureHelp: vi.fn(),
  };
}
