// @vitest-environment jsdom

import { act, createElement, useState, type ReactNode } from "react";
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
  dispose?: ReturnType<typeof vi.fn>;
  getEOL?: ReturnType<typeof vi.fn>;
  getLineContent?: ReturnType<typeof vi.fn>;
  getLineCount?: ReturnType<typeof vi.fn>;
  getLineMaxColumn?: ReturnType<typeof vi.fn>;
  getOptions?: ReturnType<typeof vi.fn>;
  getValue?: ReturnType<typeof vi.fn>;
  getValueInRange?: ReturnType<typeof vi.fn>;
  isDisposed?: ReturnType<typeof vi.fn>;
  tokenization?: {
    forceTokenization: ReturnType<typeof vi.fn>;
  };
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
  getContribution: ReturnType<typeof vi.fn>;
  getLayoutInfo: ReturnType<typeof vi.fn>;
  getModel: ReturnType<typeof vi.fn>;
  getPosition: ReturnType<typeof vi.fn>;
  getSelection: ReturnType<typeof vi.fn>;
  getScrollTop: ReturnType<typeof vi.fn>;
  getTopForLineNumber: ReturnType<typeof vi.fn>;
  cursorPositionHandler:
    | ((event: { position: EditorPosition }) => void)
    | null;
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
  updateOptions: ReturnType<typeof vi.fn>;
}

interface FakeMouseDownEvent {
  event: {
    ctrlKey?: boolean;
    metaKey?: boolean;
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
  renderCount: 0,
  props: null as {
    options?: Record<string, unknown>;
    onChange?: (value: string | undefined) => void;
    beforeMount?: (monaco: unknown) => void;
    loading?: unknown;
  } | null,
  registeredContext: null as {
    isDocumentSynced?: (rootPath: string, path: string) => boolean;
    provideBladeCompletions?: (
      source: string,
      position: { column: number; lineNumber: number },
    ) => unknown;
    provideBladeDefinition?: (source: string, offset: number) => unknown;
    providePhpCodeActions?: (
      source: string,
      range: { end: number; start: number },
    ) => unknown;
    providePhpLaravelDefinition?: (source: string, offset: number) => unknown;
  } | null,
}));

vi.mock("./languageServerMonacoProviders", async () => {
  const actual = await vi.importActual<
    typeof import("./languageServerMonacoProviders")
  >("./languageServerMonacoProviders");

  return {
    ...actual,
    registerLanguageServerMonacoProviders: (
      monaco: unknown,
      context: {
        isDocumentSynced?: (rootPath: string, path: string) => boolean;
        provideBladeCompletions?: (
          source: string,
          position: { column: number; lineNumber: number },
        ) => unknown;
        provideBladeDefinition?: (source: string, offset: number) => unknown;
        providePhpCodeActions?: (source: string) => unknown;
        providePhpLaravelDefinition?: (source: string, offset: number) => unknown;
      },
    ) => {
      editorSurfaceMocks.registeredContext = context;
      return actual.registerLanguageServerMonacoProviders(
        monaco as Parameters<
          typeof actual.registerLanguageServerMonacoProviders
        >[0],
        context as Parameters<
          typeof actual.registerLanguageServerMonacoProviders
        >[1],
      );
    },
  };
});

