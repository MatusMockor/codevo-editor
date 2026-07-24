// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import type { DebugBreakpointRelocationCandidate } from "../application/debugSessionContracts";
import { useEditorBreakpointDecorations } from "./useEditorBreakpointDecorations";

describe("useEditorBreakpointDecorations", () => {
  it("drops invalid lines and clears decorations when the exact model swaps", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const modelA = {
      getDecorationRange: () => null,
      getLineCount: () => 3,
      getLineMaxColumn: () => 8,
      getVersionId: () => 1,
    } as unknown as Monaco.editor.ITextModel;
    const modelB = {
      getDecorationRange: () => null,
      getLineCount: () => 8,
      getLineMaxColumn: () => 20,
      getVersionId: () => 1,
    } as unknown as Monaco.editor.ITextModel;
    let currentModel: Monaco.editor.ITextModel | null = modelA;
    const deltaDecorations = vi.fn((_old: string[], decorations: unknown[]) =>
      decorations.map((_, index) => `d${index}`),
    );
    const editor = {
      deltaDecorations,
      getModel: () => currentModel,
      onDidChangeModelContent: () => ({ dispose: vi.fn() }),
    } as unknown as Monaco.editor.IStandaloneCodeEditor;
    const monaco = {
      Range: class {
        constructor(
          readonly startLineNumber: number,
          readonly startColumn: number,
          readonly endLineNumber: number,
          readonly endColumn: number,
        ) {}
      },
      editor: {
        GlyphMarginLane: { Left: 1 },
        TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
      },
    } as unknown as typeof Monaco;
    const breakpoints = [
      { enabled: true, filePath: "/workspace/app.ts", id: "zero", lineNumber: 0 },
      { enabled: true, filePath: "/workspace/app.ts", id: "valid", lineNumber: 2 },
      {
        columnNumber: 4,
        enabled: true,
        filePath: "/workspace/app.ts",
        id: "inline-a",
        lineNumber: 2,
      },
      {
        columnNumber: 7,
        enabled: true,
        filePath: "/workspace/app.ts",
        id: "inline-b",
        lineNumber: 2,
      },
      {
        columnNumber: 9,
        enabled: true,
        filePath: "/workspace/app.ts",
        id: "invalid-column",
        lineNumber: 2,
      },
      { enabled: true, filePath: "/workspace/app.ts", id: "past", lineNumber: 4 },
    ];
    function Harness({ model }: { model: Monaco.editor.ITextModel | null }) {
      useEditorBreakpointDecorations(editor, monaco, "/workspace/app.ts", model, breakpoints);
      return null;
    }
    act(() => root.render(<Harness model={modelA} />));
    const decorations = deltaDecorations.mock.calls[deltaDecorations.mock.calls.length - 1]?.[1];
    expect(decorations).toHaveLength(3);
    expect((decorations as any[])[0].range.startLineNumber).toBe(2);
    expect((decorations as any[]).map(({ range }) => range.startColumn)).toEqual([1, 4, 7]);
    currentModel = modelB;
    act(() => root.render(<Harness model={modelB} />));
    expect(deltaDecorations.mock.calls.some(([, decorations]) => decorations.length === 0)).toBe(
      true,
    );
    act(() => root.unmount());
  });

  it("backwrites same-line tracked ranges by exact sibling ID and fails closed when stale", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    let version = 1;
    let contentListener: (() => void) | null = null;
    let nextDecorationId = 1;
    const ranges = new Map<string, TestRange>();
    const model = {
      getDecorationRange: (id: string) => ranges.get(id) ?? null,
      getLineCount: () => 3,
      getLineMaxColumn: () => 20,
      getVersionId: () => version,
    } as unknown as Monaco.editor.ITextModel;
    const editor = {
      deltaDecorations(oldIds: string[], decorations: { range: TestRange }[]) {
        oldIds.forEach((id) => ranges.delete(id));
        return decorations.map(({ range }) => {
          const id = `tracked-${nextDecorationId++}`;
          ranges.set(id, range);
          return id;
        });
      },
      getModel: () => model,
      onDidChangeModelContent(listener: () => void) {
        contentListener = listener;
        return {
          dispose: () => {
            if (contentListener === listener) contentListener = null;
          },
        };
      },
    } as unknown as Monaco.editor.IStandaloneCodeEditor;
    const monaco = testMonaco();
    const relocateBreakpoint = vi.fn(
      async ({ breakpointId }: DebugBreakpointRelocationCandidate) => breakpointId === "inline-a",
    );
    const breakpoints = [
      { enabled: true, filePath: "/workspace/app.ts", id: "line", lineNumber: 2 },
      {
        columnNumber: 4,
        enabled: true,
        filePath: "/workspace/app.ts",
        id: "inline-a",
        lineNumber: 2,
      },
      {
        columnNumber: 7,
        enabled: true,
        filePath: "/workspace/app.ts",
        id: "inline-b",
        lineNumber: 2,
      },
    ];

    function Harness() {
      useEditorBreakpointDecorations(editor, monaco, "/workspace/app.ts", model, breakpoints, {
        relocateBreakpoint,
        workspaceOwnerKey: "owner-a",
        workspaceRoot: "/workspace",
      });
      return null;
    }

    act(() => root.render(<Harness />));
    const [lineId, inlineAId, inlineBId] = [...ranges.keys()];
    ranges.set(lineId!, new TestRange(2, 1, 2, 1));
    ranges.set(inlineAId!, new TestRange(2, 6, 2, 6));
    ranges.set(inlineBId!, new TestRange(2, 9, 2, 9));
    version = 2;
    act(() => contentListener?.());

    expect(relocateBreakpoint).toHaveBeenCalledTimes(2);
    const [candidateA, candidateB] = relocateBreakpoint.mock.calls.map(([candidate]) => candidate);
    expect(candidateA).toMatchObject({
      breakpointId: "inline-a",
      columnNumber: 6,
      filePath: "/workspace/app.ts",
      lineNumber: 2,
      workspaceOwnerKey: "owner-a",
      workspaceRoot: "/workspace",
    });
    expect(candidateB).toMatchObject({ breakpointId: "inline-b", columnNumber: 9 });
    expect(candidateA.isCurrent()).toBe(true);
    expect(candidateB.isCurrent()).toBe(true);
    await Promise.resolve();
    expect(relocateBreakpoint).toHaveBeenCalledTimes(2);

    version = 3;
    expect(candidateA.isCurrent()).toBe(false);
    act(() => root.unmount());
    expect(contentListener).toBeNull();
    expect(candidateB.isCurrent()).toBe(false);
  });

  it("preserves explicit inline column one instead of converting it to a line breakpoint", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    let listener: (() => void) | null = null;
    const ranges = new Map<string, TestRange>();
    const model = {
      getDecorationRange: (id: string) => ranges.get(id) ?? null,
      getLineCount: () => 2,
      getLineMaxColumn: () => 10,
      getVersionId: () => 2,
    } as unknown as Monaco.editor.ITextModel;
    const editor = {
      deltaDecorations(oldIds: string[], decorations: { range: TestRange }[]) {
        oldIds.forEach((id) => ranges.delete(id));
        return decorations.map(({ range }, index) => {
          const id = `id-${index}`;
          ranges.set(id, range);
          return id;
        });
      },
      getModel: () => model,
      onDidChangeModelContent(next: () => void) {
        listener = next;
        return { dispose: () => (listener = null) };
      },
    } as unknown as Monaco.editor.IStandaloneCodeEditor;
    const relocateBreakpoint = vi.fn(
      async (_candidate: DebugBreakpointRelocationCandidate) => false,
    );
    function Harness() {
      useEditorBreakpointDecorations(
        editor,
        testMonaco(),
        "/workspace/app.ts",
        model,
        [
          {
            columnNumber: 3,
            enabled: true,
            filePath: "/workspace/app.ts",
            id: "inline",
            lineNumber: 1,
          },
        ],
        {
          relocateBreakpoint,
          workspaceOwnerKey: "owner-a",
          workspaceRoot: "/workspace",
        },
      );
      return null;
    }
    act(() => root.render(<Harness />));
    ranges.set("id-0", new TestRange(1, 1, 1, 1));
    act(() => listener?.());
    const candidate = relocateBreakpoint.mock.calls[0]?.[0];
    expect(candidate).toHaveProperty("columnNumber", 1);
    act(() => root.unmount());
  });
});

class TestRange {
  constructor(
    readonly startLineNumber: number,
    readonly startColumn: number,
    readonly endLineNumber: number,
    readonly endColumn: number,
  ) {}
}

function testMonaco() {
  return {
    Range: TestRange,
    editor: {
      GlyphMarginLane: { Left: 1 },
      TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
    },
  } as unknown as typeof Monaco;
}
