import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import type { EditorDocument } from "../../domain/workspace";
import type { EditorCursorCaptureReader } from "../../domain/editorCursorCapture";
import { createEditorCursorCaptureReader } from "../editorCursorCaptureMonacoReader";

interface EditorCursorCaptureReaderOptions {
  readonly activeDocumentPath: string | null | undefined;
  readonly activeDocumentRef: MutableRefObject<EditorDocument | null>;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly editorSessionOwnerKey: string | null;
  readonly onEditorCursorCaptureReaderChange?: (reader: EditorCursorCaptureReader | null) => void;
  readonly workspaceRoot: string | null;
  readonly workspaceRootRef: MutableRefObject<string | null>;
}

export function useEditorCursorCaptureReader({
  activeDocumentPath,
  activeDocumentRef,
  editor,
  editorSessionOwnerKey,
  onEditorCursorCaptureReaderChange,
  workspaceRoot,
  workspaceRootRef,
}: EditorCursorCaptureReaderOptions): void {
  useEffect(() => {
    if (!onEditorCursorCaptureReaderChange) return;
    if (!editor || !activeDocumentPath || !workspaceRoot || !editorSessionOwnerKey) {
      onEditorCursorCaptureReaderChange(null);
      return;
    }

    const reader = createEditorCursorCaptureReader({
      activeDocumentRef,
      editor,
      workspaceOwnerKey: editorSessionOwnerKey,
      workspaceRootRef,
    });
    onEditorCursorCaptureReaderChange(reader);
    return () => onEditorCursorCaptureReaderChange(null);
  }, [
    activeDocumentPath,
    activeDocumentRef,
    editor,
    editorSessionOwnerKey,
    onEditorCursorCaptureReaderChange,
    workspaceRoot,
    workspaceRootRef,
  ]);
}