vi.mock("@monaco-editor/react", async () => {
  const React = await import("react");

  return {
    default: function MonacoEditorMock(props: {
      onMount(editor: FakeEditor, monaco: ReturnType<typeof createMonaco>): void;
      options?: Record<string, unknown>;
    }) {
      editorSurfaceMocks.renderCount += 1;
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
    editorSurfaceMocks.renderCount = 0;
    editorSurfaceMocks.props = null;
    editorSurfaceMocks.registeredContext = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
          onGoToSuperMethod={vi.fn()}
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
        // Alt is the multi-cursor modifier (VS Code/PhpStorm default) so
        // Cmd/Ctrl+Click stays bound to go-to-definition.
        multiCursorModifier: "alt",
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

  it("forwards providePhpCodeActions into the language server provider context", async () => {
    const activeDocument: EditorDocument = {
      content: "<?php\nclass Example {}\n",
      language: "php",
      name: "Example.php",
      path: "/workspace/app/Example.php",
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
    const providePhpCodeActions = vi.fn(async () => []);

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
          onGoToSuperMethod={vi.fn()}
          onEditorFocused={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpCodeActions={providePhpCodeActions}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    const context = editorSurfaceMocks.registeredContext;

    expect(context?.providePhpCodeActions).toEqual(expect.any(Function));

    await context?.providePhpCodeActions?.("<?php\nclass Example {}\n", {
      end: 7,
      start: 7,
    });

    expect(providePhpCodeActions).toHaveBeenCalledWith(
      "<?php\nclass Example {}\n",
      { end: 7, start: 7 },
    );
  });

  it("forwards providePhpLaravelDefinition into the language server provider context", async () => {
    const activeDocument: EditorDocument = {
      content: "<?php\n$value = config('app.name');\n",
      language: "php",
      name: "Service.php",
      path: "/workspace/app/Service.php",
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
    const providePhpLaravelDefinition = vi.fn(async () => true);

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
          onGoToSuperMethod={vi.fn()}
          onEditorFocused={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpLaravelDefinition={providePhpLaravelDefinition}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    const context = editorSurfaceMocks.registeredContext;

    expect(context?.providePhpLaravelDefinition).toEqual(expect.any(Function));

    await context?.providePhpLaravelDefinition?.(
      "<?php\n$value = config('app.name');\n",
      24,
    );

    expect(providePhpLaravelDefinition).toHaveBeenCalledWith(
      "<?php\n$value = config('app.name');\n",
      24,
    );
  });

  it("forwards blade definition and completion callbacks into the provider context", async () => {
    const bladeSource = "@include('partials.alert')\n";
    const activeDocument: EditorDocument = {
      content: bladeSource,
      language: "blade",
      name: "show.blade.php",
      path: "/workspace/resources/views/show.blade.php",
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
    const provideBladeDefinition = vi.fn(async () => true);
    const provideBladeCompletions = vi.fn(async () => [
      {
        insertText: "include",
        kind: "directive" as const,
        label: "@include",
      },
    ]);

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
          onGoToSuperMethod={vi.fn()}
          onEditorFocused={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          provideBladeCompletions={provideBladeCompletions}
          provideBladeDefinition={provideBladeDefinition}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    const context = editorSurfaceMocks.registeredContext;

    expect(context?.provideBladeDefinition).toEqual(expect.any(Function));
    expect(context?.provideBladeCompletions).toEqual(expect.any(Function));

    await context?.provideBladeDefinition?.(bladeSource, 12);
    await context?.provideBladeCompletions?.(bladeSource, {
      column: 12,
      lineNumber: 1,
    });

    expect(provideBladeDefinition).toHaveBeenCalledWith(bladeSource, 12);
    expect(provideBladeCompletions).toHaveBeenCalledWith(bladeSource, {
      column: 12,
      lineNumber: 1,
    });
  });

  it("enables bracket pair colorization and sticky scroll like VS Code", async () => {
    const activeDocument: EditorDocument = {
      content: "function example() {\n  return [1, 2, 3];\n}\n",
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
          onGoToSuperMethod={vi.fn()}
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
        bracketPairColorization: { enabled: true },
        stickyScroll: { enabled: true },
      }),
    );
  });

  it("publishes a synchronous window chrome edit menu runner for Monaco commands", async () => {
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
    const editorMenuCommandRunnerChange = vi.fn();
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
          onGoToSuperMethod={vi.fn()}
          onEditorFocused={vi.fn()}
          onEditorMenuCommandRunnerChange={editorMenuCommandRunnerChange}
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

    const editor = editorSurfaceMocks.editor;
    const runner = editorMenuCommandRunnerChange.mock.calls.find(
      ([candidate]) => typeof candidate === "function",
    )?.[0];

    expect(runner).toEqual(expect.any(Function));

    act(() => {
      runner("undo");
      runner("redo");
      runner("cut");
      runner("copy");
      runner("paste");
      runner("selectAll");
    });

    expect(editor?.focus).toHaveBeenCalledTimes(6);
    expect(editor?.trigger).toHaveBeenNthCalledWith(
      1,
      "mockor.windowChrome",
      "undo",
      null,
    );
    expect(editor?.trigger).toHaveBeenNthCalledWith(
      2,
      "mockor.windowChrome",
      "redo",
      null,
    );
    expect(editor?.trigger).toHaveBeenNthCalledWith(
      3,
      "mockor.windowChrome",
      "editor.action.clipboardCutAction",
      null,
    );
    expect(editor?.trigger).toHaveBeenNthCalledWith(
      4,
      "mockor.windowChrome",
      "editor.action.clipboardCopyAction",
      null,
    );
    expect(editor?.trigger).toHaveBeenNthCalledWith(
      5,
      "mockor.windowChrome",
      "editor.action.clipboardPasteAction",
      null,
    );
    expect(editor?.trigger).toHaveBeenNthCalledWith(
      6,
      "mockor.windowChrome",
      "editor.action.selectAll",
      null,
    );
  });

  it("clears the window chrome edit menu runner when no document is targetable", async () => {
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
    const editorMenuCommandRunnerChange = vi.fn();
    model.dispose = vi.fn();
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);
    const renderSurface = (document: EditorDocument | null) => (
      <EditorSurface
        activeDocument={document}
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
        onGoToSuperMethod={vi.fn()}
        onEditorFocused={vi.fn()}
        onEditorMenuCommandRunnerChange={editorMenuCommandRunnerChange}
        onLanguageServerError={vi.fn()}
        onOpenClass={vi.fn()}
        onOpenFile={vi.fn()}
        onOpenFileStructure={vi.fn()}
        onRevealTargetHandled={vi.fn()}
        onRevertChangeHunk={vi.fn()}
        phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
        providePhpMethodCompletions={vi.fn(async () => [])}
        providePhpMethodSignature={vi.fn(async () => null)}
      />
    );

    await act(async () => {
      root.render(renderSurface(activeDocument));
      await Promise.resolve();
    });

    expect(editorMenuCommandRunnerChange).toHaveBeenCalledWith(
      expect.any(Function),
    );

    await act(async () => {
      root.render(renderSurface(null));
      await Promise.resolve();
    });

    expect(editorMenuCommandRunnerChange).toHaveBeenLastCalledWith(null);
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
          onGoToSuperMethod={vi.fn()}
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

  // Smart Backspace (VS Code / PhpStorm muscle memory): pressing Backspace while
  // the cursor sits inside a line's leading whitespace unindents to the previous
  // tab stop instead of deleting a single space. Monaco provides this natively
  // via `useTabStops`, whose default is `true`, so the only way the project could
  // break it is by explicitly disabling the option. This guards that the editor
  // options never set `useTabStops: false`, preserving the built-in behaviour.
  it("keeps Monaco's useTabStops default so Backspace unindents to the previous tab stop", async () => {
    const activeDocument: EditorDocument = {
      content: "function example() {\n    return 1;\n}\n",
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
          onGoToSuperMethod={vi.fn()}
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

    expect(editorSurfaceMocks.props?.options).toBeDefined();
    expect(editorSurfaceMocks.props?.options?.useTabStops).not.toBe(false);
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
          onGoToSuperMethod={vi.fn()}
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
          onGoToSuperMethod={vi.fn()}
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

  it("passes large-file and scroll guards that keep fast scrolling responsive", async () => {
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
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onGoToSuperMethod={vi.fn()}
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

    // smoothScrolling animates each fling into many onDidScrollChange events,
    // each driving a synchronous viewport tokenization pass. Turning it off
    // keeps fast scrolling of large files responsive. The two length guards cap
    // per-line tokenization and rendering work on extreme lines.
    expect(editorSurfaceMocks.props?.options).toEqual(
      expect.objectContaining({
        smoothScrolling: false,
        maxTokenizationLineLength: 2000,
        stopRenderingLineAfter: 10000,
        largeFileOptimizations: true,
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
          onGoToSuperMethod={vi.fn()}
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

  it("preserves the provided editor font family in Monaco options", async () => {
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
          editorFontFamily="Consolas, monospace"
          editorFontLigatures={true}
          editorFontSize={22}
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
          onGoToSuperMethod={vi.fn()}
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
        fontFamily: "Consolas, monospace",
        fontLigatures: '"liga" on, "calt" on',
        fontSize: 22,
      }),
    );

    expect(editorSurfaceMocks.editor.updateOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        fontFamily: "Consolas, monospace",
        fontLigatures: '"liga" on, "calt" on',
        fontSize: 22,
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
          onGoToSuperMethod={vi.fn()}
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
          onGoToSuperMethod={vi.fn()}
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

    await flushGutterDebounce();

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

  it("renders a run-test gutter glyph and runs the test on a Right-lane click", async () => {
    const activeDocument: EditorDocument = {
      content: `<?php

namespace Tests\\Unit;

use Tests\\TestCase;

class InvoiceServiceTest extends TestCase
{
    public function testItCalculatesTotals(): void
    {
    }
}
`,
      language: "php",
      name: "InvoiceServiceTest.php",
      path: "/workspace/tests/Unit/InvoiceServiceTest.php",
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
    const onRunTestAt = vi.fn();
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          isActiveDocumentPhpTest
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
          onGoToSuperMethod={vi.fn()}
          onRunTestAt={onRunTestAt}
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

    await flushGutterDebounce();

    const testDecorationCall = editor.deltaDecorations.mock.calls.find(
      ([, decorations]) =>
        decorations.some(
          (decoration: any) =>
            decoration.options?.glyphMarginClassName === "test-run-gutter-glyph",
        ),
    );
    expect(testDecorationCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          options: expect.objectContaining({
            glyphMargin: {
              position: monaco.editor.GlyphMarginLane.Right,
            },
            glyphMarginClassName: "test-run-gutter-glyph",
          }),
        }),
      ]),
    );

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    act(() => {
      editor.mouseDownHandler?.({
        event: {
          preventDefault,
          stopPropagation,
        },
        target: {
          detail: {
            glyphMarginLane: monaco.editor.GlyphMarginLane.Right,
          },
          position: {
            column: 1,
            lineNumber: 9,
          },
          type: monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN,
        },
      });
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(onRunTestAt).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: "testItCalculatesTotals",
        kind: "method",
      }),
    );
  });

  it("renders a bookmark gutter marker for bookmarked lines and toggles on a lines-decoration click", async () => {
    const activeDocument: EditorDocument = {
      content: "const one = 1;\nconst two = 2;\nconst three = 3;\n",
      language: "typescript",
      name: "constants.ts",
      path: "/workspace/src/constants.ts",
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
    const onToggleBookmarkAtLine = vi.fn();
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          bookmarkedLineNumbers={[2]}
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
          onGoToSuperMethod={vi.fn()}
          onToggleBookmarkAtLine={onToggleBookmarkAtLine}
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

    const bookmarkDecorationCall = editor.deltaDecorations.mock.calls.find(
      ([, decorations]) =>
        decorations.some(
          (decoration: any) =>
            decoration.options?.linesDecorationsClassName ===
            "bookmark-gutter-glyph",
        ),
    );
    expect(bookmarkDecorationCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          options: expect.objectContaining({
            linesDecorationsClassName: "bookmark-gutter-glyph",
          }),
          range: expect.objectContaining({
            startLineNumber: 2,
          }),
        }),
      ]),
    );

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
            lineNumber: 3,
          },
          type: monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS,
        },
      });
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(onToggleBookmarkAtLine).toHaveBeenCalledWith(3);
  });

  it("routes a Cmd+click on code text through go-to-definition on macOS", async () => {
    stubNavigatorPlatform("MacIntel");

    const activeDocument: EditorDocument = {
      content: "import { value } from './other';\nconsole.log(value);\n",
      language: "typescript",
      name: "main.ts",
      path: "/workspace/src/main.ts",
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
    const position = { column: 13, lineNumber: 2 };
    // The controller reads the active-editor position ref (kept in sync via
    // onCursorPositionChange) when it resolves a definition. Track the latest
    // reported caret and snapshot it at the moment onGoToDefinition runs so the
    // test asserts the caret already points at the clicked symbol by then.
    let lastReportedPosition: EditorPosition | null = null;
    let positionAtNavigation: EditorPosition | null = null;
    const onCursorPositionChange = vi.fn((next: EditorPosition) => {
      lastReportedPosition = next;
    });
    const onGoToDefinition = vi.fn(() => {
      positionAtNavigation = lastReportedPosition;
    });
    // Mirror real Monaco: setPosition synchronously emits onDidChangeCursorPosition
    // so the active-editor-position consumer observes the new caret before the
    // call returns (and thus before onGoToDefinition reads it).
    editor.setPosition.mockImplementation((next: EditorPosition) => {
      editor.cursorPositionHandler?.({ position: next });
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
          onCursorPositionChange={onCursorPositionChange}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={onGoToDefinition}
          onGoToImplementationAt={vi.fn()}
          onGoToSuperMethod={vi.fn()}
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

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    act(() => {
      editor.mouseDownHandler?.({
        event: {
          metaKey: true,
          preventDefault,
          stopPropagation,
        },
        target: {
          position,
          type: monaco.editor.MouseTargetType.CONTENT_TEXT,
        },
      });
    });

    expect(editor.setPosition).toHaveBeenCalledWith(position);
    expect(onGoToDefinition).toHaveBeenCalledTimes(1);
    // The caret must have settled on the clicked symbol before navigation ran:
    // a stale (or null) snapshot here would mean setPosition did not propagate
    // before onGoToDefinition read the position.
    expect(positionAtNavigation).toEqual(position);
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
  });

  it("routes a Ctrl+click on code text through go-to-definition on Linux", async () => {
    stubNavigatorPlatform("Linux x86_64");

    const activeDocument: EditorDocument = {
      content: "import { value } from './other';\nconsole.log(value);\n",
      language: "typescript",
      name: "main.ts",
      path: "/workspace/src/main.ts",
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
          onGoToImplementationAt={vi.fn()}
          onGoToSuperMethod={vi.fn()}
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

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const position = { column: 13, lineNumber: 2 };
    act(() => {
      editor.mouseDownHandler?.({
        event: {
          ctrlKey: true,
          preventDefault,
          stopPropagation,
        },
        target: {
          position,
          type: monaco.editor.MouseTargetType.CONTENT_TEXT,
        },
      });
    });

    expect(editor.setPosition).toHaveBeenCalledWith(position);
    expect(onGoToDefinition).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
  });

  it("does not navigate on a plain click on code text without the definition modifier", async () => {
    stubNavigatorPlatform("MacIntel");

    const activeDocument: EditorDocument = {
      content: "console.log(value);\n",
      language: "typescript",
      name: "main.ts",
      path: "/workspace/src/main.ts",
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
          onGoToImplementationAt={vi.fn()}
          onGoToSuperMethod={vi.fn()}
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

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    act(() => {
      editor.mouseDownHandler?.({
        event: {
          preventDefault,
          stopPropagation,
        },
        target: {
          position: { column: 13, lineNumber: 1 },
          type: monaco.editor.MouseTargetType.CONTENT_TEXT,
        },
      });
    });

    expect(onGoToDefinition).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("leaves the bookmark gutter handler intact for a Cmd+click on the lines-decoration margin", async () => {
    stubNavigatorPlatform("MacIntel");

    const activeDocument: EditorDocument = {
      content: "const one = 1;\nconst two = 2;\n",
      language: "typescript",
      name: "constants.ts",
      path: "/workspace/src/constants.ts",
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
    const onToggleBookmarkAtLine = vi.fn();
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
          onGoToImplementationAt={vi.fn()}
          onGoToSuperMethod={vi.fn()}
          onToggleBookmarkAtLine={onToggleBookmarkAtLine}
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

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    act(() => {
      editor.mouseDownHandler?.({
        event: {
          metaKey: true,
          preventDefault,
          stopPropagation,
        },
        target: {
          position: { column: 1, lineNumber: 2 },
          type: monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS,
        },
      });
    });

    expect(onGoToDefinition).not.toHaveBeenCalled();
    expect(onToggleBookmarkAtLine).toHaveBeenCalledWith(2);
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
          onGoToSuperMethod={vi.fn()}
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
          onGoToSuperMethod={vi.fn()}
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
          onGoToSuperMethod={vi.fn()}
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
          onGoToSuperMethod={vi.fn()}
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

  it("does not re-set language-server markers on a keystroke when diagnostics are unchanged", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "user.ts",
      path: "/workspace/src/user.ts",
      savedContent: "const value = 1;\n",
    };
    const model: FakeModel = {
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const monaco = createMonaco(model);
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = monaco;

    const diagnostics = {
      [activeDocument.path]: [
        {
          character: 6,
          endCharacter: 11,
          endLine: 0,
          line: 0,
          message: "unused",
          severity: "warning" as const,
          source: "typescript",
        },
      ],
    };

    const renderWith = async (document: EditorDocument) => {
      await act(async () => {
        root.render(
          <EditorSurface
            activeDocument={document}
            changeHunks={[]}
            editorRevealTarget={null}
            flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
            languageServerDiagnosticsByPath={diagnostics}
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
            onGoToSuperMethod={vi.fn()}
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
    };

    await renderWith(activeDocument);

    const languageServerMarkerCalls = () =>
      monaco.editor.setModelMarkers.mock.calls.filter(
        ([, owner]) => owner === "php-language-server",
      );

    expect(languageServerMarkerCalls().length).toBeGreaterThan(0);
    monaco.editor.setModelMarkers.mockClear();

    // Simulate a keystroke: useWorkbenchController hands EditorSurface a brand
    // new activeDocument object (same path, mutated content) while the
    // diagnostics map keeps its identity. The marker effect must NOT churn.
    await renderWith({ ...activeDocument, content: "const value = 12;\n" });

    expect(languageServerMarkerCalls()).toHaveLength(0);
  });

  it("does not reopen PHP suggestions per keystroke when readiness is unchanged", async () => {
    const content = "<?php\n$comment->\n";
    const activeDocument: EditorDocument = {
      content,
      language: "php",
      name: "CommentController.php",
      path: "/workspace/src/CommentController.php",
      savedContent: "",
    };
    let modelValue = content;
    const model: FakeModel = {
      getValue: vi.fn(() => modelValue),
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

    // Stable callback identities across renders, matching the memoized callbacks
    // the controller hands EditorSurface. Only the activeDocument object identity
    // changes on a keystroke, which must not re-fire the auto-suggest effect.
    const providePhpMethodCompletions = vi.fn(async () => []);
    const providePhpMethodSignature = vi.fn(async () => null);
    const phpSyntaxDiagnosticsGateway = { validate: vi.fn(async () => []) };

    const renderWith = async (document: EditorDocument) => {
      await act(async () => {
        root.render(
          <EditorSurface
            activeDocument={document}
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
            onGoToSuperMethod={vi.fn()}
            onEditorFocused={vi.fn()}
            onLanguageServerError={vi.fn()}
            onOpenClass={vi.fn()}
            onOpenFile={vi.fn()}
            onOpenFileStructure={vi.fn()}
            onRevealTargetHandled={vi.fn()}
            onRevertChangeHunk={vi.fn()}
            phpSyntaxDiagnosticsGateway={phpSyntaxDiagnosticsGateway}
            providePhpMethodCompletions={providePhpMethodCompletions}
            providePhpMethodSignature={providePhpMethodSignature}
          />,
        );
        await Promise.resolve();
      });
    };

    await renderWith(activeDocument);

    const triggerSuggestCalls = () =>
      editor.trigger.mock.calls.filter(
        ([, action]) => action === "editor.action.triggerSuggest",
      );

    // The auto-suggest fired once when readiness was already at version 1 on
    // mount. A keystroke must not re-fire it.
    expect(triggerSuggestCalls().length).toBeGreaterThan(0);
    editor.trigger.mockClear();

    // Simulate a keystroke: a brand new activeDocument object (same path,
    // mutated content) at the same readiness version.
    modelValue = "<?php\n$comment->x\n";
    await renderWith({ ...activeDocument, content: modelValue });

    expect(triggerSuggestCalls()).toHaveLength(0);
  });

  it("does not re-parse implementation gutter targets per keystroke", async () => {
    vi.useFakeTimers();
    try {
      const firstContent = `<?php

interface PaymentGateway
{
    public function charge(): void;
}
`;
      const activeDocument: EditorDocument = {
        content: firstContent,
        language: "php",
        name: "PaymentGateway.php",
        path: "/workspace/src/PaymentGateway.php",
        savedContent: "",
      };
      const model: FakeModel = {
        uri: {
          fsPath: activeDocument.path,
          path: activeDocument.path,
        },
      };
      const editor = createEditor(model);
      editorSurfaceMocks.editor = editor;
      editorSurfaceMocks.monaco = createMonaco(model);

      const renderWith = async (document: EditorDocument) => {
        await act(async () => {
          root.render(
            <EditorSurface
              activeDocument={document}
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
              onGoToSuperMethod={vi.fn()}
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
      };

      const gutterDecorationCalls = () =>
        editor.deltaDecorations.mock.calls.filter(([, decorations]) =>
          (decorations as any[]).some(
            (decoration) =>
              decoration.options?.glyphMarginClassName ===
              "implementation-gutter-glyph",
          ),
        );

      await renderWith(activeDocument);
      await act(async () => {
        vi.advanceTimersByTime(200);
        await Promise.resolve();
      });

      // The initial parse rendered one implementation glyph for the interface
      // method declaration.
      expect(gutterDecorationCalls().length).toBeGreaterThan(0);
      editor.deltaDecorations.mockClear();

      // Simulate a keystroke: same path, mutated content. The gutter must NOT
      // re-parse + re-decorate synchronously during typing.
      const secondContent = `<?php

interface PaymentGateway
{
    public function charge(): void;
    public function refund(): void;
}
`;
      await renderWith({ ...activeDocument, content: secondContent });

      expect(gutterDecorationCalls()).toHaveLength(0);

      // After the debounce window the gutter catches up with the new content.
      await act(async () => {
        vi.advanceTimersByTime(200);
        await Promise.resolve();
      });

      expect(gutterDecorationCalls().length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces the impl gutter, test gutter and syntax diagnostics into a single debounce per edit", async () => {
    vi.useFakeTimers();
    try {
      const firstContent = `<?php

class InvoiceServiceTest
{
    public function testCharges(): void
    {
    }
}
`;
      const activeDocument: EditorDocument = {
        content: firstContent,
        language: "php",
        name: "InvoiceServiceTest.php",
        path: "/workspace/tests/Unit/InvoiceServiceTest.php",
        savedContent: "",
      };
      const model: FakeModel = {
        uri: {
          fsPath: activeDocument.path,
          path: activeDocument.path,
        },
      };
      const editor = createEditor(model);
      const monaco = createMonaco(model);
      const validate = vi.fn(async () => []);
      const gateway = { validate };
      editorSurfaceMocks.editor = editor;
      editorSurfaceMocks.monaco = monaco;

      const renderWith = async (document: EditorDocument) => {
        await act(async () => {
          root.render(
            <EditorSurface
              activeDocument={document}
              changeHunks={[]}
              editorRevealTarget={null}
              flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
              isActiveDocumentPhpTest
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
              onGoToSuperMethod={vi.fn()}
              onEditorFocused={vi.fn()}
              onLanguageServerError={vi.fn()}
              onOpenClass={vi.fn()}
              onOpenFile={vi.fn()}
              onOpenFileStructure={vi.fn()}
              onRevealTargetHandled={vi.fn()}
              onRevertChangeHunk={vi.fn()}
              phpSyntaxDiagnosticsGateway={gateway}
              providePhpMethodCompletions={vi.fn(async () => [])}
              providePhpMethodSignature={vi.fn(async () => null)}
            />,
          );
          await Promise.resolve();
        });
      };

      const testGlyphCalls = () =>
        editor.deltaDecorations.mock.calls.filter(([, decorations]) =>
          (decorations as any[]).some(
            (decoration) =>
              decoration.options?.glyphMarginClassName ===
              "test-run-gutter-glyph",
          ),
        );
      const syntaxMarkerCalls = () =>
        monaco.editor.setModelMarkers.mock.calls.filter(
          ([, owner]) => owner === "php-syntax",
        );

      // Initial mount + flush so all three consumers have rendered once.
      await renderWith(activeDocument);
      await act(async () => {
        vi.advanceTimersByTime(200);
        await Promise.resolve();
      });

      expect(testGlyphCalls().length).toBeGreaterThan(0);
      expect(validate).toHaveBeenCalledTimes(1);

      editor.deltaDecorations.mockClear();
      monaco.editor.setModelMarkers.mockClear();
      validate.mockClear();

      // Record every 160ms debounce timer armed during the keystroke. With the
      // shared debounce there is exactly ONE for all three PHP consumers (impl
      // gutter, test gutter, syntax diagnostics); the pre-refactor code armed
      // three independent timers. We restore the original setTimeout only AFTER
      // switching back to real timers (in `finally`) so the spy never corrupts
      // vitest's fake-timer patching of the global.
      const debounceDelays: number[] = [];
      const realSetTimeout = window.setTimeout;
      const recordingSetTimeout = ((
        handler: TimerHandler,
        timeout?: number,
        ...args: unknown[]
      ) => {
        if (timeout === 160) {
          debounceDelays.push(timeout);
        }
        return (realSetTimeout as any)(handler, timeout, ...args);
      }) as typeof window.setTimeout;
      window.setTimeout = recordingSetTimeout;

      // A single keystroke (same path, mutated content) must arm exactly ONE
      // 160ms debounce timer shared by all three consumers, not three
      // independent timers.
      const secondContent = `<?php

class InvoiceServiceTest
{
    public function testCharges(): void
    {
    }

    public function testRefunds(): void
    {
    }
}
`;
      await renderWith({ ...activeDocument, content: secondContent });

      window.setTimeout = realSetTimeout;

      expect(debounceDelays).toHaveLength(1);

      // One flush updates all three consumers from the single shared snapshot.
      await act(async () => {
        vi.advanceTimersByTime(200);
        await Promise.resolve();
      });

      // Impl + test gutter re-parsed and re-decorated, syntax re-validated once.
      expect(testGlyphCalls().length).toBeGreaterThan(0);
      expect(syntaxMarkerCalls().length).toBeGreaterThan(0);
      expect(validate).toHaveBeenCalledTimes(1);
      expect(validate).toHaveBeenCalledWith(secondContent);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not re-map diagnostic overview decorations per keystroke when diagnostics are unchanged", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "user.ts",
      path: "/workspace/src/user.ts",
      savedContent: "const value = 1;\n",
    };
    const model: FakeModel = {
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    // Stable diagnostics map identity across renders so the only thing changing
    // is the activeDocument object identity (a keystroke).
    const diagnostics = {
      [activeDocument.path]: [
        {
          character: 6,
          endCharacter: 11,
          endLine: 0,
          line: 0,
          message: "unused",
          severity: "warning" as const,
          source: "typescript",
        },
      ],
    };

    const renderWith = async (document: EditorDocument) => {
      await act(async () => {
        root.render(
          <EditorSurface
            activeDocument={document}
            changeHunks={[]}
            editorRevealTarget={null}
            flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
            languageServerDiagnosticsByPath={diagnostics}
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
            onGoToSuperMethod={vi.fn()}
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
    };

    const overviewDecorationCalls = () =>
      editor.deltaDecorations.mock.calls.filter(([, decorations]) =>
        (decorations as any[]).some(
          (decoration) =>
            decoration.options?.overviewRuler?.position ===
            monaco.editor.OverviewRulerLane.Right,
        ),
      );

    await renderWith(activeDocument);

    expect(overviewDecorationCalls().length).toBeGreaterThan(0);
    editor.deltaDecorations.mockClear();

    // Simulate a keystroke: new activeDocument object, same path + same
    // diagnostics identity. Overview decorations must NOT be re-mapped.
    await renderWith({ ...activeDocument, content: "const value = 12;\n" });

    expect(overviewDecorationCalls()).toHaveLength(0);
  });

  it("does not re-map bookmark gutter decorations per keystroke when bookmarks are unchanged", async () => {
    const activeDocument: EditorDocument = {
      content: "const one = 1;\nconst two = 2;\nconst three = 3;\n",
      language: "typescript",
      name: "constants.ts",
      path: "/workspace/src/constants.ts",
      savedContent: "const one = 1;\nconst two = 2;\nconst three = 3;\n",
    };
    const model: FakeModel = {
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    // Stable bookmark-line identity across renders so the only thing changing is
    // the activeDocument object identity (a keystroke).
    const bookmarkedLineNumbers = [2];

    const renderWith = async (document: EditorDocument) => {
      await act(async () => {
        root.render(
          <EditorSurface
            activeDocument={document}
            bookmarkedLineNumbers={bookmarkedLineNumbers}
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
            onGoToSuperMethod={vi.fn()}
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
    };

    const bookmarkDecorationCalls = () =>
      editor.deltaDecorations.mock.calls.filter(([, decorations]) =>
        (decorations as any[]).some(
          (decoration) =>
            decoration.options?.linesDecorationsClassName ===
            "bookmark-gutter-glyph",
        ),
      );

    await renderWith(activeDocument);

    expect(bookmarkDecorationCalls().length).toBeGreaterThan(0);
    editor.deltaDecorations.mockClear();

    // Simulate a keystroke: new activeDocument object, same path + same
    // bookmarked-line identity. Bookmark gutter decorations must NOT re-map.
    await renderWith({ ...activeDocument, content: "const one = 12;\nconst two = 2;\nconst three = 3;\n" });

    expect(bookmarkDecorationCalls()).toHaveLength(0);
  });

  it("does not re-map change-hunk decorations per keystroke when hunks are unchanged", async () => {
    const activeDocument: EditorDocument = {
      content: "const one = 1;\nconst two = 2;\n",
      language: "typescript",
      name: "diff.ts",
      path: "/workspace/src/diff.ts",
      savedContent: "const one = 0;\nconst two = 2;\n",
    };
    const model: FakeModel = {
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    // Stable change-hunk identity across renders so the only thing changing is
    // the activeDocument object identity (a keystroke). The change-hunk effect
    // must gate on the document path + hunk identity, not the document object.
    const changeHunks = editorChangeHunks(
      activeDocument.savedContent ?? "",
      activeDocument.content,
    );

    const renderWith = async (document: EditorDocument) => {
      await act(async () => {
        root.render(
          <EditorSurface
            activeDocument={document}
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
            onGoToSuperMethod={vi.fn()}
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
    };

    const changeDecorationCalls = () =>
      editor.deltaDecorations.mock.calls.filter(([, decorations]) =>
        (decorations as any[]).some((decoration) =>
          decoration.options?.glyphMarginClassName?.startsWith(
            "editor-change-glyph",
          ),
        ),
      );

    await renderWith(activeDocument);

    expect(changeDecorationCalls().length).toBeGreaterThan(0);
    editor.deltaDecorations.mockClear();

    // Simulate a keystroke: new activeDocument object, same path + same hunk
    // identity. Change-hunk decorations must NOT be re-mapped.
    await renderWith({ ...activeDocument, content: "const one = 11;\nconst two = 2;\n" });

    expect(changeDecorationCalls()).toHaveLength(0);
  });

  it("re-maps bookmark gutter decorations when bookmarked lines change", async () => {
    const activeDocument: EditorDocument = {
      content: "const one = 1;\nconst two = 2;\nconst three = 3;\n",
      language: "typescript",
      name: "constants.ts",
      path: "/workspace/src/constants.ts",
      savedContent: "const one = 1;\nconst two = 2;\nconst three = 3;\n",
    };
    const model: FakeModel = {
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    const renderWith = async (bookmarkedLineNumbers: readonly number[]) => {
      await act(async () => {
        root.render(
          <EditorSurface
            activeDocument={activeDocument}
            bookmarkedLineNumbers={bookmarkedLineNumbers}
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
            onGoToSuperMethod={vi.fn()}
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
    };

    const bookmarkDecorationCalls = () =>
      editor.deltaDecorations.mock.calls.filter(([, decorations]) =>
        (decorations as any[]).some(
          (decoration) =>
            decoration.options?.linesDecorationsClassName ===
            "bookmark-gutter-glyph",
        ),
      );

    await renderWith([2]);

    expect(bookmarkDecorationCalls().length).toBeGreaterThan(0);
    editor.deltaDecorations.mockClear();

    // Toggle a bookmark: the bookmarked-line set changes, so the gutter must
    // repaint with the new line's glyph.
    await renderWith([3]);

    const repaint = bookmarkDecorationCalls();
    expect(repaint.length).toBeGreaterThan(0);
    expect(repaint[repaint.length - 1]?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          options: expect.objectContaining({
            linesDecorationsClassName: "bookmark-gutter-glyph",
          }),
          range: expect.objectContaining({
            startLineNumber: 3,
          }),
        }),
      ]),
    );
  });

  it("re-maps diagnostic overview decorations when diagnostics change", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "user.ts",
      path: "/workspace/src/user.ts",
      savedContent: "const value = 1;\n",
    };
    const model: FakeModel = {
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    const renderWith = async (diagnostics: Record<string, unknown[]>) => {
      await act(async () => {
        root.render(
          <EditorSurface
            activeDocument={activeDocument}
            changeHunks={[]}
            editorRevealTarget={null}
            flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
            languageServerDiagnosticsByPath={diagnostics as never}
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
            onGoToSuperMethod={vi.fn()}
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
    };

    const overviewDecorationCalls = () =>
      editor.deltaDecorations.mock.calls.filter(([, decorations]) =>
        (decorations as any[]).some(
          (decoration) =>
            decoration.options?.overviewRuler?.position ===
            monaco.editor.OverviewRulerLane.Right,
        ),
      );

    await renderWith({});
    editor.deltaDecorations.mockClear();

    await renderWith({
      [activeDocument.path]: [
        {
          character: 6,
          endCharacter: 11,
          endLine: 0,
          line: 0,
          message: "unused",
          severity: "warning",
          source: "typescript",
        },
      ],
    });

    expect(overviewDecorationCalls().length).toBeGreaterThan(0);
  });

  it("re-applies language-server markers when diagnostics actually change", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "user.ts",
      path: "/workspace/src/user.ts",
      savedContent: "const value = 1;\n",
    };
    const model: FakeModel = {
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const monaco = createMonaco(model);
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = monaco;

    const renderWith = async (
      diagnostics: Record<string, unknown[]>,
    ) => {
      await act(async () => {
        root.render(
          <EditorSurface
            activeDocument={activeDocument}
            changeHunks={[]}
            editorRevealTarget={null}
            flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
            languageServerDiagnosticsByPath={diagnostics as never}
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
            onGoToSuperMethod={vi.fn()}
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
    };

    await renderWith({});
    monaco.editor.setModelMarkers.mockClear();

    await renderWith({
      [activeDocument.path]: [
        {
          character: 6,
          endCharacter: 11,
          endLine: 0,
          line: 0,
          message: "unused",
          severity: "warning",
          source: "typescript",
        },
      ],
    });

    const languageServerMarkerCall =
      monaco.editor.setModelMarkers.mock.calls.find(
        ([, owner]) => owner === "php-language-server",
      );
    expect(languageServerMarkerCall?.[2]).toHaveLength(1);
  });

  it("applies markers to a newly opened model that already has diagnostics", async () => {
    const firstDocument: EditorDocument = {
      content: "const a = 1;\n",
      language: "typescript",
      name: "a.ts",
      path: "/workspace/src/a.ts",
      savedContent: "const a = 1;\n",
    };
    const secondDocument: EditorDocument = {
      content: "const b = 2;\n",
      language: "typescript",
      name: "b.ts",
      path: "/workspace/src/b.ts",
      savedContent: "const b = 2;\n",
    };
    const firstModel: FakeModel = {
      dispose: vi.fn(),
      uri: { fsPath: firstDocument.path, path: firstDocument.path },
    };
    const secondModel: FakeModel = {
      dispose: vi.fn(),
      uri: { fsPath: secondDocument.path, path: secondDocument.path },
    };

    let openModels: FakeModel[] = [firstModel];
    const monaco = createMonaco(firstModel);
    monaco.editor.getModels = vi.fn(() => openModels);
    editorSurfaceMocks.editor = createEditor(firstModel);
    editorSurfaceMocks.monaco = monaco;

    const diagnostics = {
      [secondDocument.path]: [
        {
          character: 6,
          endCharacter: 7,
          endLine: 0,
          line: 0,
          message: "unused b",
          severity: "warning" as const,
          source: "typescript",
        },
      ],
    };

    const renderWith = async (document: EditorDocument) => {
      await act(async () => {
        root.render(
          <EditorSurface
            activeDocument={document}
            changeHunks={[]}
            editorRevealTarget={null}
            flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
            languageServerDiagnosticsByPath={diagnostics}
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
            onGoToSuperMethod={vi.fn()}
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
    };

    await renderWith(firstDocument);
    monaco.editor.setModelMarkers.mockClear();

    // Open b.ts: it joins the live model set and becomes the active document.
    openModels = [firstModel, secondModel];
    await renderWith(secondDocument);

    const secondModelMarkerCall =
      monaco.editor.setModelMarkers.mock.calls.find(
        ([target, owner]) =>
          target === secondModel && owner === "php-language-server",
      );
    expect(secondModelMarkerCall?.[2]).toHaveLength(1);
  });

  it("re-applies language-server markers only for paths whose diagnostics changed", async () => {
    const firstDocument: EditorDocument = {
      content: "const a = 1;\n",
      language: "typescript",
      name: "a.ts",
      path: "/workspace/src/a.ts",
      savedContent: "const a = 1;\n",
    };
    const secondDocument: EditorDocument = {
      content: "const b = 2;\n",
      language: "typescript",
      name: "b.ts",
      path: "/workspace/src/b.ts",
      savedContent: "const b = 2;\n",
    };
    const firstModel: FakeModel = {
      dispose: vi.fn(),
      getValue: vi.fn(() => firstDocument.content),
      uri: { fsPath: firstDocument.path, path: firstDocument.path },
    };
    const secondModel: FakeModel = {
      dispose: vi.fn(),
      getValue: vi.fn(() => secondDocument.content),
      uri: { fsPath: secondDocument.path, path: secondDocument.path },
    };

    const monaco = createMonaco(firstModel);
    monaco.editor.getModels = vi.fn(() => [firstModel, secondModel]);
    editorSurfaceMocks.editor = createEditor(firstModel);
    editorSurfaceMocks.monaco = monaco;

    const unchangedSecondDiagnostics = [
      {
        character: 6,
        endCharacter: 7,
        endLine: 0,
        line: 0,
        message: "unused b",
        severity: "warning" as const,
        source: "typescript",
      },
    ];

    const diagnosticsFor = (firstDiagnostics: unknown[]) => ({
      [firstDocument.path]: firstDiagnostics,
      // Same array reference across renders: b.ts diagnostics never change.
      [secondDocument.path]: unchangedSecondDiagnostics,
    });

    const renderWith = async (
      diagnostics: Record<string, unknown[]>,
    ) => {
      await act(async () => {
        root.render(
          <EditorSurface
            activeDocument={firstDocument}
            changeHunks={[]}
            editorRevealTarget={null}
            flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
            languageServerDiagnosticsByPath={diagnostics as never}
            languageServerFeaturesGateway={languageServerFeaturesGateway()}
            languageServerRuntimeStatus={null}
            keymap={defaultKeymapSettings()}
            monacoTheme="calm-dark"
            navigationHistoryPaths={[secondDocument.path]}
            onChange={vi.fn()}
            onCloseActiveTab={vi.fn()}
            onCursorPositionChange={vi.fn()}
            onEditorFocused={vi.fn()}
            onGoBack={vi.fn()}
            onGoForward={vi.fn()}
            onGoToDefinition={vi.fn()}
            onGoToImplementationAt={vi.fn()}
            onGoToSuperMethod={vi.fn()}
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
    };

    await renderWith(diagnosticsFor([]));
    monaco.editor.setModelMarkers.mockClear();

    // New map identity, but only a.ts's diagnostics array changed identity.
    await renderWith(
      diagnosticsFor([
        {
          character: 6,
          endCharacter: 7,
          endLine: 0,
          line: 0,
          message: "unused a",
          severity: "warning",
          source: "typescript",
        },
      ]),
    );

    const markerCalls = monaco.editor.setModelMarkers.mock.calls.filter(
      ([, owner]) => owner === "php-language-server",
    );
    expect(
      markerCalls.some(([target]) => target === firstModel),
    ).toBe(true);
    expect(
      markerCalls.some(([target]) => target === secondModel),
    ).toBe(false);
  });

  it("re-applies markers to a model recreated for a reopened path with unchanged diagnostics", async () => {
    const document: EditorDocument = {
      content: "const a = 1;\n",
      language: "typescript",
      name: "a.ts",
      path: "/workspace/src/a.ts",
      savedContent: "const a = 1;\n",
    };
    const otherDocument: EditorDocument = {
      content: "const b = 2;\n",
      language: "typescript",
      name: "b.ts",
      path: "/workspace/src/b.ts",
      savedContent: "const b = 2;\n",
    };
    // Same path, but two distinct model objects: the first is disposed on close,
    // the second is created on reopen. Monaco hands EditorSurface a brand new
    // model object for the same path.
    const firstModel: FakeModel = {
      dispose: vi.fn(),
      getValue: vi.fn(() => document.content),
      uri: { fsPath: document.path, path: document.path },
    };
    const otherModel: FakeModel = {
      dispose: vi.fn(),
      getValue: vi.fn(() => otherDocument.content),
      uri: { fsPath: otherDocument.path, path: otherDocument.path },
    };
    const reopenedModel: FakeModel = {
      dispose: vi.fn(),
      getValue: vi.fn(() => document.content),
      uri: { fsPath: document.path, path: document.path },
    };

    let openModels: FakeModel[] = [firstModel];
    const monaco = createMonaco(firstModel);
    monaco.editor.getModels = vi.fn(() => openModels);
    editorSurfaceMocks.editor = createEditor(firstModel);
    editorSurfaceMocks.monaco = monaco;

    // Stable diagnostics array identity for a.ts across the whole scenario: the
    // language server never re-publishes a.ts between close and reopen.
    const diagnostics = {
      [document.path]: [
        {
          character: 6,
          endCharacter: 7,
          endLine: 0,
          line: 0,
          message: "unused a",
          severity: "warning" as const,
          source: "typescript",
        },
      ],
    };

    const renderWith = async (active: EditorDocument) => {
      await act(async () => {
        root.render(
          <EditorSurface
            activeDocument={active}
            changeHunks={[]}
            editorRevealTarget={null}
            flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
            languageServerDiagnosticsByPath={diagnostics}
            languageServerFeaturesGateway={languageServerFeaturesGateway()}
            languageServerRuntimeStatus={null}
            keymap={defaultKeymapSettings()}
            monacoTheme="calm-dark"
            navigationHistoryPaths={[document.path, otherDocument.path]}
            onChange={vi.fn()}
            onCloseActiveTab={vi.fn()}
            onCursorPositionChange={vi.fn()}
            onEditorFocused={vi.fn()}
            onGoBack={vi.fn()}
            onGoForward={vi.fn()}
            onGoToDefinition={vi.fn()}
            onGoToImplementationAt={vi.fn()}
            onGoToSuperMethod={vi.fn()}
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
    };

    // a.ts open and marked.
    await renderWith(document);
    monaco.editor.setModelMarkers.mockClear();

    // Close a.ts: active switches to b.ts and a.ts's model is disposed.
    openModels = [otherModel];
    await renderWith(otherDocument);

    // Reopen a.ts: a brand new model object is created for the same path while
    // a.ts's diagnostics array identity is unchanged.
    openModels = [otherModel, reopenedModel];
    await renderWith(document);

    const reopenedMarkerCall = monaco.editor.setModelMarkers.mock.calls.find(
      ([target, owner]) =>
        target === reopenedModel && owner === "php-language-server",
    );
    expect(reopenedMarkerCall?.[2]).toHaveLength(1);
  });

  it("prunes per-path caches when a document is closed", async () => {
    const closingDocument: EditorDocument = {
      content: "export class Closing {\n  render() {}\n}\n",
      language: "typescript",
      name: "Closing.tsx",
      path: "/workspace/src/Closing.tsx",
      savedContent: "",
    };
    const remainingDocument: EditorDocument = {
      content: "export const remaining = 1;\n",
      language: "typescript",
      name: "Remaining.ts",
      path: "/workspace/src/Remaining.ts",
      savedContent: "",
    };
    const closingModel: FakeModel = {
      getValue: vi.fn(() => closingDocument.content),
      uri: { fsPath: closingDocument.path, path: closingDocument.path },
    };
    const remainingModel: FakeModel = {
      getValue: vi.fn(() => remainingDocument.content),
      uri: { fsPath: remainingDocument.path, path: remainingDocument.path },
    };

    let openModels: FakeModel[] = [closingModel];
    const monaco = createMonaco(closingModel);
    monaco.editor.getModels = vi.fn(() => openModels);
    editorSurfaceMocks.editor = createEditor(closingModel);
    editorSurfaceMocks.monaco = monaco;

    const gateway = languageServerFeaturesGateway();
    const closingSymbols: LanguageServerDocumentSymbol[] = [
      {
        children: [],
        containerName: null,
        detail: null,
        kind: 5,
        name: "Closing",
        range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
        selectionRange: {
          start: { line: 0, character: 13 },
          end: { line: 0, character: 20 },
        },
      },
    ];
    const documentSymbolsMock = vi.fn(async (_root: string, path: string) =>
      path === closingDocument.path ? closingSymbols : [],
    );
    gateway.documentSymbols =
      documentSymbolsMock as unknown as typeof gateway.documentSymbols;

    const renderWith = async (document: EditorDocument) => {
      await act(async () => {
        root.render(
          <EditorSurface
            activeDocument={document}
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
            onGoToSuperMethod={vi.fn()}
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
    };

    await renderWith(closingDocument);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    // The breadcrumb cache is populated for the closing document.
    const initialLabels = Array.from(
      host.querySelectorAll<HTMLElement>(".breadcrumb-segment"),
    ).map((segment) => segment.textContent);
    expect(initialLabels).toContain("Closing");

    // Close Closing.tsx: it leaves the live model set; Remaining.ts is active.
    openModels = [remainingModel];
    editorSurfaceMocks.editor = createEditor(remainingModel);
    monaco.editor.getModels = vi.fn(() => openModels);
    await renderWith(remainingDocument);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    // Re-open Closing.tsx, but have the document-symbols fetch never resolve so
    // the breadcrumb can only show stale cached symbols. If the cache was
    // pruned on close, no stale "Closing" segment is rendered.
    documentSymbolsMock.mockImplementation(
      () => new Promise(() => undefined) as Promise<LanguageServerDocumentSymbol[]>,
    );
    openModels = [closingModel];
    editorSurfaceMocks.editor = createEditor(closingModel);
    monaco.editor.getModels = vi.fn(() => openModels);
    await renderWith(closingDocument);
    await act(async () => {
      await Promise.resolve();
    });

    const reopenedLabels = Array.from(
      host.querySelectorAll<HTMLElement>(".breadcrumb-segment"),
    ).map((segment) => segment.textContent);
    // The breadcrumb bar is rendered (filename segment present) but the stale
    // "Closing" symbol segment is gone, proving the cache entry was pruned on
    // close rather than the breadcrumb simply being absent.
    expect(reopenedLabels).toContain("Closing.tsx");
    expect(reopenedLabels).not.toContain("Closing");
  });

  it("disposes the Monaco model of a closed document", async () => {
    const closingDocument: EditorDocument = {
      content: "const closing = 1;\n",
      language: "typescript",
      name: "closing.ts",
      path: "/workspace/src/closing.ts",
      savedContent: "const closing = 1;\n",
    };
    const remainingDocument: EditorDocument = {
      content: "const remaining = 2;\n",
      language: "typescript",
      name: "remaining.ts",
      path: "/workspace/src/remaining.ts",
      savedContent: "const remaining = 2;\n",
    };
    const closingModel: FakeModel = {
      dispose: vi.fn(),
      uri: { fsPath: closingDocument.path, path: closingDocument.path },
    };
    const remainingModel: FakeModel = {
      dispose: vi.fn(),
      uri: { fsPath: remainingDocument.path, path: remainingDocument.path },
    };

    let openModels: FakeModel[] = [closingModel, remainingModel];
    const monaco = createMonaco(closingModel);
    monaco.editor.getModels = vi.fn(() => openModels);
    editorSurfaceMocks.editor = createEditor(remainingModel);
    editorSurfaceMocks.monaco = monaco;

    const renderWith = async (
      document: EditorDocument,
      openDocumentPaths: string[],
    ) => {
      await act(async () => {
        root.render(
          <EditorSurface
            activeDocument={document}
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
            onGoToSuperMethod={vi.fn()}
            onLanguageServerError={vi.fn()}
            onOpenClass={vi.fn()}
            onOpenFile={vi.fn()}
            onOpenFileStructure={vi.fn()}
            onRevealTargetHandled={vi.fn()}
            onRevertChangeHunk={vi.fn()}
            openDocumentPaths={openDocumentPaths}
            phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
            providePhpMethodCompletions={vi.fn(async () => [])}
            providePhpMethodSignature={vi.fn(async () => null)}
            workspaceRoot="/workspace"
          />,
        );
        await Promise.resolve();
      });
    };

    await renderWith(remainingDocument, [
      closingDocument.path,
      remainingDocument.path,
    ]);
    expect(closingModel.dispose).not.toHaveBeenCalled();

    // Close closing.ts: it leaves the live open document set.
    await renderWith(remainingDocument, [remainingDocument.path]);

    expect(closingModel.dispose).toHaveBeenCalledTimes(1);
    expect(remainingModel.dispose).not.toHaveBeenCalled();
  });

  it("never disposes the active document's model", async () => {
    const activeDocument: EditorDocument = {
      content: "const active = 1;\n",
      language: "typescript",
      name: "active.ts",
      path: "/workspace/src/active.ts",
      savedContent: "const active = 1;\n",
    };
    const model: FakeModel = {
      dispose: vi.fn(),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };

    const monaco = createMonaco(model);
    monaco.editor.getModels = vi.fn(() => [model]);
    editorSurfaceMocks.editor = createEditor(model);
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
          onGoToSuperMethod={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          openDocumentPaths={[]}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
          workspaceRoot="/workspace"
        />,
      );
      await Promise.resolve();
    });

    // Even though the active document's path is absent from openDocumentPaths,
    // the active model must never be disposed out from under the editor.
    expect(model.dispose).not.toHaveBeenCalled();
  });

  it("keeps the model of a document still open in another tab", async () => {
    const activeDocument: EditorDocument = {
      content: "const active = 1;\n",
      language: "typescript",
      name: "active.ts",
      path: "/workspace/src/active.ts",
      savedContent: "const active = 1;\n",
    };
    const stillOpenDocument: EditorDocument = {
      content: "const other = 2;\n",
      language: "typescript",
      name: "other.ts",
      path: "/workspace/src/other.ts",
      savedContent: "const other = 2;\n",
    };
    const activeModel: FakeModel = {
      dispose: vi.fn(),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const stillOpenModel: FakeModel = {
      dispose: vi.fn(),
      uri: { fsPath: stillOpenDocument.path, path: stillOpenDocument.path },
    };

    const monaco = createMonaco(activeModel);
    monaco.editor.getModels = vi.fn(() => [activeModel, stillOpenModel]);
    editorSurfaceMocks.editor = createEditor(activeModel);
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
          onGoToSuperMethod={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          openDocumentPaths={[activeDocument.path, stillOpenDocument.path]}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
          workspaceRoot="/workspace"
        />,
      );
      await Promise.resolve();
    });

    // other.ts is not active but is still open in another tab/split, so its
    // model must be kept alive.
    expect(activeModel.dispose).not.toHaveBeenCalled();
    expect(stillOpenModel.dispose).not.toHaveBeenCalled();
  });

  it("keeps the model of a document reachable via back/forward navigation history", async () => {
    // Go-to-definition turns the source file into a clean-preview replacement,
    // so its path leaves openDocumentPaths even though Back/Forward can still
    // navigate to it. Disposing it would force a full re-tokenization on Back
    // (lag). The navigation history paths must keep such a model alive.
    const activeDocument: EditorDocument = {
      content: "const target = 1;\n",
      language: "typescript",
      name: "target.ts",
      path: "/workspace/src/target.ts",
      savedContent: "const target = 1;\n",
    };
    const historyDocument: EditorDocument = {
      content: "const source = 2;\n",
      language: "typescript",
      name: "source.ts",
      path: "/workspace/src/source.ts",
      savedContent: "const source = 2;\n",
    };
    const activeModel: FakeModel = {
      dispose: vi.fn(),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const historyModel: FakeModel = {
      dispose: vi.fn(),
      uri: { fsPath: historyDocument.path, path: historyDocument.path },
    };

    const monaco = createMonaco(activeModel);
    monaco.editor.getModels = vi.fn(() => [activeModel, historyModel]);
    editorSurfaceMocks.editor = createEditor(activeModel);
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
          onGoToSuperMethod={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          openDocumentPaths={[activeDocument.path]}
          navigationHistoryPaths={[historyDocument.path]}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
          workspaceRoot="/workspace"
        />,
      );
      await Promise.resolve();
    });

    // source.ts is no longer an open document but is reachable via back/forward
    // history, so its model must survive (cheap model-swap on Back, no
    // dispose+recreate+re-tokenization lag).
    expect(activeModel.dispose).not.toHaveBeenCalled();
    expect(historyModel.dispose).not.toHaveBeenCalled();
  });

  it("disposes a model that is neither open nor in navigation history", async () => {
    // The c1f7489f leak fix must be preserved: a truly closed file (absent from
    // open documents AND navigation history) is still disposed.
    const activeDocument: EditorDocument = {
      content: "const target = 1;\n",
      language: "typescript",
      name: "target.ts",
      path: "/workspace/src/target.ts",
      savedContent: "const target = 1;\n",
    };
    const closedDocument: EditorDocument = {
      content: "const closed = 2;\n",
      language: "typescript",
      name: "closed.ts",
      path: "/workspace/src/closed.ts",
      savedContent: "const closed = 2;\n",
    };
    const historyDocument: EditorDocument = {
      content: "const source = 3;\n",
      language: "typescript",
      name: "source.ts",
      path: "/workspace/src/source.ts",
      savedContent: "const source = 3;\n",
    };
    const activeModel: FakeModel = {
      dispose: vi.fn(),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const closedModel: FakeModel = {
      dispose: vi.fn(),
      uri: { fsPath: closedDocument.path, path: closedDocument.path },
    };
    const historyModel: FakeModel = {
      dispose: vi.fn(),
      uri: { fsPath: historyDocument.path, path: historyDocument.path },
    };

    const monaco = createMonaco(activeModel);
    monaco.editor.getModels = vi.fn(() => [
      activeModel,
      closedModel,
      historyModel,
    ]);
    editorSurfaceMocks.editor = createEditor(activeModel);
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
          onGoToSuperMethod={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          openDocumentPaths={[activeDocument.path]}
          navigationHistoryPaths={[historyDocument.path]}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
          workspaceRoot="/workspace"
        />,
      );
      await Promise.resolve();
    });

    expect(closedModel.dispose).toHaveBeenCalledTimes(1);
    expect(activeModel.dispose).not.toHaveBeenCalled();
    expect(historyModel.dispose).not.toHaveBeenCalled();
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
          onGoToSuperMethod={vi.fn()}
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

  it("registers Cmd+L go to line that opens Monaco's gotoLine quick access", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\nconst other = 2;\n",
      language: "typescript",
      name: "module.ts",
      path: "/workspace/src/module.ts",
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
          onGoToSuperMethod={vi.fn()}
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

    const gotoLineAction = editor.addAction.mock.calls
      .map(([action]) => action)
      .find((action) => action.id === "mockor.gotoLine");

    expect(gotoLineAction).toEqual(
      expect.objectContaining({
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL],
        label: "Go to Line/Column",
      }),
    );

    gotoLineAction.run();

    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.gotoLine",
      {},
    );
  });

  describe("cyclic expand word (hippie completion)", () => {
    interface HippieHarness {
      editor: FakeEditor;
      monaco: ReturnType<typeof createMonaco>;
      rerender(document: EditorDocument): Promise<void>;
      run(): void;
      setBuffer(value: string, cursorOffset: number): void;
    }

    function offsetToPosition(value: string, offset: number) {
      const before = value.slice(0, offset);
      const lines = before.split("\n");

      return {
        column: lines[lines.length - 1].length + 1,
        lineNumber: lines.length,
      };
    }

    async function renderHippie(
      initialValue: string,
      initialOffset: number,
    ): Promise<HippieHarness> {
      let modelValue = initialValue;
      let cursorOffset = initialOffset;
      const activeDocument: EditorDocument = {
        content: initialValue,
        language: "typescript",
        name: "main.ts",
        path: "/workspace/main.ts",
        savedContent: "",
      };
      const model: FakeModel = {
        dispose: vi.fn(),
        getLineMaxColumn: vi.fn((lineNumber: number) => {
          const lines = modelValue.split("\n");
          return (lines[lineNumber - 1]?.length ?? 0) + 1;
        }),
        getValue: vi.fn(() => modelValue),
        isDisposed: vi.fn(() => false),
        uri: {
          fsPath: activeDocument.path,
          path: activeDocument.path,
        },
      };
      const extendedModel = model as FakeModel & {
        getOffsetAt: ReturnType<typeof vi.fn>;
        getPositionAt: ReturnType<typeof vi.fn>;
      };
      extendedModel.getOffsetAt = vi.fn(
        (position: { column: number; lineNumber: number }) => {
          const lines = modelValue.split("\n");
          let offset = 0;
          for (let index = 0; index < position.lineNumber - 1; index += 1) {
            offset += lines[index].length + 1;
          }
          return offset + position.column - 1;
        },
      );
      extendedModel.getPositionAt = vi.fn((offset: number) =>
        offsetToPosition(modelValue, offset),
      );
      const editor = createEditor(model);
      const monaco = createMonaco(model);
      editor.getPosition.mockImplementation(() =>
        offsetToPosition(modelValue, cursorOffset),
      );
      editorSurfaceMocks.editor = editor;
      editorSurfaceMocks.monaco = monaco;

      const renderDocument = async (document: EditorDocument) => {
        await act(async () => {
          root.render(
            <EditorSurface
              activeDocument={document}
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
              onGoToSuperMethod={vi.fn()}
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
      };

      await renderDocument(activeDocument);

      const action = editor.addAction.mock.calls
        .map(([entry]) => entry)
        .find((entry) => entry.id === "mockor.cyclicExpandWord");

      if (!action) {
        throw new Error("Cyclic expand word action was not registered.");
      }

      return {
        editor,
        monaco,
        rerender: renderDocument,
        run: () => action.run(),
        setBuffer: (value: string, nextOffset: number) => {
          modelValue = value;
          cursorOffset = nextOffset;
        },
      };
    }

    it("registers the action with the Alt+/ keybinding", async () => {
      const harness = await renderHippie("calculateTotal\ncalc", "".length);
      const action = harness.editor.addAction.mock.calls
        .map(([entry]) => entry)
        .find((entry) => entry.id === "mockor.cyclicExpandWord");

      expect(action).toEqual(
        expect.objectContaining({
          keybindings: [harness.monaco.KeyMod.Alt | harness.monaco.KeyCode.Slash],
          label: "Cyclic Expand Word",
        }),
      );
    });

    it("expands the prefix to the nearest matching word from the buffer", async () => {
      const value = "calculateTotal\ncalc";
      const harness = await renderHippie(value, value.length);

      harness.run();

      // Replaces just the "calc" prefix with the remaining "ulateTotal".
      expect(harness.editor.executeEdits).toHaveBeenCalledWith(
        "mockor.cyclicExpandWord",
        [
          expect.objectContaining({
            text: "calculateTotal",
            range: expect.objectContaining({
              startLineNumber: 2,
              startColumn: 1,
              endLineNumber: 2,
              endColumn: 5,
            }),
          }),
        ],
      );
    });

    it("does nothing when no buffer word matches the prefix", async () => {
      const value = "alpha beta zz";
      const harness = await renderHippie(value, value.length);

      harness.run();

      expect(harness.editor.executeEdits).not.toHaveBeenCalled();
    });

    it("cycles to the next candidate on a back-to-back press, then wraps to the prefix", async () => {
      const value = "fooOne\nfooTwo\nfoo";
      const harness = await renderHippie(value, value.length);

      // First Alt+/ -> nearest backward candidate "fooTwo".
      harness.run();
      expect(harness.editor.executeEdits).toHaveBeenNthCalledWith(
        1,
        "mockor.cyclicExpandWord",
        [expect.objectContaining({ text: "fooTwo" })],
      );

      // Reflect the inserted edit + caret at the end of the inserted word, then
      // press Alt+/ again immediately: it must cycle to "fooOne".
      harness.setBuffer("fooOne\nfooTwo\nfooTwo", "fooOne\nfooTwo\nfooTwo".length);
      harness.run();
      expect(harness.editor.executeEdits).toHaveBeenNthCalledWith(
        2,
        "mockor.cyclicExpandWord",
        [expect.objectContaining({ text: "fooOne" })],
      );

      // After the last candidate it wraps back to the originally typed prefix.
      harness.setBuffer("fooOne\nfooTwo\nfooOne", "fooOne\nfooTwo\nfooOne".length);
      harness.run();
      expect(harness.editor.executeEdits).toHaveBeenNthCalledWith(
        3,
        "mockor.cyclicExpandWord",
        [expect.objectContaining({ text: "foo" })],
      );
    });

    it("drops the active session when the document changes (no cross-file cycle)", async () => {
      const value = "fooOne\nfooTwo\nfoo";
      const harness = await renderHippie(value, value.length);

      harness.run();
      expect(harness.editor.executeEdits).toHaveBeenNthCalledWith(
        1,
        "mockor.cyclicExpandWord",
        [expect.objectContaining({ text: "fooTwo" })],
      );

      // A document switch hands EditorSurface a new activeDocument object. The
      // hippie session anchor/candidates belong to the previous file, so the
      // switch must drop the session. We re-render with a new document object so
      // the reset effect fires, then point the buffer at fresh content.
      await harness.rerender({
        content: "fooOne\nfooTwo\nfooTwo",
        language: "typescript",
        name: "main.ts",
        path: "/workspace/main.ts",
        savedContent: "",
      });

      // The buffer now shows "fooTwo" at the caret. A stale session would cycle
      // to its old candidate "fooOne"; a correctly reset session re-expands from
      // the prefix under the caret. We give the buffer a distinct prefix so the
      // two outcomes differ: a fresh expansion from "alp" yields "alphaBeta".
      harness.setBuffer("alphaBeta\nalp", "alphaBeta\nalp".length);
      harness.run();

      expect(harness.editor.executeEdits).toHaveBeenNthCalledWith(
        2,
        "mockor.cyclicExpandWord",
        [expect.objectContaining({ text: "alphaBeta" })],
      );
    });

    it("starts a fresh expansion (not a cycle) when the caret moves between presses", async () => {
      const value = "fooOne\nfooTwo\nfoo";
      const harness = await renderHippie(value, value.length);

      harness.run();
      expect(harness.editor.executeEdits).toHaveBeenNthCalledWith(
        1,
        "mockor.cyclicExpandWord",
        [expect.objectContaining({ text: "fooTwo" })],
      );

      // The buffer now shows the expansion, but the caret is somewhere else
      // entirely (user clicked away). The next press must NOT cycle "fooTwo" ->
      // "fooOne"; it must re-expand from whatever new prefix is under the caret.
      const moved = "fooOne\nfooTwo\nfooTwo\nfo";
      harness.setBuffer(moved, moved.length);
      harness.run();

      // Fresh expansion from prefix "fo": nearest backward word is "fooTwo".
      expect(harness.editor.executeEdits).toHaveBeenNthCalledWith(
        2,
        "mockor.cyclicExpandWord",
        [expect.objectContaining({ text: "fooTwo" })],
      );
    });
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
          onGoToSuperMethod={vi.fn()}
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
          onGoToSuperMethod={vi.fn()}
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

  it("surrounds the selected text with a chosen control-flow block via a snippet", async () => {
    const lines = ["doStuff();", "more();"];
    const activeDocument: EditorDocument = {
      content: `${lines.join("\n")}\n`,
      language: "php",
      name: "Service.php",
      path: "/workspace/Service.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getEOL: vi.fn(() => "\n"),
      getLineContent: vi.fn((lineNumber: number) => lines[lineNumber - 1] ?? ""),
      getLineCount: vi.fn(() => lines.length),
      getLineMaxColumn: vi.fn(
        (lineNumber: number) => (lines[lineNumber - 1]?.length ?? 0) + 1,
      ),
      getOptions: vi.fn(() => ({ indentSize: 4, insertSpaces: true, tabSize: 4 })),
      getValueInRange: vi.fn(() => "doStuff();"),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    const snippetController = { insert: vi.fn() };
    editor.getContribution.mockReturnValue(snippetController);
    editor.getSelection.mockReturnValue({
      endColumn: "doStuff();".length + 1,
      endLineNumber: 1,
      startColumn: 1,
      startLineNumber: 1,
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
          onGoToSuperMethod={vi.fn()}
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

    const surroundWithAction = editor.addAction.mock.calls
      .map(([action]) => action)
      .find((action) => action.id === "mockor.surroundWith");

    expect(surroundWithAction).toEqual(
      expect.objectContaining({
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyT],
        label: "Surround With",
      }),
    );

    await act(async () => {
      surroundWithAction.run();
      await Promise.resolve();
    });

    const picker = queryRequired<HTMLElement>(
      document.body,
      "[aria-label='Surround with']",
    );
    const ifButton = Array.from(
      picker.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("if"));

    expect(ifButton).toBeTruthy();

    await act(async () => {
      ifButton?.click();
      await Promise.resolve();
    });

    expect(editor.setSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        endColumn: "doStuff();".length + 1,
        endLineNumber: 1,
        startColumn: 1,
        startLineNumber: 1,
      }),
    );
    expect(snippetController.insert).toHaveBeenCalledWith(
      ["if (${1:condition}) {", "    doStuff();$0", "}"].join("\n"),
    );

    expect(
      document.body.querySelector("[aria-label='Surround with']"),
    ).toBeNull();
  });

  it("falls back to the current line when surround-with runs without a selection", async () => {
    const lines = ["  doStuff();"];
    const activeDocument: EditorDocument = {
      content: `${lines.join("\n")}\n`,
      language: "php",
      name: "Service.php",
      path: "/workspace/Service.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getEOL: vi.fn(() => "\n"),
      getLineContent: vi.fn((lineNumber: number) => lines[lineNumber - 1] ?? ""),
      getLineCount: vi.fn(() => lines.length),
      getLineMaxColumn: vi.fn(
        (lineNumber: number) => (lines[lineNumber - 1]?.length ?? 0) + 1,
      ),
      getOptions: vi.fn(() => ({ indentSize: 4, insertSpaces: true, tabSize: 4 })),
      getValueInRange: vi.fn(() => "  doStuff();"),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    const snippetController = { insert: vi.fn() };
    editor.getContribution.mockReturnValue(snippetController);
    editor.getPosition.mockReturnValue({ column: 5, lineNumber: 1 });
    editor.getSelection.mockReturnValue({
      endColumn: 5,
      endLineNumber: 1,
      startColumn: 5,
      startLineNumber: 1,
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
          onGoToSuperMethod={vi.fn()}
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

    const surroundWithAction = editor.addAction.mock.calls
      .map(([action]) => action)
      .find((action) => action.id === "mockor.surroundWith");

    await act(async () => {
      surroundWithAction.run();
      await Promise.resolve();
    });

    const picker = queryRequired<HTMLElement>(
      document.body,
      "[aria-label='Surround with']",
    );
    const foreachButton = Array.from(
      picker.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("foreach"));

    await act(async () => {
      foreachButton?.click();
      await Promise.resolve();
    });

    expect(editor.setSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        endColumn: "  doStuff();".length + 1,
        endLineNumber: 1,
        startColumn: 1,
        startLineNumber: 1,
      }),
    );
    expect(snippetController.insert).toHaveBeenCalledWith(
      [
        "  foreach (${1:\\$items} as ${2:\\$item}) {",
        "      doStuff();$0",
        "  }",
      ].join("\n"),
    );
  });

  it("never applies a captured surround-with wrap to a different document", async () => {
    const lines = ["doStuff();"];
    const activeDocument: EditorDocument = {
      content: `${lines.join("\n")}\n`,
      language: "php",
      name: "Service.php",
      path: "/workspace/Service.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getEOL: vi.fn(() => "\n"),
      getLineContent: vi.fn((lineNumber: number) => lines[lineNumber - 1] ?? ""),
      getLineCount: vi.fn(() => lines.length),
      getLineMaxColumn: vi.fn(
        (lineNumber: number) => (lines[lineNumber - 1]?.length ?? 0) + 1,
      ),
      getOptions: vi.fn(() => ({ indentSize: 4, insertSpaces: true, tabSize: 4 })),
      getValueInRange: vi.fn(() => "doStuff();"),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    const snippetController = { insert: vi.fn() };
    editor.getContribution.mockReturnValue(snippetController);
    editor.getSelection.mockReturnValue({
      endColumn: "doStuff();".length + 1,
      endLineNumber: 1,
      startColumn: 1,
      startLineNumber: 1,
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
          onGoToSuperMethod={vi.fn()}
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

    const surroundWithAction = editor.addAction.mock.calls
      .map(([action]) => action)
      .find((action) => action.id === "mockor.surroundWith");

    await act(async () => {
      surroundWithAction.run();
      await Promise.resolve();
    });

    // Simulate a tab switch underneath the open picker: the live model now
    // points at a different document than the one the request was captured on.
    editor.getModel.mockReturnValue({
      ...model,
      uri: { fsPath: "/workspace/Other.php", path: "/workspace/Other.php" },
    });

    const picker = queryRequired<HTMLElement>(
      document.body,
      "[aria-label='Surround with']",
    );
    const ifButton = Array.from(
      picker.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("if"));

    await act(async () => {
      ifButton?.click();
      await Promise.resolve();
    });

    expect(snippetController.insert).not.toHaveBeenCalled();
    expect(
      document.body.querySelector("[aria-label='Surround with']"),
    ).toBeNull();
  });

  it("inserts unescaped wrapped text when the snippet controller is unavailable", async () => {
    const lines = ['$total = $price * $qty;'];
    const activeDocument: EditorDocument = {
      content: `${lines.join("\n")}\n`,
      language: "php",
      name: "Service.php",
      path: "/workspace/Service.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getEOL: vi.fn(() => "\n"),
      getLineContent: vi.fn((lineNumber: number) => lines[lineNumber - 1] ?? ""),
      getLineCount: vi.fn(() => lines.length),
      getLineMaxColumn: vi.fn(
        (lineNumber: number) => (lines[lineNumber - 1]?.length ?? 0) + 1,
      ),
      getOptions: vi.fn(() => ({ indentSize: 4, insertSpaces: true, tabSize: 4 })),
      getValueInRange: vi.fn(() => '$total = $price * $qty;'),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    // No snippet controller: the surround action must fall back to executeEdits
    // and insert plain, UN-escaped text (no leftover snippet escaping).
    editor.getContribution.mockReturnValue(null);
    editor.getSelection.mockReturnValue({
      endColumn: '$total = $price * $qty;'.length + 1,
      endLineNumber: 1,
      startColumn: 1,
      startLineNumber: 1,
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
          onGoToSuperMethod={vi.fn()}
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

    const surroundWithAction = editor.addAction.mock.calls
      .map(([action]) => action)
      .find((action) => action.id === "mockor.surroundWith");

    await act(async () => {
      surroundWithAction.run();
      await Promise.resolve();
    });

    const picker = queryRequired<HTMLElement>(
      document.body,
      "[aria-label='Surround with']",
    );
    const ifButton = Array.from(
      picker.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("if"));

    await act(async () => {
      ifButton?.click();
      await Promise.resolve();
    });

    expect(editor.executeEdits).toHaveBeenCalledWith(
      "mockor.surroundWith",
      [
        expect.objectContaining({
          text: [
            "if (condition) {",
            "    $total = $price * $qty;",
            "}",
          ].join("\n"),
        }),
      ],
    );
  });

  it("preserves literal snippet markers in the fallback wrapped text", async () => {
    // The selection itself contains text that looks like snippet structure
    // ($0 caret, ${1:...} placeholder). The fallback must treat these as literal
    // body content, not as markers to strip.
    const selected = 'echo "$0 then ${1:x} and \\$y";';
    const lines = [selected];
    const activeDocument: EditorDocument = {
      content: `${lines.join("\n")}\n`,
      language: "php",
      name: "Service.php",
      path: "/workspace/Service.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getEOL: vi.fn(() => "\n"),
      getLineContent: vi.fn((lineNumber: number) => lines[lineNumber - 1] ?? ""),
      getLineCount: vi.fn(() => lines.length),
      getLineMaxColumn: vi.fn(
        (lineNumber: number) => (lines[lineNumber - 1]?.length ?? 0) + 1,
      ),
      getOptions: vi.fn(() => ({ indentSize: 4, insertSpaces: true, tabSize: 4 })),
      getValueInRange: vi.fn(() => selected),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    editor.getContribution.mockReturnValue(null);
    editor.getSelection.mockReturnValue({
      endColumn: selected.length + 1,
      endLineNumber: 1,
      startColumn: 1,
      startLineNumber: 1,
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
          onGoToSuperMethod={vi.fn()}
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

    const surroundWithAction = editor.addAction.mock.calls
      .map(([action]) => action)
      .find((action) => action.id === "mockor.surroundWith");

    await act(async () => {
      surroundWithAction.run();
      await Promise.resolve();
    });

    const picker = queryRequired<HTMLElement>(
      document.body,
      "[aria-label='Surround with']",
    );
    const ifButton = Array.from(
      picker.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("if"));

    await act(async () => {
      ifButton?.click();
      await Promise.resolve();
    });

    expect(editor.executeEdits).toHaveBeenCalledWith(
      "mockor.surroundWith",
      [
        expect.objectContaining({
          text: [
            "if (condition) {",
            `    ${selected}`,
            "}",
          ].join("\n"),
        }),
      ],
    );
  });

  it("appends a semicolon and moves the caret on Complete Current Statement", async () => {
    const lines = ["        $total = $price * $qty"];
    const { editor } = await mountCompleteStatementSurface(root, lines);

    editor.getPosition.mockReturnValue({
      column: lines[0].length + 1,
      lineNumber: 1,
    });

    const action = completeStatementAction(editor);

    await act(async () => {
      action.run();
      await Promise.resolve();
    });

    expect(editor.executeEdits).toHaveBeenCalledWith("mockor.completeStatement", [
      expect.objectContaining({
        range: expect.objectContaining({ startLineNumber: 1 }),
        text: "        $total = $price * $qty;",
      }),
    ]);
    expect(editor.setPosition).toHaveBeenCalledWith({
      column: "        $total = $price * $qty;".length + 1,
      lineNumber: 1,
    });
  });

  it("closes an unbalanced call before terminating on Complete Current Statement", async () => {
    const lines = ["$this->repo->save(1, 2"];
    const { editor } = await mountCompleteStatementSurface(root, lines);

    editor.getPosition.mockReturnValue({
      column: lines[0].length + 1,
      lineNumber: 1,
    });

    const action = completeStatementAction(editor);

    await act(async () => {
      action.run();
      await Promise.resolve();
    });

    expect(editor.executeEdits).toHaveBeenCalledWith("mockor.completeStatement", [
      expect.objectContaining({ text: "$this->repo->save(1, 2);" }),
    ]);
  });

  it("opens a brace block via the snippet controller for a control header", async () => {
    const lines = ["if ($ready)"];
    const { editor } = await mountCompleteStatementSurface(root, lines);
    const snippetController = { insert: vi.fn() };
    editor.getContribution.mockReturnValue(snippetController);

    editor.getPosition.mockReturnValue({
      column: lines[0].length + 1,
      lineNumber: 1,
    });

    const action = completeStatementAction(editor);

    await act(async () => {
      action.run();
      await Promise.resolve();
    });

    expect(snippetController.insert).toHaveBeenCalledWith(
      "if (\\$ready) {\n    $0\n}",
    );
    expect(editor.executeEdits).not.toHaveBeenCalled();
  });

  it("does nothing on Complete Current Statement for a non-PHP document", async () => {
    const lines = ["const total = price * qty"];
    const { editor } = await mountCompleteStatementSurface(root, lines, "typescript");

    editor.getPosition.mockReturnValue({
      column: lines[0].length + 1,
      lineNumber: 1,
    });

    const action = completeStatementAction(editor);

    await act(async () => {
      action.run();
      await Promise.resolve();
    });

    expect(editor.executeEdits).not.toHaveBeenCalled();
    expect(editor.setPosition).not.toHaveBeenCalled();
  });

  it("does nothing on Complete Current Statement inside a multiline array", async () => {
    const lines = ["$config = [", "    'name' => $value", "];"];
    const { editor } = await mountCompleteStatementSurface(root, lines);

    editor.getPosition.mockReturnValue({
      column: lines[1].length + 1,
      lineNumber: 2,
    });

    const action = completeStatementAction(editor);

    await act(async () => {
      action.run();
      await Promise.resolve();
    });

    expect(editor.executeEdits).not.toHaveBeenCalled();
    expect(editor.setPosition).not.toHaveBeenCalled();
  });

  it("does not close a closure brace opened on the caret line", async () => {
    const lines = ["$callback = function () {"];
    const { editor } = await mountCompleteStatementSurface(root, lines);

    editor.getPosition.mockReturnValue({
      column: lines[0].length + 1,
      lineNumber: 1,
    });

    const action = completeStatementAction(editor);

    await act(async () => {
      action.run();
      await Promise.resolve();
    });

    expect(editor.executeEdits).not.toHaveBeenCalled();
    expect(editor.setPosition).not.toHaveBeenCalled();
  });

  it("swaps a whole PHP block above its neighbour on Move Statement Up", async () => {
    const lines = ["$before = 1;", "if ($ready) {", "    doStuff();", "}"];
    const { editor } = await mountCompleteStatementSurface(root, lines);

    editor.getPosition.mockReturnValue({ column: 1, lineNumber: 2 });

    const action = moveStatementAction(editor, "up");

    await act(async () => {
      action.run();
      await Promise.resolve();
    });

    expect(editor.executeEdits).toHaveBeenCalledWith("mockor.moveStatement", [
      expect.objectContaining({
        range: expect.objectContaining({
          startLineNumber: 1,
          endLineNumber: 4,
        }),
        text: [
          "if ($ready) {",
          "    doStuff();",
          "}",
          "$before = 1;",
        ].join("\n"),
      }),
    ]);
    expect(editor.setPosition).toHaveBeenCalledWith({
      column: 1,
      lineNumber: 1,
    });
    expect(editor.trigger).not.toHaveBeenCalledWith(
      "keyboard",
      "editor.action.moveLinesUpAction",
      {},
    );
  });

  it("swaps two single-line PHP statements on Move Statement Down", async () => {
    const lines = ["$a = 1;", "$b = 2;", "$c = 3;"];
    const { editor } = await mountCompleteStatementSurface(root, lines);

    editor.getPosition.mockReturnValue({ column: 1, lineNumber: 2 });

    const action = moveStatementAction(editor, "down");

    await act(async () => {
      action.run();
      await Promise.resolve();
    });

    expect(editor.executeEdits).toHaveBeenCalledWith("mockor.moveStatement", [
      expect.objectContaining({
        text: ["$c = 3;", "$b = 2;"].join("\n"),
      }),
    ]);
  });

  it("falls back to Monaco Move Line when the PHP statement swap is ambiguous", async () => {
    const lines = ["$a = 1;", "$b = 2;"];
    const { editor } = await mountCompleteStatementSurface(root, lines);

    editor.getPosition.mockReturnValue({ column: 1, lineNumber: 1 });

    const action = moveStatementAction(editor, "up");

    await act(async () => {
      action.run();
      await Promise.resolve();
    });

    expect(editor.executeEdits).not.toHaveBeenCalled();
    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.moveLinesUpAction",
      {},
    );
  });

  it("falls back to Monaco Move Line for a non-PHP document", async () => {
    const lines = ["const a = 1;", "const b = 2;", "const c = 3;"];
    const { editor } = await mountCompleteStatementSurface(
      root,
      lines,
      "typescript",
    );

    editor.getPosition.mockReturnValue({ column: 1, lineNumber: 2 });

    const action = moveStatementAction(editor, "down");

    await act(async () => {
      action.run();
      await Promise.resolve();
    });

    expect(editor.executeEdits).not.toHaveBeenCalled();
    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.moveLinesDownAction",
      {},
    );
  });

  it("routes JavaScript and TypeScript navigation through workbench actions", async () => {
    stubNavigatorPlatform("Linux x86_64");

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
          keymap={defaultKeymapSettings("linux")}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={onGoToDefinition}
          onGoToImplementationAt={onGoToImplementationAt}
          onGoToSuperMethod={vi.fn()}
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
    const goToDefinitionAction = actions.find(
      (action) => action.id === "mockor.goToDefinition",
    );
    const goToImplementationAction = actions.find(
      (action) => action.id === "mockor.goToImplementation",
    );

    expect(goToDefinitionAction).toEqual(
      expect.objectContaining({
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB],
      }),
    );
    expect(goToImplementationAction).toEqual(
      expect.objectContaining({
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyB,
        ],
      }),
    );

    goToDefinitionAction?.run();
    goToImplementationAction?.run();

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

  it("formats the active document through the formatting provider with Shift+Alt+F", async () => {
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
          keymap={defaultKeymapSettings("linux")}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onGoToSuperMethod={vi.fn()}
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

    const formatDocumentAction = editor.addAction.mock.calls
      .map(([action]) => action)
      .find((action) => action.id === "mockor.formatDocument");

    expect(formatDocumentAction).toEqual(
      expect.objectContaining({
        keybindings: [
          monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
        ],
        label: "Format Document",
      }),
    );

    formatDocumentAction.run();

    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.formatDocument",
      {},
    );

    editor.trigger.mockClear();
    editor.getModel.mockReturnValueOnce(null);

    formatDocumentAction.run();

    expect(editor.trigger).not.toHaveBeenCalled();
  });

  it("formats the selected range through the formatting provider with Cmd+Alt+L", async () => {
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
          keymap={defaultKeymapSettings("mac")}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onGoToSuperMethod={vi.fn()}
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

    const formatSelectionAction = editor.addAction.mock.calls
      .map(([action]) => action)
      .find((action) => action.id === "mockor.formatSelection");

    expect(formatSelectionAction).toEqual(
      expect.objectContaining({
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyL,
        ],
        label: "Format Selection",
      }),
    );

    formatSelectionAction.run();

    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.formatSelection",
      {},
    );

    editor.trigger.mockClear();
    editor.getModel.mockReturnValueOnce(null);

    formatSelectionAction.run();

    expect(editor.trigger).not.toHaveBeenCalled();
  });

  it("wires editor ergonomics actions to their Monaco commands and keybindings", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "ergonomics.ts",
      path: "/workspace/src/ergonomics.ts",
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
          keymap={defaultKeymapSettings("mac")}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onGoToSuperMethod={vi.fn()}
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
    const actionById = (id: string) =>
      actions.find((action) => action.id === id);

    const moveLineUp = actionById("mockor.moveLineUp");
    const moveLineDown = actionById("mockor.moveLineDown");
    const duplicateLine = actionById("mockor.duplicateLine");
    const addSelectionToNextMatch = actionById(
      "mockor.addSelectionToNextMatch",
    );
    const deleteLine = actionById("mockor.deleteLine");
    const quickDefinition = actionById("mockor.quickDefinition");

    expect(quickDefinition).toEqual(
      expect.objectContaining({
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyI,
        ],
      }),
    );

    const moveStatementUp = actionById("mockor.moveStatementUp");
    const moveStatementDown = actionById("mockor.moveStatementDown");

    expect(moveStatementUp).toEqual(
      expect.objectContaining({
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.UpArrow,
        ],
      }),
    );
    expect(moveStatementDown).toEqual(
      expect.objectContaining({
        keybindings: [
          monaco.KeyMod.CtrlCmd |
            monaco.KeyMod.Shift |
            monaco.KeyCode.DownArrow,
        ],
      }),
    );
    expect(moveLineUp).toEqual(
      expect.objectContaining({
        keybindings: [
          monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.UpArrow,
        ],
      }),
    );
    expect(moveLineDown).toEqual(
      expect.objectContaining({
        keybindings: [
          monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.DownArrow,
        ],
      }),
    );
    expect(duplicateLine).toEqual(
      expect.objectContaining({
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyD,
        ],
      }),
    );
    expect(addSelectionToNextMatch).toEqual(
      expect.objectContaining({
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD],
      }),
    );
    expect(deleteLine).toEqual(
      expect.objectContaining({
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyK,
        ],
      }),
    );

    moveLineUp?.run();
    moveLineDown?.run();
    duplicateLine?.run();
    addSelectionToNextMatch?.run();
    deleteLine?.run();
    quickDefinition?.run();

    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.moveLinesUpAction",
      {},
    );
    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.moveLinesDownAction",
      {},
    );
    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.copyLinesDownAction",
      {},
    );
    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.addSelectionToNextFindMatch",
      {},
    );
    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.deleteLines",
      {},
    );
    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.peekDefinition",
      {},
    );
  });

  it("wires the line/case utility actions to their Monaco commands and keybindings", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\nconst other = 2;\n",
      language: "typescript",
      name: "utilities.ts",
      path: "/workspace/src/utilities.ts",
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
          keymap={defaultKeymapSettings("mac")}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onGoToSuperMethod={vi.fn()}
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
    const actionById = (id: string) =>
      actions.find((action) => action.id === id);

    const joinLines = actionById("mockor.joinLines");
    const sortLinesAscending = actionById("mockor.sortLinesAscending");
    const sortLinesDescending = actionById("mockor.sortLinesDescending");
    const toggleCase = actionById("mockor.toggleCase");
    const transformToLowercase = actionById("mockor.transformToLowercase");

    expect(joinLines).toEqual(
      expect.objectContaining({
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyJ,
        ],
        label: "Join Lines",
      }),
    );
    expect(toggleCase).toEqual(
      expect.objectContaining({
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyU,
        ],
        label: "Toggle Case",
      }),
    );
    expect(sortLinesAscending).toEqual(
      expect.objectContaining({
        keybindings: [],
        label: "Sort Lines Ascending",
      }),
    );
    expect(sortLinesDescending).toEqual(
      expect.objectContaining({
        keybindings: [],
        label: "Sort Lines Descending",
      }),
    );
    expect(transformToLowercase).toEqual(
      expect.objectContaining({
        keybindings: [],
        label: "Transform to Lowercase",
      }),
    );

    joinLines?.run();
    sortLinesAscending?.run();
    sortLinesDescending?.run();
    toggleCase?.run();
    transformToLowercase?.run();

    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.joinLines",
      {},
    );
    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.sortLinesAscending",
      {},
    );
    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.sortLinesDescending",
      {},
    );
    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.transformToUppercase",
      {},
    );
    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.transformToLowercase",
      {},
    );
  });

  it("wires multi-cursor and selection-resize actions to their Monaco commands and keybindings", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "multicursor.ts",
      path: "/workspace/src/multicursor.ts",
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
          keymap={defaultKeymapSettings("mac")}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onGoToSuperMethod={vi.fn()}
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
    const actionById = (id: string) =>
      actions.find((action) => action.id === id);

    const insertCursorAbove = actionById("mockor.insertCursorAbove");
    const insertCursorBelow = actionById("mockor.insertCursorBelow");
    const selectAllOccurrences = actionById("mockor.selectAllOccurrences");
    const shrinkSelection = actionById("mockor.shrinkSelection");

    expect(insertCursorAbove).toEqual(
      expect.objectContaining({
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.UpArrow,
        ],
      }),
    );
    expect(insertCursorBelow).toEqual(
      expect.objectContaining({
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.DownArrow,
        ],
      }),
    );
    expect(selectAllOccurrences).toEqual(
      expect.objectContaining({
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL,
        ],
      }),
    );
    expect(shrinkSelection).toEqual(
      expect.objectContaining({
        keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.DownArrow],
      }),
    );

    insertCursorAbove?.run();
    insertCursorBelow?.run();
    selectAllOccurrences?.run();
    shrinkSelection?.run();

    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.insertCursorAbove",
      {},
    );
    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.insertCursorBelow",
      {},
    );
    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.selectHighlights",
      {},
    );
    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.smartSelect.shrink",
      {},
    );
  });

  it("toggles column selection mode on and off via updateOptions", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "column.ts",
      path: "/workspace/src/column.ts",
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
          keymap={defaultKeymapSettings("mac")}
          monacoTheme="calm-dark"
          onChange={vi.fn()}
          onCloseActiveTab={vi.fn()}
          onCursorPositionChange={vi.fn()}
          onGoBack={vi.fn()}
          onGoForward={vi.fn()}
          onGoToDefinition={vi.fn()}
          onGoToImplementationAt={vi.fn()}
          onGoToSuperMethod={vi.fn()}
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

    const toggleColumnSelection = editor.addAction.mock.calls
      .map(([action]) => action)
      .find((action) => action.id === "mockor.toggleColumnSelection");

    expect(toggleColumnSelection).toBeDefined();

    editor.updateOptions.mockClear();

    toggleColumnSelection?.run();
    expect(editor.updateOptions).toHaveBeenLastCalledWith({
      columnSelection: true,
    });

    toggleColumnSelection?.run();
    expect(editor.updateOptions).toHaveBeenLastCalledWith({
      columnSelection: false,
    });
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
          onGoToSuperMethod={vi.fn()}
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
          onGoToSuperMethod={vi.fn()}
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
          onGoToSuperMethod={vi.fn()}
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
          onGoToSuperMethod={vi.fn()}
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
          onGoToSuperMethod={vi.fn()}
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
          onGoToSuperMethod={vi.fn()}
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
          onGoToSuperMethod={vi.fn()}
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
          onGoToSuperMethod={vi.fn()}
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

  it("does not fetch breadcrumb document symbols for a PHP document before it is synced", async () => {
    const activeDocument: EditorDocument = {
      content: "<?php\nclass Example {}\n",
      language: "php",
      name: "Example.php",
      path: "/workspace/app/Example.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getValue: vi.fn(() => activeDocument.content),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    const gateway = languageServerFeaturesGateway();
    const documentSymbolsMock = vi.fn(async () => []);
    gateway.documentSymbols =
      documentSymbolsMock as unknown as typeof gateway.documentSymbols;

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          isLanguageServerDocumentSynced={vi.fn(() => false)}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={gateway}
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
          onGoToSuperMethod={vi.fn()}
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
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(documentSymbolsMock).not.toHaveBeenCalled();
  });

  it("fetches breadcrumb document symbols for a PHP document once it becomes synced", async () => {
    const activeDocument: EditorDocument = {
      content: "<?php\nclass Example {}\n",
      language: "php",
      name: "Example.php",
      path: "/workspace/app/Example.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getValue: vi.fn(() => activeDocument.content),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    const gateway = languageServerFeaturesGateway();
    const documentSymbolsMock = vi.fn(async () => []);
    gateway.documentSymbols =
      documentSymbolsMock as unknown as typeof gateway.documentSymbols;

    let synced = false;
    const isLanguageServerDocumentSynced = vi.fn(() => synced);

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          isLanguageServerDocumentSynced={isLanguageServerDocumentSynced}
          languageServerDiagnosticsByPath={{}}
          languageServerFeaturesGateway={gateway}
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
          onGoToSuperMethod={vi.fn()}
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
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(documentSymbolsMock).not.toHaveBeenCalled();

    synced = true;

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    expect(documentSymbolsMock).toHaveBeenCalledWith(
      "/workspace",
      activeDocument.path,
    );

    // The poll must stop once the document is synced and the fetch ran, so the
    // breadcrumb fetch is not re-issued on every subsequent tick.
    const callsAfterSync = documentSymbolsMock.mock.calls.length;

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(documentSymbolsMock.mock.calls.length).toBe(callsAfterSync);
  });

  it("forwards isLanguageServerDocumentSynced into the language server provider context", async () => {
    const activeDocument: EditorDocument = {
      content: "<?php\nclass Example {}\n",
      language: "php",
      name: "Example.php",
      path: "/workspace/app/Example.php",
      savedContent: "",
    };
    const model: FakeModel = {
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);
    const isLanguageServerDocumentSynced = vi.fn(() => true);

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          isLanguageServerDocumentSynced={isLanguageServerDocumentSynced}
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
          onGoToSuperMethod={vi.fn()}
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
      await Promise.resolve();
    });

    const context = editorSurfaceMocks.registeredContext;

    expect(context?.isDocumentSynced).toEqual(expect.any(Function));

    expect(context?.isDocumentSynced?.("/workspace", activeDocument.path)).toBe(
      true,
    );
    expect(isLanguageServerDocumentSynced).toHaveBeenCalledWith(
      activeDocument.path,
    );
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
          onGoToSuperMethod={vi.fn()}
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
          onGoToSuperMethod={vi.fn()}
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
          onGoToSuperMethod={vi.fn()}
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
          onGoToSuperMethod={vi.fn()}
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

  it("skips re-rendering when an unrelated parent update leaves its props referentially equal", async () => {
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

    let triggerUnrelatedRender: () => void = () => undefined;

    function MemoGuardHarness() {
      const [unrelatedCounter, setUnrelatedCounter] = useState(0);
      triggerUnrelatedRender = () => setUnrelatedCounter((value) => value + 1);

      // Build a fresh element on every render but reuse the same, referentially
      // stable prop bag. Without a memo boundary the function component would
      // re-render on each parent update; with memo the shallow-equal props let
      // React skip it. The unrelated counter only affects the wrapper div.
      return createElement(
        "div",
        { "data-unrelated": unrelatedCounter },
        createElement(EditorSurface, stableMemoGuardProps),
      );
    }

    await act(async () => {
      root.render(createElement(MemoGuardHarness));
      await Promise.resolve();
    });

    const rendersAfterMount = editorSurfaceMocks.renderCount;
    expect(rendersAfterMount).toBeGreaterThan(0);

    await act(async () => {
      triggerUnrelatedRender();
      await Promise.resolve();
    });

    // memo skips the EditorSurface render because every prop is referentially
    // equal, so the unrelated parent update does not re-render the surface.
    expect(editorSurfaceMocks.renderCount).toBe(rendersAfterMount);
  });

  it("re-renders the Monaco surface when the active document content changes", async () => {
    const initialDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: "",
    };
    const updatedDocument: EditorDocument = {
      ...initialDocument,
      content: "const value = 2;\n",
    };
    const model: FakeModel = {
      uri: {
        fsPath: initialDocument.path,
        path: initialDocument.path,
      },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    const renderSurface = (document: EditorDocument) =>
      root.render(memoGuardSurface(document));

    await act(async () => {
      renderSurface(initialDocument);
      await Promise.resolve();
    });

    expect(
      (editorSurfaceMocks.props as { value?: string } | null)?.value,
    ).toBe(initialDocument.content);

    await act(async () => {
      renderSurface(updatedDocument);
      await Promise.resolve();
    });

    expect(
      (editorSurfaceMocks.props as { value?: string } | null)?.value,
    ).toBe(updatedDocument.content);
  });

  it("invokes the focus handler the parent supplies for the active file reveal signal", async () => {
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
    const onEditorFocused = vi.fn();

    await act(async () => {
      root.render(memoGuardSurface(activeDocument, { onEditorFocused }));
      await Promise.resolve();
    });

    const panel = queryRequired<HTMLElement>(host, '[role="tabpanel"]');
    act(() => {
      panel.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(onEditorFocused).toHaveBeenCalled();
  });

  it("keeps the Monaco options, onChange, beforeMount and loading props referentially stable across a cursor move", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\nconst other = 2;\n",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: "",
    };
    const model: FakeModel = {
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const editor = createEditor(model);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(createElement(EditorSurface, memoGuardProps(activeDocument)));
      await Promise.resolve();
    });

    const optionsBefore = editorSurfaceMocks.props?.options;
    const onChangeBefore = editorSurfaceMocks.props?.onChange;
    const beforeMountBefore = editorSurfaceMocks.props?.beforeMount;
    const loadingBefore = editorSurfaceMocks.props?.loading;
    const updateOptionsCallsBefore = editor.updateOptions.mock.calls.length;

    // A real cursor move that lands on a different position must update the
    // tracked position (breadcrumbs depend on it) without churning the heavy
    // Monaco props - otherwise @monaco-editor/react re-runs updateOptions and
    // disposes/recreates the model-content listener on every cursor move.
    await act(async () => {
      editor.cursorPositionHandler?.({
        position: { column: 5, lineNumber: 2 },
      });
      await Promise.resolve();
    });

    expect(editorSurfaceMocks.props?.options).toBe(optionsBefore);
    expect(editorSurfaceMocks.props?.onChange).toBe(onChangeBefore);
    expect(editorSurfaceMocks.props?.beforeMount).toBe(beforeMountBefore);
    expect(editorSurfaceMocks.props?.loading).toBe(loadingBefore);
    expect(editor.updateOptions.mock.calls.length).toBe(
      updateOptionsCallsBefore,
    );
  });

  it("recomputes the Monaco options when an editor setting changes so it is applied", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: "",
    };
    const model: FakeModel = {
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          editorFontSize: 14,
        }),
      );
      await Promise.resolve();
    });

    const optionsBefore = editorSurfaceMocks.props?.options;
    expect(optionsBefore).toEqual(
      expect.objectContaining({ fontSize: 14 }),
    );

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          editorFontSize: 20,
        }),
      );
      await Promise.resolve();
    });

    expect(editorSurfaceMocks.props?.options).not.toBe(optionsBefore);
    expect(editorSurfaceMocks.props?.options).toEqual(
      expect.objectContaining({ fontSize: 20 }),
    );
  });

  it("recomputes the Monaco options when the read-only state changes", async () => {
    const editableDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: "",
    };
    const readOnlyDocument: EditorDocument = {
      ...editableDocument,
      readOnly: true,
    };
    const model: FakeModel = {
      uri: { fsPath: editableDocument.path, path: editableDocument.path },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        createElement(EditorSurface, memoGuardProps(editableDocument)),
      );
      await Promise.resolve();
    });

    expect(editorSurfaceMocks.props?.options).toEqual(
      expect.objectContaining({ readOnly: false }),
    );

    await act(async () => {
      root.render(
        createElement(EditorSurface, memoGuardProps(readOnlyDocument)),
      );
      await Promise.resolve();
    });

    expect(editorSurfaceMocks.props?.options).toEqual(
      expect.objectContaining({ readOnly: true, domReadOnly: true }),
    );
  });

  it("forwards the current parent onChange handler even though the prop identity is stable", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: "",
    };
    const model: FakeModel = {
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    const firstOnChange = vi.fn();
    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          onChange: firstOnChange,
        }),
      );
      await Promise.resolve();
    });

    const stableOnChange = editorSurfaceMocks.props?.onChange;

    const secondOnChange = vi.fn();
    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          onChange: secondOnChange,
        }),
      );
      await Promise.resolve();
    });

    // The wrapped Editor receives the same stable onChange reference so its memo
    // is never broken by a fresh handler...
    expect(editorSurfaceMocks.props?.onChange).toBe(stableOnChange);

    // ...yet invoking it routes to the latest parent handler (no stale closure).
    act(() => {
      editorSurfaceMocks.props?.onChange?.("next");
    });

    expect(firstOnChange).not.toHaveBeenCalled();
    expect(secondOnChange).toHaveBeenCalledWith("next");
  });

  it("does not update tracked cursor state when the cursor fires with an unchanged position", async () => {
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
    const editor = createEditor(model);
    editor.getPosition.mockReturnValue({ column: 14, lineNumber: 1 });
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(model);

    const gateway = languageServerFeaturesGateway();
    const documentSymbols: LanguageServerDocumentSymbol[] = [
      {
        children: [],
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
    gateway.documentSymbols = vi.fn(
      async () => documentSymbols,
    ) as unknown as typeof gateway.documentSymbols;

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          javaScriptTypeScriptLanguageServerFeaturesGateway: gateway,
          workspaceRoot: "/workspace",
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    const labelsBefore = Array.from(
      host.querySelectorAll<HTMLElement>(".breadcrumb-segment"),
    ).map((segment) => segment.textContent);
    expect(labelsBefore).toEqual(["App.tsx", "MyComponent"]);

    const optionsBefore = editorSurfaceMocks.props?.options;
    const renderCountBefore = editorSurfaceMocks.renderCount;

    // Monaco can fire onDidChangeCursorPosition with the same position (e.g. a
    // repeated click on the current spot). The gate must skip the duplicate so
    // the surface does not re-render at all.
    await act(async () => {
      editor.cursorPositionHandler?.({
        position: { column: 14, lineNumber: 1 },
      });
      await Promise.resolve();
    });

    expect(editorSurfaceMocks.renderCount).toBe(renderCountBefore);
    expect(editorSurfaceMocks.props?.options).toBe(optionsBefore);

    const labelsAfter = Array.from(
      host.querySelectorAll<HTMLElement>(".breadcrumb-segment"),
    ).map((segment) => segment.textContent);
    expect(labelsAfter).toEqual(["App.tsx", "MyComponent"]);
  });

  it("warms the active model's tokens progressively on idle after open", async () => {
    const idle = captureIdleCallbacks();

    const activeDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: "",
    };
    const model = tokenizableModel(activeDocument.path, 1200);
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(memoGuardSurface(activeDocument));
      await Promise.resolve();
    });

    // Warming is deferred to idle, never run synchronously on the open path.
    expect(model.tokenization?.forceTokenization).not.toHaveBeenCalled();
    expect(idle.pending()).toBe(1);

    await act(async () => {
      idle.runAll();
    });

    // The whole model is warmed in chunks; the final call clamps to the last
    // line and warming then stops re-arming.
    const calls = (model.tokenization?.forceTokenization.mock.calls ?? []).map(
      ([lineNumber]) => lineNumber,
    );
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[calls.length - 1]).toBe(1200);
    expect(idle.pending()).toBe(0);
  });

  it("stops warming the model when the surface unmounts", async () => {
    const idle = captureIdleCallbacks();

    const activeDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: "",
    };
    const model = tokenizableModel(activeDocument.path, 5000);
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(memoGuardSurface(activeDocument));
      await Promise.resolve();
    });

    await act(async () => {
      idle.runNext();
    });
    const callsBeforeUnmount =
      model.tokenization?.forceTokenization.mock.calls.length ?? 0;
    expect(callsBeforeUnmount).toBeGreaterThan(0);

    await act(async () => {
      root.unmount();
    });

    // No pending idle slice survives the unmount, and draining the queue cannot
    // resurrect warming for the now-gone surface.
    expect(idle.pending()).toBe(0);
    await act(async () => {
      idle.runAll();
    });
    expect(model.tokenization?.forceTokenization.mock.calls.length).toBe(
      callsBeforeUnmount,
    );
  });

  it("never warms a disposed model's tokens", async () => {
    const idle = captureIdleCallbacks();

    const activeDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: "",
    };
    const model = tokenizableModel(activeDocument.path, 5000);
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(memoGuardSurface(activeDocument));
      await Promise.resolve();
    });

    // The model is disposed (tab/file/workspace switch) while a slice is queued.
    model.isDisposed?.mockReturnValue(true);

    await act(async () => {
      idle.runAll();
    });

    expect(model.tokenization?.forceTokenization).not.toHaveBeenCalled();
    expect(idle.pending()).toBe(0);
  });

  it("renders per-line git blame annotations when enabled", async () => {
    const activeDocument: EditorDocument = {
      content: "const one = 1;\nconst two = 2;\n",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: "",
    };
    const model: FakeModel = {
      dispose: vi.fn(),
      getLineCount: vi.fn(() => 2),
      getValue: vi.fn(() => activeDocument.content),
      isDisposed: vi.fn(() => false),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;
    const now = Math.floor(Date.now() / 1000);
    const provideGitBlame = vi.fn(async () => [
      { author: "Alice", lineNumber: 1, sha: "1a2b3c4", timestamp: now - 86400 },
      { author: "Bob", lineNumber: 2, sha: "f0e1d2c", timestamp: now - 7200 },
    ]);

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          gitBlameEnabled
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
          onGoToSuperMethod={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          provideGitBlame={provideGitBlame}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(provideGitBlame).toHaveBeenCalledWith(activeDocument.path);
    const blameCall = editor.deltaDecorations.mock.calls.find(
      ([, decorations]) =>
        decorations.some(
          (decoration: any) =>
            decoration.options?.before?.inlineClassName === "git-blame-annotation",
        ),
    );
    expect(blameCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          options: expect.objectContaining({
            before: expect.objectContaining({
              content: expect.stringContaining("Alice"),
              inlineClassName: "git-blame-annotation",
            }),
          }),
          range: expect.objectContaining({ startLineNumber: 1 }),
        }),
      ]),
    );
  });

  it("renders no git blame annotations when disabled", async () => {
    const activeDocument: EditorDocument = {
      content: "const one = 1;\n",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: "",
    };
    const model: FakeModel = {
      dispose: vi.fn(),
      getLineCount: vi.fn(() => 1),
      getValue: vi.fn(() => activeDocument.content),
      isDisposed: vi.fn(() => false),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;
    const provideGitBlame = vi.fn(async () => []);

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          gitBlameEnabled={false}
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
          onGoToSuperMethod={vi.fn()}
          onLanguageServerError={vi.fn()}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          provideGitBlame={provideGitBlame}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(provideGitBlame).not.toHaveBeenCalled();
    const blameCall = editor.deltaDecorations.mock.calls.find(
      ([, decorations]) =>
        decorations.some(
          (decoration: any) =>
            decoration.options?.before?.inlineClassName === "git-blame-annotation",
        ),
    );
    expect(blameCall).toBeUndefined();
  });

  it("drops stale git blame results after the active document switches", async () => {
    const first: EditorDocument = {
      content: "const one = 1;\n",
      language: "typescript",
      name: "first.ts",
      path: "/workspace/src/first.ts",
      savedContent: "",
    };
    const second: EditorDocument = {
      content: "const two = 2;\n",
      language: "typescript",
      name: "second.ts",
      path: "/workspace/src/second.ts",
      savedContent: "",
    };
    // The model reports the SECOND document's path: the surface has already
    // switched tabs by the time the first document's blame promise resolves.
    const model: FakeModel = {
      dispose: vi.fn(),
      getLineCount: vi.fn(() => 1),
      getValue: vi.fn(() => second.content),
      isDisposed: vi.fn(() => false),
      uri: { fsPath: second.path, path: second.path },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;
    const now = Math.floor(Date.now() / 1000);
    const provideGitBlame = vi.fn(async (path: string) =>
      path === first.path
        ? [{ author: "Stale", lineNumber: 1, sha: "1111111", timestamp: now - 60 }]
        : [],
    );

    const props = (document: EditorDocument) => ({
      activeDocument: document,
      changeHunks: [],
      editorRevealTarget: null,
      flushPendingLanguageServerDocument: vi.fn(async () => undefined),
      gitBlameEnabled: true,
      languageServerDiagnosticsByPath: {},
      languageServerFeaturesGateway: languageServerFeaturesGateway(),
      languageServerRuntimeStatus: null,
      keymap: defaultKeymapSettings(),
      monacoTheme: "calm-dark" as const,
      onChange: vi.fn(),
      onCloseActiveTab: vi.fn(),
      onCursorPositionChange: vi.fn(),
      onEditorFocused: vi.fn(),
      onGoBack: vi.fn(),
      onGoForward: vi.fn(),
      onGoToDefinition: vi.fn(),
      onGoToImplementationAt: vi.fn(),
      onGoToSuperMethod: vi.fn(),
      onLanguageServerError: vi.fn(),
      onOpenClass: vi.fn(),
      onOpenFile: vi.fn(),
      onOpenFileStructure: vi.fn(),
      onRevealTargetHandled: vi.fn(),
      onRevertChangeHunk: vi.fn(),
      phpSyntaxDiagnosticsGateway: { validate: vi.fn(async () => []) },
      provideGitBlame,
      providePhpMethodCompletions: vi.fn(async () => []),
      providePhpMethodSignature: vi.fn(async () => null),
    });

    await act(async () => {
      root.render(<EditorSurface {...props(first)} />);
    });
    await act(async () => {
      root.render(<EditorSurface {...props(second)} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const staleCall = editor.deltaDecorations.mock.calls.find(
      ([, decorations]) =>
        decorations.some((decoration: any) =>
          decoration.options?.before?.content?.includes("Stale"),
        ),
    );
    expect(staleCall).toBeUndefined();
  });
});

function memoGuardProps(
  activeDocument: EditorDocument,
  overrides: Partial<{ onEditorFocused: () => void }> = {},
) {
  return {
    activeDocument,
    changeHunks: [],
    editorRevealTarget: null,
    flushPendingLanguageServerDocument: vi.fn(async () => undefined),
    languageServerDiagnosticsByPath: {},
    javaScriptTypeScriptValidationEnabled: true,
    languageServerFeaturesGateway: languageServerFeaturesGateway(),
    languageServerRuntimeStatus: null,
    keymap: defaultKeymapSettings(),
    monacoTheme: "calm-dark" as const,
    onChange: vi.fn(),
    onCloseActiveTab: vi.fn(),
    onCursorPositionChange: vi.fn(),
    onGoBack: vi.fn(),
    onGoForward: vi.fn(),
    onGoToDefinition: vi.fn(),
    onGoToImplementationAt: vi.fn(),
    onGoToSuperMethod: vi.fn(),
    onEditorFocused: overrides.onEditorFocused ?? vi.fn(),
    onLanguageServerError: vi.fn(),
    onOpenClass: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenFileStructure: vi.fn(),
    onRevealTargetHandled: vi.fn(),
    onRevertChangeHunk: vi.fn(),
    phpSyntaxDiagnosticsGateway: { validate: vi.fn(async () => []) },
    providePhpMethodCompletions: vi.fn(async () => []),
    providePhpMethodSignature: vi.fn(async () => null),
  };
}

function memoGuardSurface(
  activeDocument: EditorDocument,
  overrides: Partial<{ onEditorFocused: () => void }> = {},
): ReactNode {
  return createElement(EditorSurface, memoGuardProps(activeDocument, overrides));
}

// A single, referentially stable prop bag so that an unrelated parent re-render
// keeps every prop identical (shallow-equal) and the memo boundary can skip.
const stableMemoGuardProps = memoGuardProps({
  content: "const value = 1;\n",
  language: "typescript",
  name: "example.ts",
  path: "/workspace/src/example.ts",
  savedContent: "",
});

async function mountCompleteStatementSurface(
  root: Root,
  lines: string[],
  language: "php" | "typescript" = "php",
): Promise<{ editor: FakeEditor; model: FakeModel }> {
  const path =
    language === "php" ? "/workspace/Service.php" : "/workspace/service.ts";
  const activeDocument: EditorDocument = {
    content: `${lines.join("\n")}\n`,
    language,
    name: language === "php" ? "Service.php" : "service.ts",
    path,
    savedContent: "",
  };
  const model: FakeModel = {
    getEOL: vi.fn(() => "\n"),
    getLineContent: vi.fn((lineNumber: number) => lines[lineNumber - 1] ?? ""),
    getLineCount: vi.fn(() => lines.length),
    getLineMaxColumn: vi.fn(
      (lineNumber: number) => (lines[lineNumber - 1]?.length ?? 0) + 1,
    ),
    getOptions: vi.fn(() => ({ indentSize: 4, insertSpaces: true, tabSize: 4 })),
    getValue: vi.fn(() => `${lines.join("\n")}\n`),
    getValueInRange: vi.fn(() => ""),
    uri: { fsPath: path, path },
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
        onGoToSuperMethod={vi.fn()}
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

  return { editor, model };
}

function completeStatementAction(editor: FakeEditor): { run: () => void } {
  const action = editor.addAction.mock.calls
    .map(([entry]) => entry)
    .find((entry) => entry.id === "mockor.completeStatement");

  if (!action) {
    throw new Error("Expected the complete-statement action to be registered.");
  }

  return action;
}

function moveStatementAction(
  editor: FakeEditor,
  direction: "down" | "up",
): { run: () => void } {
  const id =
    direction === "up" ? "mockor.moveStatementUp" : "mockor.moveStatementDown";
  const action = editor.addAction.mock.calls
    .map(([entry]) => entry)
    .find((entry) => entry.id === id);

  if (!action) {
    throw new Error(`Expected the ${id} action to be registered.`);
  }

  return action;
}

// A FakeModel with the tokenization surface the background warmer drives:
// getLineCount + isDisposed (public Monaco API) and the runtime-only
// `tokenization.forceTokenization`.
function tokenizableModel(path: string, lineCount: number): FakeModel {
  return {
    getLineCount: vi.fn(() => lineCount),
    isDisposed: vi.fn(() => false),
    tokenization: { forceTokenization: vi.fn() },
    uri: { fsPath: path, path },
  };
}

// Stubs `requestIdleCallback`/`cancelIdleCallback` so the surface's
// idle-callback scheduler queues warming slices deterministically instead of
// waiting on real browser idle time (jsdom has neither). Cancelled handles are
// dropped so a cleared slice never runs. Auto-restored by the suite's
// `vi.unstubAllGlobals()` in afterEach.
function captureIdleCallbacks() {
  const queue = new Map<number, () => void>();
  let nextHandle = 1;

  vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
    const handle = nextHandle++;
    queue.set(handle, callback);
    return handle;
  });
  vi.stubGlobal("cancelIdleCallback", (handle: number) => {
    queue.delete(handle);
  });

  return {
    pending: () => queue.size,
    runNext: () => {
      const entry = queue.entries().next().value as
        | [number, () => void]
        | undefined;
      if (!entry) {
        return;
      }
      queue.delete(entry[0]);
      entry[1]();
    },
    runAll() {
      let guard = 0;
      while (queue.size > 0) {
        this.runNext();
        guard += 1;
        if (guard > 100000) {
          throw new Error("idle queue did not drain");
        }
      }
    },
  };
}

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
    getContribution: vi.fn(() => ({ insert: vi.fn() })),
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
    cursorPositionHandler: null,
    mouseDownHandler: null,
    modelContentChangeHandler: null,
    onDidChangeCursorPosition: vi.fn(
      (handler: (event: { position: EditorPosition }) => void) => {
        editor.cursorPositionHandler = handler;

        return { dispose: vi.fn() };
      },
    ),
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
    updateOptions: vi.fn(),
  };

  return editor;
}

