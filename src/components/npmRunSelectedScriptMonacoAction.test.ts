import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import type { EditorDocument } from "../domain/workspace";
import {
  captureNpmRunSelectedScriptContext,
  isNpmPackageManifestPath,
  registerNpmRunSelectedScriptMonacoAction,
} from "./npmRunSelectedScriptMonacoAction";

describe("npm run-selected-script Monaco action", () => {
  it("recognizes package manifests across native path flavors", () => {
    expect(isNpmPackageManifestPath("/workspace/apps/web/package.json")).toBe(true);
    expect(isNpmPackageManifestPath("C:\\workspace\\package.json")).toBe(true);
    expect(isNpmPackageManifestPath("/workspace/package-lock.json")).toBe(false);
    expect(isNpmPackageManifestPath(null)).toBe(false);
  });

  it("captures the live dirty buffer and cursor as one immutable tuple", () => {
    const harness = createEditorHarness('{"scripts":{"dev":"vite"}}');
    const activeDocumentRef = {
      current: document("/workspace/package.json", "saved content"),
    };
    const workspaceRootRef = { current: "/workspace" };

    const capture = captureNpmRunSelectedScriptContext({
      activeDocumentRef,
      editor: harness.editor,
      modelMatchesDocument: () => true,
      workspaceRootRef,
    });

    expect(capture).toEqual({
      anchorOffset: 4,
      content: '{"scripts":{"dev":"vite"}}',
      documentPath: "/workspace/package.json",
      modelIdentity: harness.model,
      modelVersion: 7,
    });
    expect(Object.isFrozen(capture)).toBe(true);
  });

  it.each([
    ["forward", selection(1, 5, 1, 12), { column: 5, lineNumber: 1 }],
    ["reversed", selection(1, 12, 1, 5), { column: 12, lineNumber: 1 }],
  ])("uses the %s selection anchor", (_label, selected, expectedAnchor) => {
    const harness = captureHarness();
    harness.editorHarness.getSelection.mockReturnValue(selected);

    expect(
      captureNpmRunSelectedScriptContext({
        activeDocumentRef: harness.activeDocumentRef,
        editor: harness.editorHarness.editor,
        modelMatchesDocument: () => true,
        workspaceRootRef: harness.workspaceRootRef,
      }),
    ).not.toBeNull();
    expect(harness.editorHarness.getOffsetAt).toHaveBeenCalledWith(expectedAnchor);
  });

  it.each([
    ["read-only document", (h: ReturnType<typeof captureHarness>) => (h.document.readOnly = true)],
    [
      "non-manifest",
      (h: ReturnType<typeof captureHarness>) => (h.document.path = "/workspace/app.json"),
    ],
    [
      "model drift",
      (h: ReturnType<typeof captureHarness>) =>
        h.editorHarness.getModel
          .mockReturnValueOnce(h.editorHarness.model)
          .mockReturnValueOnce(null),
    ],
    [
      "version drift",
      (h: ReturnType<typeof captureHarness>) =>
        h.editorHarness.getVersionId.mockReturnValueOnce(7).mockReturnValueOnce(8),
    ],
    [
      "selection anchor drift",
      (h: ReturnType<typeof captureHarness>) =>
        h.editorHarness.getSelection
          .mockReturnValueOnce(selection(1, 5, 1, 5))
          .mockReturnValueOnce(selection(1, 6, 1, 6)),
    ],
    [
      "document drift",
      (h: ReturnType<typeof captureHarness>) =>
        h.editorHarness.getValue.mockImplementation(() => {
          h.activeDocumentRef.current = document("/workspace/other/package.json", "");
          return h.editorHarness.source;
        }),
    ],
    [
      "root drift",
      (h: ReturnType<typeof captureHarness>) =>
        h.editorHarness.getValue.mockImplementation(() => {
          h.workspaceRootRef.current = "/other";
          return h.editorHarness.source;
        }),
    ],
  ])("fails closed on %s", (_label, drift) => {
    const harness = captureHarness();
    drift(harness);
    expect(
      captureNpmRunSelectedScriptContext({
        activeDocumentRef: harness.activeDocumentRef,
        editor: harness.editorHarness.editor,
        modelMatchesDocument: () => true,
        workspaceRootRef: harness.workspaceRootRef,
      }),
    ).toBeNull();
  });

  it("registers the official context-only action and delegates a fresh capture", async () => {
    const harness = captureHarness();
    const run = vi.fn();
    const disposable = registerNpmRunSelectedScriptMonacoAction({
      activeDocumentRef: harness.activeDocumentRef,
      editor: harness.editorHarness.editor,
      keybindings: [42],
      modelMatchesDocument: () => true,
      run,
      workspaceRootRef: harness.workspaceRootRef,
    });
    const action = harness.editorHarness.addAction.mock.calls[0]?.[0];

    expect(action).toMatchObject({
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1,
      id: "npm.runSelectedScript",
      keybindings: [42],
      label: "Run Script",
      precondition: "!editorReadonly",
    });
    await action?.run(harness.editorHarness.editor);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ anchorOffset: 4 }));
    disposable.dispose();
    expect(harness.editorHarness.dispose).toHaveBeenCalledOnce();
  });
});

function captureHarness() {
  const editorHarness = createEditorHarness('{"scripts":{"dev":"vite"}}');
  const activeDocumentRef = { current: document("/workspace/package.json", "saved") };
  const workspaceRootRef = { current: "/workspace" as string | null | undefined };
  return {
    activeDocumentRef,
    document: activeDocumentRef.current,
    editorHarness,
    workspaceRootRef,
  };
}

function createEditorHarness(source: string) {
  const dispose = vi.fn();
  const addAction = vi.fn((_descriptor: Monaco.editor.IActionDescriptor) => ({ dispose }));
  const getModel = vi.fn();
  const getSelection = vi.fn(() => selection(1, 5, 1, 5));
  const getVersionId = vi.fn(() => 7);
  const getValue = vi.fn(() => source);
  const getOffsetAt = vi.fn(() => 4);
  const model = { getOffsetAt, getValue, getVersionId } as unknown as Monaco.editor.ITextModel;
  getModel.mockReturnValue(model);
  const editor = {
    addAction,
    getModel,
    getSelection,
  } as unknown as Monaco.editor.IStandaloneCodeEditor;
  return {
    addAction,
    dispose,
    editor,
    getModel,
    getOffsetAt,
    getSelection,
    getValue,
    getVersionId,
    model,
    source,
  };
}

function selection(
  selectionStartLineNumber: number,
  selectionStartColumn: number,
  positionLineNumber: number,
  positionColumn: number,
): Monaco.Selection {
  return {
    endColumn: Math.max(selectionStartColumn, positionColumn),
    endLineNumber: Math.max(selectionStartLineNumber, positionLineNumber),
    positionColumn,
    positionLineNumber,
    selectionStartColumn,
    selectionStartLineNumber,
    startColumn: Math.min(selectionStartColumn, positionColumn),
    startLineNumber: Math.min(selectionStartLineNumber, positionLineNumber),
  } as Monaco.Selection;
}

function document(path: string, savedContent: string): EditorDocument {
  return {
    content: savedContent,
    language: "json",
    name: "package.json",
    path,
    readOnly: false,
    savedContent,
  };
}
