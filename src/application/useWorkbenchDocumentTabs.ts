import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { FilePrefetchCache } from "../domain/filePrefetchCache";
import {
  isPrefetchableContentSize,
  shouldPrefetchFileContent,
} from "../domain/filePrefetchCache";
import type { AppSettings } from "../domain/settings";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
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

function replaceOpeningFileOwner(
  ownerRef: MutableRefObject<number | null>,
  setIsOpeningFile: Dispatch<SetStateAction<boolean>>,
  nextOwner: number | null,
): void {
  if (ownerRef.current === nextOwner) {
    return;
  }

  ownerRef.current = nextOwner;
  setIsOpeningFile(nextOwner !== null);
}

function releaseOpeningFileOwner(
  ownerRef: MutableRefObject<number | null>,
  setIsOpeningFile: Dispatch<SetStateAction<boolean>>,
  owner: number,
): void {
  if (ownerRef.current !== owner) {
    return;
  }

  replaceOpeningFileOwner(ownerRef, setIsOpeningFile, null);
}

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
  documentTabSession: DocumentTabSessionPort;

  appSettingsRef: MutableRefObject<AppSettings>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  resolveCurrentWorkspaceRuntimeOwner: () => WorkspaceRuntimeOwner | null;
  openFileRequestTokenRef: MutableRefObject<number>;
  openingFileFlagOwnerTokenRef: MutableRefObject<number | null>;
  emptyDocumentRefreshTimeoutsRef: MutableRefObject<Set<number>>;
  filePrefetchCacheRef: MutableRefObject<FilePrefetchCache>;
  filePrefetchTimersRef: MutableRefObject<
    Map<string, ReturnType<typeof setTimeout>>
  >;

  setIsOpeningFile: Dispatch<SetStateAction<boolean>>;

  // Gateways.
  workspaceFiles: WorkspaceFileGateway;

  // Shell-owned collaborators.
  forgetExternallyRemovedDocumentPath: (path: string) => void;
  clearGitDiffPreviewState: () => void;
  isGitDiffDocumentPath: (path: string) => boolean;
  loadGitDiffDocument: (path: string) => void;
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
    documentTabSession,
    appSettingsRef,
    currentWorkspaceRootRef,
    resolveCurrentWorkspaceRuntimeOwner,
    openFileRequestTokenRef,
    openingFileFlagOwnerTokenRef,
    emptyDocumentRefreshTimeoutsRef,
    filePrefetchCacheRef,
    filePrefetchTimersRef,
    setIsOpeningFile,
    workspaceFiles,
    forgetExternallyRemovedDocumentPath,
    clearGitDiffPreviewState,
    isGitDiffDocumentPath,
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

  const leaveGitDiff = useCallback(() => {
    clearGitDiffPreviewState();
  }, [clearGitDiffPreviewState]);

  const activateDocument = useCallback(
    (path: string) => {
      if (documentTabSession.getActivePath() === path) {
        return;
      }

      if (isGitDiffDocumentPath(path)) {
        loadGitDiffDocument(path);
        return;
      }

      recordCurrentNavigationLocation();
      leaveGitDiff();
      documentTabSession.activate(path);
      recordRecentFile({
        name: documentTabSession.getTabDisplayName(path) ?? getFileName(path),
        path,
      });
    },
    [
      documentTabSession,
      isGitDiffDocumentPath,
      leaveGitDiff,
      loadGitDiffDocument,
      recordCurrentNavigationLocation,
      recordRecentFile,
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
      replaceOpeningFileOwner(
        openingFileFlagOwnerTokenRef,
        setIsOpeningFile,
        null,
      );
      forgetExternallyRemovedDocumentPath(entry.path);
      const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;
      const requestedOwner = resolveCurrentWorkspaceRuntimeOwner();
      const requestedOwnerStillCurrent = () =>
        requestedOwner?.ownerKey ===
        resolveCurrentWorkspaceRuntimeOwner()?.ownerKey;
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

      leaveGitDiff();

      if (isImagePath(entry.path)) {
        try {
          if (!workspaceFiles.readImageFile) {
            throw new Error("Image viewing is unavailable for this workspace.");
          }
          const payload = await workspaceFiles.readImageFile(entry.path);
          if (
            openFileRequestTokenRef.current !== requestToken ||
            !requestedOwnerStillCurrent() ||
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
          recordRecentFile({ name: entry.name, path: entry.path });
          return true;
        } catch (error) {
          if (
            openFileRequestTokenRef.current !== requestToken ||
            !requestedOwnerStillCurrent() ||
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
            if (!requestedOwnerStillCurrent()) {
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
              !requestedOwnerStillCurrent()
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
            requestedOwnerStillCurrent() &&
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
        releaseOpeningFileOwner(
          openingFileFlagOwnerTokenRef,
          setIsOpeningFile,
          requestToken,
        );
      };

      try {
        const prefetchedContent = filePrefetchCacheRef.current.get(
          requestedRoot,
          entry.path,
        );
        const hasUsablePrefetchedContent =
          prefetchedContent !== null && prefetchedContent !== "";

        if (!hasUsablePrefetchedContent) {
          replaceOpeningFileOwner(
            openingFileFlagOwnerTokenRef,
            setIsOpeningFile,
            requestToken,
          );
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
          !requestedOwnerStillCurrent() ||
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

        recordRecentFile({ name: entry.name, path: entry.path });
        filePrefetchCacheRef.current.invalidate(entry.path);
        if (content === "") {
          scheduleEmptyDocumentRefresh(entry.path);
        }
        clearOpeningFileForRequest();
        return true;
      } catch (error) {
        if (
          openFileRequestTokenRef.current !== requestToken ||
          !requestedOwnerStillCurrent() ||
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
      leaveGitDiff,
      openFileRequestTokenRef,
      openingFileFlagOwnerTokenRef,
      recordCurrentNavigationLocation,
      recordRecentFile,
      refreshLocalPhpDiagnosticsForContent,
      resolveCurrentWorkspaceRuntimeOwner,
      reportError,
      reportErrorForActiveWorkspaceRoot,
      setIsOpeningFile,
      syncClosedDocument,
      syncClosedJavaScriptTypeScriptDocument,
      workspaceFiles,
      workspacePathBelongsToRoot,
      workspaceRoot,
    ],
  );

  const prefetchFileContentNow = useCallback(
    async (
      entry: FileEntry,
      requestedRoot: string | null,
      requestedOwner: WorkspaceRuntimeOwner | null,
    ) => {
      if (entry.kind === "directory") {
        return;
      }

      if (!shouldPrefetchFileContent(entry.path)) {
        return;
      }

      const requestedOwnerStillCurrent = () =>
        requestedOwner?.ownerKey ===
        resolveCurrentWorkspaceRuntimeOwner()?.ownerKey;

      if (!requestedOwnerStillCurrent()) {
        return;
      }

      if (documentTabSession.getDocument(entry.path)) {
        return;
      }

      if (filePrefetchCacheRef.current.has(requestedRoot, entry.path)) {
        return;
      }

      try {
        const content = await workspaceFiles.readTextFile(entry.path);

        if (!requestedOwnerStillCurrent()) {
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
      documentTabSession,
      filePrefetchCacheRef,
      resolveCurrentWorkspaceRuntimeOwner,
      workspaceFiles,
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

      const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;
      const requestedOwner = resolveCurrentWorkspaceRuntimeOwner();
      const timer = setTimeout(() => {
        timers.delete(entry.path);
        void prefetchFileContentNow(entry, requestedRoot, requestedOwner);
      }, FILE_PREFETCH_HOVER_DELAY_MS);

      timers.set(entry.path, timer);
    },
    [
      currentWorkspaceRootRef,
      filePrefetchTimersRef,
      prefetchFileContentNow,
      resolveCurrentWorkspaceRuntimeOwner,
      workspaceRoot,
    ],
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
      leaveGitDiff();
    },
    [
      documentTabSession,
      leaveGitDiff,
      recordCurrentNavigationLocation,
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
