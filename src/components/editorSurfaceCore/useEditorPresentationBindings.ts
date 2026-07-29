import { useEffect } from "react";
import type * as Monaco from "monaco-editor";
import {
  editorConfigEol,
  editorConfigFormattingOptions,
  type ResolvedEditorConfig,
} from "../../domain/editorConfig";
import { modelMatchesProject } from "../editorSurfaceModelIdentity";

interface EditorPresentationBindingsInput {
  readonly activeDocumentPath?: string;
  readonly activateFromInteraction: () => void;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly editorConfigEndOfLine?: ResolvedEditorConfig["endOfLine"];
  readonly editorConfigIndentSize?: ResolvedEditorConfig["indentSize"];
  readonly editorConfigIndentStyle?: ResolvedEditorConfig["indentStyle"];
  readonly editorConfigTabWidth?: ResolvedEditorConfig["tabWidth"];
  readonly fontFamily: string;
  readonly fontLigatures: boolean | string;
  readonly fontSize: number;
  readonly minimapEnabled: boolean;
  readonly monaco: typeof Monaco | null;
  readonly wordWrapEnabled: boolean;
  readonly workspaceRoot?: string | null;
}

/**
 * Owns editor-widget presentation and focus bindings.
 *
 * The effects deliberately stay in their historical order: focus subscription,
 * widget options, then active-model EditorConfig.
 */
export function useEditorPresentationBindings({
  activeDocumentPath,
  activateFromInteraction,
  editor,
  editorConfigEndOfLine,
  editorConfigIndentSize,
  editorConfigIndentStyle,
  editorConfigTabWidth,
  fontFamily,
  fontLigatures,
  fontSize,
  minimapEnabled,
  monaco,
  wordWrapEnabled,
  workspaceRoot,
}: EditorPresentationBindingsInput): void {
  useEffect(() => {
    if (!editor) {
      return;
    }

    const disposable = editor.onDidFocusEditorWidget(activateFromInteraction);
    return () => disposable.dispose();
  }, [activateFromInteraction, editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.updateOptions({
      fontFamily,
      fontLigatures,
      fontSize,
      minimap: { enabled: minimapEnabled },
      wordWrap: wordWrapEnabled ? "on" : "off",
    });
  }, [editor, fontFamily, fontLigatures, fontSize, minimapEnabled, wordWrapEnabled]);

  useEffect(() => {
    if (!editor || !monaco || !activeDocumentPath) {
      return;
    }

    const model = editor.getModel();
    if (!model || !modelMatchesProject(model, workspaceRoot ?? null, activeDocumentPath)) {
      return;
    }

    const resolved: ResolvedEditorConfig = {
      endOfLine: editorConfigEndOfLine,
      indentSize: editorConfigIndentSize,
      indentStyle: editorConfigIndentStyle,
      tabWidth: editorConfigTabWidth,
    };
    const formattingOptions = editorConfigFormattingOptions(resolved);
    if (formattingOptions) {
      model.updateOptions({
        insertSpaces: formattingOptions.insertSpaces,
        tabSize: formattingOptions.tabSize,
      });
    }

    const eol = editorConfigEol(resolved);
    if (eol) {
      model.setEOL(
        eol === "\r\n" ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF,
      );
    }
  }, [
    activeDocumentPath,
    editor,
    editorConfigEndOfLine,
    editorConfigIndentSize,
    editorConfigIndentStyle,
    editorConfigTabWidth,
    monaco,
    workspaceRoot,
  ]);
}
