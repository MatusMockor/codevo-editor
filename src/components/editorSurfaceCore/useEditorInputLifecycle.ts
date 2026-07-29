import { useEffect } from "react";
import type * as Monaco from "monaco-editor";
import {
  isSmartBlankLineIndentDocument,
  leadingWhitespace,
  smartBlankLineIndent,
  smartBlankLineIndentTargetLineNumber,
} from "../editorSmartIndent";
import { shouldTriggerLatteMemberSuggest } from "../editorLatteMemberSuggestTrigger";
import { modelMatchesProject } from "../editorSurfaceModelIdentity";

interface EditorInputLifecycleOptions {
  readonly activeDocumentLanguage?: string;
  readonly activeDocumentPath?: string;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly monaco: typeof Monaco | null;
  readonly workspaceRoot: string | null;
}

/**
 * Owns content-change reactions that are local to the active Monaco model.
 *
 * The effects intentionally retain their historical order: Latte member
 * suggestions first, then smart blank-line indentation.
 */
export function useEditorInputLifecycle({
  activeDocumentLanguage,
  activeDocumentPath,
  editor,
  monaco,
  workspaceRoot,
}: EditorInputLifecycleOptions): void {
  useEffect(() => {
    if (!activeDocumentPath || !activeDocumentLanguage || !editor) {
      return;
    }

    if (activeDocumentLanguage !== "latte") {
      return;
    }

    const disposable = editor.onDidChangeModelContent((event) => {
      const model = editor.getModel();
      const position = editor.getPosition();

      if (!model || !position || !modelMatchesProject(model, workspaceRoot, activeDocumentPath)) {
        return;
      }

      if (
        !shouldTriggerLatteMemberSuggest(activeDocumentLanguage, model, position, event.changes)
      ) {
        return;
      }

      editor.trigger("mockor.latteMemberCompletion", "editor.action.triggerSuggest", {});
    });

    return () => disposable.dispose();
  }, [activeDocumentLanguage, activeDocumentPath, editor, workspaceRoot]);

  useEffect(() => {
    if (!activeDocumentPath || !activeDocumentLanguage || !editor || !monaco) {
      return;
    }

    if (!isSmartBlankLineIndentDocument({ language: activeDocumentLanguage })) {
      return;
    }

    const disposable = editor.onDidChangeModelContent((event) => {
      const insertedNewLine = event.changes.some((change) => change.text.includes("\n"));
      const insertedBlankLineWhitespace = event.changes.some((change) =>
        /^[\t ]+$/.test(change.text),
      );

      if (!insertedNewLine && !insertedBlankLineWhitespace) {
        return;
      }

      const model = editor.getModel();
      const position = editor.getPosition();

      if (!model || !position || !modelMatchesProject(model, workspaceRoot, activeDocumentPath)) {
        return;
      }

      const targetLineNumber = insertedNewLine
        ? smartBlankLineIndentTargetLineNumber(event.changes, position.lineNumber)
        : position.lineNumber;
      const indent = smartBlankLineIndent(model, targetLineNumber);

      if (indent === null) {
        return;
      }

      const line = model.getLineContent(targetLineNumber);
      const currentIndent = leadingWhitespace(line);

      if (currentIndent === indent) {
        return;
      }

      if (!insertedNewLine && currentIndent.length >= indent.length) {
        return;
      }

      editor.executeEdits("mockor.smartBlankLineIndent", [
        {
          forceMoveMarkers: true,
          range: new monaco.Range(targetLineNumber, 1, targetLineNumber, currentIndent.length + 1),
          text: indent,
        },
      ]);
      editor.setPosition({
        column: indent.length + 1,
        lineNumber: targetLineNumber,
      });
    });

    return () => disposable.dispose();
  }, [activeDocumentLanguage, activeDocumentPath, editor, monaco, workspaceRoot]);
}
