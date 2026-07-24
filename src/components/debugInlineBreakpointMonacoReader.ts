import type { MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import type { DebugInlineBreakpointCaptureReader } from "../domain/debugInlineBreakpointCapture";
import { MAX_DEBUG_INLINE_BREAKPOINT_FOCUS_EPOCH } from "../domain/debugInlineBreakpointCapture";
import type { EditorDocument } from "../domain/workspace";
import { monacoModelIdentity } from "./monacoModelIdentity";
import { modelMatchesWorkspacePath } from "./phpMonacoDocumentContext";

const supportedLanguages = new Set([
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
]);

/** Exact live 1-based cursor capture for the explicit Inline Breakpoint command. */
export function createDebugInlineBreakpointCaptureReader({
  activeDocumentRef,
  editor,
  workspaceOwnerKey,
  workspaceRootRef,
  readFocusEpoch = () => 1,
}: {
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  editor: Monaco.editor.IStandaloneCodeEditor;
  workspaceOwnerKey: string;
  workspaceRootRef: MutableRefObject<string | null | undefined>;
  readFocusEpoch?: () => number;
}): DebugInlineBreakpointCaptureReader {
  return {
    readDebugInlineBreakpointCapture() {
      try {
        const model = editor.getModel();
        const position = editor.getPosition();
        const document = activeDocumentRef.current;
        const workspaceRoot = workspaceRootRef.current;
        const focusEpoch = readFocusEpoch();
        if (
          !model ||
          !position ||
          !document ||
          !workspaceRoot ||
          !Number.isSafeInteger(focusEpoch) ||
          focusEpoch < 1 ||
          focusEpoch > MAX_DEBUG_INLINE_BREAKPOINT_FOCUS_EPOCH ||
          !editor.hasTextFocus() ||
          document.readOnly ||
          !supportedLanguages.has(model.getLanguageId()) ||
          !modelMatchesWorkspacePath(model, workspaceRoot, document.path)
        ) {
          return null;
        }

        const version = model.getVersionId();
        const currentPosition = editor.getPosition();
        if (
          editor.getModel() !== model ||
          !editor.hasTextFocus() ||
          model.getVersionId() !== version ||
          !currentPosition ||
          currentPosition.lineNumber !== position.lineNumber ||
          currentPosition.column !== position.column ||
          activeDocumentRef.current !== document ||
          workspaceRootRef.current !== workspaceRoot ||
          readFocusEpoch() !== focusEpoch ||
          !modelMatchesWorkspacePath(model, workspaceRoot, document.path)
        ) {
          return null;
        }

        return Object.freeze({
          columnNumber: position.column,
          documentPath: document.path,
          focused: true,
          focusEpoch,
          lineNumber: position.lineNumber,
          modelIdentity: monacoModelIdentity(model),
          modelVersion: version,
          workspaceOwnerKey,
          workspaceRoot,
          writable: true,
        });
      } catch {
        return null;
      }
    },
  };
}
