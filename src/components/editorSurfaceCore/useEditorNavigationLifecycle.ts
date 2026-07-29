import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import type { EditorRevealTarget } from "../../domain/languageServerFeatures";
import type { EditorDocument } from "../../domain/workspace";
import type { EditorRuntimeContextValue } from "../editorRuntimeContext";
import { activeDocumentModelForReveal } from "../editorSurfaceLiveModelContentAuthority";
import { dismissTransientEditorWidgets } from "../editorTransientWidgetDismissal";

interface EditorNavigationLifecycleOptions {
  readonly activeDocument: EditorDocument | null;
  readonly activeDocumentContentReady: boolean;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly editorRevealTarget: EditorRevealTarget | null;
  readonly groupId: string;
  readonly isOpeningFile: boolean;
  readonly onRevealTargetHandled: (target: EditorRevealTarget) => void;
  readonly previousActiveDocumentPathRef: MutableRefObject<string | null>;
  readonly previousTransientWidgetDismissKeyRef: MutableRefObject<string | undefined>;
  readonly runtime: EditorRuntimeContextValue | null;
  readonly transientWidgetDismissKey: string | undefined;
  readonly workspaceRoot: string | null;
}

/**
 * Owns model navigation and transient-widget dismissal without coupling the
 * EditorSurface composition root to Monaco's model-swap timing.
 */
export function useEditorNavigationLifecycle({
  activeDocument,
  activeDocumentContentReady,
  editor,
  editorRevealTarget,
  groupId,
  isOpeningFile,
  onRevealTargetHandled,
  previousActiveDocumentPathRef,
  previousTransientWidgetDismissKeyRef,
  runtime,
  transientWidgetDismissKey,
  workspaceRoot,
}: EditorNavigationLifecycleOptions): void {
  useEffect(() => {
    if (!editor) {
      return;
    }

    const currentPath = activeDocument?.path ?? null;
    const previousPath = previousActiveDocumentPathRef.current;
    previousActiveDocumentPathRef.current = currentPath;

    if (previousPath === currentPath) {
      return;
    }

    dismissTransientEditorWidgets(editor, "document-switch");
  }, [activeDocument?.path, editor, previousActiveDocumentPathRef]);

  useEffect(() => {
    if (!editor || transientWidgetDismissKey === undefined) {
      return;
    }

    if (previousTransientWidgetDismissKeyRef.current === transientWidgetDismissKey) {
      return;
    }

    previousTransientWidgetDismissKeyRef.current = transientWidgetDismissKey;
    dismissTransientEditorWidgets(editor, "floating-surface");
  }, [editor, previousTransientWidgetDismissKeyRef, transientWidgetDismissKey]);

  useEffect(() => {
    if (!editorRevealTarget) {
      return;
    }

    if (!activeDocument) {
      onRevealTargetHandled(editorRevealTarget);
      return;
    }

    if (editorRevealTarget.path !== activeDocument.path) {
      onRevealTargetHandled(editorRevealTarget);
      return;
    }

    if (!editor) {
      return;
    }

    if (!activeDocumentContentReady || isOpeningFile) {
      return;
    }

    const reveal = (): boolean => {
      const model = activeDocumentModelForReveal(
        runtime,
        groupId,
        editor,
        workspaceRoot,
        activeDocument,
      );

      if (!model) {
        return false;
      }

      dismissTransientEditorWidgets(editor, "navigation");
      editor.setPosition(editorRevealTarget.position);
      editor.revealPositionInCenter(editorRevealTarget.position);
      editor.focus();
      onRevealTargetHandled(editorRevealTarget);
      return true;
    };

    if (reveal()) {
      return;
    }

    const disposable = editor.onDidChangeModel(() => {
      if (!reveal()) {
        return;
      }

      disposable.dispose();
    });

    return () => disposable.dispose();
  }, [
    activeDocument,
    activeDocumentContentReady,
    editor,
    editorRevealTarget,
    groupId,
    isOpeningFile,
    onRevealTargetHandled,
    runtime,
    workspaceRoot,
  ]);
}
