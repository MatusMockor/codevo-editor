import type { GitChangedFile } from "../domain/git";
import {
  nextActiveEditorPathAfterClose,
  type EditorDocument,
} from "../domain/workspace";

export interface DocumentClosePlanInput {
  closePath: string;
  activePath: string | null;
  documents: Record<string, EditorDocument>;
  openPaths: string[];
  previewPath: string | null;
  gitStatusChanges: GitChangedFile[];
  gitChangeForDiffDocumentPath: (
    path: string,
    changes: GitChangedFile[],
  ) => GitChangedFile | null;
}

export interface DocumentClosePlan {
  document: EditorDocument | null;
  nextDocuments: Record<string, EditorDocument>;
  nextOpenPaths: string[];
  nextPreviewPath: string | null;
  closedActiveDocument: boolean;
  nextActivePath: string | null;
  nextGitChange: GitChangedFile | null;
}

export function planDocumentClose(
  input: DocumentClosePlanInput,
): DocumentClosePlan {
  const {
    closePath,
    activePath,
    documents,
    openPaths,
    previewPath,
    gitStatusChanges,
    gitChangeForDiffDocumentPath,
  } = input;
  const nextDocuments = { ...documents };
  const document = nextDocuments[closePath] ?? null;
  delete nextDocuments[closePath];

  const nextOpenPaths = openPaths.filter((path) => path !== closePath);
  const nextPreviewPath = previewPath === closePath ? null : previewPath;
  const closedActiveDocument = activePath === closePath;
  const nextActivePath = closedActiveDocument
    ? nextActiveEditorPathAfterClose(closePath, openPaths, previewPath)
    : null;
  const nextGitChange = nextActivePath
    ? gitChangeForDiffDocumentPath(nextActivePath, gitStatusChanges)
    : null;

  return {
    document,
    nextDocuments,
    nextOpenPaths,
    nextPreviewPath,
    closedActiveDocument,
    nextActivePath,
    nextGitChange,
  };
}
