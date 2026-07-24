import { describe, expect, it } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import { createDebugEvaluateInConsoleCaptureReader } from "./debugEvaluateInConsoleMonacoReader";

describe("debug Evaluate in Console Monaco reader", () => {
  it("captures exact selected text and the line containing the selection start", () => {
    const model = fakeModel("const first = user.name;\nconst second = account.id;");
    const editor = fakeEditor(model, selection(1, 15, 2, 15));
    const reader = createReader(editor);

    const capture = reader.readDebugEvaluateInConsoleCapture();
    expect(capture).toMatchObject({
      currentLineText: "const first = user.name;",
      documentPath: "/workspace/src/app.ts",
      focused: true,
      modelVersion: 1,
      selection: { startLineNumber: 1, startColumn: 15, endLineNumber: 2, endColumn: 15 },
      selectionText: "user.name;\nconst second =",
      workspaceOwnerKey: "editor-owner-a",
      workspaceRoot: "/workspace",
    });
    expect(capture?.modelIdentity).toContain("file:///workspace/src/app.ts");
    expect(Object.isFrozen(capture)).toBe(true);
    expect(Object.isFrozen(capture?.selection)).toBe(true);
  });

  it("uses the exact current line when the live selection is empty", () => {
    const editor = fakeEditor(
      fakeModel("const first = 1;\n  account.total  \nconst last = 3;"),
      selection(2, 10, 2, 10),
    );
    const capture = createReader(editor).readDebugEvaluateInConsoleCapture();

    expect(capture?.selectionText).toBe("");
    expect(capture?.currentLineText).toBe("  account.total  ");
    expect(capture?.selection).toEqual({
      startLineNumber: 2,
      startColumn: 10,
      endLineNumber: 2,
      endColumn: 10,
    });
  });

  it("fails closed outside the exact focused JavaScript or TypeScript model", () => {
    const model = fakeModel("user.name");
    const editor = fakeEditor(model, selection(1, 1, 1, 5));
    const reader = createReader(editor);

    editor.focused = false;
    expect(reader.readDebugEvaluateInConsoleCapture()).toBeNull();
    editor.focused = true;
    model.language = "php";
    expect(reader.readDebugEvaluateInConsoleCapture()).toBeNull();
    model.language = "typescript";
    editor.selection = null;
    expect(reader.readDebugEvaluateInConsoleCapture()).toBeNull();
  });

  it("rejects model version, selection, document, and root drift during capture", () => {
    const documentRef = { current: editorDocument() as EditorDocument | null };
    const rootRef = { current: "/workspace" as string | null };
    const model = fakeModel("user.name");
    const editor = fakeEditor(model, selection(1, 1, 1, 5));
    const reader = createDebugEvaluateInConsoleCaptureReader({
      activeDocumentRef: documentRef,
      editor: editor as never,
      workspaceOwnerKey: "editor-owner-a",
      workspaceRootRef: rootRef,
    });

    model.onRead = () => {
      editor.selection = selection(1, 2, 1, 5);
    };
    expect(reader.readDebugEvaluateInConsoleCapture()).toBeNull();
    editor.selection = selection(1, 1, 1, 5);
    model.onRead = () => {
      model.version += 1;
    };
    expect(reader.readDebugEvaluateInConsoleCapture()).toBeNull();
    model.onRead = undefined;
    model.version = 1;
    documentRef.current = { ...editorDocument(), path: "/workspace/src/other.ts" };
    expect(reader.readDebugEvaluateInConsoleCapture()).toBeNull();
    documentRef.current = editorDocument();
    rootRef.current = null;
    expect(reader.readDebugEvaluateInConsoleCapture()).toBeNull();
  });

  function createReader(editor: ReturnType<typeof fakeEditor>) {
    return createDebugEvaluateInConsoleCaptureReader({
      activeDocumentRef: { current: editorDocument() },
      editor: editor as never,
      workspaceOwnerKey: "editor-owner-a",
      workspaceRootRef: { current: "/workspace" },
    });
  }
});

function editorDocument(): EditorDocument {
  return {
    content: "React document state may lag Monaco",
    language: "typescript",
    name: "app.ts",
    path: "/workspace/src/app.ts",
    readOnly: false,
    savedContent: "React document state may lag Monaco",
  };
}

function selection(startLine: number, startColumn: number, endLine: number, endColumn: number) {
  return {
    endColumn,
    endLineNumber: endLine,
    startColumn,
    startLineNumber: startLine,
    isEmpty() {
      return startLine === endLine && startColumn === endColumn;
    },
  };
}

function fakeModel(content: string) {
  return {
    content,
    language: "typescript",
    onRead: undefined as (() => void) | undefined,
    uri: {
      path: "/workspace/src/app.ts",
      scheme: "file",
      toString: () => "file:///workspace/src/app.ts",
    },
    version: 1,
    getLanguageId() {
      return this.language;
    },
    getLineContent(lineNumber: number) {
      return this.content.split("\n")[lineNumber - 1] ?? "";
    },
    getValueInRange(range: ReturnType<typeof selection>) {
      this.onRead?.();
      const lines = this.content.split("\n");
      if (range.startLineNumber === range.endLineNumber) {
        return (lines[range.startLineNumber - 1] ?? "").slice(
          range.startColumn - 1,
          range.endColumn - 1,
        );
      }
      return [
        (lines[range.startLineNumber - 1] ?? "").slice(range.startColumn - 1),
        ...lines.slice(range.startLineNumber, range.endLineNumber - 1),
        (lines[range.endLineNumber - 1] ?? "").slice(0, range.endColumn - 1),
      ].join("\n");
    },
    getVersionId() {
      return this.version;
    },
  };
}

function fakeEditor(
  model: ReturnType<typeof fakeModel> | null,
  liveSelection: ReturnType<typeof selection> | null,
) {
  return {
    focused: true,
    model,
    selection: liveSelection,
    getModel() {
      return this.model;
    },
    getSelection() {
      return this.selection;
    },
    hasTextFocus() {
      return this.focused;
    },
  };
}
