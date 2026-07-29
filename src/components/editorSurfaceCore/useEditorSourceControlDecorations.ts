import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import type { EditorDocument } from "../../domain/workspace";
import type { GitBlameLine } from "../../domain/git";
import { modelMatchesProject } from "../editorSurfaceModelIdentity";
import { toBookmarkDecoration, toGitBlameDecoration } from "../editorChangeMonacoMappings";

interface EditorSourceControlDecorationOptions {
  readonly activeDocumentPath: string | null | undefined;
  readonly activeDocumentRef: MutableRefObject<EditorDocument | null>;
  readonly bookmarkedLineNumbers: readonly number[];
  readonly bookmarkDecorationIdsRef: MutableRefObject<string[]>;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly gitBlameDecoratedPathRef: MutableRefObject<string | null>;
  readonly gitBlameDecorationIdsRef: MutableRefObject<string[]>;
  readonly gitBlameEnabled: boolean;
  readonly gitBlameLinesRef: MutableRefObject<GitBlameLine[]>;
  readonly monaco: typeof Monaco | null;
  readonly provideGitBlameRef: MutableRefObject<
    ((path: string) => Promise<GitBlameLine[]>) | undefined
  >;
  readonly workspaceRoot: string | null;
}

/**
 * Owns source-control-adjacent decorations whose async results must remain
 * isolated to the active model and workspace.
 */
export function useEditorSourceControlDecorations({
  activeDocumentPath,
  activeDocumentRef,
  bookmarkedLineNumbers,
  bookmarkDecorationIdsRef,
  editor,
  gitBlameDecoratedPathRef,
  gitBlameDecorationIdsRef,
  gitBlameEnabled,
  gitBlameLinesRef,
  monaco,
  provideGitBlameRef,
  workspaceRoot,
}: EditorSourceControlDecorationOptions): void {
  useEffect(() => {
    if (!activeDocumentPath || !editor || !monaco) {
      return;
    }

    const model = editor.getModel();

    if (!model || !modelMatchesProject(model, workspaceRoot, activeDocumentPath)) {
      return;
    }

    bookmarkDecorationIdsRef.current = editor.deltaDecorations(
      bookmarkDecorationIdsRef.current,
      bookmarkedLineNumbers.map((lineNumber) => toBookmarkDecoration(monaco, lineNumber)),
    );

    return () => {
      bookmarkDecorationIdsRef.current = editor.deltaDecorations(
        bookmarkDecorationIdsRef.current,
        [],
      );
    };
  }, [
    activeDocumentPath,
    bookmarkedLineNumbers,
    bookmarkDecorationIdsRef,
    editor,
    monaco,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!activeDocumentPath || !editor || !monaco) {
      return;
    }

    const model = editor.getModel();

    if (!model || !modelMatchesProject(model, workspaceRoot, activeDocumentPath)) {
      return;
    }

    const clearAnnotations = () => {
      gitBlameLinesRef.current = [];
      gitBlameDecorationIdsRef.current = editor.deltaDecorations(
        gitBlameDecorationIdsRef.current,
        [],
      );
      gitBlameDecoratedPathRef.current = null;
    };

    const provider = provideGitBlameRef.current;

    if (!gitBlameEnabled || !provider) {
      clearAnnotations();
      return;
    }

    const requestedPath = activeDocumentPath;
    let cancelled = false;

    void provider(requestedPath)
      .then((blameLines) => {
        if (cancelled || model.isDisposed?.()) {
          return;
        }

        const currentModel = editor.getModel();

        if (
          !currentModel ||
          !modelMatchesProject(currentModel, workspaceRoot, requestedPath) ||
          activeDocumentRef.current?.path !== requestedPath
        ) {
          return;
        }

        const now = Date.now();
        gitBlameLinesRef.current = blameLines;
        gitBlameDecorationIdsRef.current = editor.deltaDecorations(
          gitBlameDecorationIdsRef.current,
          blameLines.map((line) => toGitBlameDecoration(monaco, line, now)),
        );
        gitBlameDecoratedPathRef.current = requestedPath;
      })
      .catch(() => {
        // Blame is a best-effort decoration and must not disrupt editing.
      });

    return () => {
      cancelled = true;
      clearAnnotations();
    };
  }, [
    activeDocumentPath,
    activeDocumentRef,
    editor,
    gitBlameDecoratedPathRef,
    gitBlameDecorationIdsRef,
    gitBlameEnabled,
    gitBlameLinesRef,
    monaco,
    provideGitBlameRef,
    workspaceRoot,
  ]);
}
