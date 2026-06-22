// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EditorPosition,
  LanguageServerDocumentSymbol,
} from "../domain/languageServerFeatures";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import { defaultKeymapSettings } from "../domain/keymap";
import { editorChangeHunks } from "../domain/editorChangeMarkers";
import type { EditorDocument } from "../domain/workspace";
import { EditorSurface } from "./EditorSurface";

interface FakeModel {
  getLineContent?: ReturnType<typeof vi.fn>;
  getLineCount?: ReturnType<typeof vi.fn>;
  getValue?: ReturnType<typeof vi.fn>;
  uri: {
    fsPath: string;
    path: string;
  };
}

interface FakeEditor {
  addAction: ReturnType<typeof vi.fn>;
  deltaDecorations: ReturnType<typeof vi.fn>;
  executeEdits: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  getLayoutInfo: ReturnType<typeof vi.fn>;
  getModel: ReturnType<typeof vi.fn>;
  getPosition: ReturnType<typeof vi.fn>;
  getSelection: ReturnType<typeof vi.fn>;
  getScrollTop: ReturnType<typeof vi.fn>;
  getTopForLineNumber: ReturnType<typeof vi.fn>;
  mouseDownHandler: ((event: FakeMouseDownEvent) => void) | null;
  modelContentChangeHandler:
    | ((
        event: {
          changes: Array<{
            range?: {
              startLineNumber: number;
            };
            text: string;
          }>;
        },
      ) => void)
    | null;
  onDidChangeCursorPosition: ReturnType<typeof vi.fn>;
  onDidChangeModelContent: ReturnType<typeof vi.fn>;
  onMouseDown: ReturnType<typeof vi.fn>;
  revealPositionInCenter: ReturnType<typeof vi.fn>;
  setPosition: ReturnType<typeof vi.fn>;
  setSelection: ReturnType<typeof vi.fn>;
  trigger: ReturnType<typeof vi.fn>;
}

interface FakeMouseDownEvent {
  event: {
    preventDefault: ReturnType<typeof vi.fn>;
    stopPropagation: ReturnType<typeof vi.fn>;
  };
  target: {
    detail?: {
      glyphMarginLane?: number;
    };
    position?: EditorPosition;
    type: number;
  };
}

const editorSurfaceMocks = vi.hoisted(() => ({
  editor: null as FakeEditor | null,
  monaco: null as ReturnType<typeof createMonaco> | null,
  props: null as { options?: Record<string, unknown> } | null,
}));

