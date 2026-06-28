import type { EditorDocument } from "./workspace";

export type WorkspaceFileChangeUnsubscribeFn = () => void;

export type WorkspaceFileChangeKind =
  | "created"
  | "deleted"
  | "modified"
  | "renamed"
  | "rescanRequired";

export type WorkspaceFileChangeFileKind = "directory" | "file";

/**
 * Filesystem change observed for an open workspace by the native (or Watchman)
 * watcher. Mirrors the Rust `WorkspaceFileChangedPayload` emitted on the
 * `workspace://file-changed` event. `previousPath` is populated for renames.
 */
export interface WorkspaceFileChangeEvent {
  rootPath: string;
  kind: WorkspaceFileChangeKind;
  path: string;
  previousPath?: string | null;
  relativePath: string;
  previousRelativePath?: string | null;
  fileKind?: WorkspaceFileChangeFileKind | null;
}

export interface WorkspaceFileChangeGateway {
  /**
   * Ensures a native watcher is running for `rootPath` so external filesystem
   * changes (delete / rename / create / modify performed outside the editor)
   * are reported. Idempotent per root.
   */
  startWatching(rootPath: string): Promise<void>;
  subscribeFileChanges(
    listener: (event: WorkspaceFileChangeEvent) => void,
  ): Promise<WorkspaceFileChangeUnsubscribeFn>;
}

/**
 * Clean editor documents can be refreshed from an external file watcher event.
 * Dirty documents must be left alone so disk changes never clobber in-editor
 * work that has not been saved yet.
 */
export function canRefreshDocumentFromExternalFileChange(
  document: Pick<EditorDocument, "content" | "savedContent"> | null | undefined,
): boolean {
  return document ? document.content === document.savedContent : false;
}
