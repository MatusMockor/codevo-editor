import { describe, expect, it } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import { createDebugWatchAtCursorCaptureReader } from "./debugWatchAtCursorMonacoReader";

describe("EditorSurface debug Watch at Cursor capture reader", () => {
  it("captures the exact live dirty model with stable URI-bound model identity", () => {
    const document = editorDocument();
    const model = fakeModel("const value = user.name;", "typescript");
    const editor = fakeEditor(model, { column: 21, lineNumber: 1 });
    const activeDocumentRef = { current: document };
    const workspaceRootRef = { current: "/workspace" };
    const reader = createDebugWatchAtCursorCaptureReader({
      activeDocumentRef,
      editor: editor as never,
      workspaceOwnerKey: "editor-owner-a",
      workspaceRootRef,
    });

    const first = reader.readDebugWatchAtCursorCapture();
    expect(first).toMatchObject({
      content: "const value = user.name;",
      documentPath: "/workspace/src/app.ts",
      modelVersion: 1,
      position: { column: 21, lineNumber: 1 },
      workspaceOwnerKey: "editor-owner-a",
      workspaceRoot: "/workspace",
    });
    expect(first?.modelIdentity).toContain("file:///workspace/src/app.ts");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.position)).toBe(true);

    model.content = "const value = dirty.user.name;";
    model.version = 2;
    editor.position = { column: 23, lineNumber: 1 };
    const second = reader.readDebugWatchAtCursorCapture();
    expect(second?.content).toBe("const value = dirty.user.name;");
    expect(second?.modelVersion).toBe(2);
    expect(second?.position).toEqual({ column: 23, lineNumber: 1 });
    expect(second?.modelIdentity).toBe(first?.modelIdentity);
  });

  it("assigns a distinct identity when Monaco replaces a model at the same URI", () => {
    const document = editorDocument();
    const firstModel = fakeModel("user.name", "javascript");
    const editor = fakeEditor(firstModel, { column: 2, lineNumber: 1 });
    const reader = createDebugWatchAtCursorCaptureReader({
      activeDocumentRef: { current: document },
      editor: editor as never,
      workspaceOwnerKey: "editor-owner-a",
      workspaceRootRef: { current: "/workspace" },
    });
    const firstIdentity = reader.readDebugWatchAtCursorCapture()?.modelIdentity;
    editor.model = fakeModel("other.name", "javascript");
    const secondIdentity = reader.readDebugWatchAtCursorCapture()?.modelIdentity;

    expect(firstIdentity).toBeTruthy();
    expect(secondIdentity).toBeTruthy();
    expect(secondIdentity).not.toBe(firstIdentity);
  });

  it.each(["php", "json", "plaintext"])("rejects an unsupported %s model", (language) => {
    const reader = createDebugWatchAtCursorCaptureReader({
      activeDocumentRef: { current: editorDocument() },
      editor: fakeEditor(fakeModel("user.name", language), {
        column: 2,
        lineNumber: 1,
      }) as never,
      workspaceOwnerKey: "editor-owner-a",
      workspaceRootRef: { current: "/workspace" },
    });
    expect(reader.readDebugWatchAtCursorCapture()).toBeNull();
  });

  it("fails closed for path, root, cursor, and version drift", () => {
    const documentRef = { current: editorDocument() as EditorDocument | null };
    const rootRef = { current: "/workspace" as string | null };
    const model = fakeModel("user.name", "typescript");
    const editor = fakeEditor(model, { column: 2, lineNumber: 1 });
    const reader = createDebugWatchAtCursorCaptureReader({
      activeDocumentRef: documentRef,
      editor: editor as never,
      workspaceOwnerKey: "editor-owner-a",
      workspaceRootRef: rootRef,
    });

    documentRef.current = { ...editorDocument(), path: "/workspace/src/other.ts" };
    expect(reader.readDebugWatchAtCursorCapture()).toBeNull();
    documentRef.current = editorDocument();
    rootRef.current = null;
    expect(reader.readDebugWatchAtCursorCapture()).toBeNull();
    rootRef.current = "/workspace";
    editor.position = null;
    expect(reader.readDebugWatchAtCursorCapture()).toBeNull();
    editor.position = { column: 2, lineNumber: 1 };
    model.onRead = () => {
      model.version += 1;
    };
    expect(reader.readDebugWatchAtCursorCapture()).toBeNull();
  });
});

function editorDocument(): EditorDocument {
  return {
    content: "saved content may lag Monaco",
    language: "typescript",
    name: "app.ts",
    path: "/workspace/src/app.ts",
    readOnly: false,
    savedContent: "saved content may lag Monaco",
  };
}

function fakeModel(content: string, language: string) {
  return {
    content,
    language,
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
    getValue() {
      this.onRead?.();
      return this.content;
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
  return {
    model,
    position,
    getModel() {
      return this.model;
    },
    getPosition() {
      return this.position;
    },
  };
}
