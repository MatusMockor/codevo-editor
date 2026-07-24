// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import type { DebugInlineValueContext } from "../application/debugInlineValueContext";
import type { EditorDocument } from "../domain/workspace";
import {
  createDebugVariablePagesState,
  reduceDebugVariablePages,
} from "../domain/debugVariablePages";
import {
  createDebugInlineValueDecorations,
  useDebugInlineValueDecorations,
} from "./useDebugInlineValueDecorations";
import { debugInlineSourceAdmissionCoordinator } from "./debugInlineSourceAdmissionCoordinator";

beforeEach(() => debugInlineSourceAdmissionCoordinator.clear());

const owner = { rootKey: "/workspace", sessionId: 4, pauseGeneration: 2, frameId: 11 };

function document(overrides: Partial<EditorDocument> = {}): EditorDocument {
  const content = "const count = total + count;\n";
  return {
    content,
    language: "typescript",
    name: "main.ts",
    path: "/workspace/main.ts",
    savedContent: content,
    ...overrides,
  };
}

function context(overrides: Partial<DebugInlineValueContext> = {}): DebugInlineValueContext {
  const contextOwner = overrides.owner ?? owner;
  let variablePages = createDebugVariablePagesState(contextOwner);
  variablePages = reduceDebugVariablePages(variablePages, {
    type: "request",
    owner: contextOwner,
    variablesReference: 21,
    start: 0,
    requestId: "inline-request",
  });
  variablePages = reduceDebugVariablePages(variablePages, {
    type: "resolve",
    owner: contextOwner,
    variablesReference: 21,
    start: 0,
    requestId: "inline-request",
    result: {
      variablesReference: 21,
      start: 0,
      variables: [
        { name: "count", value: "4", variablesReference: 0 },
        { name: "total", value: "9", variablesReference: 0 },
      ],
      nextStart: null,
    },
  });
  return {
    filePath: "/workspace/main.ts",
    lineNumber: 1,
    owner: contextOwner,
    scopes: [{ name: "Locals", variablesReference: 21, expensive: false }],
    variablePages,
    ...overrides,
  };
}

function runtime(source = document().content) {
  const model = {
    getLineCount: vi.fn(() => source.split("\n").length),
    getValue: vi.fn(() => source),
  } as unknown as Monaco.editor.ITextModel;
  class Range {
    constructor(
      readonly startLineNumber: number,
      readonly startColumn: number,
      readonly endLineNumber: number,
      readonly endColumn: number,
    ) {}
  }
  const monaco = {
    Range,
    editor: { TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 } },
  } as unknown as typeof Monaco;
  const deltaDecorations = vi.fn((_: string[], decorations: unknown[]) =>
    decorations.map((__, index) => `inline-${index}`),
  );
  const editor = {
    deltaDecorations,
    getModel: vi.fn(() => model),
  } as unknown as Monaco.editor.IStandaloneCodeEditor;
  return { deltaDecorations, editor, model, monaco };
}

describe("createDebugInlineValueDecorations", () => {
  it("maps cached values to after-content with non-growing ranges", () => {
    const { model, monaco } = runtime();
    const decorations = createDebugInlineValueDecorations({
      activeDocument: document(),
      context: context(),
      model,
      monaco,
      workspaceRoot: "/workspace/",
    });

    expect(decorations).toHaveLength(2);
    expect(decorations.map(({ options }) => options.after?.content)).toEqual([" = 4", " = 9"]);
    expect(decorations[0]?.options.stickiness).toBe(1);
    expect(decorations[0]?.range).toEqual(
      expect.objectContaining({ startColumn: 7, endColumn: 12, startLineNumber: 1 }),
    );
  });

  it.each([
    ["dirty document", document({ content: "const count = 5;\n" }), context(), "/workspace"],
    ["unsupported language", document({ language: "php" }), context(), "/workspace"],
    ["different path", document(), context({ filePath: "/workspace/other.ts" }), "/workspace"],
    ["different root", document(), context(), "/other"],
    ["out-of-bounds line", document(), context({ lineNumber: 99 }), "/workspace"],
  ])("fails closed for %s", (_, activeDocument, inlineContext, workspaceRoot) => {
    const { model, monaco } = runtime(activeDocument.content);
    expect(
      createDebugInlineValueDecorations({
        activeDocument,
        context: inlineContext,
        model,
        monaco,
        workspaceRoot,
      }),
    ).toEqual([]);
  });

  it.each(["javascript", "javascriptreact", "typescript", "typescriptreact"])(
    "supports the %s Monaco language",
    (language) => {
      const activeDocument = document({ language });
      const { model, monaco } = runtime(activeDocument.content);
      expect(
        createDebugInlineValueDecorations({
          activeDocument,
          context: context(),
          model,
          monaco,
          workspaceRoot: "/workspace",
        }),
      ).not.toEqual([]);
    },
  );
});