// The gutter glyph recompute is debounced (~160ms) so it does not re-parse the
// whole file on every keystroke. Tests that assert on the glyph decorations must
// let the debounce window elapse first.
async function flushGutterDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
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
      GlyphMarginLane: { Center: 2, Left: 1, Right: 3 },
      MouseTargetType: {
        CONTENT_TEXT: 6,
        GUTTER_GLYPH_MARGIN: 4,
        GUTTER_LINE_DECORATIONS: 3,
      },
      OverviewRulerLane: { Left: 1, Right: 4 },
      setModelMarkers: vi.fn(),
      TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
    },
    KeyCode: {
      BracketLeft: 5,
      BracketRight: 6,
      DownArrow: 11,
      Enter: 8,
      KeyB: 1,
      KeyD: 12,
      KeyF: 10,
      KeyI: 15,
      KeyJ: 17,
      KeyK: 13,
      KeyL: 16,
      KeyO: 2,
      KeyP: 3,
      KeyR: 4,
      KeyT: 14,
      KeyU: 18,
      KeyW: 7,
      Slash: 90,
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
    Selection: class FakeSelection {
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

function stubNavigatorPlatform(platform: string): void {
  vi.stubGlobal("navigator", {
    platform,
    userAgent: `Mozilla/5.0 (${platform})`,
    userAgentData: { platform },
  });
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