vi.mock("@monaco-editor/react", async () => {
  const React = await import("react");

  return {
    default: function MonacoEditorMock(props: {
      onMount(editor: FakeEditor, monaco: ReturnType<typeof createMonaco>): void;
      options?: Record<string, unknown>;
    }) {
      React.useEffect(() => {
        if (!editorSurfaceMocks.editor || !editorSurfaceMocks.monaco) {
          throw new Error("EditorSurface test Monaco mocks were not prepared.");
        }

        editorSurfaceMocks.props = props;
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
    editorSurfaceMocks.props = null;
  });

  it("configures responsive suggestions and parameter hints", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: "",
    };
    const model: FakeModel = {
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          javaScriptTypeScriptValidationEnabled={true}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onEditorFocused={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    expect(editorSurfaceMocks.props?.options).toEqual(
      expect.objectContaining({
        parameterHints: {
          cycle: true,
          enabled: true,
        },
        quickSuggestions: {
          comments: false,
          other: true,
          strings: true,
        },
        quickSuggestionsDelay: 10,
        suggestOnTriggerCharacters: true,
      }),
    );
  });

  it("detects indentation from the file so manual formatting respects its style", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: "",
    };
    const model: FakeModel = {
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          javaScriptTypeScriptValidationEnabled={true}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onEditorFocused={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    expect(editorSurfaceMocks.props?.options).toEqual(
      expect.objectContaining({
        detectIndentation: true,
      }),
    );
  });

  it("enables the Monaco formatOnPaste option when the setting is enabled", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: "",
    };
    const model: FakeModel = {
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          formatOnPaste={true}
          languageServerDiagnosticsByPath={{}}
          javaScriptTypeScriptValidationEnabled={true}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onEditorFocused={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    expect(editorSurfaceMocks.props?.options).toEqual(
      expect.objectContaining({
        formatOnPaste: true,
      }),
    );
  });

  it("disables the Monaco formatOnPaste option when the setting is disabled", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: "",
    };
    const model: FakeModel = {
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          formatOnPaste={false}
          languageServerDiagnosticsByPath={{}}
          javaScriptTypeScriptValidationEnabled={true}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onEditorFocused={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    expect(editorSurfaceMocks.props?.options).toEqual(
      expect.objectContaining({
        formatOnPaste: false,
      }),
    );
  });

  it("passes Monaco read-only options for read-only documents", async () => {
    const activeDocument: EditorDocument = {
      content: "declare const value: string;\n",
      language: "typescript",
      name: "pkg.d.ts",
      path: "/external/types/pkg.d.ts",
      readOnly: true,
      savedContent: "declare const value: string;\n",
    };
    const model: FakeModel = {
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onEditorFocused={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    expect(editorSurfaceMocks.props?.options).toEqual(
      expect.objectContaining({
        domReadOnly: true,
        readOnly: true,
      }),
    );
  });

  it("keeps Monaco JavaScript and TypeScript built-in providers active unless the managed runtime matches the workspace, while never enabling built-in diagnostics", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: "",
    };
    const model: FakeModel = {
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const monaco = createMonaco(model);
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = monaco;
    const renderSurface = (
      javaScriptTypeScriptLanguageServerRuntimeStatus: LanguageServerRuntimeStatus | null,
    ) =>
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          javaScriptTypeScriptLanguageServerRuntimeStatus={
            javaScriptTypeScriptLanguageServerRuntimeStatus
          }
          javaScriptTypeScriptValidationEnabled={true}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onEditorFocused={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
          workspaceRoot="/workspace"
        />,
      );

    await act(async () => {
      renderSurface({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running",
        sessionId: 1,
      });
      await Promise.resolve();
    });

    expect(latestTypeScriptModeConfiguration(monaco)).toEqual(
      expect.objectContaining({
        completionItems: true,
        diagnostics: false,
        hovers: true,
      }),
    );
    expect(latestTypeScriptDiagnosticsOptions(monaco)).toEqual({
      noSemanticValidation: true,
      noSuggestionDiagnostics: true,
      noSyntaxValidation: true,
    });

    await act(async () => {
      renderSurface({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running",
        rootPath: "/other",
        sessionId: 2,
      });
      await Promise.resolve();
    });

    expect(latestTypeScriptModeConfiguration(monaco)).toEqual(
      expect.objectContaining({
        completionItems: true,
        diagnostics: false,
        hovers: true,
      }),
    );

    await act(async () => {
      renderSurface({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running",
        rootPath: "/workspace/",
        sessionId: 3,
      });
      await Promise.resolve();
    });

    expect(latestTypeScriptModeConfiguration(monaco)).toEqual(
      expect.objectContaining({
        completionItems: false,
        diagnostics: false,
        hovers: false,
      }),
    );
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
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={onGoToImplementationAt}
          onEditorFocused={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
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

  it("reopens PHP suggestions when IDE readiness changes in member access context", async () => {
    const content = "<?php\n$comment->\n";
    const activeDocument: EditorDocument = {
      content,
      language: "php",
      name: "CommentController.php",
      path: "/workspace/src/CommentController.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getValue: vi.fn(() => content),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const editor = createEditor(model);
    editor.getPosition.mockReturnValue({
      column: 11,
      lineNumber: 2,
    });
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(model);

    const render = (
      phpIdeReadinessVersion: number,
      providePhpMethodCompletions = vi.fn(async () => []),
    ) =>
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          phpIdeReadinessVersion={phpIdeReadinessVersion}
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onEditorFocused={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={providePhpMethodCompletions}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );

    await act(async () => {
      render(0);
      await Promise.resolve();
    });
    editor.trigger.mockClear();

    await act(async () => {
      render(1);
      await Promise.resolve();
    });

    expect(editor.trigger).toHaveBeenCalledWith(
      "mockor.phpIdeReadiness",
      "editor.action.triggerSuggest",
      {},
    );
  });

  it("reopens PHP suggestions when IDE readiness changes in Laravel scoped strings", async () => {
    const content = "<?php\nAuth::guard('ad');\n";
    const activeDocument: EditorDocument = {
      content,
      language: "php",
      name: "AuthController.php",
      path: "/workspace/src/AuthController.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getValue: vi.fn(() => content),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const editor = createEditor(model);
    editor.getPosition.mockReturnValue({
      column: 16,
      lineNumber: 2,
    });
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(model);

    const render = (phpIdeReadinessVersion: number) =>
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          phpIdeReadinessVersion={phpIdeReadinessVersion}
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onEditorFocused={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );

    await act(async () => {
      render(0);
      await Promise.resolve();
    });
    editor.trigger.mockClear();

    await act(async () => {
      render(1);
      await Promise.resolve();
    });

    expect(editor.trigger).toHaveBeenCalledWith(
      "mockor.phpIdeReadiness",
      "editor.action.triggerSuggest",
      {},
    );
  });

  it("reopens PHP suggestions when the IDE method provider becomes ready", async () => {
    const content = "<?php\n$comment->\n";
    const activeDocument: EditorDocument = {
      content,
      language: "php",
      name: "CommentController.php",
      path: "/workspace/src/CommentController.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getValue: vi.fn(() => content),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const editor = createEditor(model);
    editor.getPosition.mockReturnValue({
      column: 11,
      lineNumber: 2,
    });
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(model);
    const emptyProvider = vi.fn(async () => []);
    const readyProvider = vi.fn(async () => [
      {
        declaringClassName: "App\\Models\\Comment",
        name: "forceDelete",
        parameters: "",
        returnType: "bool",
      },
    ]);

    const render = (
      providePhpMethodCompletions: typeof emptyProvider | typeof readyProvider,
    ) =>
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          phpIdeReadinessVersion={1}
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onEditorFocused={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={providePhpMethodCompletions}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );

    await act(async () => {
      render(emptyProvider);
      await Promise.resolve();
    });
    editor.trigger.mockClear();

    await act(async () => {
      render(readyProvider);
      await Promise.resolve();
    });

    expect(editor.trigger).toHaveBeenCalledWith(
      "mockor.phpIdeReadiness",
      "editor.action.triggerSuggest",
      {},
    );
  });

  it("preserves language-server diagnostic ranges and tags on Monaco markers", async () => {
    const activeDocument: EditorDocument = {
      content: "const unused =\n  deprecatedValue;\n",
      language: "typescript",
      name: "user.ts",
      path: "/workspace/src/user.ts",
      savedContent: "const unused =\n  deprecatedValue;\n",
    };
    const model: FakeModel = {
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{
            [activeDocument.path]: [
              {
                character: 6,
                code: 6133,
                codeDescriptionHref: "https://typescript.tv/errors/6133",
                data: { fixId: "disableUnusedCheck" },
                endCharacter: 17,
                endLine: 1,
                line: 0,
                message: "'unused' is declared but its value is never read.",
                relatedInformation: [
                  {
                    character: 9,
                    endCharacter: 20,
                    endLine: 4,
                    line: 4,
                    message: "The expected type comes from this property.",
                    uri: "file:///workspace/src/types.ts",
                  },
                ],
                severity: "hint",
                source: "typescript",
                tags: [1, 2],
              },
            ],
          }}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onEditorFocused={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    expect(monaco.editor.setModelMarkers).toHaveBeenCalledWith(
      model,
      "php-language-server",
      [
        expect.objectContaining({
          code: {
            target: { uri: "https://typescript.tv/errors/6133" },
            value: "6133",
          },
          data: { fixId: "disableUnusedCheck" },
          endColumn: 18,
          endLineNumber: 2,
          message: "'unused' is declared but its value is never read.",
          startColumn: 7,
          startLineNumber: 1,
          relatedInformation: [
            {
              endColumn: 21,
              endLineNumber: 5,
              message: "The expected type comes from this property.",
              resource: { uri: "file:///workspace/src/types.ts" },
              startColumn: 10,
              startLineNumber: 5,
            },
          ],
          tags: [monaco.MarkerTag.Unnecessary, monaco.MarkerTag.Deprecated],
        }),
      ],
    );

    const diagnosticDecorationCall = editor.deltaDecorations.mock.calls.find(
      ([, decorations]) =>
        decorations.some(
          (decoration: any) =>
            decoration.options?.overviewRuler?.position ===
            monaco.editor.OverviewRulerLane.Right,
        ),
    );
    expect(diagnosticDecorationCall?.[1]).toEqual([
      expect.objectContaining({
        range: expect.objectContaining({
          endColumn: 18,
          endLineNumber: 2,
          startColumn: 7,
          startLineNumber: 1,
        }),
      }),
    ]);
  });

  it("registers guarded Option+Enter quick fix/context actions", async () => {
    const activeDocument: EditorDocument = {
      content: "<?php echo $user;",
      language: "php",
      name: "User.php",
      path: "/workspace/src/User.php",
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
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onEditorFocused={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    const quickFixAction = editor.addAction.mock.calls
      .map(([action]) => action)
      .find((action) => action.id === "mockor.quickFix");

    expect(quickFixAction).toEqual(
      expect.objectContaining({
        keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.Enter],
        label: "Show Context Actions",
      }),
    );

    quickFixAction.run();

    expect(editor.trigger).not.toHaveBeenCalled();

    monaco.editor.getModelMarkers.mockReturnValue([
      {
        endColumn: 12,
        endLineNumber: 1,
        message: 'Unexpected bare PHP identifier "bad".',
        severity: monaco.MarkerSeverity.Error,
        source: "PHP Syntax",
        startColumn: 9,
        startLineNumber: 1,
      },
    ]);

    quickFixAction.run();

    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.quickFix",
      {},
    );
  });

  it("extends selection from identifier to full member call with Option+Up", async () => {
    const line =
      "$comment = $this->commentRepository->findOrFail($request->getCommentId());";
    const activeDocument: EditorDocument = {
      content: `<?php\n${line}\n`,
      language: "php",
      name: "CommentController.php",
      path: "/workspace/app/CommentController.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getLineContent: vi.fn(() => line),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    const methodStart = line.indexOf("getCommentId");
    const expressionStart = line.indexOf("$request");
    const expressionEnd = line.indexOf(")", methodStart) + 1;
    editor.getPosition.mockReturnValue({
      column: methodStart + 4,
      lineNumber: 2,
    });
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onEditorFocused={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    const extendSelectionAction = editor.addAction.mock.calls
      .map(([action]) => action)
      .find((action) => action.id === "mockor.extendSelection");

    expect(extendSelectionAction).toEqual(
      expect.objectContaining({
        keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.UpArrow],
        label: "Extend Selection",
      }),
    );

    extendSelectionAction.run();

    expect(editor.setSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        endColumn: methodStart + "getCommentId".length + 1,
        endLineNumber: 2,
        startColumn: methodStart + 1,
        startLineNumber: 2,
      }),
    );

    extendSelectionAction.run();

    expect(editor.setSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        endColumn: expressionEnd + 1,
        endLineNumber: 2,
        startColumn: expressionStart + 1,
        startLineNumber: 2,
      }),
    );
  });

  it("extends JavaScript member calls with the same global action", async () => {
    const line = "const id = request.getCommentId(user.id);";
    const activeDocument: EditorDocument = {
      content: line,
      language: "typescript",
      name: "comment.ts",
      path: "/workspace/comment.ts",
      savedContent: "",
    };
    const model: FakeModel = {
      getLineContent: vi.fn(() => line),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    const methodStart = line.indexOf("getCommentId");
    const expressionStart = line.indexOf("request");
    const expressionEnd = line.indexOf(";", methodStart);
    editor.getPosition.mockReturnValue({
      column: methodStart + 4,
      lineNumber: 1,
    });
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onEditorFocused={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    const extendSelectionAction = editor.addAction.mock.calls
      .map(([action]) => action)
      .find((action) => action.id === "mockor.extendSelection");

    extendSelectionAction.run();
    extendSelectionAction.run();

    expect(editor.setSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        endColumn: expressionEnd + 1,
        endLineNumber: 1,
        startColumn: expressionStart + 1,
        startLineNumber: 1,
      }),
    );
  });

  it("routes JavaScript and TypeScript navigation through workbench actions", async () => {
    const activeDocument: EditorDocument = {
      content: "export class UserService {}\n",
      language: "typescript",
      name: "UserService.ts",
      path: "/workspace/src/UserService.ts",
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
    const onGoToDefinition = vi.fn();
    const onGoToImplementationAt = vi.fn();
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={onGoToDefinition}
          onGoToImplementationAt={onGoToImplementationAt}
          onEditorFocused={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    const actions = editor.addAction.mock.calls.map(([action]) => action);
    actions.find((action) => action.id === "mockor.goToDefinition")?.run();
    actions.find((action) => action.id === "mockor.goToImplementation")?.run();

    expect(onGoToDefinition).toHaveBeenCalledTimes(1);
    expect(onGoToImplementationAt).toHaveBeenCalledWith({
      column: 1,
      lineNumber: 1,
    });
    expect(editor.trigger).not.toHaveBeenCalledWith(
      "keyboard",
      "editor.action.revealDefinition",
      {},
    );
    expect(editor.trigger).not.toHaveBeenCalledWith(
      "keyboard",
      "editor.action.goToImplementation",
      {},
    );
  });

  it("notifies when the editor panel receives focus back", async () => {
    const activeDocument: EditorDocument = {
      content: "<?php echo $user;",
      language: "php",
      name: "User.php",
      path: "/workspace/src/User.php",
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
    const onEditorFocused = vi.fn();
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onEditorFocused={onEditorFocused}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    act(() => {
      host.querySelector<HTMLElement>(".editor-panel")?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      );
    });

    expect(onEditorFocused).toHaveBeenCalled();
  });

  it("keeps a new blank PHP line aligned with the surrounding block", async () => {
    const lines = [
      "<?php",
      "class CommentController",
      "{",
      "    public function getOne(): JsonResponse",
      "    {",
      "        $comment = $this->commentRepository->findOrFail($id);",
      "",
      "        return new CommentResource($comment);",
      "    }",
      "}",
    ];
    const activeDocument: EditorDocument = {
      content: lines.join("\n"),
      language: "php",
      name: "CommentController.php",
      path: "/workspace/app/CommentController.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getLineContent: vi.fn((lineNumber: number) => lines[lineNumber - 1] ?? ""),
      getLineCount: vi.fn(() => lines.length),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    editor.getPosition.mockReturnValue({
      column: 1,
      lineNumber: 7,
    });
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onEditorFocused={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    act(() => {
      editor.modelContentChangeHandler?.({
        changes: [{ text: "\n" }],
      });
    });

    expect(editor.executeEdits).toHaveBeenCalledWith(
      "mockor.smartBlankLineIndent",
      [
        {
          forceMoveMarkers: true,
          range: expect.objectContaining({
            endColumn: 1,
            endLineNumber: 7,
            startColumn: 1,
            startLineNumber: 7,
          }),
          text: "        ",
        },
      ],
    );
    expect(editor.setPosition).toHaveBeenCalledWith({
      column: 9,
      lineNumber: 7,
    });
  });

  it("aligns a whitespace-only PHP line when typing space inside a block", async () => {
    const lines = [
      "<?php",
      "class CommentController",
      "{",
      "    public function getOne(): JsonResponse",
      "    {",
      "        $comment = $this->commentRepository->findOrFail($id);",
      " ",
      "        return new CommentResource($comment);",
      "    }",
      "}",
    ];
    const activeDocument: EditorDocument = {
      content: lines.join("\n"),
      language: "php",
      name: "CommentController.php",
      path: "/workspace/app/CommentController.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getLineContent: vi.fn((lineNumber: number) => lines[lineNumber - 1] ?? ""),
      getLineCount: vi.fn(() => lines.length),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    editor.getPosition.mockReturnValue({
      column: 2,
      lineNumber: 7,
    });
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onEditorFocused={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    act(() => {
      editor.modelContentChangeHandler?.({
        changes: [{ text: " " }],
      });
    });

    expect(editor.executeEdits).toHaveBeenCalledWith(
      "mockor.smartBlankLineIndent",
      [
        {
          forceMoveMarkers: true,
          range: expect.objectContaining({
            endColumn: 2,
            endLineNumber: 7,
            startColumn: 1,
            startLineNumber: 7,
          }),
          text: "        ",
        },
      ],
    );
    expect(editor.setPosition).toHaveBeenCalledWith({
      column: 9,
      lineNumber: 7,
    });
  });

  it("keeps Enter from an indented blank PHP line aligned even before Monaco moves the cursor", async () => {
    const lines = [
      "<?php",
      "class CommentController",
      "{",
      "    public function getOne(): JsonResponse",
      "    {",
      "        $comment = $this->commentRepository->findOrFail($id);",
      "        ",
      "",
      "        return new CommentResource($comment);",
      "    }",
      "}",
    ];
    const activeDocument: EditorDocument = {
      content: lines.join("\n"),
      language: "php",
      name: "CommentController.php",
      path: "/workspace/app/CommentController.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getLineContent: vi.fn((lineNumber: number) => lines[lineNumber - 1] ?? ""),
      getLineCount: vi.fn(() => lines.length),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    editor.getPosition.mockReturnValue({
      column: 9,
      lineNumber: 7,
    });
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onEditorFocused={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    act(() => {
      editor.modelContentChangeHandler?.({
        changes: [
          {
            range: {
              startLineNumber: 7,
            },
            text: "\n",
          },
        ],
      });
    });

    expect(editor.executeEdits).toHaveBeenCalledWith(
      "mockor.smartBlankLineIndent",
      [
        {
          forceMoveMarkers: true,
          range: expect.objectContaining({
            endColumn: 1,
            endLineNumber: 8,
            startColumn: 1,
            startLineNumber: 8,
          }),
          text: "        ",
        },
      ],
    );
    expect(editor.setPosition).toHaveBeenCalledWith({
      column: 9,
      lineNumber: 8,
    });
  });

  it("aligns a whitespace-only PHP line after a closing brace with the next statement", async () => {
    const lines = [
      "<?php",
      "class CommentController",
      "{",
      "    public function getOne(): JsonResponse",
      "    {",
      "        if ($comment) {",
      "            $comment->touch();",
      "        }",
      " ",
      "        return new CommentResource($comment);",
      "    }",
      "}",
    ];
    const activeDocument: EditorDocument = {
      content: lines.join("\n"),
      language: "php",
      name: "CommentController.php",
      path: "/workspace/app/CommentController.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getLineContent: vi.fn((lineNumber: number) => lines[lineNumber - 1] ?? ""),
      getLineCount: vi.fn(() => lines.length),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    editor.getPosition.mockReturnValue({
      column: 2,
      lineNumber: 9,
    });
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onEditorFocused={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    act(() => {
      editor.modelContentChangeHandler?.({
        changes: [{ text: " " }],
      });
    });

    expect(editor.executeEdits).toHaveBeenCalledWith(
      "mockor.smartBlankLineIndent",
      [
        {
          forceMoveMarkers: true,
          range: expect.objectContaining({
            endColumn: 2,
            endLineNumber: 9,
            startColumn: 1,
            startLineNumber: 9,
          }),
          text: "        ",
        },
      ],
    );
    expect(editor.setPosition).toHaveBeenCalledWith({
      column: 9,
      lineNumber: 9,
    });
  });

  it("previews and reverts local editor changes from the gutter", async () => {
    const activeDocument: EditorDocument = {
      content: "<?php\n$comment = 'new';\n",
      language: "php",
      name: "CommentController.php",
      path: "/workspace/src/CommentController.php",
      savedContent: "<?php\n$comment = 'old';\n",
    };
    const changeHunks = editorChangeHunks(
      activeDocument.savedContent,
      activeDocument.content,
    );
    const model: FakeModel = {
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    const onRevertChangeHunk = vi.fn();
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={changeHunks}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onEditorFocused={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={onRevertChangeHunk}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    const changeDecorationCall = editor.deltaDecorations.mock.calls.find(
      ([, decorations]) =>
        decorations.some(
          (decoration: any) =>
            decoration.options.glyphMarginClassName ===
            "editor-change-glyph editor-change-glyph-modified",
        ),
    );
    expect(changeDecorationCall?.[1]).toEqual([
      expect.objectContaining({
        options: expect.objectContaining({
          glyphMargin: {
            position: monaco.editor.GlyphMarginLane.Left,
          },
          glyphMarginClassName:
            "editor-change-glyph editor-change-glyph-modified",
          linesDecorationsClassName:
            "editor-change-line editor-change-line-modified",
        }),
        range: expect.objectContaining({
          endLineNumber: 2,
          startLineNumber: 2,
        }),
      }),
    ]);

    act(() => {
      editor.mouseDownHandler?.({
        event: {
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        },
        target: {
          detail: {
            glyphMarginLane: monaco.editor.GlyphMarginLane.Left,
          },
          position: {
            column: 1,
            lineNumber: 2,
          },
          type: monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN,
        },
      });
    });

    expect(host.textContent).toContain("Modified lines");
    expect(host.textContent).toContain("$comment = 'old';");
    const popover = queryRequired<HTMLElement>(host, ".editor-change-popover");
    expect(popover.classList.contains("editor-change-popover-modified")).toBe(
      true,
    );
    expect(popover.style.left).toBe("92px");
    expect(popover.style.top).toBe("56px");

    act(() => {
      queryRequired<HTMLButtonElement>(
        host,
        ".editor-change-popover-action",
      ).click();
    });

    expect(onRevertChangeHunk).toHaveBeenCalledWith(changeHunks[0]);
  });

  it("anchors local change previews to the clicked line inside a larger hunk", async () => {
    const activeDocument: EditorDocument = {
      content: "<?php\n$first = 'new';\n$second = 'new';\n",
      language: "php",
      name: "CommentController.php",
      path: "/workspace/src/CommentController.php",
      savedContent: "<?php\n$first = 'old';\n$second = 'old';\n",
    };
    const changeHunks = editorChangeHunks(
      activeDocument.savedContent,
      activeDocument.content,
    );
    const model: FakeModel = {
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={changeHunks}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onEditorFocused={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    expect(changeHunks[0]).toEqual(
      expect.objectContaining({
        endLineNumber: 3,
        startLineNumber: 2,
      }),
    );

    act(() => {
      editor.mouseDownHandler?.({
        event: {
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        },
        target: {
          detail: {
            glyphMarginLane: monaco.editor.GlyphMarginLane.Left,
          },
          position: {
            column: 1,
            lineNumber: 3,
          },
          type: monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN,
        },
      });
    });

    const popover = queryRequired<HTMLElement>(host, ".editor-change-popover");
    expect(popover.style.left).toBe("92px");
    expect(popover.style.top).toBe("76px");
  });

  it("renders a breadcrumb bar from the active document symbols at the cursor", async () => {
    const activeDocument: EditorDocument = {
      content: "export class MyComponent {\n  render() {}\n}\n",
      language: "typescript",
      name: "App.tsx",
      path: "/workspace/src/App.tsx",
      savedContent: "",
    };
    const model: FakeModel = {
      getValue: vi.fn(() => activeDocument.content),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    const gateway = languageServerFeaturesGateway();
    const documentSymbols: LanguageServerDocumentSymbol[] = [
      {
        children: [
          {
            children: [],
            containerName: null,
            detail: null,
            kind: 6,
            name: "render",
            range: {
              start: { line: 1, character: 2 },
              end: { line: 1, character: 12 },
            },
            selectionRange: {
              start: { line: 1, character: 2 },
              end: { line: 1, character: 8 },
            },
          },
        ],
        containerName: null,
        detail: null,
        kind: 5,
        name: "MyComponent",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 2, character: 1 },
        },
        selectionRange: {
          start: { line: 0, character: 13 },
          end: { line: 0, character: 24 },
        },
      },
    ];
    const documentSymbolsMock = vi.fn(async () => documentSymbols);
    gateway.documentSymbols =
      documentSymbolsMock as unknown as typeof gateway.documentSymbols;

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          javaScriptTypeScriptLanguageServerFeaturesGateway={gateway}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onEditorFocused={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
          workspaceRoot="/workspace"
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    expect(documentSymbolsMock).toHaveBeenCalledWith(
      "/workspace",
      activeDocument.path,
    );

    const labels = Array.from(
      host.querySelectorAll<HTMLElement>(".breadcrumb-segment"),
    ).map((segment) => segment.textContent);
    expect(labels).toEqual(["App.tsx", "MyComponent"]);

    const symbolSegment = queryRequired<HTMLButtonElement>(
      host,
      ".breadcrumb-symbol",
    );

    act(() => {
      symbolSegment.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(editorSurfaceMocks.editor?.setPosition).toHaveBeenCalledWith({
      lineNumber: 1,
      column: 14,
    });
    expect(
      editorSurfaceMocks.editor?.revealPositionInCenter,
    ).toHaveBeenCalled();
  });

  it("keeps the Monaco editor mounted and overlays an opening state while a file is being opened", async () => {
    const model: FakeModel = {
      uri: {
        fsPath: "inmemory://workbench/empty",
        path: "inmemory://workbench/empty",
      },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={null}
          isOpeningFile={true}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          javaScriptTypeScriptValidationEnabled={true}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onEditorFocused={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="editor-opening"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="monaco-editor"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Open a file to start editing.");
  });

  it("keeps the Monaco editor mounted and overlays the empty placeholder when nothing is open", async () => {
    const model: FakeModel = {
      uri: {
        fsPath: "inmemory://workbench/empty",
        path: "inmemory://workbench/empty",
      },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={null}
          isOpeningFile={false}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          javaScriptTypeScriptValidationEnabled={true}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onEditorFocused={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="editor-opening"]')).toBeNull();
    expect(host.querySelector('[data-testid="editor-empty"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="monaco-editor"]')).not.toBeNull();
    expect(host.textContent).toContain("Open a file to start editing.");
  });

  it("wires a synchronous beforeMount so the dark fallback theme is applied before Shiki loads", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: "",
    };
    const model: FakeModel = {
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onEditorFocused={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    const beforeMount = (
      editorSurfaceMocks.props as { beforeMount?: (m: unknown) => void } | null
    )?.beforeMount;
    expect(beforeMount).toBeTypeOf("function");
  });

  it("renders a dark loading placeholder instead of the default white Monaco loading box", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: "",
    };
    const model: FakeModel = {
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={languageServerFeaturesGateway()}
          languageServerRuntimeStatus={null}
          keymap={defaultKeymapSettings()}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onEditorFocused={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    const loading = (
      editorSurfaceMocks.props as { loading?: unknown } | null
    )?.loading;
    expect(loading).not.toBeNull();
    expect(loading).toBeDefined();
  });
});

function createEditor(model: FakeModel): FakeEditor {
  let selection: {
    endColumn: number;
    endLineNumber: number;
    startColumn: number;
    startLineNumber: number;
  } | null = null;
  const editor: FakeEditor = {
    addAction: vi.fn(() => ({ dispose: vi.fn() })),
    deltaDecorations: vi.fn((_oldDecorations: string[], decorations: any[]) =>
      decorations.map((_, index) => `implementation-gutter-${index}`),
    ),
    executeEdits: vi.fn(),
    focus: vi.fn(),
    getLayoutInfo: vi.fn(() => ({
      contentLeft: 80,
      height: 480,
      width: 900,
    })),
    getModel: vi.fn(() => model),
    getPosition: vi.fn(() => ({
      column: 1,
      lineNumber: 1,
    })),
    getSelection: vi.fn(() => selection),
    getScrollTop: vi.fn(() => 10),
    getTopForLineNumber: vi.fn((lineNumber: number) => lineNumber * 20),
    mouseDownHandler: null,
    modelContentChangeHandler: null,
    onDidChangeCursorPosition: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeModelContent: vi.fn(
      (handler: (event: { changes: Array<{ text: string }> }) => void) => {
        editor.modelContentChangeHandler = handler;

        return { dispose: vi.fn() };
      },
    ),
    onMouseDown: vi.fn((handler: (event: FakeMouseDownEvent) => void) => {
      editor.mouseDownHandler = handler;

      return { dispose: vi.fn() };
    }),
    revealPositionInCenter: vi.fn(),
    setPosition: vi.fn(),
    setSelection: vi.fn((nextSelection) => {
      selection = nextSelection;
    }),
    trigger: vi.fn(),
  };

  return editor;
}

function queryRequired<T extends Element>(
  container: ParentNode,
  selector: string,
): T {
  const element = container.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Expected ${selector} to exist.`);
  }

  return element;
}

function createMonaco(model: FakeModel) {
  const javascriptDefaults = languageDefaults();
  const typescriptDefaults = languageDefaults();

  return {
    editor: {
      addCommand: vi.fn(() => ({ dispose: vi.fn() })),
      defineTheme: vi.fn(),
      getModelMarkers: vi.fn((): any[] => []),
      getModels: vi.fn(() => [model]),
      GlyphMarginLane: { Center: 2, Left: 1 },
      MouseTargetType: { GUTTER_GLYPH_MARGIN: 4 },
      OverviewRulerLane: { Left: 1, Right: 4 },
      setModelMarkers: vi.fn(),
      TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
    },
    KeyCode: {
      BracketLeft: 5,
      BracketRight: 6,
      Enter: 8,
      KeyB: 1,
      KeyO: 2,
      KeyP: 3,
      KeyR: 4,
      KeyW: 7,
      UpArrow: 9,
    },
    KeyMod: { Alt: 512, CtrlCmd: 2048, Shift: 1024, WinCtrl: 4096 },
    MarkerTag: {
      Deprecated: 2,
      Unnecessary: 1,
    },
    languages: {
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      CompletionItemKind: { Method: 2, Text: 1, Variable: 6 },
      registerCodeActionProvider: vi.fn(() => ({ dispose: vi.fn() })),
      registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
      registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() })),
      registerSelectionRangeProvider: vi.fn(() => ({ dispose: vi.fn() })),
      registerSignatureHelpProvider: vi.fn(() => ({ dispose: vi.fn() })),
      SignatureHelpTriggerKind: { Invoke: 1 },
      typescript: {
        javascriptDefaults,
        typescriptDefaults,
        JsxEmit: { ReactJSX: 4 },
        ModuleKind: { ESNext: 99 },
        ModuleResolutionKind: { NodeJs: 2 },
        ScriptTarget: { ESNext: 99 },
      },
    },
    MarkerSeverity: {
      Error: 8,
      Hint: 1,
      Info: 2,
      Warning: 4,
    },
    Uri: {
      parse: vi.fn((uri: string) => ({ uri })),
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

function languageDefaults() {
  return {
    setCompilerOptions: vi.fn(),
    setDiagnosticsOptions: vi.fn(),
    setEagerModelSync: vi.fn(),
    setModeConfiguration: vi.fn(),
  };
}

function latestTypeScriptModeConfiguration(monaco: ReturnType<typeof createMonaco>) {
  const calls =
    monaco.languages.typescript.typescriptDefaults.setModeConfiguration.mock
      .calls;

  return calls[calls.length - 1]?.[0];
}

function latestTypeScriptDiagnosticsOptions(
  monaco: ReturnType<typeof createMonaco>,
) {
  const calls =
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions.mock
      .calls;

  return calls[calls.length - 1]?.[0];
}

function languageServerFeaturesGateway() {
  return {
    codeActions: vi.fn(async () => []),
    codeLenses: vi.fn(async () => []),
    completion: vi.fn(),
    declaration: vi.fn(async () => []),
    definition: vi.fn(),
    didChangeConfiguration: vi.fn(async () => undefined),
    didChangeWatchedFiles: vi.fn(async () => undefined),
    didRenameFiles: vi.fn(async () => undefined),
    documentHighlights: vi.fn(async () => []),
    documentLinks: vi.fn(async () => []),
    documentSymbols: vi.fn(async () => []),
    executeCommand: vi.fn(async () => null),
    foldingRanges: vi.fn(async () => []),
    formatting: vi.fn(async () => []),
    hover: vi.fn(),
    incomingCalls: vi.fn(async () => []),
    implementation: vi.fn(),
    inlayHints: vi.fn(async () => []),
    resolveInlayHint: vi.fn(async (_rootPath, hint) => hint),
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
    selectionRanges: vi.fn(async () => []),
    semanticTokens: vi.fn(async () => null),
    resolveCompletionItem: vi.fn(async (_rootPath, item) => item),
    resolveCodeAction: vi.fn(async (_rootPath, action) => action),
    resolveCodeLens: vi.fn(async (_rootPath, lens) => lens),
    resolveDocumentLink: vi.fn(async (_rootPath, link) => link),
    signatureHelp: vi.fn(),
    sourceDefinition: vi.fn(async () => []),
    typeDefinition: vi.fn(async () => []),
    typeHierarchySubtypes: vi.fn(async () => []),
    typeHierarchySupertypes: vi.fn(async () => []),
    willRenameFiles: vi.fn(async () => null),
    workspaceSymbols: vi.fn(async () => []),
  };
}
