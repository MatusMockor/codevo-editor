import type * as Monaco from "monaco-editor";
import type { MutableRefObject } from "react";
import type { EditorDocument } from "../domain/workspace";

export interface EditorRuntimeMembershipInput {
  /** Stable editor-group identity used for focus-aware command/provider routing. */
  groupId: string;
  /** Paths owned outside the surface (open tabs, history, future LSP membership). */
  retainPaths?: readonly string[];
  /** Resolves a document by Monaco model, including a non-focused split. */
  resolveDocumentForModel?(
    model: Monaco.editor.ITextModel,
  ): EditorDocument | null;
}

export interface EditorRuntimeEditorMembership {
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  groupId: string;
  monacoApi: typeof Monaco | null;
  retainPaths: readonly string[];
  resolveDocumentForModel(
    model: Monaco.editor.ITextModel,
  ): EditorDocument | null;
}
