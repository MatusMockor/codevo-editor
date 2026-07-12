// @vitest-environment jsdom

import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { URI } from "monaco-editor/esm/vs/base/common/uri.js";
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
import type { EditorChangeHunk } from "../domain/editorChangeMarkers";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { EditorDocument } from "../domain/workspace";
import type { ResolvedEditorConfig } from "../domain/editorConfig";
import { EditorSurface, gitBlameShaAtLine } from "./EditorSurface";
import { workspaceModelUri } from "./phpMonacoDocumentContext";
import {
  type EditorQaDefinitionRequest,
  type EditorQaOpenWorkspaceFileRequest,
  editorQaBridgeEnabled,
} from "./editorQaBridge";

interface FakeModel {
  dispose?: ReturnType<typeof vi.fn>;
  getEOL?: ReturnType<typeof vi.fn>;
  setEOL?: ReturnType<typeof vi.fn>;
  updateOptions?: ReturnType<typeof vi.fn>;
  getLineContent?: ReturnType<typeof vi.fn>;
  getLineCount?: ReturnType<typeof vi.fn>;
  getLineMaxColumn?: ReturnType<typeof vi.fn>;
  getOptions?: ReturnType<typeof vi.fn>;
  getValue?: ReturnType<typeof vi.fn>;
  getValueInRange?: ReturnType<typeof vi.fn>;
  getOffsetAt?: ReturnType<typeof vi.fn>;
  getPositionAt?: ReturnType<typeof vi.fn>;
  getVersionId?: ReturnType<typeof vi.fn>;
  setValue?: ReturnType<typeof vi.fn>;
  isDisposed?: ReturnType<typeof vi.fn>;
  tokenization?: {
    forceTokenization: ReturnType<typeof vi.fn>;
  };
  uri: {
    fsPath: string;
    path: string;
    toString?: () => string;
  };
}

interface FakeEditor {
  addAction: ReturnType<typeof vi.fn>;
  deltaDecorations: ReturnType<typeof vi.fn>;
  executeEdits: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  getContribution: ReturnType<typeof vi.fn>;
  gotoDefinitionContributionDispose: ReturnType<typeof vi.fn>;
  // The built-in gesture contribution. Its `gotoDefinition` method is the one the
  // surface neutralizes (replaces with a no-op) so a Cmd-hover never navigates.
  // `gotoDefinitionContributionNavigate` records the ORIGINAL navigation that the
  // gesture would perform, letting a test assert the surface stopped it without
  // tearing the contribution down.
  gotoDefinitionContribution: {
    gotoDefinition: (...args: unknown[]) => Promise<void>;
  };
  gotoDefinitionContributionNavigate: ReturnType<typeof vi.fn>;
  getDomNode: ReturnType<typeof vi.fn>;
  getLayoutInfo: ReturnType<typeof vi.fn>;
  getModel: ReturnType<typeof vi.fn>;
  getPosition: ReturnType<typeof vi.fn>;
  getSelection: ReturnType<typeof vi.fn>;
  getScrollTop: ReturnType<typeof vi.fn>;
  getTopForLineNumber: ReturnType<typeof vi.fn>;
  cursorPositionHandler:
    | ((event: { position: EditorPosition }) => void)
    | null;
  keyDownHandler: ((event: FakeKeyDownEvent) => void) | null;
  mouseDownHandler: ((event: FakeMouseDownEvent) => void) | null;
  mouseMoveHandler: ((event: FakeMouseDownEvent) => void) | null;
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
  modelContentChangeHandlers: Array<
    (event: {
      changes: Array<{
        range?: {
          startLineNumber: number;
        };
        text: string;
      }>;
    }) => void
  >;
  modelChangeHandler: (() => void) | null;
  modelChangeHandlers: Array<() => void>;
  onDidChangeCursorPosition: ReturnType<typeof vi.fn>;
  onDidChangeModel: ReturnType<typeof vi.fn>;
  onDidChangeModelContent: ReturnType<typeof vi.fn>;
  onDidScrollChange: ReturnType<typeof vi.fn>;
  onKeyDown: ReturnType<typeof vi.fn>;
  onMouseDown: ReturnType<typeof vi.fn>;
  onMouseMove: ReturnType<typeof vi.fn>;
  revealPositionInCenter: ReturnType<typeof vi.fn>;
  setPosition: ReturnType<typeof vi.fn>;
  setScrollTop: ReturnType<typeof vi.fn>;
  setSelection: ReturnType<typeof vi.fn>;
  trigger: ReturnType<typeof vi.fn>;
  updateOptions: ReturnType<typeof vi.fn>;
}

interface FakeFoldingRegion {
  isCollapsed: boolean;
  regionIndex: number;
  startLineNumber: number;
}

interface FakeFoldingModel {
  emitChange(): void;
  onDidChange: ReturnType<typeof vi.fn>;
  regions: {
    getStartLineNumber(index: number): number;
    isCollapsed(index: number): boolean;
    length: number;
    toRegion(index: number): FakeFoldingRegion;
  };
  setRegions(next: Array<{ collapsed: boolean; start: number }>): void;
  toggleCollapseState: ReturnType<typeof vi.fn>;
}

interface FakeKeyDownEvent {
  browserEvent: {
    key: string;
    preventDefault: ReturnType<typeof vi.fn>;
    stopPropagation: ReturnType<typeof vi.fn>;
  };
  keyCode: number;
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
}