describe("useDebugInlineValueDecorations", () => {
  it("owns only its decoration ids and clears on resume and unmount", () => {
    const host = window.document.createElement("div");
    const root = createRoot(host);
    const { deltaDecorations, editor, model, monaco } = runtime();
    let inlineContext: DebugInlineValueContext | null = context();
    function Harness() {
      useDebugInlineValueDecorations({
        activeDocument: document(),
        context: inlineContext,
        editor,
        model,
        monaco,
        workspaceRoot: "/workspace",
      });
      return null;
    }

    act(() => root.render(<Harness />));
    expect(deltaDecorations).toHaveBeenLastCalledWith([], expect.any(Array));
    inlineContext = null;
    act(() => root.render(<Harness />));
    expect(deltaDecorations).toHaveBeenCalledWith(["inline-0", "inline-1"], []);
    act(() => root.unmount());
    expect(deltaDecorations).toHaveBeenLastCalledWith(["inline-0", "inline-1"], []);
  });

  it("does not decorate a model that is not mounted in this split editor", () => {
    const host = window.document.createElement("div");
    const root = createRoot(host);
    const { deltaDecorations, editor, model, monaco } = runtime();
    vi.mocked(editor.getModel).mockReturnValue({} as Monaco.editor.ITextModel);
    function Harness() {
      useDebugInlineValueDecorations({
        activeDocument: document(),
        context: context(),
        editor,
        model,
        monaco,
        workspaceRoot: "/workspace",
      });
      return null;
    }

    act(() => root.render(<Harness />));
    expect(deltaDecorations).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("keeps a dirty stopped source cleared after it is saved during the same pause", () => {
    const host = window.document.createElement("div");
    const root = createRoot(host);
    const { deltaDecorations, editor, model, monaco } = runtime();
    let activeDocument = document();
    function Harness() {
      useDebugInlineValueDecorations({
        activeDocument,
        context: context(),
        editor,
        model,
        monaco,
        workspaceRoot: "/workspace",
      });
      return null;
    }
    act(() => root.render(<Harness />));
    const edited = "const count = total + 1;\n";
    activeDocument = document({ content: edited });
    vi.mocked(model.getValue).mockReturnValue(edited);
    act(() => root.render(<Harness />));
    activeDocument = document({ content: edited, savedContent: edited });
    act(() => root.render(<Harness />));

    expect(deltaDecorations).toHaveBeenLastCalledWith(["inline-0", "inline-1"], []);
    expect(deltaDecorations).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
  });

  it("keeps an externally reloaded clean source cleared during the same pause", () => {
    const host = window.document.createElement("div");
    const root = createRoot(host);
    const { deltaDecorations, editor, model, monaco } = runtime();
    let activeDocument = document();
    function Harness() {
      useDebugInlineValueDecorations({
        activeDocument,
        context: context(),
        editor,
        model,
        monaco,
        workspaceRoot: "/workspace",
      });
      return null;
    }
    act(() => root.render(<Harness />));
    const reloaded = "const count = total + 2;\n";
    activeDocument = document({ content: reloaded, savedContent: reloaded });
    vi.mocked(model.getValue).mockReturnValue(reloaded);
    act(() => root.render(<Harness />));

    expect(deltaDecorations).toHaveBeenLastCalledWith(["inline-0", "inline-1"], []);
    act(() => root.unmount());
  });

  it("invalidates a same-path model replacement but admits a first clean split model", () => {
    const host = window.document.createElement("div");
    const root = createRoot(host);
    const first = runtime();
    const replacement = runtime();
    let model = first.model;
    vi.mocked(first.editor.getModel).mockImplementation(() => model);
    function Harness() {
      useDebugInlineValueDecorations({
        activeDocument: document(),
        context: context(),
        editor: first.editor,
        model,
        monaco: first.monaco,
        workspaceRoot: "/workspace",
      });
      return null;
    }
    act(() => root.render(<Harness />));
    model = replacement.model;
    act(() => root.render(<Harness />));

    expect(first.deltaDecorations).toHaveBeenLastCalledWith(["inline-0", "inline-1"], []);
    act(() => root.unmount());

    const splitHost = window.document.createElement("div");
    const splitRoot = createRoot(splitHost);
    const nextContext = context({ owner: { ...owner, pauseGeneration: 3 } });
    function SplitHarness() {
      useDebugInlineValueDecorations({
        activeDocument: document(),
        context: nextContext,
        editor: replacement.editor,
        model: replacement.model,
        monaco: replacement.monaco,
        workspaceRoot: "/workspace",
      });
      return null;
    }
    act(() => splitRoot.render(<SplitHarness />));
    expect(replacement.deltaDecorations).toHaveBeenCalledWith([], expect.any(Array));
    act(() => splitRoot.unmount());
  });

  it("retains source invalidation through trust revoke and restore", () => {
    const host = window.document.createElement("div");
    const root = createRoot(host);
    const { deltaDecorations, editor, model, monaco } = runtime();
    let activeDocument = document();
    let inlineContext: DebugInlineValueContext | null = context();
    function Harness() {
      useDebugInlineValueDecorations({
        activeDocument,
        context: inlineContext,
        editor,
        model,
        monaco,
        workspaceRoot: "/workspace",
      });
      return null;
    }
    act(() => root.render(<Harness />));
    inlineContext = null;
    act(() => root.render(<Harness />));
    const edited = "const count = total + 3;\n";
    activeDocument = document({ content: edited, savedContent: edited });
    vi.mocked(model.getValue).mockReturnValue(edited);
    act(() => root.render(<Harness />));
    inlineContext = context();
    act(() => root.render(<Harness />));

    expect(deltaDecorations).toHaveBeenCalledTimes(2);
    expect(deltaDecorations).toHaveBeenLastCalledWith(["inline-0", "inline-1"], []);
    act(() => root.unmount());
  });

  it("retains admission through unmount and rejects a changed source on remount", () => {
    const firstHost = window.document.createElement("div");
    const firstRoot = createRoot(firstHost);
    const { deltaDecorations, editor, model, monaco } = runtime();
    const inlineContext = context();
    function Harness({ activeDocument }: { activeDocument: EditorDocument }) {
      useDebugInlineValueDecorations({
        activeDocument,
        context: inlineContext,
        editor,
        model,
        monaco,
        workspaceRoot: "/workspace",
      });
      return null;
    }
    act(() => firstRoot.render(<Harness activeDocument={document()} />));
    act(() => firstRoot.unmount());
    const edited = "const count = total + 4;\n";
    vi.mocked(model.getValue).mockReturnValue(edited);
    const secondRoot = createRoot(window.document.createElement("div"));
    act(() =>
      secondRoot.render(
        <Harness activeDocument={document({ content: edited, savedContent: edited })} />,
      ),
    );

    expect(deltaDecorations).toHaveBeenCalledTimes(2);
    expect(deltaDecorations).toHaveBeenLastCalledWith(["inline-0", "inline-1"], []);
    act(() => secondRoot.unmount());
  });
});
