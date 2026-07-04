import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { LocalHistoryDiff, LocalHistoryGateway, LocalHistoryVersion } from "../domain/localHistory";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import type { FilePrefetchCache } from "../domain/filePrefetchCache";
import { workspaceRelativePath } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

/**
 * Collaborators the Local History (PhpStorm-style, git-independent) panel
 * needs from the workbench shell. `captureLocalHistorySnapshot` is shared with
 * the save flow (every save also records a snapshot), `syncSavedDocument` /
 * `syncSavedJavaScriptTypeScriptDocument` are shared with every other flow that
 * writes a document's content back, and `filePrefetchCacheRef` is shared across
 * every write path in the shell — all four stay shell-owned rather than being
 * duplicated here. Every piece of local-history-panel-local state (the panel
 * state, its request tokens, and the per-file path/language tracking) is owned
 * by this hook.
 */
export interface LocalHistoryDependencies {
  localHistoryGateway: LocalHistoryGateway;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  workspaceRoot: string | null;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  setDocuments: Dispatch<SetStateAction<Record<string, EditorDocument>>>;
  workspaceFiles: WorkspaceFileGateway;
  filePrefetchCacheRef: MutableRefObject<FilePrefetchCache>;
  captureLocalHistorySnapshot: (
    requestedRoot: string,
    absolutePath: string,
    content: string,
  ) => Promise<void>;
  syncSavedDocument: (document: EditorDocument) => Promise<void>;
  syncSavedJavaScriptTypeScriptDocument: (
    document: EditorDocument,
  ) => Promise<void>;
  setMessage: (message: string) => void;
  reportError: (source: string, error: unknown) => void;
  reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
}

export interface LocalHistoryPanel {
  localHistoryPanelOpen: boolean;
  localHistoryRelativePath: string | null;
  localHistoryVersions: LocalHistoryVersion[];
  localHistoryLoading: boolean;
  localHistorySelectedId: string | null;
  localHistoryDiff: LocalHistoryDiff | null;
  localHistoryDiffLoading: boolean;
  openLocalHistory: () => Promise<void>;
  selectLocalHistoryVersion: (versionId: string) => Promise<void>;
  revertLocalHistoryVersion: (versionId: string) => Promise<void>;
  closeLocalHistory: () => void;
}

/**
 * Local History (PhpStorm parity): per-workspace snapshots of a file captured
 * on save, browsed/diffed/reverted WITHOUT git. Per-tab isolated like the git
 * file history panel: a switched-away tab's late list/diff resolve can never
 * repopulate another tab's panel.
 */
