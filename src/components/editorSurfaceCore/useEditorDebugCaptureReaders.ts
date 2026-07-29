import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import type { EditorDocument } from "../../domain/workspace";
import type { DebugWatchAtCursorCaptureReader } from "../../domain/debugWatchAtCursorCapture";
import type { DebugBreakpointNavigationCaptureReader } from "../../domain/debugBreakpointNavigationCapture";
import type { DebugInlineBreakpointCaptureReader } from "../../domain/debugInlineBreakpointCapture";
import type { DebugEvaluateInConsoleCaptureReader } from "../../domain/debugEvaluateInConsoleCapture";
import { createDebugWatchAtCursorCaptureReader } from "../debugWatchAtCursorMonacoReader";
import { createDebugBreakpointNavigationCaptureReader } from "../debugBreakpointNavigationMonacoReader";
import { createDebugInlineBreakpointCaptureReader } from "../debugInlineBreakpointMonacoReader";
import { createDebugEvaluateInConsoleCaptureReader } from "../debugEvaluateInConsoleMonacoReader";

interface EditorDebugCaptureReaderOptions {
  readonly activeDocumentPath: string | null | undefined;
  readonly activeDocumentRef: MutableRefObject<EditorDocument | null>;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly editorSessionOwnerKey: string | null;
  readonly onDebugBreakpointNavigationCaptureReaderChange?: (
    reader: DebugBreakpointNavigationCaptureReader | null,
  ) => void;
  readonly onDebugEvaluateInConsoleCaptureReaderChange?: (
    reader: DebugEvaluateInConsoleCaptureReader | null,
  ) => void;
  readonly onDebugInlineBreakpointCaptureReaderChange?: (
    reader: DebugInlineBreakpointCaptureReader | null,
  ) => void;
  readonly onDebugWatchAtCursorCaptureReaderChange?: (
    reader: DebugWatchAtCursorCaptureReader | null,
  ) => void;
  readonly workspaceRoot: string | null;
  readonly workspaceRootRef: MutableRefObject<string | null>;
}

/**
 * Owns the four debugger cursor readers as one surface-scoped adapter family.
 * Each effect publishes only while the exact editor workspace owner exists.
 */
export function useEditorDebugCaptureReaders({
  activeDocumentPath,
  activeDocumentRef,
  editor,
  editorSessionOwnerKey,
  onDebugBreakpointNavigationCaptureReaderChange,
  onDebugEvaluateInConsoleCaptureReaderChange,
  onDebugInlineBreakpointCaptureReaderChange,
  onDebugWatchAtCursorCaptureReaderChange,
  workspaceRoot,
  workspaceRootRef,
}: EditorDebugCaptureReaderOptions): void {
  useEffect(() => {
    if (!onDebugWatchAtCursorCaptureReaderChange) return;
    if (!editor || !activeDocumentPath || !workspaceRoot || !editorSessionOwnerKey) {
      onDebugWatchAtCursorCaptureReaderChange(null);
      return;
    }

    const reader = createDebugWatchAtCursorCaptureReader({
      activeDocumentRef,
      editor,
      workspaceOwnerKey: editorSessionOwnerKey,
      workspaceRootRef,
    });
    onDebugWatchAtCursorCaptureReaderChange(reader);
    return () => onDebugWatchAtCursorCaptureReaderChange(null);
  }, [
    activeDocumentPath,
    activeDocumentRef,
    editor,
    editorSessionOwnerKey,
    onDebugWatchAtCursorCaptureReaderChange,
    workspaceRoot,
    workspaceRootRef,
  ]);

  useEffect(() => {
    if (!onDebugEvaluateInConsoleCaptureReaderChange) return;
    if (!editor || !activeDocumentPath || !workspaceRoot || !editorSessionOwnerKey) {
      onDebugEvaluateInConsoleCaptureReaderChange(null);
      return;
    }

    const reader = createDebugEvaluateInConsoleCaptureReader({
      activeDocumentRef,
      editor,
      workspaceOwnerKey: editorSessionOwnerKey,
      workspaceRootRef,
    });
    onDebugEvaluateInConsoleCaptureReaderChange(reader);
    return () => onDebugEvaluateInConsoleCaptureReaderChange(null);
  }, [
    activeDocumentPath,
    activeDocumentRef,
    editor,
    editorSessionOwnerKey,
    onDebugEvaluateInConsoleCaptureReaderChange,
    workspaceRoot,
    workspaceRootRef,
  ]);

  useEffect(() => {
    if (!onDebugBreakpointNavigationCaptureReaderChange) return;
    if (!editor || !activeDocumentPath || !workspaceRoot || !editorSessionOwnerKey) {
      onDebugBreakpointNavigationCaptureReaderChange(null);
      return;
    }

    const reader = createDebugBreakpointNavigationCaptureReader({
      activeDocumentRef,
      editor,
      workspaceOwnerKey: editorSessionOwnerKey,
      workspaceRootRef,
    });
    onDebugBreakpointNavigationCaptureReaderChange(reader);
    return () => onDebugBreakpointNavigationCaptureReaderChange(null);
  }, [
    activeDocumentPath,
    activeDocumentRef,
    editor,
    editorSessionOwnerKey,
    onDebugBreakpointNavigationCaptureReaderChange,
    workspaceRoot,
    workspaceRootRef,
  ]);

  useEffect(() => {
    if (!onDebugInlineBreakpointCaptureReaderChange) return;
    if (!editor || !activeDocumentPath || !workspaceRoot || !editorSessionOwnerKey) {
      onDebugInlineBreakpointCaptureReaderChange(null);
      return;
    }

    const reader = createDebugInlineBreakpointCaptureReader({
      activeDocumentRef,
      editor,
      workspaceOwnerKey: editorSessionOwnerKey,
      workspaceRootRef,
    });
    onDebugInlineBreakpointCaptureReaderChange(reader);
    return () => onDebugInlineBreakpointCaptureReaderChange(null);
  }, [
    activeDocumentPath,
    activeDocumentRef,
    editor,
    editorSessionOwnerKey,
    onDebugInlineBreakpointCaptureReaderChange,
    workspaceRoot,
    workspaceRootRef,
  ]);
}
