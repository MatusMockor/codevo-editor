import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import type { EditorMenuCommandRunner } from "../../domain/editorMenuCommand";
import type {
  EditorSurfaceCommandId,
  EditorSurfaceCommandInvocationScope,
  EditorSurfaceCommandRunner,
} from "../../domain/editorSurfaceCommand";
import type { EditorChangeHunk } from "../../domain/editorChangeMarkers";
import { editorActionForMenuCommand } from "../editorMenuCommandAction";
import { modelMatchesProject } from "../editorSurfaceModelIdentity";
import { createEditorSurfaceCommandRunner } from "./editorCommands";

interface EditorSurfaceCommandPublicationOptions {
  readonly activeDocumentPath: string | null | undefined;
  readonly captureEditorSurfaceScope: () => EditorSurfaceCommandInvocationScope | null;
  readonly changeHunksRef: MutableRefObject<readonly EditorChangeHunk[]>;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly invalidateImportActionAuthority: () => void;
  readonly isImportActionEnabled: (commandId: EditorSurfaceCommandId) => boolean;
  readonly onEditorMenuCommandRunnerChange?: (runner: EditorMenuCommandRunner | null) => void;
  readonly onEditorSurfaceCommandRunnerChange?: (runner: EditorSurfaceCommandRunner | null) => void;
  readonly runImportAction: (commandId: EditorSurfaceCommandId) => void;
  readonly workspaceRoot: string | null;
}

/**
 * Publishes the editor-owned command adapters and retires them with the exact
 * model/surface lifecycle that created them.
 */
export function useEditorSurfaceCommandPublications({
  activeDocumentPath,
  captureEditorSurfaceScope,
  changeHunksRef,
  editor,
  invalidateImportActionAuthority,
  isImportActionEnabled,
  onEditorMenuCommandRunnerChange,
  onEditorSurfaceCommandRunnerChange,
  runImportAction,
  workspaceRoot,
}: EditorSurfaceCommandPublicationOptions): void {
  useEffect(() => {
    if (!onEditorMenuCommandRunnerChange) {
      return;
    }

    if (!editor || !activeDocumentPath) {
      onEditorMenuCommandRunnerChange(null);
      return;
    }

    const targetPath = activeDocumentPath;
    const runner: EditorMenuCommandRunner = (command) => {
      const model = editor.getModel();

      if (!model || !modelMatchesProject(model, workspaceRoot, targetPath)) {
        return;
      }

      editor.focus();
      editor.trigger("mockor.windowChrome", editorActionForMenuCommand(command), null);
    };

    onEditorMenuCommandRunnerChange(runner);

    return () => {
      onEditorMenuCommandRunnerChange(null);
    };
  }, [activeDocumentPath, editor, onEditorMenuCommandRunnerChange, workspaceRoot]);

  useEffect(() => {
    if (!onEditorSurfaceCommandRunnerChange) {
      return;
    }

    if (!editor || !activeDocumentPath) {
      onEditorSurfaceCommandRunnerChange(null);
      return;
    }

    const publishRunner = () => {
      onEditorSurfaceCommandRunnerChange(
        createEditorSurfaceCommandRunner({
          captureScope: captureEditorSurfaceScope,
          changeHunksRef,
          editor,
          isImportActionEnabled,
          runImportAction,
        }),
      );
    };

    publishRunner();
    const modelChangeDisposable = editor.onDidChangeModel(() => {
      invalidateImportActionAuthority();
      publishRunner();
    });

    return () => {
      modelChangeDisposable.dispose();
      onEditorSurfaceCommandRunnerChange(null);
    };
  }, [
    activeDocumentPath,
    captureEditorSurfaceScope,
    changeHunksRef,
    editor,
    invalidateImportActionAuthority,
    isImportActionEnabled,
    onEditorSurfaceCommandRunnerChange,
    runImportAction,
  ]);
}
