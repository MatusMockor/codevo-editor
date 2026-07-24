import type { MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import type {
  DebugEditorSelectionRange,
  DebugEvaluateInConsoleCapture,
  DebugEvaluateInConsoleCaptureReader,
} from "../domain/debugEvaluateInConsoleCapture";
import type { EditorDocument } from "../domain/workspace";
import { monacoModelIdentity } from "./monacoModelIdentity";
import { modelMatchesWorkspacePath } from "./phpMonacoDocumentContext";

const supportedLanguages = new Set([
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
]);

/** Captures selection/current-line text directly from the exact focused Monaco model. */
export function createDebugEvaluateInConsoleCaptureReader({
  activeDocumentRef,
  editor,
  workspaceOwnerKey,
  workspaceRootRef,
}: {
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  editor: Monaco.editor.IStandaloneCodeEditor;
  workspaceOwnerKey: string;
  workspaceRootRef: MutableRefObject<string | null | undefined>;
}): DebugEvaluateInConsoleCaptureReader {
  return {
    readDebugEvaluateInConsoleCapture(): DebugEvaluateInConsoleCapture | null {
      try {
        const model = editor.getModel();
        const selection = editor.getSelection();
        const document = activeDocumentRef.current;
        const workspaceRoot = workspaceRootRef.current;
        if (
          !model ||
          !selection ||
          !document ||
          !workspaceRoot ||
          !editor.hasTextFocus() ||
          !supportedLanguages.has(model.getLanguageId()) ||
          !modelMatchesWorkspacePath(model, workspaceRoot, document.path)
        ) {
          return null;
        }

        const range = selectionRange(selection);
        const version = model.getVersionId();
        const selectionText = selection.isEmpty() ? "" : model.getValueInRange(selection);
        const currentLineText = model.getLineContent(range.startLineNumber);
        const currentSelection = editor.getSelection();
        if (
          editor.getModel() !== model ||
          !editor.hasTextFocus() ||
          model.getVersionId() !== version ||
          !currentSelection ||
          !rangesEqual(range, selectionRange(currentSelection)) ||
          activeDocumentRef.current?.path !== document.path ||
          workspaceRootRef.current !== workspaceRoot
        ) {
          return null;
        }

        return Object.freeze({
          currentLineText,
          documentPath: document.path,
          focused: true,
          modelIdentity: monacoModelIdentity(model),
          modelVersion: version,
          selection: Object.freeze(range),
          selectionText,
          workspaceOwnerKey,
          workspaceRoot,
        });
      } catch {
        return null;
      }
    },
  };
}

function selectionRange(selection: Monaco.Selection): DebugEditorSelectionRange {
  return {
    endColumn: selection.endColumn,
    endLineNumber: selection.endLineNumber,
    startColumn: selection.startColumn,
    startLineNumber: selection.startLineNumber,
  };
}

function rangesEqual(left: DebugEditorSelectionRange, right: DebugEditorSelectionRange): boolean {
  return (
    left.startLineNumber === right.startLineNumber &&
    left.startColumn === right.startColumn &&
    left.endLineNumber === right.endLineNumber &&
    left.endColumn === right.endColumn
  );
}
