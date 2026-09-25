import type { EditorGroup } from "../../domain/editorGroups";
import type { GitChangeStatus } from "../../domain/git";
import { visibleEditorPaths } from "../../domain/workspace";
import type { EditorGroupDocument } from "../EditorGroupView";

export interface EditorPanelDocumentEntry {
  readonly documentId: string;
  readonly title: string;
  readonly path: string;
  readonly dirty: boolean;
  readonly preview: boolean;
  readonly gitStatus: GitChangeStatus | null;
}

export type EditorPanelFileStatuses = Readonly<Record<string, GitChangeStatus | undefined>>;

const NO_FILE_STATUSES: EditorPanelFileStatuses = Object.freeze({});

export interface EditorPanelDocumentsSnapshot {
  readonly documents: ReadonlyArray<EditorPanelDocumentEntry>;
  readonly activeDocumentId: string | null;
}

export function editorPanelDocuments(
  group: EditorGroup,
  documents: ReadonlyArray<EditorGroupDocument>,
  fileStatusesByPath: EditorPanelFileStatuses = NO_FILE_STATUSES,
): EditorPanelDocumentsSnapshot {
  const byPath = new Map(documents.map((document) => [document.path, document]));
  const entries = visibleEditorPaths(group.openPaths, group.previewPath).flatMap(
    (path): ReadonlyArray<EditorPanelDocumentEntry> => {
      const document = byPath.get(path);
      if (document === undefined) return [];
      const dirty = documentDirty(document);
      return [
        {
          documentId: path,
          title: document.name,
          path,
          dirty,
          preview: path === group.previewPath && !dirty,
          gitStatus: fileStatusesByPath[path] ?? null,
        },
      ];
    },
  );
  return { documents: entries, activeDocumentId: group.activePath };
}

export function editorPanelDocumentsEqual(
  left: EditorPanelDocumentsSnapshot,
  right: EditorPanelDocumentsSnapshot,
): boolean {
  if (left.activeDocumentId !== right.activeDocumentId) return false;
  if (left.documents.length !== right.documents.length) return false;
  return left.documents.every((entry, index) => entriesEqual(entry, right.documents[index]));
}

function entriesEqual(
  left: EditorPanelDocumentEntry,
  right: EditorPanelDocumentEntry | undefined,
): boolean {
  if (right === undefined) return false;
  return (
    left.documentId === right.documentId &&
    left.title === right.title &&
    left.path === right.path &&
    left.dirty === right.dirty &&
    left.preview === right.preview &&
    left.gitStatus === right.gitStatus
  );
}

function documentDirty(document: EditorGroupDocument): boolean {
  if (!("savedContent" in document)) return false;
  return document.content !== document.savedContent;
}
