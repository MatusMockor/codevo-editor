import type { MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import type {
  DebugWatchAtCursorCapture,
  DebugWatchAtCursorCaptureReader,
} from "../domain/debugWatchAtCursorCapture";
import type { EditorDocument } from "../domain/workspace";
import { modelMatchesWorkspacePath } from "./phpMonacoDocumentContext";
import { monacoModelIdentity } from "./monacoModelIdentity";

const supportedLanguages = new Set([
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
]);

/** Reads one immutable, owner-tagged snapshot directly from the live Monaco surface. */
export function createDebugWatchAtCursorCaptureReader({
  activeDocumentRef,
  editor,
  workspaceOwnerKey,
  workspaceRootRef,
}: {
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  editor: Monaco.editor.IStandaloneCodeEditor;
  workspaceOwnerKey: string;
  workspaceRootRef: MutableRefObject<string | null | undefined>;
}): DebugWatchAtCursorCaptureReader {
  return {
    readDebugWatchAtCursorCapture(): DebugWatchAtCursorCapture | null {
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
          !supportedLanguages.has(model.getLanguageId()) ||
          !modelMatchesWorkspacePath(model, workspaceRoot, document.path)
        ) {
          return null;
        }

        const version = model.getVersionId();
        const content = model.getValue();
        if (
          editor.getModel() !== model ||
          model.getVersionId() !== version ||
          activeDocumentRef.current?.path !== document.path ||
          workspaceRootRef.current !== workspaceRoot
        ) {
          return null;
        }

        return Object.freeze({
          content,
          documentPath: document.path,
          modelIdentity: monacoModelIdentity(model),
          modelVersion: version,
          position: Object.freeze({ column: position.column, lineNumber: position.lineNumber }),
          workspaceOwnerKey,
          workspaceRoot,
        });
      } catch {
        return null;
      }
    },
  };
}