export function useLocalHistory(
  dependencies: LocalHistoryDependencies,
): LocalHistoryPanel {
  const {
    localHistoryGateway,
    currentWorkspaceRootRef,
    workspaceRoot,
    activeDocumentRef,
    documentsRef,
    setDocuments,
    workspaceFiles,
    filePrefetchCacheRef,
    captureLocalHistorySnapshot,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    setMessage,
    reportError,
    reportErrorForActiveWorkspaceRoot,
  } = dependencies;

  const [localHistoryPanelOpen, setLocalHistoryPanelOpen] = useState(false);
  const [localHistoryRelativePath, setLocalHistoryRelativePath] = useState<
    string | null
  >(null);
  const [localHistoryVersions, setLocalHistoryVersions] = useState<
    LocalHistoryVersion[]
  >([]);
  const [localHistoryLoading, setLocalHistoryLoading] = useState(false);
  const [localHistorySelectedId, setLocalHistorySelectedId] = useState<
    string | null
  >(null);
  const [localHistoryDiff, setLocalHistoryDiff] =
    useState<LocalHistoryDiff | null>(null);
  const [localHistoryDiffLoading, setLocalHistoryDiffLoading] = useState(false);
  const localHistoryRequestTokenRef = useRef(0);
  const localHistoryDiffRequestTokenRef = useRef(0);
  // Mirrors the file currently shown in the local-history panel, for the same
  // reason as fileHistoryRelativePathRef: a version click always targets the
  // panel's live file, keeping the diff/revert request per-file isolated.
  const localHistoryRelativePathRef = useRef<string | null>(null);
  // The absolute path of the local-history panel's file, used to read the live
  // document content for the diff and to write the reverted content back.
  const localHistoryAbsolutePathRef = useRef<string | null>(null);
  // The Monaco language of the local-history panel's file, captured at open so
  // the version diff highlights correctly.
  const localHistoryLanguageRef = useRef<string>("plaintext");

  const closeLocalHistory = useCallback(() => {
    localHistoryRequestTokenRef.current += 1;
    localHistoryDiffRequestTokenRef.current += 1;
    localHistoryRelativePathRef.current = null;
    localHistoryAbsolutePathRef.current = null;
    setLocalHistoryPanelOpen(false);
    setLocalHistoryVersions([]);
    setLocalHistoryLoading(false);
    setLocalHistorySelectedId(null);
    setLocalHistoryDiff(null);
    setLocalHistoryDiffLoading(false);
    setLocalHistoryRelativePath(null);
  }, []);

  // Current live content of the local-history panel's file: the open editor
  // buffer when the document is loaded, otherwise null. Used as the "modified"
  // (right) side of the version diff and as the pre-revert snapshot source.
  const currentLocalHistoryContent = useCallback((): string | null => {
    const absolutePath = localHistoryAbsolutePathRef.current;

    if (!absolutePath) {
      return null;
    }

    return documentsRef.current[absolutePath]?.content ?? null;
  }, []);

  // Loads the diff for a single local-history version (selected version vs the
  // file's current content). The requested root, relative path, and request
  // token are captured up front; after the await we re-check the active root and
  // the token so a stale result from a switched-away tab or superseded click is
  // dropped (per-tab isolation).
  const selectLocalHistoryVersion = useCallback(
    async (versionId: string) => {
      const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;
      const relativePath = localHistoryRelativePathRef.current;

      if (!requestedRoot || !relativePath) {
        return;
      }

      const requestToken = localHistoryDiffRequestTokenRef.current + 1;
      localHistoryDiffRequestTokenRef.current = requestToken;
      setLocalHistorySelectedId(versionId);
      setLocalHistoryDiffLoading(true);

      const isCurrentRequest = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) &&
        localHistoryRelativePathRef.current === relativePath &&
        localHistoryDiffRequestTokenRef.current === requestToken;

      try {
        const originalContent = await localHistoryGateway.readVersion(
          requestedRoot,
          relativePath,
          versionId,
        );

        if (!isCurrentRequest()) {
          return;
        }

        setLocalHistoryDiff({
          language: localHistoryLanguageRef.current,
          modifiedContent: currentLocalHistoryContent() ?? "",
          originalContent,
        });
      } catch (error) {
        if (!isCurrentRequest()) {
          return;
        }

        setLocalHistoryDiff(null);
        reportError("Local History", error);
      } finally {
        if (isCurrentRequest()) {
          setLocalHistoryDiffLoading(false);
        }
      }
    },
    [
      currentLocalHistoryContent,
      localHistoryGateway,
      reportError,
      workspaceRoot,
    ],
  );

  // Opens the Local History panel for the active document. The requested root
  // and the active document's relative/absolute paths + language are captured up
  // front; after the await we re-check the active root, document, and request
  // token so a stale version list from a switched-away tab is dropped.
  const openLocalHistory = useCallback(async () => {
    const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;
    const document = activeDocumentRef.current;

    if (!requestedRoot || !document) {
      return;
    }

    const requestedDocumentPath = document.path;
    const relativePath = workspaceRelativePath(
      requestedRoot,
      requestedDocumentPath,
    );

    if (!relativePath) {
      return;
    }

    const requestToken = localHistoryRequestTokenRef.current + 1;
    localHistoryRequestTokenRef.current = requestToken;
    localHistoryDiffRequestTokenRef.current += 1;
    localHistoryRelativePathRef.current = relativePath;
    localHistoryAbsolutePathRef.current = requestedDocumentPath;
    localHistoryLanguageRef.current = document.language;
    setLocalHistoryRelativePath(relativePath);
    setLocalHistorySelectedId(null);
    setLocalHistoryDiff(null);
    setLocalHistoryDiffLoading(false);
    setLocalHistoryVersions([]);
    setLocalHistoryPanelOpen(true);
    setLocalHistoryLoading(true);

    const isCurrentRequest = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) &&
      activeDocumentRef.current?.path === requestedDocumentPath &&
      localHistoryRequestTokenRef.current === requestToken;

    try {
      const versions = await localHistoryGateway.listVersions(
        requestedRoot,
        relativePath,
      );

      if (!isCurrentRequest()) {
        return;
      }

      setLocalHistoryVersions(versions);
    } catch (error) {
      if (!isCurrentRequest()) {
        return;
      }

      setLocalHistoryVersions([]);
      reportError("Local History", error);
    } finally {
      if (isCurrentRequest()) {
        setLocalHistoryLoading(false);
      }
    }
  }, [localHistoryGateway, reportError, workspaceRoot]);

  // Reverts the panel's file to a stored version. Before overwriting, the
  // current content is snapshotted into Local History so the revert itself is
  // undoable. The version content is read first, then written to disk and synced
  // into the open document. All work is scoped to the root captured up front and
  // re-checked after each await so a tab switch drops the revert.
  const revertLocalHistoryVersion = useCallback(
    async (versionId: string) => {
      const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;
      const relativePath = localHistoryRelativePathRef.current;
      const absolutePath = localHistoryAbsolutePathRef.current;

      if (!requestedRoot || !relativePath || !absolutePath) {
        return;
      }

      try {
        const versionContent = await localHistoryGateway.readVersion(
          requestedRoot,
          relativePath,
          versionId,
        );

        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        // Snapshot the pre-revert content (best-effort) so the revert can be
        // undone from history too.
        const preRevertContent = currentLocalHistoryContent();
        if (preRevertContent !== null && preRevertContent !== versionContent) {
          await captureLocalHistorySnapshot(
            requestedRoot,
            absolutePath,
            preRevertContent,
          );
        }

        await workspaceFiles.writeTextFile(absolutePath, versionContent);
        filePrefetchCacheRef.current.invalidate(absolutePath);

        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        // Record the reverted content as the newest version too, so the file's
        // current on-disk state always has a matching snapshot.
        await captureLocalHistorySnapshot(
          requestedRoot,
          absolutePath,
          versionContent,
        );

        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        setDocuments((current) => {
          const existing = current[absolutePath];

          if (!existing) {
            return current;
          }

          return {
            ...current,
            [absolutePath]: {
              ...existing,
              content: versionContent,
              savedContent: versionContent,
            },
          };
        });

        const reverted = documentsRef.current[absolutePath];
        if (reverted) {
          await syncSavedDocument(reverted);
          await syncSavedJavaScriptTypeScriptDocument(reverted);
        }

        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        setMessage("Reverted to selected local history version");
        // Refresh the panel so the new version list + diff reflect the revert.
        void openLocalHistory();
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(requestedRoot, "Local History", error);
      }
    },
    [
      captureLocalHistorySnapshot,
      currentLocalHistoryContent,
      localHistoryGateway,
      openLocalHistory,
      reportErrorForActiveWorkspaceRoot,
      syncSavedDocument,
      syncSavedJavaScriptTypeScriptDocument,
      workspaceFiles,
      workspaceRoot,
    ],
  );

  return {
    localHistoryPanelOpen,
    localHistoryRelativePath,
    localHistoryVersions,
    localHistoryLoading,
    localHistorySelectedId,
    localHistoryDiff,
    localHistoryDiffLoading,
    openLocalHistory,
    selectLocalHistoryVersion,
    revertLocalHistoryVersion,
    closeLocalHistory,
  };
}
