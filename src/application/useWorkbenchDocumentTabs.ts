import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type {
  GitChangedFile,
  GitFileDiff,
  GitStatus,
} from "../domain/git";
import type { FilePrefetchCache } from "../domain/filePrefetchCache";
import {
  isPrefetchableContentSize,
  shouldPrefetchFileContent,
} from "../domain/filePrefetchCache";
import type { AppSettings } from "../domain/settings";
import {
  detectLanguage,
  getFileName,
  readWorkspaceTextFileSnapshot,
  type EditorDocument,
  type FileEntry,
  type ImageTab,
  type WorkspaceFileGateway,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { DocumentTabSessionPort } from "./documentTabSessionPort";

const FILE_PREFETCH_HOVER_DELAY_MS = 80;

export interface OpenFileOptions {
  pin?: boolean;
  readOnly?: boolean;
  recordNavigation?: boolean;
  shouldCommit?: () => boolean;
}

export interface OpenReadOnlyDocumentOptions {
  pin?: boolean;
}

export interface WorkbenchDocumentTabsDependencies {
  // Shared workspace + tab state (shell-owned).
  workspaceRoot: string | null;
  gitStatus: GitStatus;
  documentTabSession: DocumentTabSessionPort;

  appSettingsRef: MutableRefObject<AppSettings>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  openFileRequestTokenRef: MutableRefObject<number>;
  openingFileFlagOwnerTokenRef: MutableRefObject<number | null>;
  emptyDocumentRefreshTimeoutsRef: MutableRefObject<Set<number>>;
  filePrefetchCacheRef: MutableRefObject<FilePrefetchCache>;
  filePrefetchTimersRef: MutableRefObject<
    Map<string, ReturnType<typeof setTimeout>>
  >;
  gitDiffRequestTokenRef: MutableRefObject<number>;
  selectedGitChangeRef: MutableRefObject<GitChangedFile | null>;

  setIsOpeningFile: Dispatch<SetStateAction<boolean>>;
  setSelectedGitChange: Dispatch<SetStateAction<GitChangedFile | null>>;
  setGitDiffPreview: Dispatch<SetStateAction<GitFileDiff | null>>;
  setGitDiffLoading: Dispatch<SetStateAction<boolean>>;
  setMessage: Dispatch<SetStateAction<string | null>>;

  // Gateways.
  workspaceFiles: WorkspaceFileGateway;

  // Shell-owned collaborators.
  forgetExternallyRemovedDocumentPath: (path: string) => void;
  gitChangeForDiffDocumentPath: (
    path: string,
    changes: GitChangedFile[],
  ) => GitChangedFile | null;
  loadGitDiffDocument: (path: string, gitChange: GitChangedFile) => void;
  recordCurrentNavigationLocation: () => void;
  recordRecentFile: (entry: { name: string; path: string }) => void;
  refreshLocalPhpDiagnosticsForContent: (
    path: string,
    content: string,
    language: EditorDocument["language"],
  ) => void;
  syncClosedDocument: (document: EditorDocument) => Promise<void>;
  syncClosedJavaScriptTypeScriptDocument: (
    document: EditorDocument,
  ) => Promise<void>;
  workspacePathBelongsToRoot: (
    path: string,
    workspaceRoot: string | null | undefined,
  ) => boolean;
  reportError: (source: string, error: unknown) => void;
  reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
}

export interface WorkbenchDocumentTabs {
  activateDocument: (path: string) => void;
  pinDocument: (path: string) => void;
  openFile: (entry: FileEntry, options?: OpenFileOptions) => Promise<boolean>;
  previewFile: (entry: FileEntry) => Promise<void>;
  openPinnedFile: (entry: FileEntry) => Promise<boolean>;
  openReadOnlyDocument: (
    document: EditorDocument,
    options?: OpenReadOnlyDocumentOptions,
  ) => void;
  prefetchFile: (entry: FileEntry) => void;
  cancelFilePrefetch: (entry: FileEntry) => void;
}

/**
 * Document tab/open-file operations extracted from the workbench shell. The
 * shell owns the broad tab state and live refs; this hook owns the cohesive
 * callbacks for activation, preview replacement, pinning, open-file reads,
 * read-only tabs, and hover prefetch.
 */
export function useWorkbenchDocumentTabs(
  dependencies: WorkbenchDocumentTabsDependencies,
): WorkbenchDocumentTabs {
  const {
    workspaceRoot,
    gitStatus,
    documentTabSession,
    appSettingsRef,
    currentWorkspaceRootRef,
    openFileRequestTokenRef,
    openingFileFlagOwnerTokenRef,
    emptyDocumentRefreshTimeoutsRef,
    filePrefetchCacheRef,
    filePrefetchTimersRef,
    gitDiffRequestTokenRef,
    selectedGitChangeRef,
    setIsOpeningFile,
    setSelectedGitChange,
    setGitDiffPreview,
    setGitDiffLoading,
    setMessage,
    workspaceFiles,
    forgetExternallyRemovedDocumentPath,
    gitChangeForDiffDocumentPath,
    loadGitDiffDocument,
    recordCurrentNavigationLocation,
    recordRecentFile,
    refreshLocalPhpDiagnosticsForContent,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    workspacePathBelongsToRoot,
    reportError,
    reportErrorForActiveWorkspaceRoot,
  } = dependencies;

  const activateDocument = useCallback(
    (path: string) => {
      if (documentTabSession.getActivePath() === path) {
        return;
      }

      const gitChange = gitChangeForDiffDocumentPath(path, gitStatus.changes);

      if (gitChange) {
        loadGitDiffDocument(path, gitChange);
        return;
      }

      recordCurrentNavigationLocation();
      selectedGitChangeRef.current = null;
      setSelectedGitChange(null);
      setGitDiffPreview(null);
      documentTabSession.activate(path);
      recordRecentFile({
        name: documentTabSession.getTabDisplayName(path) ?? getFileName(path),
        path,
      });
    },
    [
      documentTabSession,
      gitChangeForDiffDocumentPath,
      gitStatus.changes,
      loadGitDiffDocument,
      recordCurrentNavigationLocation,
      recordRecentFile,
      selectedGitChangeRef,
      setGitDiffPreview,
      setSelectedGitChange,
    ],
  );

  const pinDocument = useCallback(
    (path: string) => {
      documentTabSession.pin(path);
    },
    [documentTabSession],
  );

  const openFile = useCallback(
    async (entry: FileEntry, options: OpenFileOptions = {}) => {
      const requestToken = openFileRequestTokenRef.current + 1;
      openFileRequestTokenRef.current = requestToken;
      forgetExternallyRemovedDocumentPath(entry.path);
      const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;
      const shouldRecordNavigation = options.recordNavigation !== false;
      const shouldPin = options.pin === true;
      const readTextFileForEmptyDocumentRefresh = async (
        targetPath: string,
      ): Promise<string | null> => {
        try {
          return await workspaceFiles.readTextFile(targetPath);
        } catch {
          return null;
        }
      };
      const belongsToInactiveWorkspaceTab = appSettingsRef.current.workspaceTabs.some(
        (tabPath) =>
          !workspaceRootKeysEqual(tabPath, requestedRoot) &&
          workspacePathBelongsToRoot(entry.path, tabPath),
      );

      if (belongsToInactiveWorkspaceTab) {
        return false;
      }

      if (isImagePath(entry.path)) {
        try {
          if (!workspaceFiles.readImageFile) {
            throw new Error("Image viewing is unavailable for this workspace.");
          }
          const payload = await workspaceFiles.readImageFile(entry.path);
          if (
            openFileRequestTokenRef.current !== requestToken ||
            (requestedRoot !== null &&
              !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) ||
            options.shouldCommit?.() === false
          ) {
            return false;
          }
          const image: ImageTab = {
            path: entry.path,
            name: entry.name,
            byteLength: payload.byteLength,
            dataUrl: `data:${imageMimeType(entry.path)};base64,${payload.base64}`,
          };
          const commit = documentTabSession.commitImageOpen(image);
          if (commit.replacedDocument) {
            void syncClosedDocument(commit.replacedDocument);
            void syncClosedJavaScriptTypeScriptDocument(
              commit.replacedDocument,
            );
          }
          selectedGitChangeRef.current = null;
          setSelectedGitChange(null);
          setGitDiffPreview(null);
          setMessage(null);
          recordRecentFile({ name: entry.name, path: entry.path });
          return true;
        } catch (error) {
          if (
            openFileRequestTokenRef.current !== requestToken ||
            (requestedRoot !== null &&
              !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot))
          ) {
            return false;
          }
          if (requestedRoot) {
            reportErrorForActiveWorkspaceRoot(requestedRoot, "Open Image", error);
            return false;
          }
          reportError("Open Image", error);
          return false;
        }
      }

      const scheduleEmptyDocumentRefresh = (targetPath: string) => {
        const timeoutId = window.setTimeout(() => {
          emptyDocumentRefreshTimeoutsRef.current.delete(timeoutId);

          const refreshEmptyDocument = async () => {
            if (
              requestedRoot !== null &&
              !workspaceRootKeysEqual(
                currentWorkspaceRootRef.current,
                requestedRoot,
              )
            ) {
              return;
            }

            const currentDocument = documentTabSession.getDocument(targetPath);

            if (
              !currentDocument ||
              currentDocument.content !== "" ||
              currentDocument.savedContent !== ""
            ) {
              return;
            }

            let refreshedContent = "";

            try {
              refreshedContent = await workspaceFiles.readTextFile(targetPath);
            } catch {
              return;
            }

            if (
              refreshedContent === "" ||
              (requestedRoot !== null &&
                !workspaceRootKeysEqual(
                  currentWorkspaceRootRef.current,
                  requestedRoot,
                ))
            ) {
              return;
            }

            const refreshedDocument =
              documentTabSession.refreshCleanDocument(
                targetPath,
                refreshedContent,
              );

            if (!refreshedDocument) {
              return;
            }
            refreshLocalPhpDiagnosticsForContent(
              refreshedDocument.path,
              refreshedDocument.content,
              refreshedDocument.language,
            );
          };

          void refreshEmptyDocument();
        }, 150);

        emptyDocumentRefreshTimeoutsRef.current.add(timeoutId);
      };

      const existingDocument = documentTabSession.getDocument(entry.path);

      if (existingDocument) {
        if (options.shouldCommit?.() === false) {
          return false;
        }

        const openedDocument = existingDocument;
        const hasEmptySavedContentWithoutUnsavedEdits =
          openedDocument.savedContent === "" && openedDocument.content === "";

        const refreshedContent = hasEmptySavedContentWithoutUnsavedEdits
          ? await readTextFileForEmptyDocumentRefresh(entry.path)
          : null;

        if (refreshedContent !== null) {
          const requestStillActive =
            openFileRequestTokenRef.current === requestToken &&
            (requestedRoot === null ||
              workspaceRootKeysEqual(
                currentWorkspaceRootRef.current,
                requestedRoot,
              )) &&
            options.shouldCommit?.() !== false;

          if (!requestStillActive) {
            return false;
          }

          const liveDocument = documentTabSession.getDocument(entry.path);
          const stillEmptyAndUnedited =
            liveDocument?.savedContent === "" && liveDocument.content === "";

          if (refreshedContent !== "" && stillEmptyAndUnedited) {
            const refreshedDocument =
              documentTabSession.refreshCleanDocument(
                entry.path,
                refreshedContent,
              );

            if (refreshedDocument) {
              refreshLocalPhpDiagnosticsForContent(
                refreshedDocument.path,
                refreshedDocument.content,
                refreshedDocument.language,
              );
            }
          } else if (refreshedContent === "" && stillEmptyAndUnedited) {
            scheduleEmptyDocumentRefresh(entry.path);
          }
        }

        if (
          shouldRecordNavigation &&
          documentTabSession.getActivePath() !== entry.path
        ) {
          recordCurrentNavigationLocation();
        }

        const opened = documentTabSession.openExistingDocument({
          path: entry.path,
          pin: shouldPin,
          readOnly: options.readOnly === true,
        });

        if (!opened) {
          return false;
        }

        if (opened.replacedDocument) {
          void syncClosedDocument(opened.replacedDocument);
          void syncClosedJavaScriptTypeScriptDocument(opened.replacedDocument);
        }

        selectedGitChangeRef.current = null;
        setSelectedGitChange(null);
        setGitDiffPreview(null);
        const activatedDocument = opened.document;
        refreshLocalPhpDiagnosticsForContent(
          activatedDocument.path,
          activatedDocument.content,
          activatedDocument.language,
        );
        recordRecentFile({ name: entry.name, path: entry.path });
        return true;
      }

      const clearOpeningFileForRequest = () => {
        if (openingFileFlagOwnerTokenRef.current !== requestToken) {
          return;
        }

        openingFileFlagOwnerTokenRef.current = null;
        setIsOpeningFile(false);
      };

      try {
        const prefetchedContent = filePrefetchCacheRef.current.get(
          requestedRoot,
          entry.path,
        );
        const hasUsablePrefetchedContent =
          prefetchedContent !== null && prefetchedContent !== "";

        if (!hasUsablePrefetchedContent) {
          openingFileFlagOwnerTokenRef.current = requestToken;
          setIsOpeningFile(true);
        }

        const snapshot =
          hasUsablePrefetchedContent && !workspaceFiles.readTextFileSnapshot
            ? { content: prefetchedContent, revision: null }
            : await readWorkspaceTextFileSnapshot(workspaceFiles, entry.path);
        const content =
          hasUsablePrefetchedContent && prefetchedContent === snapshot.content
            ? prefetchedContent
            : snapshot.content;

        if (
          openFileRequestTokenRef.current !== requestToken ||
          (requestedRoot !== null &&
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) ||
          options.shouldCommit?.() === false
        ) {
          clearOpeningFileForRequest();
          return false;
        }

        const document: EditorDocument = {
          path: entry.path,
          name: entry.name,
          content,
          savedContent: content,
          language: detectLanguage(entry.path),
          revision: snapshot.revision,
          readOnly: options.readOnly === true ? true : undefined,
        };

        if (shouldRecordNavigation) {
          recordCurrentNavigationLocation();
        }

        const commit = documentTabSession.commitTextOpen({
          document,
          pin: shouldPin,
        });

        if (commit.replacedDocument) {
          void syncClosedDocument(commit.replacedDocument);
          void syncClosedJavaScriptTypeScriptDocument(
            commit.replacedDocument,
          );
        }

        refreshLocalPhpDiagnosticsForContent(
          document.path,
          document.content,
          document.language,
        );

        selectedGitChangeRef.current = null;
        setSelectedGitChange(null);
        setGitDiffPreview(null);
        recordRecentFile({ name: entry.name, path: entry.path });
        setMessage(null);
        filePrefetchCacheRef.current.invalidate(entry.path);
        if (content === "") {
          scheduleEmptyDocumentRefresh(entry.path);
        }
        clearOpeningFileForRequest();
        return true;
      } catch (error) {
        if (
          openFileRequestTokenRef.current !== requestToken ||
          (requestedRoot !== null &&
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot))
        ) {
          clearOpeningFileForRequest();
          return false;
        }

        clearOpeningFileForRequest();

        if (requestedRoot) {
          reportErrorForActiveWorkspaceRoot(requestedRoot, "Open File", error);
        } else {
          reportError("Open File", error);
        }
        return false;
      }
    },
    [
      appSettingsRef,
      currentWorkspaceRootRef,
      documentTabSession,
      emptyDocumentRefreshTimeoutsRef,
      filePrefetchCacheRef,
      forgetExternallyRemovedDocumentPath,
      openFileRequestTokenRef,
      openingFileFlagOwnerTokenRef,
      recordCurrentNavigationLocation,
      recordRecentFile,
      refreshLocalPhpDiagnosticsForContent,
      reportError,
      reportErrorForActiveWorkspaceRoot,
      selectedGitChangeRef,
      setGitDiffPreview,
      setIsOpeningFile,
      setMessage,
      setSelectedGitChange,
      syncClosedDocument,
      syncClosedJavaScriptTypeScriptDocument,
      workspaceFiles,
      workspacePathBelongsToRoot,
      workspaceRoot,
    ],
  );

  const prefetchFileContentNow = useCallback(
    async (entry: FileEntry) => {
      if (entry.kind === "directory") {
        return;
      }

      if (!shouldPrefetchFileContent(entry.path)) {
        return;
      }

      const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;

      if (documentTabSession.getDocument(entry.path)) {
        return;
      }

      if (filePrefetchCacheRef.current.has(requestedRoot, entry.path)) {
        return;
      }

      try {
        const content = await workspaceFiles.readTextFile(entry.path);

        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        if (documentTabSession.getDocument(entry.path)) {
          return;
        }

        if (!isPrefetchableContentSize(content)) {
          return;
        }

        filePrefetchCacheRef.current.set(requestedRoot, entry.path, content);
      } catch {
        // Prefetch is a best-effort optimization; ignore read failures so the
        // real open path remains the source of truth.
      }
    },
    [
      currentWorkspaceRootRef,
      documentTabSession,
      filePrefetchCacheRef,
      workspaceFiles,
      workspaceRoot,
    ],
  );

  const prefetchFile = useCallback(
    (entry: FileEntry) => {
      if (entry.kind === "directory") {
        return;
      }

      if (!shouldPrefetchFileContent(entry.path)) {
        return;
      }

      const timers = filePrefetchTimersRef.current;

      if (timers.has(entry.path)) {
        return;
      }

      const timer = setTimeout(() => {
        timers.delete(entry.path);
        void prefetchFileContentNow(entry);
      }, FILE_PREFETCH_HOVER_DELAY_MS);

      timers.set(entry.path, timer);
    },
    [filePrefetchTimersRef, prefetchFileContentNow],
  );

  const cancelFilePrefetch = useCallback(
    (entry: FileEntry) => {
      const timers = filePrefetchTimersRef.current;
      const timer = timers.get(entry.path);

      if (timer === undefined) {
        return;
      }

      clearTimeout(timer);
      timers.delete(entry.path);
    },
    [filePrefetchTimersRef],
  );

  const previewFile = useCallback(
    async (entry: FileEntry) => {
      await openFile(entry);
    },
    [openFile],
  );

  const openPinnedFile = useCallback(
    async (entry: FileEntry) => {
      return openFile(entry, { pin: true });
    },
    [openFile],
  );

  const openReadOnlyDocument = useCallback(
    (document: EditorDocument, options: OpenReadOnlyDocumentOptions = {}) => {
      const nextDocument = {
        ...document,
        readOnly: true,
        savedContent: document.savedContent ?? document.content,
      };

      recordCurrentNavigationLocation();
      const commit = documentTabSession.openReadOnlyDocument(
        nextDocument,
        options.pin === true,
      );

      if (commit.replacedDocument) {
        void syncClosedDocument(commit.replacedDocument);
        void syncClosedJavaScriptTypeScriptDocument(commit.replacedDocument);
      }
      selectedGitChangeRef.current = null;
      setSelectedGitChange(null);
      setGitDiffPreview(null);
      setGitDiffLoading(false);
      gitDiffRequestTokenRef.current += 1;
      setMessage(null);
    },
    [
      documentTabSession,
      gitDiffRequestTokenRef,
      recordCurrentNavigationLocation,
      selectedGitChangeRef,
      setGitDiffLoading,
      setGitDiffPreview,
      setMessage,
      setSelectedGitChange,
      syncClosedDocument,
      syncClosedJavaScriptTypeScriptDocument,
    ],
  );

  return {
    activateDocument,
    pinDocument,
    openFile,
    previewFile,
    openPinnedFile,
    openReadOnlyDocument,
    prefetchFile,
    cancelFilePrefetch,
  };
}

const IMAGE_EXTENSIONS = new Set(["bmp", "gif", "ico", "jpeg", "jpg", "png", "webp"]);

export function isImagePath(path: string): boolean {
  const extension = path.toLowerCase().split(".").pop() ?? "";
  return IMAGE_EXTENSIONS.has(extension);
}

function imageMimeType(path: string): string {
  const extension = path.toLowerCase().split(".").pop();
  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg";
  }
  if (extension === "ico") {
    return "image/x-icon";
  }
  return `image/${extension}`;
}
