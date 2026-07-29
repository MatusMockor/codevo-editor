import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type * as Monaco from "monaco-editor";
import type { EditorChangeHunk } from "../../domain/editorChangeMarkers";
import { modelMatchesProject } from "../editorSurfaceModelIdentity";
import { toEditorChangeDecoration } from "../editorChangeMonacoMappings";
import type { EditorChangePreviewState } from "./useEditorMouseInteractions";

interface EditorChangeDecorationOptions {
  readonly activeDocumentPath?: string;
  readonly changeDecorationIdsRef: MutableRefObject<string[]>;
  readonly changeHunks: readonly EditorChangeHunk[];
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly monaco: typeof Monaco | null;
  readonly workspaceRoot: string | null;
}

export function useEditorChangeDecorations({
  activeDocumentPath,
  changeDecorationIdsRef,
  changeHunks,
  editor,
  monaco,
  workspaceRoot,
}: EditorChangeDecorationOptions): void {
  useEffect(() => {
    if (!activeDocumentPath || !editor || !monaco) {
      return;
    }

    const model = editor.getModel();

    if (!model || !modelMatchesProject(model, workspaceRoot, activeDocumentPath)) {
      return;
    }

    changeDecorationIdsRef.current = editor.deltaDecorations(
      changeDecorationIdsRef.current,
      changeHunks.map((hunk) => toEditorChangeDecoration(monaco, hunk)),
    );

    return () => {
      changeDecorationIdsRef.current = editor.deltaDecorations(changeDecorationIdsRef.current, []);
    };
  }, [activeDocumentPath, changeDecorationIdsRef, changeHunks, editor, monaco, workspaceRoot]);
}

export function useChangePreviewEscapeLifecycle(
  changePreview: EditorChangePreviewState | null,
  setChangePreview: Dispatch<SetStateAction<EditorChangePreviewState | null>>,
): void {
  useEffect(() => {
    if (!changePreview) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setChangePreview(null);
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [changePreview, setChangePreview]);
}