interface FakeMouseDownEvent {
  event: {
    ctrlKey?: boolean;
    metaKey?: boolean;
    leftButton?: boolean;
    middleButton?: boolean;
    rightButton?: boolean;
    preventDefault: ReturnType<typeof vi.fn>;
    stopPropagation: ReturnType<typeof vi.fn>;
  };
  target: {
    detail?: {
      glyphMarginLane?: number;
    };
    element?: HTMLElement;
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
    providePhpFrameworkDefinition?: (source: string, offset: number) => unknown;
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
        providePhpFrameworkDefinition?: (
          source: string,
          offset: number,
        ) => unknown;
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
    delete window.__codevoQa;
    window.localStorage?.clear?.();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("restores and clamps a persisted view after synchronizing model content", async () => {
    const activeDocument: EditorDocument = {
      content: "one\ntwo\nthree\n",
      language: "plaintext",
      name: "example.txt",
      path: "/workspace/nested/example.txt",
      savedContent: "one\ntwo\nthree\n",
    };
    const calls: string[] = [];
    let content = "";
    const model: FakeModel = {
      getLineCount: vi.fn(() => 3),
      getLineMaxColumn: vi.fn((line: number) => [4, 4, 6][line - 1]),
      getValue: vi.fn(() => content),
      setValue: vi.fn((value: string) => {
        calls.push("content");
        content = value;
      }),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const editor = createEditor(model);
    editor.setPosition.mockImplementation(() => calls.push("position"));
    editor.setScrollTop.mockImplementation(() => calls.push("scroll"));
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          restoredViewStates: {
            [activeDocument.path]: { column: 99, line: 99, scrollTop: 240 },
          },
          workspaceRoot: "/workspace",
        }),
      );
      await Promise.resolve();
    });

    expect(editor.setPosition).toHaveBeenCalledWith({
      column: 6,
      lineNumber: 3,
    });
    expect(editor.revealPositionInCenter).toHaveBeenCalledWith({
      column: 6,
      lineNumber: 3,
    });
    expect(editor.setScrollTop).toHaveBeenCalledWith(240);
    expect(calls.indexOf("content")).toBeLessThan(calls.indexOf("position"));
  });

  it("does not apply one workspace's persisted view to another workspace", async () => {
    const activeDocument: EditorDocument = {
      content: "one\ntwo\n",
      language: "plaintext",
      name: "example.txt",
      path: "/workspace/nested/example.txt",
      savedContent: "one\ntwo\n",
    };
    const model: FakeModel = {
      getLineCount: vi.fn(() => 2),
      getLineMaxColumn: vi.fn(() => 4),
      getValue: vi.fn(() => activeDocument.content),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const editor = createEditor(model);
    const foldingModel = createFoldingModel([{ collapsed: false, start: 1 }]);
    editor.getContribution.mockImplementation((id?: string) => {
      if (id === "editor.contrib.folding") {
        return { getFoldingModel: vi.fn(async () => foldingModel) };
      }

      return null;
    });
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          restoredViewStates: {
            [activeDocument.path]: {
              column: 2,
              foldedLines: [1],
              line: 2,
            },
          },
          workspaceRoot: "/workspace",
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(editor.setPosition).toHaveBeenCalledWith({
      column: 2,
      lineNumber: 2,
    });
    expect(foldingModel.toggleCollapseState).toHaveBeenCalledTimes(1);
    editor.setPosition.mockClear();

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          restoredViewStates: {},
          workspaceRoot: "/workspace/nested",
        }),
      );
      await Promise.resolve();
    });

    expect(editor.setPosition).not.toHaveBeenCalled();
    expect(foldingModel.toggleCollapseState).toHaveBeenCalledTimes(1);
  });

  it("captures a stable cursor and scroll position in memory", async () => {
    const activeDocument: EditorDocument = {
      content: "one\ntwo\n",
      language: "plaintext",
      name: "example.txt",
      path: "/workspace/example.txt",
      savedContent: "one\ntwo\n",
    };
    const model: FakeModel = {
      getValue: vi.fn(() => activeDocument.content),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const editor = createEditor(model);
    const onEditorViewStateChange = vi.fn();
    editor.getPosition.mockReturnValue({ column: 8, lineNumber: 2 });
    editor.getScrollTop.mockReturnValue(150);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          onEditorViewStateChange,
          workspaceRoot: "/workspace",
        }),
      );
      await Promise.resolve();
    });

    expect(onEditorViewStateChange).toHaveBeenCalledWith(activeDocument.path, {
      column: 8,
      line: 2,
      scrollTop: 150,
    });
  });

  it("captures collapsed folding-region start lines and folding changes", async () => {
    const activeDocument: EditorDocument = {
      content: "one\ntwo\nthree\nfour\n",
      language: "plaintext",
      name: "example.txt",
      path: "/workspace/example.txt",
      savedContent: "one\ntwo\nthree\nfour\n",
    };
    const model: FakeModel = {
      getValue: vi.fn(() => activeDocument.content),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const editor = createEditor(model);
    const foldingModel = createFoldingModel([
      { collapsed: true, start: 2 },
      { collapsed: false, start: 4 },
    ]);
    const onEditorViewStateChange = vi.fn();
    editor.getContribution.mockImplementation((id?: string) => {
      if (id === "editor.contrib.folding") {
        return { getFoldingModel: vi.fn(async () => foldingModel) };
      }

      return null;
    });
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          onEditorViewStateChange,
          workspaceRoot: "/workspace",
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onEditorViewStateChange).toHaveBeenLastCalledWith(
      activeDocument.path,
      { column: 1, foldedLines: [2], line: 1, scrollTop: 10 },
    );

    foldingModel.setRegions([
      { collapsed: false, start: 2 },
      { collapsed: true, start: 4 },
    ]);
    await act(async () => foldingModel.emitChange());

    expect(onEditorViewStateChange).toHaveBeenLastCalledWith(
      activeDocument.path,
      { column: 1, foldedLines: [4], line: 1, scrollTop: 10 },
    );
  });

  it("restores valid folds after the folding model is ready and applies them once", async () => {
    const activeDocument: EditorDocument = {
      content: "one\ntwo\nthree\nfour\n",
      language: "plaintext",
      name: "example.txt",
      path: "/workspace/example.txt",
      savedContent: "one\ntwo\nthree\nfour\n",
    };
    const model: FakeModel = {
      getLineCount: vi.fn(() => 4),
      getLineMaxColumn: vi.fn(() => 6),
      getValue: vi.fn(() => activeDocument.content),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const editor = createEditor(model);
    const foldingModel = createFoldingModel([
      { collapsed: false, start: 2 },
      { collapsed: false, start: 4 },
    ]);
    let resolveFoldingModel: ((model: FakeFoldingModel) => void) | null = null;
    const foldingModelPromise = new Promise<FakeFoldingModel>((resolve) => {
      resolveFoldingModel = resolve;
    });
    editor.getContribution.mockImplementation((id?: string) => {
      if (id === "editor.contrib.folding") {
        return { getFoldingModel: vi.fn(() => foldingModelPromise) };
      }

      return null;
    });
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          restoredViewStates: {
            [activeDocument.path]: {
              column: 1,
              foldedLines: [2, 99],
              line: 1,
            },
          },
          workspaceRoot: "/workspace",
        }),
      );
      await Promise.resolve();
    });

    expect(foldingModel.toggleCollapseState).not.toHaveBeenCalled();

    await act(async () => {
      resolveFoldingModel?.(foldingModel);
      await foldingModelPromise;
      await Promise.resolve();
    });

    expect(foldingModel.toggleCollapseState).toHaveBeenCalledTimes(1);
    expect(foldingModel.toggleCollapseState).toHaveBeenCalledWith([
      expect.objectContaining({ startLineNumber: 2 }),
    ]);

    await act(async () => foldingModel.emitChange());
    expect(foldingModel.toggleCollapseState).toHaveBeenCalledTimes(1);
  });

  it("reapplies persisted scroll after restoring folds above the viewport", async () => {
    const activeDocument: EditorDocument = {
      content: "one\ntwo\nthree\nfour\nfive\n",
      language: "plaintext",
      name: "example.txt",
      path: "/workspace/example.txt",
      savedContent: "one\ntwo\nthree\nfour\nfive\n",
    };
    const model: FakeModel = {
      getLineCount: vi.fn(() => 5),
      getLineMaxColumn: vi.fn(() => 6),
      getValue: vi.fn(() => activeDocument.content),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const editor = createEditor(model);
    const foldingModel = createFoldingModel([
      { collapsed: false, start: 1 },
    ]);
    editor.getContribution.mockImplementation((id?: string) => {
      if (id === "editor.contrib.folding") {
        return { getFoldingModel: vi.fn(async () => foldingModel) };
      }

      return null;
    });
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          restoredViewStates: {
            [activeDocument.path]: {
              column: 1,
              foldedLines: [1],
              line: 5,
              scrollTop: 240,
            },
          },
          workspaceRoot: "/workspace",
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(editor.setScrollTop).toHaveBeenLastCalledWith(240);
    const scrollCallOrder = editor.setScrollTop.mock.invocationCallOrder;
    expect(scrollCallOrder[scrollCallOrder.length - 1]).toBeGreaterThan(
      foldingModel.toggleCollapseState.mock.invocationCallOrder[0],
    );
  });

  it("reapplies folds when a reopened tab bumps the restoration revision", async () => {
    const activeDocument: EditorDocument = {
      content: "one\ntwo\nthree\n",
      language: "plaintext",
      name: "example.txt",
      path: "/workspace/example.txt",
      savedContent: "one\ntwo\nthree\n",
    };
    const model: FakeModel = {
      getLineCount: vi.fn(() => 3),
      getLineMaxColumn: vi.fn(() => 6),
      getValue: vi.fn(() => activeDocument.content),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const editor = createEditor(model);
    const foldingModel = createFoldingModel([
      { collapsed: false, start: 2 },
    ]);
    editor.getContribution.mockImplementation((id?: string) => {
      if (id === "editor.contrib.folding") {
        return { getFoldingModel: vi.fn(async () => foldingModel) };
      }

      return null;
    });
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(model);
    const restoredViewStates = {
      [activeDocument.path]: {
        column: 1,
        foldedLines: [2],
        line: 1,
      },
    };

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          restoredViewStateRevision: 0,
          restoredViewStates,
          workspaceRoot: "/workspace",
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(foldingModel.toggleCollapseState).toHaveBeenCalledTimes(1);
    foldingModel.setRegions([{ collapsed: false, start: 2 }]);

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          restoredViewStateRevision: 1,
          restoredViewStates,
          workspaceRoot: "/workspace",
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(foldingModel.toggleCollapseState).toHaveBeenCalledTimes(2);
  });

  it("does not restore folds when the folding model resolves after switching files", async () => {
    const firstDocument: EditorDocument = {
      content: "one\ntwo\nthree\n",
      language: "plaintext",
      name: "first.txt",
      path: "/workspace/first.txt",
      savedContent: "one\ntwo\nthree\n",
    };
    const secondDocument: EditorDocument = {
      content: "other\n",
      language: "plaintext",
      name: "second.txt",
      path: "/workspace/second.txt",
      savedContent: "other\n",
    };
    const firstModel: FakeModel = {
      getLineCount: vi.fn(() => 3),
      getLineMaxColumn: vi.fn(() => 6),
      getValue: vi.fn(() => firstDocument.content),
      uri: { fsPath: firstDocument.path, path: firstDocument.path },
    };
    const secondModel: FakeModel = {
      getLineCount: vi.fn(() => 1),
      getLineMaxColumn: vi.fn(() => 6),
      getValue: vi.fn(() => secondDocument.content),
      uri: { fsPath: secondDocument.path, path: secondDocument.path },
    };
    const editor = createEditor(firstModel);
    const foldingModel = createFoldingModel([
      { collapsed: false, start: 1 },
    ]);
    let resolveFoldingModel: ((model: FakeFoldingModel) => void) | null = null;
    const foldingModelPromise = new Promise<FakeFoldingModel>((resolve) => {
      resolveFoldingModel = resolve;
    });
    editor.getContribution.mockImplementation((id?: string) => {
      if (id === "editor.contrib.folding") {
        return { getFoldingModel: vi.fn(() => foldingModelPromise) };
      }

      return null;
    });
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(firstModel);

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(firstDocument),
          openDocumentPaths: [firstDocument.path, secondDocument.path],
          restoredViewStates: {
            [firstDocument.path]: {
              column: 1,
              foldedLines: [1],
              line: 1,
            },
          },
          workspaceRoot: "/workspace",
        }),
      );
      await Promise.resolve();
    });

    editor.getModel.mockReturnValue(secondModel);

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(secondDocument),
          openDocumentPaths: [firstDocument.path, secondDocument.path],
          restoredViewStates: {},
          workspaceRoot: "/workspace",
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      resolveFoldingModel?.(foldingModel);
      await foldingModelPromise;
      await Promise.resolve();
    });

    expect(foldingModel.toggleCollapseState).not.toHaveBeenCalled();
  });

  it("retries fold restoration once when asynchronous ranges arrive", async () => {
    const activeDocument: EditorDocument = {
      content: "one\ntwo\nthree\n",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/example.ts",
      savedContent: "one\ntwo\nthree\n",
    };
    const model: FakeModel = {
      getLineCount: vi.fn(() => 3),
      getLineMaxColumn: vi.fn(() => 6),
      getValue: vi.fn(() => activeDocument.content),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const editor = createEditor(model);
    const foldingModel = createFoldingModel([]);
    editor.getContribution.mockImplementation((id?: string) => {
      if (id === "editor.contrib.folding") {
        return { getFoldingModel: vi.fn(async () => foldingModel) };
      }

      return null;
    });
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          restoredViewStates: {
            [activeDocument.path]: {
              column: 1,
              foldedLines: [2],
              line: 1,
            },
          },
          workspaceRoot: "/workspace",
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    foldingModel.setRegions([{ collapsed: false, start: 2 }]);
    await act(async () => foldingModel.emitChange());

    expect(foldingModel.toggleCollapseState).toHaveBeenCalledTimes(1);

    foldingModel.setRegions([{ collapsed: false, start: 2 }]);
    await act(async () => foldingModel.emitChange());
    expect(foldingModel.toggleCollapseState).toHaveBeenCalledTimes(1);
  });

  it("applies a restored per-file view when another restored tab activates", async () => {
    const firstDocument: EditorDocument = {
      content: "first\n",
      language: "plaintext",
      name: "first.txt",
      path: "/workspace/first.txt",
      savedContent: "first\n",
    };
    const secondDocument: EditorDocument = {
      content: "one\ntwo\n",
      language: "plaintext",
      name: "second.txt",
      path: "/workspace/second.txt",
      savedContent: "one\ntwo\n",
    };
    const firstModel: FakeModel = {
      getLineCount: vi.fn(() => 1),
      getLineMaxColumn: vi.fn(() => 6),
      getValue: vi.fn(() => firstDocument.content),
      uri: { fsPath: firstDocument.path, path: firstDocument.path },
    };
    const secondModel: FakeModel = {
      getLineCount: vi.fn(() => 2),
      getLineMaxColumn: vi.fn(() => 4),
      getValue: vi.fn(() => secondDocument.content),
      uri: { fsPath: secondDocument.path, path: secondDocument.path },
    };
    const editor = createEditor(firstModel);
    const restoredViewStates = {
      [firstDocument.path]: { column: 2, line: 1 },
      [secondDocument.path]: { column: 3, line: 2, scrollTop: 90 },
    };
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(firstModel);

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(firstDocument),
          openDocumentPaths: [firstDocument.path, secondDocument.path],
          restoredViewStates,
          workspaceRoot: "/workspace",
        }),
      );
      await Promise.resolve();
    });
    editor.setPosition.mockClear();
    editor.getModel.mockReturnValue(secondModel);

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(secondDocument),
          openDocumentPaths: [firstDocument.path, secondDocument.path],
          restoredViewStates,
          workspaceRoot: "/workspace",
        }),
      );
      await Promise.resolve();
    });

    expect(editor.setPosition).toHaveBeenCalledWith({
      column: 3,
      lineNumber: 2,
    });
    expect(editor.setScrollTop).toHaveBeenCalledWith(90);
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

  it("registers language-agnostic conflict actions and refreshes conflict decorations on edits", async () => {
    const activeDocument: EditorDocument = {
      content:
        "<<<<<<< ours\ncurrent\n=======\nincoming\n>>>>>>> theirs\n",
      language: "plaintext",
      name: "notes.txt",
      path: "/workspace/notes.txt",
      savedContent: "",
    };
    let modelValue = activeDocument.content;
    const model: FakeModel = {
      getValue: vi.fn(() => modelValue),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
        toString: () => "file:///workspace/notes.txt",
      },
    };
    const editor = createEditor(model);
    const monaco = createMonaco(model);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    await act(async () => {
      root.render(memoGuardSurface(activeDocument));
      await Promise.resolve();
    });

    expect(monaco.languages.registerCodeActionProvider).toHaveBeenCalledWith(
      "*",
      expect.any(Object),
    );
    expect(monaco.editor.addCommand).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mockor.acceptConflictMarker" }),
    );
    const decorationCall = editor.deltaDecorations.mock.calls.find(
      ([, decorations]) =>
        decorations.some((decoration: any) =>
          decoration.options?.className?.includes("conflict-marker-line"),
        ),
    );

    expect(decorationCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          options: expect.objectContaining({
            className: "conflict-marker-current",
            isWholeLine: true,
          }),
        }),
        expect.objectContaining({
          options: expect.objectContaining({
            className: "conflict-marker-incoming",
            isWholeLine: true,
          }),
        }),
      ]),
    );

    editor.deltaDecorations.mockClear();
    modelValue = "resolved\n";

    act(() => {
      editor.modelContentChangeHandler?.({ changes: [{ text: "resolved" }] });
    });

    expect(editor.deltaDecorations).toHaveBeenCalledWith(expect.any(Array), []);
  });

  it("opens Latte member suggestions while typing a member prefix", async () => {
    const activeDocument: EditorDocument = {
      content: "{varType App\\Model\\Group $group}\n\n{$group->}\n",
      language: "latte",
      name: "template.latte",
      path: "/workspace/templates/template.latte",
      savedContent: "",
    };
    const lines = [
      "{varType App\\Model\\Group $group}",
      "",
      "{$group->i}",
    ];
    const model: FakeModel = {
      getLineContent: vi.fn((lineNumber: number) => lines[lineNumber - 1] ?? ""),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const editor = createEditor(model);
    editor.getPosition.mockReturnValue({
      column: 11,
      lineNumber: 3,
    });
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(createElement(EditorSurface, memoGuardProps(activeDocument)));
      await Promise.resolve();
    });

    editor.trigger.mockClear();

    act(() => {
      editor.modelContentChangeHandler?.({
        changes: [{ text: "i" }],
      });
    });

    expect(editor.trigger).toHaveBeenCalledWith(
      "mockor.latteMemberCompletion",
      "editor.action.triggerSuggest",
      {},
    );
  });

  it("dismisses transient Monaco widgets when the floating-surface state changes", async () => {
    const activeDocument: EditorDocument = {
      content: "{block content}\n{/block}\n",
      language: "latte",
      name: "template.latte",
      path: "/workspace/templates/template.latte",
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

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          transientWidgetDismissKey: "000",
        }),
      );
      await Promise.resolve();
    });

    expect(editor.trigger).not.toHaveBeenCalledWith(
      "floating-surface",
      "hideSuggestWidget",
      {},
    );

    editor.trigger.mockClear();

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          transientWidgetDismissKey: "010",
        }),
      );
      await Promise.resolve();
    });

    expect(editor.trigger).toHaveBeenCalledWith(
      "floating-surface",
      "editor.action.hideHover",
      {},
    );
    expect(editor.trigger).toHaveBeenCalledWith(
      "floating-surface",
      "closeFindWidget",
      {},
    );
    expect(editor.trigger).toHaveBeenCalledWith(
      "floating-surface",
      "hideSuggestWidget",
      {},
    );
  });

  it("dismisses transient Monaco widgets when an already-open floating surface is activated again", async () => {
    const activeDocument: EditorDocument = {
      content: "{block content}\n{/block}\n",
      language: "latte",
      name: "template.latte",
      path: "/workspace/templates/template.latte",
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

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          transientWidgetDismissKey: "010:1",
        }),
      );
      await Promise.resolve();
    });

    editor.trigger.mockClear();

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          transientWidgetDismissKey: "010:2",
        }),
      );
      await Promise.resolve();
    });

    expect(editor.trigger).toHaveBeenCalledWith(
      "floating-surface",
      "closeFindWidget",
      {},
    );
    expect(editor.trigger).toHaveBeenCalledWith(
      "floating-surface",
      "editor.action.hideHover",
      {},
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

  it("forwards providePhpFrameworkDefinition into the language server provider context", async () => {
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
    const providePhpFrameworkDefinition = vi.fn(async () => true);

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
          providePhpFrameworkDefinition={providePhpFrameworkDefinition}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    const context = editorSurfaceMocks.registeredContext;

    expect(context?.providePhpFrameworkDefinition).toEqual(expect.any(Function));

    await context?.providePhpFrameworkDefinition?.(
      "<?php\n$value = config('app.name');\n",
      24,
    );

    expect(providePhpFrameworkDefinition).toHaveBeenCalledWith(
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
          frameworkIntelligenceProviders={{
            provideBladeCompletions,
            provideBladeDefinition,
          }}
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

  it("does not install the editor QA bridge without the explicit QA flag", async () => {
    const activeDocument: EditorDocument = {
      content: "<?php\n$invoice->\n",
      language: "php",
      name: "InvoiceController.php",
      path: "/workspace/app/InvoiceController.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getValue: vi.fn(() => activeDocument.content),
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

    expect(window.__codevoQa).toBeUndefined();
  });

  it("keeps the localStorage QA bridge override DEV-only", () => {
    const localStorage = memoryLocalStorage();
    localStorage.setItem("codevo.qaBridge", "1");

    expect(
      editorQaBridgeEnabled(
        { DEV: false, VITE_CODEVO_QA_BRIDGE: "1" },
        localStorage,
      ),
    ).toBe(false);
    expect(editorQaBridgeEnabled({ DEV: true }, localStorage)).toBe(true);
  });

  it("installs a dev-only editor QA bridge for deterministic cursor, diagnostic, completion, and definition probes", async () => {
    const localStorage = memoryLocalStorage();
    vi.stubGlobal("localStorage", localStorage);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorage,
    });
    window.localStorage.setItem("codevo.qaBridge", "1");

    const activeDocument: EditorDocument = {
      content: "<?php\n$invoice->\n",
      language: "php",
      name: "InvoiceController.php",
      path: "/workspace/app/InvoiceController.php",
      savedContent: "",
    };
    const diagnostic: LanguageServerDiagnostic = {
      character: 1,
      endCharacter: 10,
      endLine: 2,
      line: 2,
      message: "Example diagnostic",
      severity: "error",
      source: "phpactor",
    };
    const model: FakeModel = {
      getOffsetAt: vi.fn(() => 16),
      getValue: vi.fn(() => activeDocument.content),
      getVersionId: vi.fn(() => 1),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);
    const providePhpFrameworkDefinition = vi.fn(async () => true);
    const providePhpPresenterLinkDefinition = vi.fn(async () => false);
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "App\\Models\\Invoice",
        insertText: "customer()",
        kind: "relation" as const,
        name: "customer",
        parameters: "",
        returnType: "App\\Models\\Customer",
      },
    ]);

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{
            [activeDocument.path]: [diagnostic],
          }}
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
          frameworkIntelligenceProviders={{
            providePhpPresenterLinkDefinition,
          }}
          providePhpFrameworkDefinition={providePhpFrameworkDefinition}
          providePhpMethodCompletions={providePhpMethodCompletions}
          providePhpMethodSignature={vi.fn(async () => null)}
          workspaceRoot="/workspace"
        />,
      );
      await Promise.resolve();
    });

    const bridge = window.__codevoQa;

    expect(bridge).toBeDefined();
    expect(bridge?.getActiveFile()).toBe(activeDocument.path);
    expect(bridge?.getWorkspaceRoot()).toBe("/workspace");
    expect(bridge?.getValue()).toBe(activeDocument.content);
    expect(bridge?.getDiagnostics()).toEqual([diagnostic]);
    expect(bridge?.openWorkspaceRoot).toEqual(expect.any(Function));
    expect(bridge?.setCursor({ column: 11, lineNumber: 2 })).toBe(true);
    expect(bridge?.getPosition()).toEqual({ column: 11, lineNumber: 2 });

    await expect(bridge?.getProviderCompletionItems()).resolves.toEqual([
      {
        detail: "App\\Models\\Customer",
        insertText: "customer()",
        kind: "relation",
        label: "customer",
      },
    ]);
    await expect(bridge?.getCompletionItems()).resolves.toEqual([
      {
        detail: "App\\Models\\Customer",
        insertText: "customer()",
        kind: "relation",
        label: "customer",
      },
    ]);
    await expect(bridge?.triggerDefinition()).resolves.toBe(true);

    expect(providePhpMethodCompletions).toHaveBeenCalledWith(
      activeDocument.content,
      { column: 11, lineNumber: 2 },
    );
    expect(providePhpPresenterLinkDefinition).toHaveBeenCalledWith(
      activeDocument.content,
      16,
      expect.objectContaining({ canNavigate: expect.any(Function) }),
    );
    expect(providePhpFrameworkDefinition).toHaveBeenCalledWith(
      activeDocument.content,
      16,
      expect.objectContaining({ canNavigate: expect.any(Function) }),
    );

    const updatedDiagnostic: LanguageServerDiagnostic = {
      character: 2,
      line: 3,
      message: "Updated diagnostic",
      severity: "warning",
      source: "phpactor",
    };

    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          changeHunks={[]}
          editorRevealTarget={null}
          flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
          languageServerDiagnosticsByPath={{
            [activeDocument.path]: [updatedDiagnostic],
          }}
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
          frameworkIntelligenceProviders={{
            providePhpPresenterLinkDefinition,
          }}
          providePhpFrameworkDefinition={providePhpFrameworkDefinition}
          providePhpMethodCompletions={providePhpMethodCompletions}
          providePhpMethodSignature={vi.fn(async () => null)}
          workspaceRoot="/workspace"
        />,
      );
      await Promise.resolve();
    });

    expect(window.__codevoQa).toBe(bridge);
    expect(window.__codevoQa?.getDiagnostics()).toEqual([updatedDiagnostic]);

    act(() => root.unmount());

    expect(window.__codevoQa).toBeUndefined();
  });

  it("opens a workspace file through the dev QA bridge", async () => {
    const localStorage = memoryLocalStorage();
    vi.stubGlobal("localStorage", localStorage);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorage,
    });
    window.localStorage.setItem("codevo.qaBridge", "1");

    const initialDocument: EditorDocument = {
      content: "<?php\n// initial\n",
      language: "php",
      name: "Initial.php",
      path: "/workspace/app/Initial.php",
      savedContent: "",
    };
    const targetDocument: EditorDocument = {
      content: "<?php\n// target\n",
      language: "php",
      name: "Target.php",
      path: "/workspace/app/Target.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getValue: vi.fn(() => targetDocument.content),
      uri: {
        fsPath: initialDocument.path,
        path: initialDocument.path,
      },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    const renderWith = async (
      activeDocument: EditorDocument,
      onOpenWorkspaceFile?: (
        path: string,
        request: EditorQaOpenWorkspaceFileRequest,
      ) => Promise<boolean>,
    ) => {
      model.uri.fsPath = activeDocument.path;
      model.uri.path = activeDocument.path;

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
            onOpenWorkspaceFile={onOpenWorkspaceFile}
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
    const onOpenWorkspaceFile = vi.fn(
      async (
        _path: string,
        request: EditorQaOpenWorkspaceFileRequest,
      ): Promise<boolean> => {
        if (!request.canOpen()) {
          return false;
        }

        await renderWith(targetDocument, onOpenWorkspaceFile);
        return true;
      },
    );

    await renderWith(initialDocument, onOpenWorkspaceFile);

    await expect(
      window.__codevoQa?.openWorkspaceFile("/workspace/app/Target.php"),
    ).resolves.toBe(true);

    expect(onOpenWorkspaceFile).toHaveBeenCalledWith(
      targetDocument.path,
      expect.objectContaining({ canOpen: expect.any(Function) }),
    );
    expect(window.__codevoQa?.getActiveFile()).toBe(targetDocument.path);
  });

  it("opens a workspace root through the dev QA bridge", async () => {
    const localStorage = memoryLocalStorage();
    vi.stubGlobal("localStorage", localStorage);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorage,
    });
    window.localStorage.setItem("codevo.qaBridge", "1");

    const activeDocument: EditorDocument = {
      content: "<?php\n// active\n",
      language: "php",
      name: "Active.php",
      path: "/workspace/app/Active.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getValue: vi.fn(() => activeDocument.content),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    const renderWith = async (
      workspaceRoot: string,
      onOpenWorkspaceRoot?: (path: string) => Promise<boolean>,
    ) => {
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
            onOpenWorkspaceRoot={onOpenWorkspaceRoot}
            onOpenFileStructure={vi.fn()}
            onRevealTargetHandled={vi.fn()}
            onRevertChangeHunk={vi.fn()}
            phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
            providePhpMethodCompletions={vi.fn(async () => [])}
            providePhpMethodSignature={vi.fn(async () => null)}
            workspaceRoot={workspaceRoot}
          />,
        );
        await Promise.resolve();
      });
    };
    const onOpenWorkspaceRoot = vi.fn(async (path: string) => {
      await renderWith(path, onOpenWorkspaceRoot);
      return true;
    });

    await renderWith("/workspace", onOpenWorkspaceRoot);

    await expect(window.__codevoQa?.openWorkspaceRoot("   ")).resolves.toBe(
      false,
    );
    await expect(
      window.__codevoQa?.openWorkspaceRoot("/invalid\0workspace"),
    ).resolves.toBe(false);
    expect(onOpenWorkspaceRoot).not.toHaveBeenCalled();

    await expect(
      window.__codevoQa?.openWorkspaceRoot("/next-workspace/"),
    ).resolves.toBe(true);

    expect(onOpenWorkspaceRoot).toHaveBeenCalledWith("/next-workspace");
    expect(window.__codevoQa?.getWorkspaceRoot()).toBe("/next-workspace");
  });

  it("returns false when a QA bridge workspace root open loses a root race", async () => {
    const localStorage = memoryLocalStorage();
    vi.stubGlobal("localStorage", localStorage);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorage,
    });
    window.localStorage.setItem("codevo.qaBridge", "1");

    const activeDocument: EditorDocument = {
      content: "<?php\n// active\n",
      language: "php",
      name: "Active.php",
      path: "/workspace/app/Active.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getValue: vi.fn(() => activeDocument.content),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const openGate = deferred<void>();
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    const renderWith = async (
      workspaceRoot: string,
      onOpenWorkspaceRoot?: (path: string) => Promise<boolean>,
    ) => {
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
            onOpenWorkspaceRoot={onOpenWorkspaceRoot}
            onOpenFileStructure={vi.fn()}
            onRevealTargetHandled={vi.fn()}
            onRevertChangeHunk={vi.fn()}
            phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
            providePhpMethodCompletions={vi.fn(async () => [])}
            providePhpMethodSignature={vi.fn(async () => null)}
            workspaceRoot={workspaceRoot}
          />,
        );
        await Promise.resolve();
      });
    };
    const onOpenWorkspaceRoot = vi.fn(async () => {
      await openGate.promise;
      return true;
    });

    await renderWith("/workspace", onOpenWorkspaceRoot);

    const opened = window.__codevoQa?.openWorkspaceRoot("/target-workspace");
    await renderWith("/other-workspace", onOpenWorkspaceRoot);
    openGate.resolve();

    await expect(opened).resolves.toBe(false);
    expect(onOpenWorkspaceRoot).toHaveBeenCalledWith("/target-workspace");
    expect(window.__codevoQa?.getWorkspaceRoot()).toBe("/other-workspace");
  });

  it("rejects QA bridge openWorkspaceFile paths outside the active workspace root", async () => {
    const localStorage = memoryLocalStorage();
    vi.stubGlobal("localStorage", localStorage);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorage,
    });
    window.localStorage.setItem("codevo.qaBridge", "1");

    const activeDocument: EditorDocument = {
      content: "<?php\n// active\n",
      language: "php",
      name: "Active.php",
      path: "/workspace/app/Active.php",
      savedContent: "",
    };
    const model: FakeModel = {
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const onOpenWorkspaceFile = vi.fn(async () => true);
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
          onOpenWorkspaceFile={onOpenWorkspaceFile}
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

    await expect(
      window.__codevoQa?.openWorkspaceFile("/workspace-other/app/Target.php"),
    ).resolves.toBe(false);
    await expect(
      window.__codevoQa?.openWorkspaceFile("/workspace/../etc/passwd"),
    ).resolves.toBe(false);

    expect(onOpenWorkspaceFile).not.toHaveBeenCalled();
    expect(window.__codevoQa?.getActiveFile()).toBe(activeDocument.path);
  });

  it("does not commit a QA bridge workspace open when the active document changes while awaiting", async () => {
    const localStorage = memoryLocalStorage();
    vi.stubGlobal("localStorage", localStorage);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorage,
    });
    window.localStorage.setItem("codevo.qaBridge", "1");

    const initialDocument: EditorDocument = {
      content: "<?php\n// initial\n",
      language: "php",
      name: "Initial.php",
      path: "/workspace/app/Initial.php",
      savedContent: "",
    };
    const staleDocument: EditorDocument = {
      content: "<?php\n// stale\n",
      language: "php",
      name: "Stale.php",
      path: "/workspace/app/Stale.php",
      savedContent: "",
    };
    const targetDocument: EditorDocument = {
      content: "<?php\n// target\n",
      language: "php",
      name: "Target.php",
      path: "/workspace/app/Target.php",
      savedContent: "",
    };
    const model: FakeModel = {
      uri: {
        fsPath: initialDocument.path,
        path: initialDocument.path,
      },
    };
    const openGate = deferred<void>();
    const commitOpen = vi.fn();
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    const renderWith = async (
      activeDocument: EditorDocument,
      onOpenWorkspaceFile?: (
        path: string,
        request: EditorQaOpenWorkspaceFileRequest,
      ) => Promise<boolean>,
    ) => {
      model.uri.fsPath = activeDocument.path;
      model.uri.path = activeDocument.path;

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
            onOpenWorkspaceFile={onOpenWorkspaceFile}
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
    const onOpenWorkspaceFile = vi.fn(
      async (
        _path: string,
        request: EditorQaOpenWorkspaceFileRequest,
      ): Promise<boolean> => {
        await openGate.promise;

        if (!request.canOpen()) {
          return false;
        }

        commitOpen();
        await renderWith(targetDocument, onOpenWorkspaceFile);
        return true;
      },
    );

    await renderWith(initialDocument, onOpenWorkspaceFile);

    const opened = window.__codevoQa?.openWorkspaceFile(targetDocument.path);
    await renderWith(staleDocument, onOpenWorkspaceFile);
    openGate.resolve();

    await expect(opened).resolves.toBe(false);
    expect(commitOpen).not.toHaveBeenCalled();
    expect(window.__codevoQa?.getActiveFile()).toBe(staleDocument.path);
  });

  it("rejects a QA bridge workspace open after canOpen observes staleness in flight", async () => {
    const localStorage = memoryLocalStorage();
    vi.stubGlobal("localStorage", localStorage);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorage,
    });
    window.localStorage.setItem("codevo.qaBridge", "1");

    const initialDocument: EditorDocument = {
      content: "<?php\n// initial\n",
      language: "php",
      name: "Initial.php",
      path: "/workspace/app/Initial.php",
      savedContent: "",
    };
    const staleDocument: EditorDocument = {
      content: "<?php\n// stale\n",
      language: "php",
      name: "Stale.php",
      path: "/workspace/app/Stale.php",
      savedContent: "",
    };
    const targetDocument: EditorDocument = {
      content: "<?php\n// target\n",
      language: "php",
      name: "Target.php",
      path: "/workspace/app/Target.php",
      savedContent: "",
    };
    const model: FakeModel = {
      uri: {
        fsPath: initialDocument.path,
        path: initialDocument.path,
      },
    };
    const openGate = deferred<void>();
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    const renderWith = async (
      activeDocument: EditorDocument,
      onOpenWorkspaceFile?: (
        path: string,
        request: EditorQaOpenWorkspaceFileRequest,
      ) => Promise<boolean>,
    ) => {
      model.uri.fsPath = activeDocument.path;
      model.uri.path = activeDocument.path;

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
            onOpenWorkspaceFile={onOpenWorkspaceFile}
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
    const onOpenWorkspaceFile = vi.fn(
      async (
        _path: string,
        request: EditorQaOpenWorkspaceFileRequest,
      ): Promise<boolean> => {
        await openGate.promise;
        expect(request.canOpen()).toBe(false);

        await renderWith(targetDocument, onOpenWorkspaceFile);
        return true;
      },
    );

    await renderWith(initialDocument, onOpenWorkspaceFile);

    const opened = window.__codevoQa?.openWorkspaceFile(targetDocument.path);
    await renderWith(staleDocument, onOpenWorkspaceFile);
    openGate.resolve();

    await expect(opened).resolves.toBe(false);
    expect(window.__codevoQa?.getActiveFile()).toBe(targetDocument.path);
  });

  it("drops stale QA provider completion results when the active model version changes while awaiting", async () => {
    const localStorage = memoryLocalStorage();
    let modelVersion = 1;
    vi.stubGlobal("localStorage", localStorage);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorage,
    });
    window.localStorage.setItem("codevo.qaBridge", "1");

    const activeDocument: EditorDocument = {
      content: "<?php\n$invoice->\n",
      language: "php",
      name: "InvoiceController.php",
      path: "/workspace/app/InvoiceController.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getValue: vi.fn(() => activeDocument.content),
      getVersionId: vi.fn(() => modelVersion),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const completion = deferred<PhpMethodCompletion[]>();
    const providePhpMethodCompletions = vi.fn(() => completion.promise);
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
          providePhpMethodCompletions={providePhpMethodCompletions}
          providePhpMethodSignature={vi.fn(async () => null)}
          workspaceRoot="/workspace"
        />,
      );
      await Promise.resolve();
    });

    const completionItems = window.__codevoQa?.getProviderCompletionItems();
    modelVersion = 2;
    completion.resolve([
      {
        declaringClassName: "App\\Models\\Invoice",
        name: "customer",
        parameters: "",
        returnType: null,
      },
    ]);

    await expect(completionItems).resolves.toEqual([]);
  });

  it.each([
    {
      name: "active model version changes",
      stale: async ({
        setModelVersion,
      }: {
        renderWith: (options: {
          activeDocument: EditorDocument;
          workspaceRoot: string;
        }) => Promise<void>;
        setModelVersion: (version: number) => void;
      }) => {
        setModelVersion(2);
      },
    },
    {
      name: "active file changes",
      stale: async ({
        renderWith,
      }: {
        renderWith: (options: {
          activeDocument: EditorDocument;
          workspaceRoot: string;
        }) => Promise<void>;
        setModelVersion: (version: number) => void;
      }) => {
        await renderWith({
          activeDocument: {
            content: "<?php\nroute('customers.show');\n",
            language: "php",
            name: "CustomerController.php",
            path: "/workspace/app/CustomerController.php",
            savedContent: "",
          },
          workspaceRoot: "/workspace",
        });
      },
    },
    {
      name: "workspace root changes",
      stale: async ({
        renderWith,
      }: {
        renderWith: (options: {
          activeDocument: EditorDocument;
          workspaceRoot: string;
        }) => Promise<void>;
        setModelVersion: (version: number) => void;
      }) => {
        await renderWith({
          activeDocument: {
            content: "<?php\nroute('invoices.show');\n",
            language: "php",
            name: "InvoiceController.php",
            path: "/workspace/app/InvoiceController.php",
            savedContent: "",
          },
          workspaceRoot: "/other-workspace",
        });
      },
    },
  ])(
    "does not call side-effect QA definition navigation when the $name while awaiting",
    async ({ stale }) => {
      const localStorage = memoryLocalStorage();
      let modelVersion = 1;
      vi.stubGlobal("localStorage", localStorage);
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: localStorage,
      });
      window.localStorage.setItem("codevo.qaBridge", "1");

      const activeDocument: EditorDocument = {
        content: "<?php\nroute('invoices.show');\n",
        language: "php",
        name: "InvoiceController.php",
        path: "/workspace/app/InvoiceController.php",
        savedContent: "",
      };
      const model: FakeModel = {
        dispose: vi.fn(),
        getOffsetAt: vi.fn(() => 14),
        getValue: vi.fn(() => activeDocument.content),
        getVersionId: vi.fn(() => modelVersion),
        uri: {
          fsPath: activeDocument.path,
          path: activeDocument.path,
        },
      };
      const presenterDefinition = deferred<boolean>();
      const navigateToDefinition = vi.fn();
      const providePhpFrameworkDefinition = vi.fn(async () => true);
      const providePhpPresenterLinkDefinition = vi.fn(
        async (
          _source: string,
          _offset: number,
          request: EditorQaDefinitionRequest,
        ) => {
          await presenterDefinition.promise;

          if (!request.canNavigate()) {
            return false;
          }

          navigateToDefinition();
          return true;
        },
      );
      editorSurfaceMocks.editor = createEditor(model);
      editorSurfaceMocks.monaco = createMonaco(model);

      const renderWith = async ({
        activeDocument,
        workspaceRoot,
      }: {
        activeDocument: EditorDocument;
        workspaceRoot: string;
      }) => {
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
              frameworkIntelligenceProviders={{
                providePhpPresenterLinkDefinition:
                  providePhpPresenterLinkDefinition as unknown as (
                    source: string,
                    offset: number,
                  ) => Promise<boolean>,
              }}
              providePhpFrameworkDefinition={providePhpFrameworkDefinition}
              providePhpMethodCompletions={vi.fn(async () => [])}
              providePhpMethodSignature={vi.fn(async () => null)}
              workspaceRoot={workspaceRoot}
            />,
          );
          await Promise.resolve();
        });
      };

      await renderWith({ activeDocument, workspaceRoot: "/workspace" });

      const definition = window.__codevoQa?.triggerDefinition();
      await stale({
        renderWith,
        setModelVersion: (version) => {
          modelVersion = version;
        },
      });
      presenterDefinition.resolve(true);

      await expect(definition).resolves.toBe(false);
      expect(navigateToDefinition).not.toHaveBeenCalled();
      expect(providePhpFrameworkDefinition).not.toHaveBeenCalled();
      expect(editorSurfaceMocks.editor.trigger).not.toHaveBeenCalledWith(
        "codevo.qa",
        "editor.action.revealDefinition",
        {},
      );
    },
  );

  it("rejects a QA definition provider result after canNavigate flips false in flight", async () => {
    const localStorage = memoryLocalStorage();
    vi.stubGlobal("localStorage", localStorage);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorage,
    });
    window.localStorage.setItem("codevo.qaBridge", "1");

    const activeDocument: EditorDocument = {
      content: "<?php\nroute('invoices.show');\n",
      language: "php",
      name: "InvoiceController.php",
      path: "/workspace/app/InvoiceController.php",
      savedContent: "",
    };
    const model: FakeModel = {
      getOffsetAt: vi.fn(() => 14),
      getValue: vi.fn(() => activeDocument.content),
      getVersionId: vi.fn(() => 1),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const presenterDefinition = deferred<boolean>();
    const definitionRequests: EditorQaDefinitionRequest[] = [];
    const providePhpFrameworkDefinition = vi.fn(async () => true);
    const providePhpPresenterLinkDefinition = vi.fn(
      async (
        _source: string,
        _offset: number,
        request: EditorQaDefinitionRequest,
      ) => {
        definitionRequests.push(request);
        await presenterDefinition.promise;
        return true;
      },
    );
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    const renderWith = async (workspaceRoot: string) => {
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
            frameworkIntelligenceProviders={{
              providePhpPresenterLinkDefinition:
                providePhpPresenterLinkDefinition as unknown as (
                  source: string,
                  offset: number,
                ) => Promise<boolean>,
            }}
            providePhpFrameworkDefinition={providePhpFrameworkDefinition}
            providePhpMethodCompletions={vi.fn(async () => [])}
            providePhpMethodSignature={vi.fn(async () => null)}
            workspaceRoot={workspaceRoot}
          />,
        );
        await Promise.resolve();
      });
    };

    await renderWith("/workspace");

    const definition = window.__codevoQa?.triggerDefinition();
    await Promise.resolve();
    await renderWith("/other-workspace");

    expect(definitionRequests).toHaveLength(1);
    expect(definitionRequests[0]?.canNavigate()).toBe(false);
    await renderWith("/workspace");
    presenterDefinition.resolve(true);

    await expect(definition).resolves.toBe(false);
    expect(providePhpFrameworkDefinition).not.toHaveBeenCalled();
    expect(editorSurfaceMocks.editor.trigger).not.toHaveBeenCalledWith(
      "codevo.qa",
      "editor.action.revealDefinition",
      {},
    );
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

  it("publishes a guarded editor surface command runner for registry commands", async () => {
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
    const editorSurfaceCommandRunnerChange = vi.fn();
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
          onEditorSurfaceCommandRunnerChange={editorSurfaceCommandRunnerChange}
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

    const editor = editorSurfaceMocks.editor;
    const runner = editorSurfaceCommandRunnerChange.mock.calls.find(
      ([candidate]) => typeof candidate === "function",
    )?.[0];

    expect(runner).toEqual(expect.any(Function));

    act(() => {
      runner("editor.rename");
    });

    expect(editor?.focus).toHaveBeenCalledTimes(1);
    expect(editor?.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.rename",
      {},
    );

    editor?.focus.mockClear();
    editor?.trigger.mockClear();
    editor?.getModel.mockReturnValueOnce({
      uri: {
        fsPath: "/workspace/src/other.ts",
        path: "/workspace/src/other.ts",
      },
    } as FakeModel);

    act(() => {
      runner("editor.quickFix");
    });

    expect(editor?.focus).not.toHaveBeenCalled();
    expect(editor?.trigger).not.toHaveBeenCalled();
  });

  it("publishes a guarded buffer fix runner that applies fixes in one edit call", async () => {
    const content = "let value = 'x'";
    const activeDocument: EditorDocument = {
      content,
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: content,
    };
    const model: FakeModel = {
      getPositionAt: vi.fn((offset: number) => ({
        column: offset + 1,
        lineNumber: 1,
      })),
      getValue: vi.fn(() => content),
      setValue: vi.fn(),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
      },
    };
    const bufferFixRunnerChange = vi.fn();
    const editor = createEditor(model);
    editor.executeEdits.mockReturnValue(true);
    editorSurfaceMocks.editor = editor;
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
          onEditorSurfaceBufferFixRunnerChange={bufferFixRunnerChange}
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

    const runner = bufferFixRunnerChange.mock.calls.find(
      ([candidate]) => typeof candidate === "function",
    )?.[0];
    const fixes = [
      { range: [12, 15] as [number, number], text: '"x"' },
      { range: [15, 15] as [number, number], text: ";" },
    ];

    editor.getModel.mockReturnValueOnce({
      ...model,
      uri: {
        fsPath: "/workspace/src/other.ts",
        path: "/workspace/src/other.ts",
      },
    });
    expect(runner(content, fixes)).toBeNull();

    model.getValue?.mockReturnValueOnce("dirty content");
    expect(runner(content, fixes)).toBeNull();

    expect(runner(content, fixes)).toBe(2);
    expect(editor.executeEdits).toHaveBeenCalledOnce();
    expect(editor.executeEdits).toHaveBeenCalledWith(
      "eslint.fixAllInActiveFile",
      [
        expect.objectContaining({
          forceMoveMarkers: true,
          range: expect.objectContaining({ startColumn: 13, endColumn: 16 }),
          text: '"x"',
        }),
        expect.objectContaining({
          forceMoveMarkers: true,
          range: expect.objectContaining({ startColumn: 16, endColumn: 16 }),
          text: ";",
        }),
      ],
    );
  });

  it("publishes a guarded PHPStan runner that inserts one indented combined ignore edit", async () => {
    const content = "<?php\n    broken();\n";
    const activeDocument: EditorDocument = {
      content,
      language: "php",
      name: "example.php",
      path: "/workspace/src/example.php",
      savedContent: content,
    };
    const model: FakeModel = {
      getLineContent: vi.fn(() => "    broken();"),
      getLineCount: vi.fn(() => 2),
      getValue: vi.fn(() => content),
      setValue: vi.fn(),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const phpstanRunnerChange = vi.fn();
    const editor = createEditor(model);
    editor.executeEdits.mockReturnValue(true);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        <EditorSurface
          {...memoGuardProps(activeDocument)}
          onEditorSurfacePhpstanIgnoreRunnerChange={phpstanRunnerChange}
          workspaceRoot="/workspace"
        />,
      );
      await Promise.resolve();
    });

    const runner = phpstanRunnerChange.mock.calls.find(
      ([candidate]) => typeof candidate === "function",
    )?.[0];

    editor.getModel.mockReturnValueOnce({
      ...model,
      uri: {
        fsPath: "/workspace/src/other.php",
        path: "/workspace/src/other.php",
      },
    });
    expect(runner(content, 2, ["argument.type"])).toBeNull();
    model.getValue?.mockReturnValueOnce("dirty");
    expect(runner(content, 2, ["argument.type"])).toBeNull();

    expect(runner(content, 2, ["argument.type", "return.type"])).toBe(2);
    expect(editor.executeEdits).toHaveBeenCalledOnce();
    expect(editor.executeEdits).toHaveBeenCalledWith(
      "phpstan.ignoreIssueAtCursor",
      [
        expect.objectContaining({
          forceMoveMarkers: true,
          range: expect.objectContaining({
            startLineNumber: 2,
            startColumn: 1,
            endLineNumber: 2,
            endColumn: 1,
          }),
          text: "    // @phpstan-ignore argument.type, return.type\n",
        }),
      ],
    );
  });

  it("publishes a guarded ESLint runner that inserts one indented combined disable edit at line one", async () => {
    const content = "    broken();\nnext();\n";
    const activeDocument: EditorDocument = {
      content,
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: content,
    };
    const model: FakeModel = {
      getLineContent: vi.fn(() => "    broken();"),
      getLineCount: vi.fn(() => 2),
      getValue: vi.fn(() => content),
      setValue: vi.fn(),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const eslintRunnerChange = vi.fn();
    const editor = createEditor(model);
    editor.executeEdits.mockReturnValue(true);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        <EditorSurface
          {...memoGuardProps(activeDocument)}
          onEditorSurfaceEslintDisableRunnerChange={eslintRunnerChange}
          workspaceRoot="/workspace"
        />,
      );
      await Promise.resolve();
    });

    const runner = eslintRunnerChange.mock.calls.find(
      ([candidate]) => typeof candidate === "function",
    )?.[0];

    editor.getModel.mockReturnValueOnce({
      ...model,
      uri: { fsPath: "/workspace/src/other.ts", path: "/workspace/src/other.ts" },
    });
    expect(runner(content, 1, ["rule-a"])).toBeNull();
    model.getValue?.mockReturnValueOnce("dirty");
    expect(runner(content, 1, ["rule-a"])).toBeNull();

    expect(runner(content, 1, ["rule-a", "rule-b"])).toBe(2);
    expect(editor.executeEdits).toHaveBeenCalledOnce();
    expect(editor.executeEdits).toHaveBeenCalledWith(
      "eslint.disableRuleAtCursor",
      [
        expect.objectContaining({
          forceMoveMarkers: true,
          range: expect.objectContaining({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 1,
          }),
          text: "    // eslint-disable-next-line rule-a, rule-b\n",
        }),
      ],
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

  it("keeps Monaco JavaScript and TypeScript built-ins active unless the managed runtime matches the workspace", async () => {
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
        diagnostics: true,
        hovers: true,
      }),
    );
    expect(latestTypeScriptDiagnosticsOptions(monaco)).toEqual({
      noSemanticValidation: false,
      noSuggestionDiagnostics: false,
      noSyntaxValidation: false,
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
        diagnostics: true,
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
    expect(latestTypeScriptDiagnosticsOptions(monaco)).toEqual({
      noSemanticValidation: true,
      noSuggestionDiagnostics: true,
      noSyntaxValidation: true,
    });
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
          leftButton: true,
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

  it("routes a middle click on code text through go-to-definition", async () => {
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
          middleButton: true,
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

  it("seeds the status bar's caret indicator on mount and forwards every cursor move", async () => {
    // The status bar's "Ln X, Col Y" item reads the active editor's caret. On a
    // tab switch @monaco-editor/react swaps the model and remounts this surface,
    // so the surface must (a) report the active editor's CURRENT caret on mount
    // (so the switched-to tab's position shows immediately) and (b) forward
    // every subsequent move. A new tab's model thus seeds the indicator with its
    // own caret, never a stale tab's.
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
    const editor = createEditor(model);
    editor.getPosition.mockReturnValue({ column: 5, lineNumber: 3 });
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(model);

    const onCursorPositionChange = vi.fn();

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

    // The surface seeded the indicator with the editor's current caret.
    expect(onCursorPositionChange).toHaveBeenCalledWith({
      column: 5,
      lineNumber: 3,
    });

    await act(async () => {
      editor.cursorPositionHandler?.({
        position: { column: 9, lineNumber: 12 },
      });
    });

    // A later move is forwarded too, so the status bar tracks the live caret.
    expect(onCursorPositionChange).toHaveBeenLastCalledWith({
      column: 9,
      lineNumber: 12,
    });
  });

  it("neutralizes Monaco's built-in Cmd-hover definition navigation without disposing the contribution so only explicit Cmd+click / Cmd+B navigate", async () => {
    stubNavigatorPlatform("MacIntel");

    // The reported repro: cursor over a class symbol in a PHP `use` statement.
    // Monaco's built-in `gotodefinitionatposition` contribution navigates on its
    // own Cmd interactions (mouseup with Cmd held, independent of leftButton and
    // of the surface's guarded onMouseDown). Disposing it at mount tore down its
    // editor listeners while the contribution stayed registered, corrupting
    // Monaco's event delivery and crashing on the next interaction. The surface
    // instead neutralizes ONLY the gesture's navigation (replaces its
    // `gotoDefinition` with a no-op) and leaves the contribution - and every
    // listener - intact; navigation must only come from the surface's explicit
    // Cmd+click handler and the Cmd+B keybinding.
    const activeDocument: EditorDocument = {
      content:
        "<?php\n\nuse App\\Http\\Controllers\\Page\\LinkDomainVerificationController;\n",
      language: "php",
      name: "Routes.php",
      path: "/workspace/app/Routes.php",
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

    expect(editor.getContribution).toHaveBeenCalledWith(
      "editor.contrib.gotodefinitionatposition",
    );

    // The contribution must NOT be disposed - disposing it is what crashed
    // Monaco's event delivery. It stays alive and registered.
    expect(editor.gotoDefinitionContributionDispose).not.toHaveBeenCalled();

    // ...but its navigation is neutralized: invoking the (now patched)
    // gotoDefinition - exactly what the gesture's onExecute does on a Cmd-hover -
    // must NOT run the original navigation.
    await editor.gotoDefinitionContribution.gotoDefinition(
      { lineNumber: 3, column: 5 },
      false,
    );
    expect(editor.gotoDefinitionContributionNavigate).not.toHaveBeenCalled();
  });

  it("does not navigate when Cmd is held while hovering over code text on macOS", async () => {
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
      editor.mouseMoveHandler?.({
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

    await editor.gotoDefinitionContribution.gotoDefinition(position, false);

    expect(editor.setPosition).not.toHaveBeenCalledWith(position);
    expect(onGoToDefinition).not.toHaveBeenCalled();
    expect(editor.gotoDefinitionContributionNavigate).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
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
          leftButton: true,
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

  it("does not navigate on a Ctrl+click on code text on macOS (that gesture is the secondary/context click)", async () => {
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
          ctrlKey: true,
          leftButton: true,
          preventDefault,
          stopPropagation,
        },
        target: {
          position: { column: 13, lineNumber: 2 },
          type: monaco.editor.MouseTargetType.CONTENT_TEXT,
        },
      });
    });

    // Holding Cmd together with Ctrl is still the secondary/context gesture on
    // macOS: the Ctrl exclusion must win over the Cmd modifier, so this must not
    // navigate either (this is the case that proves the `ctrlKey !== true`
    // clause, since the old metaKey-only check would have navigated here).
    act(() => {
      editor.mouseDownHandler?.({
        event: {
          ctrlKey: true,
          metaKey: true,
          leftButton: true,
          preventDefault,
          stopPropagation,
        },
        target: {
          position: { column: 13, lineNumber: 2 },
          type: monaco.editor.MouseTargetType.CONTENT_TEXT,
        },
      });
    });

    expect(onGoToDefinition).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("does not navigate on a Cmd+secondary (non-left) click on code text on macOS", async () => {
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
          leftButton: false,
          metaKey: true,
          rightButton: true,
          preventDefault,
          stopPropagation,
        },
        target: {
          position: { column: 13, lineNumber: 2 },
          type: monaco.editor.MouseTargetType.CONTENT_TEXT,
        },
      });
    });

    expect(onGoToDefinition).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
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
          frameworkIntelligenceProviders={{
            isPhpFrameworkStringCompletionContext: () => true,
          }}
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
          severity: monaco.MarkerSeverity.Hint,
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

  it("hides a stale content hover when the active document's diagnostics are cleared", async () => {
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

    const diagnosticsWith = (
      messages: string[],
    ): Record<string, LanguageServerDiagnostic[]> => ({
      [activeDocument.path]: messages.map((message, index) => ({
        character: 6,
        endCharacter: 11,
        endLine: 0,
        line: index,
        message,
        severity: "warning" as const,
        source: "typescript",
      })),
    });

    const renderWith = async (
      diagnostics: Record<string, LanguageServerDiagnostic[]>,
    ) => {
      await act(async () => {
        root.render(
          <EditorSurface
            activeDocument={activeDocument}
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

    // A warning is present and the user is hovering it (Monaco's content hover
    // widget is showing the diagnostic message).
    await renderWith(diagnosticsWith(["unused variable"]));

    const hideHoverCalls = () =>
      editor.trigger.mock.calls.filter(
        ([, actionId]) => actionId === "editor.action.hideHover",
      );

    editor.trigger.mockClear();

    // The diagnostic is fixed / re-validated away: markers are cleared. The
    // content hover widget is mouse-driven and survives a marker clear, so the
    // surface must dismiss it or it stays pinned showing the now-invalid message.
    await renderWith({ [activeDocument.path]: [] });

    expect(hideHoverCalls().length).toBeGreaterThan(0);
  });

  it("does not hide the hover on a keystroke when the active document's diagnostics are unchanged", async () => {
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

    const diagnostics: Record<string, LanguageServerDiagnostic[]> = {
      [activeDocument.path]: [
        {
          character: 6,
          endCharacter: 11,
          endLine: 0,
          line: 0,
          message: "unused variable",
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

    editor.trigger.mockClear();

    // A keystroke hands a fresh activeDocument object (same path, mutated content)
    // while the diagnostics map keeps its identity. No diagnostic changed, so the
    // open hover must NOT be dismissed mid-read.
    await renderWith({ ...activeDocument, content: "const value = 12;\n" });

    const hideHoverCalls = editor.trigger.mock.calls.filter(
      ([, actionId]) => actionId === "editor.action.hideHover",
    );
    expect(hideHoverCalls).toHaveLength(0);
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

  it("renders unused-import inspections as warning markers tagged Unnecessary", async () => {
    const content = `<?php

namespace App;

use App\\Services\\UsedService;
use App\\Services\\UnusedService;

class Foo
{
    public function bar(UsedService $service): void
    {
    }
}
`;
    const activeDocument: EditorDocument = {
      content,
      language: "php",
      name: "Foo.php",
      path: "/workspace/app/Foo.php",
      savedContent: content,
    };
    const model: FakeModel = {
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const monaco = createMonaco(model);
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
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await Promise.resolve();
    });

    const syntaxMarkerCalls = monaco.editor.setModelMarkers.mock.calls.filter(
      ([, owner]) => owner === "php-syntax",
    );
    const lastCall = syntaxMarkerCalls[syntaxMarkerCalls.length - 1];
    const markers = lastCall?.[2] as any[] | undefined;
    const inspectionMarker = markers?.find(
      (marker) => marker.source === "PHP Inspection",
    );

    expect(inspectionMarker).toBeDefined();
    expect(inspectionMarker.severity).toBe(monaco.MarkerSeverity.Warning);
    expect(inspectionMarker.tags).toEqual([monaco.MarkerTag.Unnecessary]);
    expect(inspectionMarker.message).toBe(
      "Unused import App\\Services\\UnusedService.",
    );
    // The marker sits on line 6 (1-based), the unused `use` statement line.
    expect(inspectionMarker.startLineNumber).toBe(6);
  });

  it("reports local PHP syntax diagnostics to the workbench aggregation callback", async () => {
    const content = "<?php\n\nfunction codevoQaBroken(";
    const activeDocument: EditorDocument = {
      content,
      language: "php",
      name: "Broken.php",
      path: "/workspace/app/Broken.php",
      savedContent: content,
    };
    const model: FakeModel = {
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const monaco = createMonaco(model);
    const onLocalPhpDiagnosticsChange = vi.fn();
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
          onLocalPhpDiagnosticsChange={onLocalPhpDiagnosticsChange}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{
            validate: vi.fn(async () => [
              {
                character: 9,
                endCharacter: 10,
                endLine: 2,
                line: 2,
                message: "syntax error, unexpected end of file",
              },
            ]),
          }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await Promise.resolve();
    });

    const syntaxMarkerCalls = monaco.editor.setModelMarkers.mock.calls.filter(
      ([, owner]) => owner === "php-syntax",
    );
    const markers = syntaxMarkerCalls[syntaxMarkerCalls.length - 1]?.[2] as
      | any[]
      | undefined;

    expect(markers?.[0]).toMatchObject({
      message: "syntax error, unexpected end of file",
      severity: monaco.MarkerSeverity.Error,
      source: "PHP Syntax",
    });
    expect(onLocalPhpDiagnosticsChange).toHaveBeenLastCalledWith(
      activeDocument.path,
      [
        expect.objectContaining({
          character: 9,
          line: 2,
          message: "syntax error, unexpected end of file",
          severity: "error",
          source: "PHP Syntax",
        }),
      ],
    );
  });

  it("skips open-time local PHP syntax diagnostics for large PHP documents", async () => {
    const content = `<?php\n${"a".repeat(17 * 1024)}`;
    const activeDocument: EditorDocument = {
      content,
      language: "php",
      name: "CarbonInterface.php",
      path: "/workspace/vendor/CarbonInterface.php",
      savedContent: content,
    };
    const model: FakeModel = {
      getValue: vi.fn(() => content),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const monaco = createMonaco(model);
    const validate = vi.fn(async () => []);
    const onLocalPhpDiagnosticsChange = vi.fn();
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
          largeSmartDocumentPolicy={{ characterLimit: 16 * 1024, lineLimit: 500 }}
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
          onLocalPhpDiagnosticsChange={onLocalPhpDiagnosticsChange}
          onOpenClass={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFileStructure={vi.fn()}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await Promise.resolve();
    });

    expect(validate).not.toHaveBeenCalled();
    expect(onLocalPhpDiagnosticsChange).toHaveBeenCalledWith(
      activeDocument.path,
      [],
    );
    expect(
      monaco.editor.setModelMarkers.mock.calls.filter(
        ([, owner]) => owner === "php-syntax",
      ),
    ).toEqual([[model, "php-syntax", []]]);
  });

  it("retries open-time local PHP diagnostics when the first parser run fails", async () => {
    vi.useFakeTimers();
    try {
      const content = "<?php\n\nfunction codevoQaBroken(";
      const activeDocument: EditorDocument = {
        content,
        language: "php",
        name: "Broken.php",
        path: "/workspace/app/Broken.php",
        savedContent: content,
      };
      const model: FakeModel = {
        getValue: vi.fn(() => content),
        uri: { fsPath: activeDocument.path, path: activeDocument.path },
      };
      const monaco = createMonaco(model);
      const onLocalPhpDiagnosticsChange = vi.fn();
      const validate = vi
        .fn()
        .mockRejectedValueOnce(new Error("parser warming up"))
        .mockResolvedValue([
          {
            character: 9,
            endCharacter: 10,
            endLine: 2,
            line: 2,
            message: "syntax error, unexpected end of file",
          },
        ]);
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
            onLocalPhpDiagnosticsChange={onLocalPhpDiagnosticsChange}
            onOpenClass={vi.fn()}
            onOpenFile={vi.fn()}
            onOpenFileStructure={vi.fn()}
            onRevealTargetHandled={vi.fn()}
            onRevertChangeHunk={vi.fn()}
            phpSyntaxDiagnosticsGateway={{ validate }}
            providePhpMethodCompletions={vi.fn(async () => [])}
            providePhpMethodSignature={vi.fn(async () => null)}
          />,
        );
        await Promise.resolve();
      });

      await act(async () => {
        await Promise.resolve();
        vi.advanceTimersByTime(80);
        await Promise.resolve();
      });

      expect(validate).toHaveBeenCalledTimes(2);
      expect(onLocalPhpDiagnosticsChange).toHaveBeenLastCalledWith(
        activeDocument.path,
        [
          expect.objectContaining({
            message: "syntax error, unexpected end of file",
            severity: "error",
            source: "PHP Syntax",
          }),
        ],
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders unused-variable inspections as warning markers tagged Unnecessary", async () => {
    const content = `<?php

namespace App;

class Foo
{
    public function bar(): int
    {
        $unused = 5;
        return 1;
    }
}
`;
    const activeDocument: EditorDocument = {
      content,
      language: "php",
      name: "Foo.php",
      path: "/workspace/app/Foo.php",
      savedContent: content,
    };
    const model: FakeModel = {
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const monaco = createMonaco(model);
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
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await Promise.resolve();
    });

    const syntaxMarkerCalls = monaco.editor.setModelMarkers.mock.calls.filter(
      ([, owner]) => owner === "php-syntax",
    );
    const lastCall = syntaxMarkerCalls[syntaxMarkerCalls.length - 1];
    const markers = lastCall?.[2] as any[] | undefined;
    const inspectionMarker = markers?.find(
      (marker) =>
        marker.source === "PHP Inspection" &&
        marker.message === 'Unused variable "$unused".',
    );

    expect(inspectionMarker).toBeDefined();
    expect(inspectionMarker.severity).toBe(monaco.MarkerSeverity.Warning);
    expect(inspectionMarker.tags).toEqual([monaco.MarkerTag.Unnecessary]);
    // The marker sits on line 9 (1-based), the `$unused = 5;` statement line.
    expect(inspectionMarker.startLineNumber).toBe(9);
  });

  it("hides a stale PHP inspection hover when unused symbols are fixed", async () => {
    const contentWithInspections = `<?php

namespace App;

use App\\Services\\UnusedService;

class Foo
{
    public function bar(): int
    {
        $unused = 5;
        return 1;
    }
}
`;
    const fixedContent = `<?php

namespace App;

class Foo
{
    public function bar(): int
    {
        return 1;
    }
}
`;
    const activeDocument: EditorDocument = {
      content: contentWithInspections,
      language: "php",
      name: "Foo.php",
      path: "/workspace/app/Foo.php",
      savedContent: contentWithInspections,
    };
    const model: FakeModel = {
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
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
    const flushPhpValidation = async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        await Promise.resolve();
      });
    };
    const hideHoverCalls = () =>
      editor.trigger.mock.calls.filter(
        ([, actionId]) => actionId === "editor.action.hideHover",
      );
    const latestPhpSyntaxMarkers = () => {
      const syntaxMarkerCalls = monaco.editor.setModelMarkers.mock.calls.filter(
        ([, owner]) => owner === "php-syntax",
      );

      return syntaxMarkerCalls[syntaxMarkerCalls.length - 1]?.[2] as
        | any[]
        | undefined;
    };

    await renderWith(activeDocument);
    await flushPhpValidation();

    expect(
      latestPhpSyntaxMarkers()?.filter(
        (marker) => marker.source === "PHP Inspection",
      ),
    ).toHaveLength(2);

    editor.trigger.mockClear();

    await renderWith({
      ...activeDocument,
      content: fixedContent,
      savedContent: fixedContent,
    });
    await flushPhpValidation();

    expect(
      latestPhpSyntaxMarkers()?.filter(
        (marker) => marker.source === "PHP Inspection",
      ),
    ).toHaveLength(0);
    expect(hideHoverCalls().length).toBeGreaterThan(0);
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

  it("cleans and repaints scoped markers and decorations on a same-path root switch", async () => {
    const path = "/workspace/packages/app/src/shared.ts";
    const document: EditorDocument = {
      content: "const shared = 1;\n",
      language: "typescript",
      name: "shared.ts",
      path,
      savedContent: "const shared = 1;\n",
    };
    const parentModel = {
      dispose: vi.fn(),
      getValue: vi.fn(() => document.content),
      uri: URI.parse(workspaceModelUri("/workspace", path)!),
    } as never as FakeModel;
    const nestedRoot = "/workspace/packages/app";
    const nestedModel = {
      dispose: vi.fn(),
      getValue: vi.fn(() => document.content),
      uri: URI.parse(workspaceModelUri(nestedRoot, path)!),
    } as never as FakeModel;
    const monaco = createMonaco(parentModel);
    monaco.editor.getModels = vi.fn(() => [parentModel, nestedModel]);
    const editor = createEditor(parentModel);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;
    const diagnostics = {
      [path]: [
        {
          character: 0,
          endCharacter: 5,
          endLine: 0,
          line: 0,
          message: "shared warning",
          severity: "warning" as const,
          source: "typescript",
        },
      ],
    };
    const renderWithRoot = async (workspaceRoot: string) => {
      await act(async () => {
        root.render(
          <EditorSurface
            activeDocument={document}
            bookmarkedLineNumbers={[1]}
            changeHunks={[]}
            editorRevealTarget={null}
            flushPendingLanguageServerDocument={vi.fn(async () => undefined)}
            keymap={defaultKeymapSettings()}
            languageServerDiagnosticsByPath={diagnostics}
            languageServerFeaturesGateway={languageServerFeaturesGateway()}
            languageServerRuntimeStatus={null}
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
            workspaceRoot={workspaceRoot}
          />,
        );
        await Promise.resolve();
      });
    };

    await renderWithRoot("/workspace");
    monaco.editor.setModelMarkers.mockClear();
    editor.getModel.mockReturnValue(nestedModel);
    await renderWithRoot(nestedRoot);

    expect(parentModel.dispose).toHaveBeenCalledOnce();
    expect(monaco.editor.setModelMarkers).toHaveBeenCalledWith(
      nestedModel,
      "php-language-server",
      expect.arrayContaining([expect.objectContaining({ message: "shared warning" })]),
    );
    expect(editor.deltaDecorations).toHaveBeenCalledWith(expect.any(Array), []);
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

  it("registers Option+Enter and Cmd+. quick fix/context actions", async () => {
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
        keybindings: [
          monaco.KeyMod.Alt | monaco.KeyCode.Enter,
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.Period,
        ],
        label: "Show Context Actions",
      }),
    );

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

  it("registers F2 rename that triggers Monaco's cross-file rename action", async () => {
    const activeDocument: EditorDocument = {
      content: "const value = 1;\nconst other = value;\n",
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

    const renameAction = editor.addAction.mock.calls
      .map(([action]) => action)
      .find((action) => action.id === "mockor.rename");

    expect(renameAction).toEqual(
      expect.objectContaining({
        keybindings: [monaco.KeyCode.F2],
        label: "Rename Symbol",
      }),
    );

    renameAction.run();

    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.action.rename",
      {},
    );

    editor.trigger.mockClear();
    editor.getModel.mockReturnValueOnce(null);

    renameAction.run();

    expect(editor.trigger).not.toHaveBeenCalled();
  });

  it("registers fold/unfold actions that trigger Monaco's folding commands", async () => {
    const activeDocument: EditorDocument = {
      content: "function outer() {\n  return 1;\n}\n",
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

    const actionById = (id: string) =>
      editor.addAction.mock.calls
        .map(([action]) => action)
        .find((action) => action.id === id);

    const foldAll = actionById("mockor.foldAll");
    const unfoldAll = actionById("mockor.unfoldAll");
    const foldRecursively = actionById("mockor.foldRecursively");
    const unfoldRecursively = actionById("mockor.unfoldRecursively");

    expect(foldAll).toEqual(
      expect.objectContaining({
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Minus,
        ],
        label: "Fold All",
      }),
    );
    expect(unfoldAll).toEqual(
      expect.objectContaining({
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Equal,
        ],
        label: "Unfold All",
      }),
    );
    // Recursively variants are palette-only (no default keybinding).
    expect(foldRecursively).toEqual(
      expect.objectContaining({
        keybindings: [],
        label: "Fold Recursively",
      }),
    );
    expect(unfoldRecursively).toEqual(
      expect.objectContaining({
        keybindings: [],
        label: "Unfold Recursively",
      }),
    );

    foldAll.run();
    expect(editor.trigger).toHaveBeenCalledWith("keyboard", "editor.foldAll", {});

    editor.trigger.mockClear();
    unfoldAll.run();
    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.unfoldAll",
      {},
    );

    editor.trigger.mockClear();
    foldRecursively.run();
    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.foldRecursively",
      {},
    );

    editor.trigger.mockClear();
    unfoldRecursively.run();
    expect(editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "editor.unfoldRecursively",
      {},
    );

    editor.trigger.mockClear();
    editor.getModel.mockReturnValueOnce(null);
    foldAll.run();
    expect(editor.trigger).not.toHaveBeenCalled();
  });

  it("registers next/previous change actions that jump between gutter change hunks", async () => {
    // Two separated change hunks: an edit on line 2 and an edit on line 6.
    const baseline = [
      "line1",
      "line2",
      "line3",
      "line4",
      "line5",
      "line6",
      "line7",
    ].join("\n");
    const current = [
      "line1",
      "line2-edited",
      "line3",
      "line4",
      "line5",
      "line6-edited",
      "line7",
    ].join("\n");
    const changeHunks = editorChangeHunks(baseline, current);

    expect(changeHunks).toHaveLength(2);
    const firstHunkLine = changeHunks[0].startLineNumber;
    const secondHunkLine = changeHunks[1].startLineNumber;
    expect(firstHunkLine).toBeLessThan(secondHunkLine);

    const activeDocument: EditorDocument = {
      content: current,
      language: "typescript",
      name: "module.ts",
      path: "/workspace/src/module.ts",
      savedContent: baseline,
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

    const actionById = (id: string) =>
      editor.addAction.mock.calls
        .map(([action]) => action)
        .find((action) => action.id === id);

    const nextChange = actionById("mockor.nextChange");
    const previousChange = actionById("mockor.previousChange");

    expect(nextChange).toEqual(
      expect.objectContaining({
        keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.F5],
        label: "Go to Next Change",
      }),
    );
    expect(previousChange).toEqual(
      expect.objectContaining({
        keybindings: [
          monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.F5,
        ],
        label: "Go to Previous Change",
      }),
    );

    // Caret starts on line 1, before both hunks: Next jumps to the first hunk.
    editor.getPosition.mockReturnValue({ column: 1, lineNumber: 1 });
    editor.setPosition.mockClear();
    nextChange.run();
    expect(editor.setPosition).toHaveBeenCalledWith(
      expect.objectContaining({ lineNumber: firstHunkLine }),
    );

    // From inside the first hunk, Next advances to the second hunk.
    editor.getPosition.mockReturnValue({ column: 1, lineNumber: firstHunkLine });
    editor.setPosition.mockClear();
    nextChange.run();
    expect(editor.setPosition).toHaveBeenCalledWith(
      expect.objectContaining({ lineNumber: secondHunkLine }),
    );

    // From the second (last) hunk, Next wraps around to the first hunk.
    editor.getPosition.mockReturnValue({ column: 1, lineNumber: secondHunkLine });
    editor.setPosition.mockClear();
    nextChange.run();
    expect(editor.setPosition).toHaveBeenCalledWith(
      expect.objectContaining({ lineNumber: firstHunkLine }),
    );

    // From the first hunk, Previous wraps around to the last hunk.
    editor.getPosition.mockReturnValue({ column: 1, lineNumber: firstHunkLine });
    editor.setPosition.mockClear();
    previousChange.run();
    expect(editor.setPosition).toHaveBeenCalledWith(
      expect.objectContaining({ lineNumber: secondHunkLine }),
    );

    // From the last hunk, Previous steps back to the first hunk.
    editor.getPosition.mockReturnValue({ column: 1, lineNumber: secondHunkLine });
    editor.setPosition.mockClear();
    previousChange.run();
    expect(editor.setPosition).toHaveBeenCalledWith(
      expect.objectContaining({ lineNumber: firstHunkLine }),
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
    editor.getContribution.mockImplementation((id?: string) =>
      id === "editor.contrib.gotodefinitionatposition"
        ? editor.gotoDefinitionContribution
        : snippetController,
    );
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
    editor.getContribution.mockImplementation((id?: string) =>
      id === "editor.contrib.gotodefinitionatposition"
        ? editor.gotoDefinitionContribution
        : snippetController,
    );
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
    editor.getContribution.mockImplementation((id?: string) =>
      id === "editor.contrib.gotodefinitionatposition"
        ? editor.gotoDefinitionContribution
        : snippetController,
    );
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
    editor.getContribution.mockImplementation((id?: string) =>
      id === "editor.contrib.gotodefinitionatposition"
        ? editor.gotoDefinitionContribution
        : snippetController,
    );

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

  it("routes editor-focused Escape through the floating-surface closer", async () => {
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
    const onCloseFloatingSurface = vi.fn(() => true);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          onCloseFloatingSurface,
        }),
      );
      await Promise.resolve();
    });

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    editor.keyDownHandler?.({
      browserEvent: {
        key: "Escape",
        preventDefault,
        stopPropagation,
      },
      keyCode: monaco.KeyCode.Escape,
      preventDefault,
      stopPropagation,
    });

    expect(onCloseFloatingSurface).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
  });

  it("leaves editor-focused Escape to Monaco when no floating surface closes", async () => {
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
    const onCloseFloatingSurface = vi.fn(() => false);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          onCloseFloatingSurface,
        }),
      );
      await Promise.resolve();
    });

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    editor.keyDownHandler?.({
      browserEvent: {
        key: "Escape",
        preventDefault,
        stopPropagation,
      },
      keyCode: monaco.KeyCode.Escape,
      preventDefault,
      stopPropagation,
    });

    expect(onCloseFloatingSurface).toHaveBeenCalledTimes(1);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
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
    // A modified hunk shows both sides of the change inline (previous + current)
    // for a clearer JetBrains-style rollback diff.
    expect(host.textContent).toContain("Previous content");
    expect(host.textContent).toContain("$comment = 'old';");
    expect(host.textContent).toContain("Current content");
    expect(host.textContent).toContain("$comment = 'new';");
    const popover = queryRequired<HTMLElement>(host, ".editor-change-popover");
    expect(popover.classList.contains("editor-change-popover-modified")).toBe(
      true,
    );
    expect(popover.querySelector(".editor-change-popover-code-removed")).not.toBeNull();
    expect(popover.querySelector(".editor-change-popover-code-added")).not.toBeNull();
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

  it("navigates to the next and previous change from the gutter rollback popover", async () => {
    const activeDocument: EditorDocument = {
      content: "<?php\n$a = 'new';\n$keep = 1;\n$b = 'new';\n",
      language: "php",
      name: "Multi.php",
      path: "/workspace/src/Multi.php",
      savedContent: "<?php\n$a = 'old';\n$keep = 1;\n$b = 'old';\n",
    };
    const changeHunks = editorChangeHunks(
      activeDocument.savedContent,
      activeDocument.content,
    );
    expect(changeHunks.length).toBeGreaterThanOrEqual(2);
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

    // Open the rollback popover on the first hunk by clicking its gutter glyph.
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
            lineNumber: changeHunks[0].startLineNumber,
          },
          type: monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN,
        },
      });
    });

    const nextButton = queryRequired<HTMLButtonElement>(
      host,
      ".editor-change-popover-action-next",
    );
    const previousButton = queryRequired<HTMLButtonElement>(
      host,
      ".editor-change-popover-action-previous",
    );

    // The popover starts on the first hunk ($a).
    expect(host.textContent).toContain("$a = 'old';");
    expect(host.textContent).not.toContain("$b = 'old';");

    // Navigating next moves the editor caret to the second hunk AND the popover
    // follows onto it (it no longer shows the first hunk's content).
    editor.setPosition.mockClear();
    act(() => {
      nextButton.click();
    });
    expect(editor.setPosition).toHaveBeenCalledWith(
      expect.objectContaining({ lineNumber: changeHunks[1].startLineNumber }),
    );
    expect(host.textContent).toContain("$b = 'old';");
    expect(host.textContent).not.toContain("$a = 'old';");

    // Navigating previous walks the editor and the popover back to the first
    // hunk - anchored on the popover's hunk, not a stale caret snapshot.
    editor.setPosition.mockClear();
    act(() => {
      previousButton.click();
    });
    expect(editor.setPosition).toHaveBeenCalledWith(
      expect.objectContaining({ lineNumber: changeHunks[0].startLineNumber }),
    );
    expect(host.textContent).toContain("$a = 'old';");
    expect(host.textContent).not.toContain("$b = 'old';");
  });

  it("renders added and deleted change gutter markers with preview and revert actions", async () => {
    const activeDocument: EditorDocument = {
      content: "one\ninserted\ntwo\nfour\n",
      language: "typescript",
      name: "module.ts",
      path: "/workspace/src/module.ts",
      savedContent: "one\ntwo\nremoved\nfour\n",
    };
    const addedHunk: EditorChangeHunk = {
      currentLines: ["inserted"],
      endLineNumber: 2,
      id: "added:2:2:0:1",
      kind: "added",
      originalLines: [],
      originalStartLineNumber: 2,
      startLineNumber: 2,
    };
    const deletedHunk: EditorChangeHunk = {
      currentLines: [],
      endLineNumber: 4,
      id: "deleted:3:4:1:0",
      kind: "deleted",
      originalLines: ["removed"],
      originalStartLineNumber: 3,
      startLineNumber: 4,
    };
    const changeHunks = [addedHunk, deletedHunk];
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
            "editor-change-glyph editor-change-glyph-added",
        ) &&
        decorations.some(
          (decoration: any) =>
            decoration.options.glyphMarginClassName ===
            "editor-change-glyph editor-change-glyph-deleted",
        ),
    );
    expect(changeDecorationCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          options: expect.objectContaining({
            glyphMargin: {
              position: monaco.editor.GlyphMarginLane.Left,
            },
            glyphMarginClassName:
              "editor-change-glyph editor-change-glyph-added",
            linesDecorationsClassName:
              "editor-change-line editor-change-line-added",
          }),
          range: expect.objectContaining({
            endLineNumber: 2,
            startLineNumber: 2,
          }),
        }),
        expect.objectContaining({
          options: expect.objectContaining({
            glyphMargin: {
              position: monaco.editor.GlyphMarginLane.Left,
            },
            glyphMarginClassName:
              "editor-change-glyph editor-change-glyph-deleted",
            linesDecorationsClassName:
              "editor-change-line editor-change-line-deleted",
          }),
          range: expect.objectContaining({
            endLineNumber: 4,
            startLineNumber: 4,
          }),
        }),
      ]),
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
            lineNumber: addedHunk.startLineNumber,
          },
          type: monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN,
        },
      });
    });

    expect(host.textContent).toContain("Added lines");
    // A pure-add hunk has no previous content, so the popover omits the
    // "Previous content" section entirely instead of showing a placeholder,
    // and instead surfaces the inserted ("Current content") lines.
    expect(host.textContent).not.toContain("Previous content");
    expect(host.textContent).toContain("Current content");
    expect(host.textContent).toContain("inserted");
    act(() => {
      queryRequired<HTMLButtonElement>(
        host,
        ".editor-change-popover-action",
      ).click();
    });
    expect(onRevertChangeHunk).toHaveBeenCalledWith(addedHunk);

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
            lineNumber: deletedHunk.startLineNumber,
          },
          type: monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN,
        },
      });
    });

    expect(host.textContent).toContain("Deleted lines");
    expect(host.textContent).toContain("removed");
    act(() => {
      queryRequired<HTMLButtonElement>(
        host,
        ".editor-change-popover-action",
      ).click();
    });
    expect(onRevertChangeHunk).toHaveBeenCalledWith(deletedHunk);
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

    const menuItem = queryRequired<HTMLButtonElement>(
      document.body,
      ".breadcrumb-menu-item",
    );

    act(() => {
      menuItem.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

  it("force-syncs the editor model when its value diverges from the active document content so a freshly opened file never renders blank", async () => {
    // Reproduces the Quick Open empty-tab race: @monaco-editor/react keys its
    // value-apply effect on the `value` prop identity, and its model swap on the
    // `path` prop. When a file's model already exists (kept alive for Back/Forward
    // navigation) and the path swaps to it while the value effect does not re-run,
    // Monaco shows the model's stale/empty buffer and the freshly read content is
    // never applied until some later unrelated edit nudges the value effect. The
    // surface must converge the model deterministically on open.
    const activeDocument: EditorDocument = {
      content: "<?php\nclass CommentController {}\n",
      language: "php",
      name: "CommentController.php",
      path: "/workspace/app/Http/Controllers/CommentController.php",
      savedContent: "<?php\nclass CommentController {}\n",
    };
    let modelValue = ""; // The model exists but its buffer is stale/empty.
    const model: FakeModel = {
      getValue: vi.fn(() => modelValue),
      setValue: vi.fn((next: string) => {
        modelValue = next;
      }),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    } as FakeModel & {
      getValue: ReturnType<typeof vi.fn>;
      setValue: ReturnType<typeof vi.fn>;
    };
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(memoGuardSurface(activeDocument));
      await Promise.resolve();
    });

    // The model's buffer must end up matching the opened document content rather
    // than the stale empty buffer that left the editor visually blank.
    expect(modelValue).toBe(activeDocument.content);
  });

  it("force-syncs when Monaco swaps to the active document model after the open effect has already run", async () => {
    const activeDocument: EditorDocument = {
      content: "<?php\nclass QuickOpenFile {}\n",
      language: "php",
      name: "QuickOpenFile.php",
      path: "/workspace/app/CodevoQa/QuickOpenFile.php",
      savedContent: "<?php\nclass QuickOpenFile {}\n",
    };
    let modelValue = "";
    const placeholderModel: FakeModel = {
      uri: { fsPath: "/workspace/.placeholder", path: "/workspace/.placeholder" },
    };
    const activeModel: FakeModel = {
      getValue: vi.fn(() => modelValue),
      setValue: vi.fn((next: string) => {
        modelValue = next;
      }),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    } as FakeModel & {
      getValue: ReturnType<typeof vi.fn>;
      setValue: ReturnType<typeof vi.fn>;
    };
    const editor = createEditor(placeholderModel);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(activeModel);

    await act(async () => {
      root.render(memoGuardSurface(activeDocument));
      await Promise.resolve();
    });

    expect(modelValue).toBe("");

    editor.getModel.mockReturnValue(activeModel);

    await act(async () => {
      editor.modelChangeHandler?.();
      await Promise.resolve();
    });

    expect(modelValue).toBe(activeDocument.content);
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

  it("hides any open hover widget when a reveal target lands so a stuck 'Loading…' hover cannot linger after navigation", async () => {
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

    // Mount with no reveal target: a hover widget could be open here.
    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          editorRevealTarget: null,
        }),
      );
      await Promise.resolve();
    });

    // Navigate back / reveal to a position in the same document. This is the
    // exact gesture that left the Monaco hover widget stuck showing "Loading…".
    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          editorRevealTarget: {
            path: activeDocument.path,
            position: { lineNumber: 2, column: 1 },
          },
        }),
      );
      await Promise.resolve();
    });

    const triggeredHideHover = editor.trigger.mock.calls.some(
      (call) => call[1] === "editor.action.hideHover",
    );

    expect(triggeredHideHover).toBe(true);
    // The reveal itself must still happen.
    expect(editor.setPosition).toHaveBeenCalledWith({
      lineNumber: 2,
      column: 1,
    });
  });

  it("dismisses transient Monaco widgets when the active document changes", async () => {
    const firstDocument: EditorDocument = {
      content: "const value = 1;\n",
      language: "typescript",
      name: "first.ts",
      path: "/workspace/src/first.ts",
      savedContent: "",
    };
    const secondDocument: EditorDocument = {
      content: "const other = 2;\n",
      language: "typescript",
      name: "second.ts",
      path: "/workspace/src/second.ts",
      savedContent: "",
    };
    const model: FakeModel = {
      dispose: vi.fn(),
      uri: { fsPath: firstDocument.path, path: firstDocument.path },
    };
    const editor = createEditor(model);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(memoGuardSurface(firstDocument));
      await Promise.resolve();
    });

    editor.trigger.mockClear();

    await act(async () => {
      root.render(memoGuardSurface(secondDocument));
      await Promise.resolve();
    });

    expect(
      editor.trigger.mock.calls.some(
        (call) =>
          call[0] === "document-switch" &&
          call[1] === "editor.action.hideHover",
      ),
    ).toBe(true);
    expect(
      editor.trigger.mock.calls.some(
        (call) =>
          call[0] === "document-switch" && call[1] === "closeFindWidget",
      ),
    ).toBe(true);
  });

  it("clears delayed Monaco find accessibility status after a document navigation", async () => {
    vi.useFakeTimers();

    try {
      const firstDocument: EditorDocument = {
        content: "const value = 1;\n",
        language: "typescript",
        name: "first.ts",
        path: "/workspace/src/first.ts",
        savedContent: "",
      };
      const secondDocument: EditorDocument = {
        content: "const other = 2;\n",
        language: "typescript",
        name: "second.ts",
        path: "/workspace/src/second.ts",
        savedContent: "",
      };
      const model: FakeModel = {
        dispose: vi.fn(),
        uri: { fsPath: firstDocument.path, path: firstDocument.path },
      };
      const editor = createEditor(model);
      const domNode = document.createElement("div");
      const ariaContainer = document.createElement("div");
      ariaContainer.className = "monaco-aria-container";
      document.body.append(ariaContainer);
      editor.getDomNode.mockReturnValue(domNode);
      editorSurfaceMocks.editor = editor;
      editorSurfaceMocks.monaco = createMonaco(model);

      await act(async () => {
        root.render(memoGuardSurface(firstDocument));
        await Promise.resolve();
      });

      await act(async () => {
        root.render(memoGuardSurface(secondDocument));
        await Promise.resolve();
      });

      ariaContainer.textContent =
        "No results found for 'partials/@showHeader.latte'";

      await act(async () => {
        vi.advanceTimersByTime(0);
      });

      expect(ariaContainer.textContent).toBe("");
    } finally {
      document
        .querySelectorAll(".monaco-aria-container")
        .forEach((element) => element.remove());
      vi.useRealTimers();
    }
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

  it("passes the minimap setting to Monaco and updates it without remounting", async () => {
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
    const editor = createEditor(model);
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = createMonaco(model);

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          minimapEnabled: false,
        }),
      );
      await Promise.resolve();
    });

    const editorElement = host.querySelector('[data-testid="monaco-editor"]');
    expect(editorSurfaceMocks.props?.options).toEqual(
      expect.objectContaining({ minimap: { enabled: false } }),
    );
    editor.updateOptions.mockClear();

    await act(async () => {
      root.render(
        createElement(EditorSurface, {
          ...memoGuardProps(activeDocument),
          minimapEnabled: true,
        }),
      );
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="monaco-editor"]')).toBe(
      editorElement,
    );
    expect(editorSurfaceMocks.props?.options).toEqual(
      expect.objectContaining({ minimap: { enabled: true } }),
    );
    expect(editor.updateOptions).toHaveBeenCalledWith(
      expect.objectContaining({ minimap: { enabled: true } }),
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

  it("maps a blamed line to its committed sha", () => {
    const lines = [
      { author: "Alice", lineNumber: 2, sha: "abc1234", timestamp: 1 },
      { author: "You", lineNumber: 3, sha: "0000000", timestamp: 0 },
    ];

    expect(gitBlameShaAtLine(lines, 2)).toBe("abc1234");
    expect(gitBlameShaAtLine(lines, 3)).toBeNull();
    expect(gitBlameShaAtLine(lines, 4)).toBeNull();
  });

  it("opens the blamed commit when its before annotation is clicked", async () => {
    const activeDocument: EditorDocument = {
      content: "const one = 1;\nconst two = 2;\n",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: "",
    };
    const model: FakeModel = {
      getLineCount: vi.fn(() => 2),
      getValue: vi.fn(() => activeDocument.content),
      isDisposed: vi.fn(() => false),
      uri: { fsPath: activeDocument.path, path: activeDocument.path },
    };
    const monaco = createMonaco(model);
    const editor = createEditor(model);
    const onRevealGitBlameCommit = vi.fn();
    editorSurfaceMocks.editor = editor;
    editorSurfaceMocks.monaco = monaco;

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
          onRevealGitBlameCommit={onRevealGitBlameCommit}
          onRevealTargetHandled={vi.fn()}
          onRevertChangeHunk={vi.fn()}
          phpSyntaxDiagnosticsGateway={{ validate: vi.fn(async () => []) }}
          provideGitBlame={vi.fn(async () => [
            {
              author: "Alice",
              lineNumber: 2,
              sha: "abc1234",
              timestamp: 1,
            },
          ])}
          providePhpMethodCompletions={vi.fn(async () => [])}
          providePhpMethodSignature={vi.fn(async () => null)}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const annotation = document.createElement("span");
    annotation.className = "git-blame-annotation";
    act(() => {
      editor.mouseDownHandler?.({
        event: {
          leftButton: true,
          preventDefault,
          stopPropagation,
        },
        target: {
          element: annotation,
          position: { column: 1, lineNumber: 2 },
          type: monaco.editor.MouseTargetType.CONTENT_TEXT,
        },
      });
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(onRevealGitBlameCommit).toHaveBeenCalledWith(
      activeDocument.path,
      "abc1234",
    );
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

describe("EditorSurface .editorconfig application", () => {
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

  function editorConfigModel(path: string): FakeModel & {
    updateOptions: ReturnType<typeof vi.fn>;
    setEOL: ReturnType<typeof vi.fn>;
  } {
    return {
      updateOptions: vi.fn(),
      setEOL: vi.fn(),
      uri: { fsPath: path, path },
    } as FakeModel & {
      updateOptions: ReturnType<typeof vi.fn>;
      setEOL: ReturnType<typeof vi.fn>;
    };
  }

  function monacoWithEol(model: FakeModel) {
    const monaco = createMonaco(model) as ReturnType<typeof createMonaco> & {
      editor: { EndOfLineSequence: { LF: number; CRLF: number } };
    };
    monaco.editor.EndOfLineSequence = { LF: 0, CRLF: 1 };
    return monaco;
  }

  async function renderSurface(
    activeDocument: EditorDocument,
    editorConfig: ResolvedEditorConfig | undefined,
  ): Promise<void> {
    await act(async () => {
      root.render(
        <EditorSurface
          activeDocument={activeDocument}
          editorConfig={editorConfig}
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
  }

  const phpDocument: EditorDocument = {
    content: "<?php\nclass Example {}\n",
    language: "php",
    name: "Example.php",
    path: "/workspace/app/Example.php",
    savedContent: "",
  };

  it("applies space indent_style/indent_size to the active model", async () => {
    const model = editorConfigModel(phpDocument.path);
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = monacoWithEol(model);

    await renderSurface(phpDocument, {
      indentStyle: "space",
      indentSize: 4,
      tabWidth: 4,
    });

    expect(model.updateOptions).toHaveBeenCalledWith({
      insertSpaces: true,
      tabSize: 4,
    });
  });

  it("applies tab indent_style using tab_width", async () => {
    const model = editorConfigModel(phpDocument.path);
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = monacoWithEol(model);

    await renderSurface(phpDocument, {
      indentStyle: "tab",
      indentSize: 4,
      tabWidth: 4,
    });

    expect(model.updateOptions).toHaveBeenCalledWith({
      insertSpaces: false,
      tabSize: 4,
    });
  });

  it("sets the model EOL from end_of_line", async () => {
    const model = editorConfigModel(phpDocument.path);
    editorSurfaceMocks.editor = createEditor(model);
    const monaco = monacoWithEol(model);
    editorSurfaceMocks.monaco = monaco;

    await renderSurface(phpDocument, { endOfLine: "crlf" });

    expect(model.setEOL).toHaveBeenCalledWith(
      monaco.editor.EndOfLineSequence.CRLF,
    );
  });

  it("does not override indentation or EOL when editorConfig is empty", async () => {
    const model = editorConfigModel(phpDocument.path);
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = monacoWithEol(model);

    await renderSurface(phpDocument, {});

    expect(model.updateOptions).not.toHaveBeenCalled();
    expect(model.setEOL).not.toHaveBeenCalled();
  });

  it("does not override when editorConfig prop is omitted", async () => {
    const model = editorConfigModel(phpDocument.path);
    editorSurfaceMocks.editor = createEditor(model);
    editorSurfaceMocks.monaco = monacoWithEol(model);

    await renderSurface(phpDocument, undefined);

    expect(model.updateOptions).not.toHaveBeenCalled();
    expect(model.setEOL).not.toHaveBeenCalled();
  });
});

function memoGuardProps(
  activeDocument: EditorDocument,
  overrides: Partial<{
    onCloseFloatingSurface: () => boolean;
    onEditorFocused: () => void;
  }> = {},
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
    onCloseFloatingSurface: overrides.onCloseFloatingSurface,
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
  overrides: Partial<{
    onCloseFloatingSurface: () => boolean;
    onEditorFocused: () => void;
  }> = {},
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

function createFoldingModel(
  initialRegions: Array<{ collapsed: boolean; start: number }>,
): FakeFoldingModel {
  let changeHandler: (() => void) | null = null;
  let source = initialRegions;
  const model: FakeFoldingModel = {
    emitChange: () => changeHandler?.(),
    onDidChange: vi.fn((handler: () => void) => {
      changeHandler = handler;

      return {
        dispose: vi.fn(() => {
          if (changeHandler === handler) {
            changeHandler = null;
          }
        }),
      };
    }),
    regions: {
      get length() {
        return source.length;
      },
      getStartLineNumber: (index: number) => source[index].start,
      isCollapsed: (index: number) => source[index].collapsed,
      toRegion: (index: number) => ({
        get isCollapsed() {
          return source[index].collapsed;
        },
        regionIndex: index,
        startLineNumber: source[index].start,
      }),
    },
    setRegions: (next) => {
      source = next;
    },
    toggleCollapseState: vi.fn((regions: FakeFoldingRegion[]) => {
      for (const region of regions) {
        source[region.regionIndex].collapsed =
          !source[region.regionIndex].collapsed;
      }
    }),
  };

  return model;
}

function createEditor(model: FakeModel): FakeEditor {
  // A real Monaco ITextModel always exposes getValue/setValue. Backfill them on
  // any fake model that omits them so the surface's deterministic content sync
  // can read and reconcile the buffer just as it does in production.
  if (!model.getValue || !model.setValue) {
    const existingGetValue = model.getValue as (() => string) | undefined;
    let buffer = existingGetValue ? existingGetValue() : "";
    model.getValue = model.getValue ?? vi.fn(() => buffer);
    model.setValue =
      model.setValue ??
      vi.fn((next: string) => {
        buffer = next;
      });
  }

  let selection: {
    endColumn: number;
    endLineNumber: number;
    startColumn: number;
    startLineNumber: number;
  } | null = null;
  let position: EditorPosition = {
    column: 1,
    lineNumber: 1,
  };
  // Monaco's built-in Cmd/Ctrl definition gesture lives in the
  // `editor.contrib.gotodefinitionatposition` contribution. The surface does NOT
  // dispose it (that crashes Monaco's event delivery); instead it replaces the
  // contribution's `gotoDefinition` method with a no-op so a Cmd-hover never
  // navigates while every listener stays wired. Model that here: the live
  // contribution exposes a `gotoDefinition` that, by default, records a
  // navigation via `gotoDefinitionContributionNavigate`. After the surface
  // patches it, invoking the method must NOT record a navigation.
  const gotoDefinitionContributionDispose = vi.fn();
  const gotoDefinitionContributionNavigate = vi.fn(
    (..._args: unknown[]) => Promise.resolve(),
  );
  const gotoDefinitionContribution: {
    dispose: typeof gotoDefinitionContributionDispose;
    gotoDefinition: (...args: unknown[]) => Promise<void>;
  } = {
    dispose: gotoDefinitionContributionDispose,
    gotoDefinition: (...args: unknown[]) =>
      gotoDefinitionContributionNavigate(...args),
  };
  const domNode = document.createElement("div");
  const editor: FakeEditor = {
    addAction: vi.fn(() => ({ dispose: vi.fn() })),
    deltaDecorations: vi.fn((_oldDecorations: string[], decorations: any[]) =>
      decorations.map((_, index) => `implementation-gutter-${index}`),
    ),
    executeEdits: vi.fn(),
    focus: vi.fn(),
    getContribution: vi.fn((id?: string) => {
      if (id === "editor.contrib.gotodefinitionatposition") {
        return gotoDefinitionContribution;
      }

      return { insert: vi.fn() };
    }),
    gotoDefinitionContribution,
    gotoDefinitionContributionDispose,
    gotoDefinitionContributionNavigate,
    getDomNode: vi.fn(() => domNode),
    getLayoutInfo: vi.fn(() => ({
      contentLeft: 80,
      height: 480,
      width: 900,
    })),
    getModel: vi.fn(() => model),
    getPosition: vi.fn(() => position),
    getSelection: vi.fn(() => selection),
    getScrollTop: vi.fn(() => 10),
    getTopForLineNumber: vi.fn((lineNumber: number) => lineNumber * 20),
    cursorPositionHandler: null,
    keyDownHandler: null,
    mouseDownHandler: null,
    mouseMoveHandler: null,
    modelContentChangeHandler: null,
    modelContentChangeHandlers: [],
    modelChangeHandler: null,
    modelChangeHandlers: [],
    onDidChangeCursorPosition: vi.fn(
      (handler: (event: { position: EditorPosition }) => void) => {
        editor.cursorPositionHandler = handler;

        return { dispose: vi.fn() };
      },
    ),
    onDidChangeModel: vi.fn((handler: () => void) => {
      editor.modelChangeHandlers.push(handler);
      editor.modelChangeHandler = () => {
        editor.modelChangeHandlers.forEach((registeredHandler) =>
          registeredHandler(),
        );
      };

      return {
        dispose: vi.fn(() => {
          editor.modelChangeHandlers = editor.modelChangeHandlers.filter(
            (registeredHandler) => registeredHandler !== handler,
          );
        }),
      };
    }),
    onDidChangeModelContent: vi.fn(
      (
        handler: (event: {
          changes: Array<{
            range?: {
              startLineNumber: number;
            };
            text: string;
          }>;
        }) => void,
      ) => {
        editor.modelContentChangeHandlers.push(handler);
        editor.modelContentChangeHandler = (event) => {
          editor.modelContentChangeHandlers.forEach((registeredHandler) =>
            registeredHandler(event),
          );
        };

        return {
          dispose: vi.fn(() => {
            editor.modelContentChangeHandlers =
              editor.modelContentChangeHandlers.filter(
                (registeredHandler) => registeredHandler !== handler,
              );
          }),
        };
      },
    ),
    onDidScrollChange: vi.fn(() => ({ dispose: vi.fn() })),
    onKeyDown: vi.fn((handler: (event: FakeKeyDownEvent) => void) => {
      editor.keyDownHandler = handler;

      return { dispose: vi.fn() };
    }),
    onMouseDown: vi.fn((handler: (event: FakeMouseDownEvent) => void) => {
      editor.mouseDownHandler = handler;

      return { dispose: vi.fn() };
    }),
    onMouseMove: vi.fn((handler: (event: FakeMouseDownEvent) => void) => {
      editor.mouseMoveHandler = handler;

      return { dispose: vi.fn() };
    }),
    revealPositionInCenter: vi.fn(),
    setPosition: vi.fn((nextPosition: EditorPosition) => {
      position = nextPosition;
    }),
    setSelection: vi.fn((nextSelection) => {
      selection = nextSelection;
    }),
    setScrollTop: vi.fn(),
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
      Escape: 91,
      Equal: 86,
      F2: 60,
      F5: 63,
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
      Minus: 88,
      Period: 89,
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

function memoryLocalStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => {
      values.clear();
    }),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  reject(error: unknown): void;
  resolve(value: T): void;
} {
  let reject!: (error: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
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
    willCreateFiles: vi.fn(async () => null),
    willDeleteFiles: vi.fn(async () => null),
    willRenameFiles: vi.fn(async () => null),
    workspaceSymbols: vi.fn(async () => []),
  };
}
