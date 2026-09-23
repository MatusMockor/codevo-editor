// @vitest-environment jsdom

import { act, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type * as Monaco from "monaco-editor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorPosition, EditorRevealTarget } from "../../domain/languageServerFeatures";
import type { WorkspaceSessionViewState } from "../../domain/settings";
import type { EditorDocument } from "../../domain/workspace";
import { useEditorModelViewStateLifecycle } from "./useEditorModelViewStateLifecycle";
import { useEditorNavigationLifecycle } from "./useEditorNavigationLifecycle";

const WORKSPACE_ROOT = "/workspace";
const PATH_A = "/workspace/src/a.ts";
const PATH_B = "/workspace/src/sum.ts";
const CONTENT = "one\ntwo\nthree\nfour\nfive\n";

interface FakeTextModel {
  readonly uri: {
    readonly fsPath: string;
    readonly path: string;
    readonly scheme: string;
    toString(): string;
  };
  getLineCount(): number;
  getLineMaxColumn(lineNumber: number): number;
  getValue(): string;
  isDisposed(): boolean;
  setValue(value: string): void;
}

interface FakeCodeEditor {
  readonly focus: ReturnType<typeof vi.fn>;
  readonly revealPositionInCenter: ReturnType<typeof vi.fn>;
  readonly setPosition: ReturnType<typeof vi.fn>;
  readonly setScrollTop: ReturnType<typeof vi.fn>;
  getContribution(): null;
  getDomNode(): null;
  getModel(): FakeTextModel | null;
  getPosition(): EditorPosition;
  onDidChangeModel(listener: () => void): { dispose(): void };
  setModel(model: FakeTextModel): void;
}

function createModel(path: string): FakeTextModel {
  let value = CONTENT;
  return {
    uri: { fsPath: path, path, scheme: "file", toString: () => `file://${path}` },
    getLineCount: () => value.split("\n").length,
    getLineMaxColumn: (lineNumber) => (value.split("\n")[lineNumber - 1]?.length ?? 0) + 1,
    getValue: () => value,
    isDisposed: () => false,
    setValue: (next) => {
      value = next;
    },
  };
}

function createEditor(): FakeCodeEditor {
  let model: FakeTextModel | null = null;
  let position: EditorPosition = { column: 1, lineNumber: 1 };
  const listeners = new Set<() => void>();
  return {
    focus: vi.fn(),
    revealPositionInCenter: vi.fn(),
    setPosition: vi.fn((next: EditorPosition) => {
      position = next;
    }),
    setScrollTop: vi.fn(),
    getContribution: () => null,
    getDomNode: () => null,
    getModel: () => model,
    getPosition: () => position,
    onDidChangeModel: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    setModel: (next) => {
      model = next;
      position = { column: 1, lineNumber: 1 };
      [...listeners].forEach((listener) => listener());
    },
  };
}

function editorDocument(path: string): EditorDocument {
  return {
    content: CONTENT,
    language: "typescript",
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    savedContent: CONTENT,
  };
}

function MonacoModelBinder({
  editor,
  models,
  path,
}: {
  readonly editor: FakeCodeEditor;
  readonly models: ReadonlyMap<string, FakeTextModel>;
  readonly path: string;
}) {
  useEffect(() => {
    const model = models.get(path);
    if (!model || editor.getModel() === model) {
      return;
    }
    editor.setModel(model);
  }, [editor, models, path]);
  return null;
}

interface HarnessProps {
  readonly document: EditorDocument;
  readonly editor: FakeCodeEditor;
  readonly models: ReadonlyMap<string, FakeTextModel>;
  readonly onRevealTargetHandled: (target: EditorRevealTarget) => void;
  readonly restoredViewStates: Record<string, WorkspaceSessionViewState>;
  readonly target: EditorRevealTarget | null;
}

function NavigationHarness({
  document,
  editor,
  models,
  onRevealTargetHandled,
  restoredViewStates,
  target,
}: HarnessProps) {
  const monacoEditor = editor as unknown as Monaco.editor.IStandaloneCodeEditor;
  const onViewStateChangeRef = useRef(undefined);
  const navigationViewportClaimRef = useEditorNavigationLifecycle({
    activeDocument: document,
    activeDocumentContentReady: true,
    editor: monacoEditor,
    editorRevealTarget: target,
    groupId: "editor-main",
    isOpeningFile: false,
    onRevealTargetHandled,
    runtime: null,
    transientWidgetDismissKey: undefined,
    workspaceRoot: WORKSPACE_ROOT,
  });
  useEditorModelViewStateLifecycle({
    activeDocumentPath: document.path,
    captureEnabled: false,
    editor: monacoEditor,
    navigationViewportClaimRef,
    onViewStateChangeRef,
    restoredViewStateRevision: 0,
    restoredViewStates,
    workspaceRoot: WORKSPACE_ROOT,
  });
  return <MonacoModelBinder editor={editor} models={models} path={document.path} />;
}

describe("useEditorNavigationLifecycle", () => {
  let host: HTMLDivElement;
  let root: Root;
  let editor: FakeCodeEditor;
  let models: ReadonlyMap<string, FakeTextModel>;
  let pendingTarget: EditorRevealTarget | null;
  let restoredViewStates: Record<string, WorkspaceSessionViewState>;

  const handled = vi.fn((target: EditorRevealTarget) => {
    if (pendingTarget === target) {
      pendingTarget = null;
    }
  });

  const render = (path: string, target: EditorRevealTarget | null) => {
    pendingTarget = target;
    act(() => {
      root.render(
        <NavigationHarness
          document={editorDocument(path)}
          editor={editor}
          models={models}
          onRevealTargetHandled={handled}
          restoredViewStates={restoredViewStates}
          target={target}
        />,
      );
    });
    act(() => {
      root.render(
        <NavigationHarness
          document={editorDocument(path)}
          editor={editor}
          models={models}
          onRevealTargetHandled={handled}
          restoredViewStates={restoredViewStates}
          target={pendingTarget}
        />,
      );
    });
  };

  const settle = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    editor = createEditor();
    models = new Map([
      [PATH_A, createModel(PATH_A)],
      [PATH_B, createModel(PATH_B)],
    ]);
    pendingTarget = null;
    restoredViewStates = { [PATH_B]: { column: 1, line: 1, scrollTop: 400 } };
    handled.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("reveals the requested line in a session-restored tab on the first navigation", async () => {
    render(PATH_A, { path: PATH_A, position: { column: 1, lineNumber: 3 } });
    expect(editor.getPosition()).toEqual({ column: 1, lineNumber: 3 });

    const targetB = { path: PATH_B, position: { column: 1, lineNumber: 2 } };
    render(PATH_B, targetB);
    await settle();

    expect(editor.getModel()).toBe(models.get(PATH_B));
    expect(editor.getPosition()).toEqual({ column: 1, lineNumber: 2 });
    expect(editor.revealPositionInCenter).toHaveBeenLastCalledWith({ column: 1, lineNumber: 2 });
    expect(editor.setScrollTop).not.toHaveBeenCalled();
    expect(handled).toHaveBeenLastCalledWith(targetB);
    expect(pendingTarget).toBeNull();
  });

  it("reveals a new line target when an already-open tab is reopened", async () => {
    render(PATH_A, null);
    render(PATH_B, { path: PATH_B, position: { column: 1, lineNumber: 2 } });
    render(PATH_A, null);
    expect(editor.getModel()).toBe(models.get(PATH_A));

    render(PATH_B, { path: PATH_B, position: { column: 2, lineNumber: 4 } });
    await settle();

    expect(editor.getPosition()).toEqual({ column: 2, lineNumber: 4 });
    expect(editor.setScrollTop).not.toHaveBeenCalled();
  });

  it("keeps a navigation reveal that lands after the persisted view was restored", async () => {
    restoredViewStates = { [PATH_B]: { column: 1, foldedLines: [2], line: 1, scrollTop: 400 } };
    render(PATH_A, null);
    act(() => {
      root.render(
        <NavigationHarness
          document={editorDocument(PATH_B)}
          editor={editor}
          models={models}
          onRevealTargetHandled={handled}
          restoredViewStates={restoredViewStates}
          target={null}
        />,
      );
    });
    expect(editor.setScrollTop).toHaveBeenCalledWith(400);
    editor.setScrollTop.mockClear();

    render(PATH_B, { path: PATH_B, position: { column: 1, lineNumber: 5 } });
    await settle();

    expect(editor.getPosition()).toEqual({ column: 1, lineNumber: 5 });
    expect(editor.setScrollTop).not.toHaveBeenCalled();
  });

  it("does not let a navigation claim suppress another document's restored view", async () => {
    restoredViewStates = { ...restoredViewStates, [PATH_A]: { column: 1, line: 4 } };
    render(PATH_B, { path: PATH_B, position: { column: 1, lineNumber: 2 } });
    act(() => {
      root.render(
        <NavigationHarness
          document={editorDocument(PATH_A)}
          editor={editor}
          models={models}
          onRevealTargetHandled={handled}
          restoredViewStates={restoredViewStates}
          target={null}
        />,
      );
    });
    await settle();

    expect(editor.getModel()).toBe(models.get(PATH_A));
    expect(editor.getPosition()).toEqual({ column: 1, lineNumber: 4 });
  });
});
