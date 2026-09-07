import {
  getEditorDocumentDirtySnapshot,
  type EditorDocumentDirtyProjection,
} from "./editorSessionDirtyProjection";
import {
  useCallback,
  useMemo,
  type MutableRefObject,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  readWorkspaceTextFileSnapshot,
  type EditorDocument,
  type WorkspaceFileGateway,
} from "../domain/workspace";
import type { WorkspaceFileChangeEvent } from "../domain/workspaceFileChange";
import { workspacePathBelongsToRoot } from "./workbenchController/workspacePathPolicy";

export interface AgentWorktreeDocumentRefreshInput {
  readonly documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  readonly activeDocumentRef: MutableRefObject<EditorDocument | null>;
  readonly setDocuments: Dispatch<SetStateAction<Record<string, EditorDocument>>>;
  readonly workspaceFiles: WorkspaceFileGateway;
  readonly refreshExternalCleanDocument: (
    expected: EditorDocument,
    replacement: EditorDocument,
  ) => boolean;
  readonly reportChangedDocuments: (paths: string[]) => void;
  readonly resolveDocumentSessionDirtyProjection: (
    path: string,
  ) => EditorDocumentDirtyProjection | null;
  readonly reportNotice: (message: string) => void;
}

export async function refreshAgentWorktreeDocuments(
  input: AgentWorktreeDocumentRefreshInput,
  event: WorkspaceFileChangeEvent,
  isCurrent: () => boolean,
): Promise<void> {
  if (!isCurrent()) return;
  const documents = Object.values(input.documentsRef.current).filter((document) =>
    workspacePathBelongsToRoot(document.path, event.rootPath),
  );
  if (documents.length > 256) {
    input.reportNotice(
      "Too many open worktree files to refresh automatically. Reopen the files you need.",
    );
    return;
  }
  for (const document of documents) {
    if (!isCurrent()) return;
    const path = document.path;
    const projection = input.resolveDocumentSessionDirtyProjection(path);
    const isClean = () => {
      if (document.content !== document.savedContent) return false;
      if (input.resolveDocumentSessionDirtyProjection(path) !== projection) return false;
      if (!projection) return true;
      const snapshot = getEditorDocumentDirtySnapshot(projection);
      return snapshot.status === "available" && !snapshot.dirty;
    };
    if (!isClean()) {
      input.reportNotice(
        "Worktree files changed on disk. Your unsaved changes were kept; reopen the file after reviewing them.",
      );
      continue;
    }
    const currentDocument = () =>
      isCurrent() && input.documentsRef.current[path] === document && isClean();
    try {
      const snapshot = await readWorkspaceTextFileSnapshot(input.workspaceFiles, path);
      if (!currentDocument()) {
        if (isCurrent() && input.documentsRef.current[path] === document && !isClean()) {
          input.reportNotice(
            "Worktree files changed on disk. Your unsaved changes were kept; reopen the file after reviewing them.",
          );
        }
        continue;
      }
      const refreshed = {
        ...document,
        content: snapshot.content,
        savedContent: snapshot.content,
        revision: snapshot.revision,
      };
      if (projection) {
        if (!input.refreshExternalCleanDocument(document, refreshed)) {
          if (isCurrent())
            input.reportNotice(
              "The editor changed before the worktree file could be refreshed. Its open buffer was kept.",
            );
          continue;
        }
        if (!isCurrent()) return;
        input.reportChangedDocuments([path]);
        continue;
      }
      input.documentsRef.current = { ...input.documentsRef.current, [path]: refreshed };
      if (input.activeDocumentRef.current === document) input.activeDocumentRef.current = refreshed;
      input.setDocuments((state) =>
        isCurrent() && isClean() && state[path] === document
          ? { ...state, [path]: refreshed }
          : state,
      );
      if (!isCurrent()) return;
      input.reportChangedDocuments([path]);
    } catch {
      if (currentDocument())
        input.reportNotice(
          "A worktree file changed or was removed on disk. Its last open contents were kept.",
        );
    }
  }
}

export function useAgentWorktreeDocumentRefresh(
  input: AgentWorktreeDocumentRefreshInput & {
    readonly reportError: (source: string, error: unknown) => void;
    readonly editorSessionOwnerKey: string | null;
    readonly currentEditorSessionOwnerKeyRef: MutableRefObject<string | null>;
  },
) {
  const { editorSessionOwnerKey, currentEditorSessionOwnerKeyRef } = input;
  const refreshDocuments = useCallback(
    (event: WorkspaceFileChangeEvent, isCurrent: () => boolean) =>
      refreshAgentWorktreeDocuments(
        input,
        event,
        () =>
          isCurrent() &&
          editorSessionOwnerKey !== null &&
          currentEditorSessionOwnerKeyRef.current === editorSessionOwnerKey,
      ),
    [input, editorSessionOwnerKey, currentEditorSessionOwnerKeyRef],
  );
  return useMemo(
    () => ({
      refreshDocuments,
      workspaceOwnerKey: editorSessionOwnerKey,
      reportError: (error: unknown) => input.reportError("Git branch files", error),
    }),
    [refreshDocuments, input, editorSessionOwnerKey],
  );
}
