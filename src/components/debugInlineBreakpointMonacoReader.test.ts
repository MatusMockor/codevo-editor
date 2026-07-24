import { describe, expect, it } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import { createDebugInlineBreakpointCaptureReader } from "./debugInlineBreakpointMonacoReader";

describe("debug inline breakpoint Monaco reader", () => {
  it("captures the exact focused writable JS/TS cursor with bounded public metadata", () => {
    const document = editorDocument();
    const model = fakeModel();
    const editor = fakeEditor(model, { column: 9, lineNumber: 12 });
    const capture = createReader(editor, { current: document }).readDebugInlineBreakpointCapture();

    expect(capture).toMatchObject({
      columnNumber: 9,
      documentPath: "/workspace/src/app.ts",
      focused: true,
      focusEpoch: 1,
      lineNumber: 12,
      modelVersion: 4,
      workspaceOwnerKey: "editor-owner-a",
      workspaceRoot: "/workspace",
      writable: true,
    });
    expect(capture?.modelIdentity).toContain("file:///workspace/src/app.ts");
    expect(Object.keys(capture ?? {}).sort()).toEqual([
      "columnNumber",
      "documentPath",
      "focusEpoch",
      "focused",
      "lineNumber",
      "modelIdentity",
      "modelVersion",
      "workspaceOwnerKey",
      "workspaceRoot",
      "writable",
    ]);
    expect(Object.isFrozen(capture)).toBe(true);
  });

  it("fails closed for unfocused, read-only, unsupported, missing, and non-workspace models", () => {
    const documentRef = { current: editorDocument() as EditorDocument | null };
    const model = fakeModel();
    const editor = fakeEditor(model, { column: 2, lineNumber: 3 });
    const reader = createReader(editor, documentRef);

    editor.focused = false;
    expect(reader.readDebugInlineBreakpointCapture()).toBeNull();
    editor.focused = true;
    documentRef.current = { ...editorDocument(), readOnly: true };
    expect(reader.readDebugInlineBreakpointCapture()).toBeNull();
    documentRef.current = editorDocument();
    model.language = "php";
    expect(reader.readDebugInlineBreakpointCapture()).toBeNull();
    model.language = "typescript";
    editor.position = null;
    expect(reader.readDebugInlineBreakpointCapture()).toBeNull();
    editor.position = { column: 2, lineNumber: 3 };
    model.uri.path = "/outside/app.ts";
    expect(reader.readDebugInlineBreakpointCapture()).toBeNull();
  });

  it("rejects line, column, model, version, focus, document, and root drift", () => {
    const documentRef = { current: editorDocument() as EditorDocument | null };
    const rootRef = { current: "/workspace" as string | null };
    const model = fakeModel();
    const editor = fakeEditor(model, { column: 2, lineNumber: 3 });
    const reader = createDebugInlineBreakpointCaptureReader({
      activeDocumentRef: documentRef,
      editor: editor as never,
      workspaceOwnerKey: "editor-owner-a",
      workspaceRootRef: rootRef,
    });

    for (const drift of [
      () => (editor.position = { column: 3, lineNumber: 3 }),
      () => (editor.position = { column: 2, lineNumber: 4 }),
      () => (model.version += 1),
      () => (editor.focused = false),
      () => (documentRef.current = { ...editorDocument(), content: "replacement" }),
      () => (rootRef.current = "/other"),
      () => (editor.model = fakeModel()),
    ]) {
      editor.position = { column: 2, lineNumber: 3 };
      editor.focused = true;
      editor.model = model;
      model.version = 4;
      documentRef.current = editorDocument();
      rootRef.current = "/workspace";
      editor.onSecondPosition = drift;
      expect(reader.readDebugInlineBreakpointCapture()).toBeNull();
    }
  });

  it("rejects focus epoch drift and invalid bounded epochs", () => {
    const editor = fakeEditor(fakeModel(), { column: 2, lineNumber: 3 });
    let focusEpoch = 7;
    const reader = createDebugInlineBreakpointCaptureReader({
      activeDocumentRef: { current: editorDocument() },
      editor: editor as never,
      readFocusEpoch: () => focusEpoch,
      workspaceOwnerKey: "editor-owner-a",
      workspaceRootRef: { current: "/workspace" },
    });

    editor.onSecondPosition = () => {
      focusEpoch = 8;
    };
    expect(reader.readDebugInlineBreakpointCapture()).toBeNull();
    editor.onSecondPosition = undefined;
    for (const invalid of [0, 1.5, 4_294_967_296]) {
      focusEpoch = invalid;
      expect(reader.readDebugInlineBreakpointCapture()).toBeNull();
    }
  });

  function createReader(
    editor: ReturnType<typeof fakeEditor>,
    activeDocumentRef: { current: EditorDocument | null },
  ) {
    return createDebugInlineBreakpointCaptureReader({
      activeDocumentRef,
      editor: editor as never,
      workspaceOwnerKey: "editor-owner-a",
      workspaceRootRef: { current: "/workspace" },
    });
  }
});

function editorDocument(): EditorDocument {
  return {
    content: "const value = 1;",
    language: "typescript",
    name: "app.ts",
    path: "/workspace/src/app.ts",
    readOnly: false,
    savedContent: "const value = 1;",
  };
}

function fakeModel() {
  return {
    language: "typescript",
    uri: {
      path: "/workspace/src/app.ts",
      scheme: "file",
      toString: () => "file:///workspace/src/app.ts",
    },
    version: 4,
    getLanguageId() {
      return this.language;
    },
    getVersionId() {
      return this.version;
    },
  };
}

function fakeEditor(
  model: ReturnType<typeof fakeModel> | null,
  position: { column: number; lineNumber: number } | null,
) {
  let positionReads = 0;
  return {
    focused: true,
    model,
    onSecondPosition: undefined as (() => void) | undefined,
    position,
    getModel() {
      return this.model;
    },
    getPosition() {
      positionReads += 1;
      if (positionReads % 2 === 0) this.onSecondPosition?.();
      return this.position;
    },
    hasTextFocus() {
      return this.focused;
    },
  };
}
