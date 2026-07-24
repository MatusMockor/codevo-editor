import type { MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import type {
  DebugBreakpointNavigationCapture,
  DebugBreakpointNavigationCaptureReader,
} from "../domain/debugBreakpointNavigationCapture";
import type { EditorDocument } from "../domain/workspace";
import { monacoModelIdentity } from "./monacoModelIdentity";
import { modelMatchesWorkspacePath } from "./phpMonacoDocumentContext";

const supportedLanguages = new Set([
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
]);

/** Captures the live cursor from the exact focused workspace-owned Monaco model. */
export function createDebugBreakpointNavigationCaptureReader({
  activeDocumentRef,
  editor,
  workspaceOwnerKey,
  workspaceRootRef,
}: {
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  editor: Monaco.editor.IStandaloneCodeEditor;
  workspaceOwnerKey: string;
  workspaceRootRef: MutableRefObject<string | null | undefined>;
}): DebugBreakpointNavigationCaptureReader {
  return {
    readDebugBreakpointNavigationCapture(): DebugBreakpointNavigationCapture | null {
      try {
        const model = editor.getModel();
        const position = editor.getPosition();
        const document = activeDocumentRef.current;
        const workspaceRoot = workspaceRootRef.current;
        if (
          !model ||
          !position ||
          !document ||
          !workspaceRoot ||
          !editor.hasTextFocus() ||
          !supportedLanguages.has(model.getLanguageId()) ||
          !modelMatchesWorkspacePath(model, workspaceRoot, document.path)
        ) {
          return null;
        }

        const version = model.getVersionId();
        const lineNumber = position.lineNumber;
        const columnNumber = position.column;
        const currentPosition = editor.getPosition();
        if (
          editor.getModel() !== model ||
          !editor.hasTextFocus() ||
          model.getVersionId() !== version ||
          !currentPosition ||
          currentPosition.lineNumber !== lineNumber ||
          currentPosition.column !== columnNumber ||
          activeDocumentRef.current?.path !== document.path ||
          workspaceRootRef.current !== workspaceRoot ||
          !modelMatchesWorkspacePath(model, workspaceRoot, document.path)
        ) {
          return null;
        }

        return Object.freeze({
          columnNumber,
          documentPath: document.path,
          focused: true,
          lineNumber,
          modelIdentity: monacoModelIdentity(model),
          modelVersion: version,
          workspaceOwnerKey,
          workspaceRoot,
        });
      } catch {
        return null;
      }
    },
  };
}
