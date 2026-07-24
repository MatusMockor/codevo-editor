import { describe, expect, it } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import { createDebugBreakpointNavigationCaptureReader } from "./debugBreakpointNavigationMonacoReader";

describe("debug breakpoint navigation Monaco reader", () => {
  it("captures only the exact live cursor and ownership metadata", () => {
    const model = fakeModel();
    const editor = fakeEditor(model, { column: 9, lineNumber: 12 });

    const capture = createReader(editor).readDebugBreakpointNavigationCapture();

    expect(capture).toMatchObject({
      columnNumber: 9,
      documentPath: "/workspace/src/app.ts",
      focused: true,
      lineNumber: 12,
      modelVersion: 4,
      workspaceOwnerKey: "editor-owner-a",
      workspaceRoot: "/workspace",
    });
    expect(capture?.modelIdentity).toContain("file:///workspace/src/app.ts");
    expect(Object.keys(capture ?? {}).sort()).toEqual([
      "columnNumber",
      "documentPath",
      "focused",
      "lineNumber",
      "modelIdentity",
      "modelVersion",
      "workspaceOwnerKey",
      "workspaceRoot",
    ]);
    expect(Object.isFrozen(capture)).toBe(true);
  });

  it("fails closed outside the exact focused JavaScript or TypeScript workspace model", () => {
    const model = fakeModel();
    const editor = fakeEditor(model, { column: 1, lineNumber: 1 });
    const reader = createReader(editor);

    editor.focused = false;
    expect(reader.readDebugBreakpointNavigationCapture()).toBeNull();
    editor.focused = true;
    model.language = "php";
    expect(reader.readDebugBreakpointNavigationCapture()).toBeNull();
    model.language = "typescript";
    editor.position = null;
    expect(reader.readDebugBreakpointNavigationCapture()).toBeNull();

    const outsideModel = fakeModel();
    outsideModel.uri = {
      path: "/outside/app.ts",
      scheme: "file",
      toString: () => "file:///outside/app.ts",
    };
    expect(
      createReader(
        fakeEditor(outsideModel, { column: 1, lineNumber: 1 }),
      ).readDebugBreakpointNavigationCapture(),
    ).toBeNull();
  });

  it("rejects model, version, cursor, focus, document, and root drift during capture", () => {
    const documentRef = { current: editorDocument() as EditorDocument | null };
    const rootRef = { current: "/workspace" as string | null };
    const model = fakeModel();
    const editor = fakeEditor(model, { column: 1, lineNumber: 3 });
    const reader = createDebugBreakpointNavigationCaptureReader({
      activeDocumentRef: documentRef,
      editor: editor as never,
      workspaceOwnerKey: "editor-owner-a",
      workspaceRootRef: rootRef,
    });

    editor.onSecondPosition = () => {
      editor.position = { column: 1, lineNumber: 4 };
    };
    expect(reader.readDebugBreakpointNavigationCapture()).toBeNull();
    editor.position = { column: 1, lineNumber: 3 };
    editor.onSecondPosition = () => {
      editor.position = { column: 2, lineNumber: 3 };
    };
    expect(reader.readDebugBreakpointNavigationCapture()).toBeNull();
    editor.position = { column: 1, lineNumber: 3 };
    editor.onSecondPosition = () => {
      model.version += 1;
    };
    expect(reader.readDebugBreakpointNavigationCapture()).toBeNull();
    model.version = 4;
    editor.onSecondPosition = () => {
      editor.focused = false;
    };
    expect(reader.readDebugBreakpointNavigationCapture()).toBeNull();
    editor.focused = true;
    editor.onSecondPosition = () => {
      documentRef.current = { ...editorDocument(), path: "/workspace/src/other.ts" };
    };
    expect(reader.readDebugBreakpointNavigationCapture()).toBeNull();
    documentRef.current = editorDocument();
    editor.onSecondPosition = () => {
      rootRef.current = "/other";
    };
    expect(reader.readDebugBreakpointNavigationCapture()).toBeNull();
    rootRef.current = "/workspace";
    editor.onSecondPosition = () => {
      editor.model = fakeModel();
    };
    expect(reader.readDebugBreakpointNavigationCapture()).toBeNull();
  });

  function createReader(editor: ReturnType<typeof fakeEditor>) {
    return createDebugBreakpointNavigationCaptureReader({
      activeDocumentRef: { current: editorDocument() },
      editor: editor as never,
      workspaceOwnerKey: "editor-owner-a",
      workspaceRootRef: { current: "/workspace" },
    });
  }
});

function editorDocument(): EditorDocument {
  return {
    content: "ignored",
    language: "typescript",
    name: "app.ts",
    path: "/workspace/src/app.ts",
    readOnly: false,
    savedContent: "ignored",
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
