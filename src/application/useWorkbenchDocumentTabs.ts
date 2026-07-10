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
  type WorkspaceFileGateway,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  documentSessionPathTransitionForOpenedPath,
  pinDocumentSessionPath,
  replaceableDocumentSessionPreview,
} from "./documentSessionState";

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
  activePath: string | null;
  documents: Record<string, EditorDocument>;
  openPaths: string[];
  gitStatus: GitStatus;

  appSettingsRef: MutableRefObject<AppSettings>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  openPathsRef: MutableRefObject<string[]>;
  previewPathRef: MutableRefObject<string | null>;
  openFileRequestTokenRef: MutableRefObject<number>;
  openingFileFlagOwnerTokenRef: MutableRefObject<number | null>;
  emptyDocumentRefreshTimeoutsRef: MutableRefObject<Set<number>>;
  filePrefetchCacheRef: MutableRefObject<FilePrefetchCache>;
  filePrefetchTimersRef: MutableRefObject<
    Map<string, ReturnType<typeof setTimeout>>
  >;
  gitDiffRequestTokenRef: MutableRefObject<number>;
  selectedGitChangeRef: MutableRefObject<GitChangedFile | null>;

  setDocuments: Dispatch<SetStateAction<Record<string, EditorDocument>>>;
  setOpenPaths: Dispatch<SetStateAction<string[]>>;
  setPreviewPath: Dispatch<SetStateAction<string | null>>;
  setActivePath: Dispatch<SetStateAction<string | null>>;
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
    activePath,
    documents,
    openPaths,
    gitStatus,
    appSettingsRef,
    currentWorkspaceRootRef,
    activeDocumentRef,
    documentsRef,
    openPathsRef,
    previewPathRef,
    openFileRequestTokenRef,
    openingFileFlagOwnerTokenRef,
    emptyDocumentRefreshTimeoutsRef,
    filePrefetchCacheRef,
    filePrefetchTimersRef,
    gitDiffRequestTokenRef,
    selectedGitChangeRef,
    setDocuments,
    setOpenPaths,
    setPreviewPath,
    setActivePath,
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
      if (activePath === path) {
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
      setActivePath(path);
      recordRecentFile({
        name: documentsRef.current[path]?.name ?? getFileName(path),
        path,
      });
    },
    [
      activePath,
      gitChangeForDiffDocumentPath,
      gitStatus.changes,
      loadGitDiffDocument,
      recordCurrentNavigationLocation,
      recordRecentFile,
      selectedGitChangeRef,
      setActivePath,
      setGitDiffPreview,
      setSelectedGitChange,
      documentsRef,
    ],
  );

  const pinDocument = useCallback(
    (path: string) => {
      setOpenPaths((current) =>
        pinDocumentSessionPath(current, previewPathRef.current, path)
          .nextOpenPaths,
      );
      setPreviewPath((current) =>
        pinDocumentSessionPath(openPathsRef.current, current, path)
          .nextPreviewPath,
      );
    },
    [openPathsRef, previewPathRef, setOpenPaths, setPreviewPath],
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

            const currentDocument = documentsRef.current[targetPath];

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

            const latestDocument = documentsRef.current[targetPath];

            if (
              !latestDocument ||
              latestDocument.content !== "" ||
              latestDocument.savedContent !== ""
            ) {
              return;
            }

            const refreshedDocument: EditorDocument = {
              ...latestDocument,
              content: refreshedContent,
              savedContent: refreshedContent,
            };

            documentsRef.current = {
              ...documentsRef.current,
              [targetPath]: refreshedDocument,
            };
            activeDocumentRef.current =
              activeDocumentRef.current?.path === targetPath
                ? refreshedDocument
                : activeDocumentRef.current;
            setDocuments((current) => {
              const currentDocument = current[targetPath];

              if (
                !currentDocument ||
                currentDocument.content !== "" ||
                currentDocument.savedContent !== ""
              ) {
                return current;
              }

              return {
                ...current,
                [targetPath]: {
                  ...currentDocument,
                  content: refreshedContent,
                  savedContent: refreshedContent,
                },
              };
            });
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

      const existingDocument =
        documentsRef.current[entry.path] ?? documents[entry.path];

      if (existingDocument) {
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
              ));

          if (!requestStillActive) {
            return false;
          }

          const stillEmptyAndUnedited =
            documentsRef.current[entry.path]?.savedContent === "" &&
            documentsRef.current[entry.path]?.content === "";

          if (refreshedContent !== "" && stillEmptyAndUnedited) {
            const refreshedDocument: EditorDocument = {
              ...documentsRef.current[entry.path],
              content: refreshedContent,
              savedContent: refreshedContent,
            };
            activeDocumentRef.current =
              activeDocumentRef.current?.path === entry.path
                ? refreshedDocument
                : activeDocumentRef.current;
            documentsRef.current = {
              ...documentsRef.current,
              [entry.path]: refreshedDocument,
            };
            setDocuments((current) => ({
              ...current,
              [entry.path]: {
                ...(current[entry.path] ?? refreshedDocument),
                content: refreshedContent,
                savedContent: refreshedContent,
              },
            }));
            refreshLocalPhpDiagnosticsForContent(
              refreshedDocument.path,
              refreshedDocument.content,
              refreshedDocument.language,
            );
          } else if (refreshedContent === "" && stillEmptyAndUnedited) {
            scheduleEmptyDocumentRefresh(entry.path);
          }
        }

        const documentToMakeReadOnly =
          documentsRef.current[entry.path] ?? documents[entry.path];

        if (options.readOnly === true && !documentToMakeReadOnly.readOnly) {
          const readOnlyDocument = {
            ...documentToMakeReadOnly,
            readOnly: true,
          };
          activeDocumentRef.current =
            activeDocumentRef.current?.path === entry.path
              ? readOnlyDocument
              : activeDocumentRef.current;
          documentsRef.current = {
            ...documentsRef.current,
            [entry.path]: readOnlyDocument,
          };
          setDocuments((current) => ({
            ...current,
            [entry.path]: {
              ...(current[entry.path] ?? readOnlyDocument),
              readOnly: true,
            },
          }));
        }

        if (shouldRecordNavigation && activePath !== entry.path) {
          recordCurrentNavigationLocation();
        }

        if (!shouldPin && !openPaths.includes(entry.path)) {
          setPreviewPath(entry.path);
        }

        if (shouldPin) {
          pinDocument(entry.path);
        }

        selectedGitChangeRef.current = null;
        setSelectedGitChange(null);
        setGitDiffPreview(null);
        const activatedDocument =
          documentsRef.current[entry.path] ??
          documents[entry.path] ??
          openedDocument;
        refreshLocalPhpDiagnosticsForContent(
          activatedDocument.path,
          activatedDocument.content,
          activatedDocument.language,
        );
        setActivePath(entry.path);
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

        // Compute the replacement from live refs after the read resolves, so a
        // rapid preview sequence never acts on a stale closure capture.
        const replacement = replaceableDocumentSessionPreview(
          activeDocumentRef.current,
          documentsRef.current,
          openPathsRef.current,
          previewPathRef.current,
        );
        const replacedPath = replacement?.path ?? null;

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

        if (replacement) {
          void syncClosedDocument(replacement);
          void syncClosedJavaScriptTypeScriptDocument(replacement);
        }

        const nextDocuments = {
          ...documentsRef.current,
          [entry.path]: document,
        };

        if (replacedPath) {
          delete nextDocuments[replacedPath];
        }

        const pathTransition = documentSessionPathTransitionForOpenedPath({
          openPaths: openPathsRef.current,
          path: entry.path,
          pin: shouldPin,
          replacedPath,
        });

        documentsRef.current = nextDocuments;
        activeDocumentRef.current = document;
        openPathsRef.current = pathTransition.nextOpenPaths;
        previewPathRef.current = pathTransition.nextPreviewPath;
        refreshLocalPhpDiagnosticsForContent(
          document.path,
          document.content,
          document.language,
        );

        setDocuments((current) => {
          const next = { ...current, [entry.path]: document };

          if (replacedPath) {
            delete next[replacedPath];
          }

          return next;
        });
        setOpenPaths((current) => {
          return documentSessionPathTransitionForOpenedPath({
            openPaths: current,
            path: entry.path,
            pin: shouldPin,
            replacedPath,
          }).nextOpenPaths;
        });
        setPreviewPath(pathTransition.nextPreviewPath);

        selectedGitChangeRef.current = null;
        setSelectedGitChange(null);
        setGitDiffPreview(null);
        setActivePath(entry.path);
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
      activeDocumentRef,
      activePath,
      appSettingsRef,
      currentWorkspaceRootRef,
      documents,
      documentsRef,
      emptyDocumentRefreshTimeoutsRef,
      filePrefetchCacheRef,
      forgetExternallyRemovedDocumentPath,
      openFileRequestTokenRef,
      openingFileFlagOwnerTokenRef,
      openPaths,
      openPathsRef,
      pinDocument,
      previewPathRef,
      recordCurrentNavigationLocation,
      recordRecentFile,
      refreshLocalPhpDiagnosticsForContent,
      reportError,
      reportErrorForActiveWorkspaceRoot,
      selectedGitChangeRef,
      setActivePath,
      setDocuments,
      setGitDiffPreview,
      setIsOpeningFile,
      setMessage,
      setOpenPaths,
      setPreviewPath,
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

      if (documentsRef.current[entry.path]) {
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

        if (documentsRef.current[entry.path]) {
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
      documentsRef,
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
      documentsRef.current = {
        ...documentsRef.current,
        [nextDocument.path]: nextDocument,
      };
      activeDocumentRef.current = nextDocument;

      if (options.pin === true) {
        const pathTransition = pinDocumentSessionPath(
          openPathsRef.current,
          previewPathRef.current,
          nextDocument.path,
        );
        openPathsRef.current = pathTransition.nextOpenPaths;
        previewPathRef.current = pathTransition.nextPreviewPath;
        setOpenPaths((current) =>
          pinDocumentSessionPath(
            current,
            previewPathRef.current,
            nextDocument.path,
          ).nextOpenPaths,
        );
        setPreviewPath((current) =>
          pinDocumentSessionPath(
            openPathsRef.current,
            current,
            nextDocument.path,
          ).nextPreviewPath,
        );
      } else {
        previewPathRef.current = nextDocument.path;
        setPreviewPath(nextDocument.path);
      }

      setDocuments((current) => ({
        ...current,
        [nextDocument.path]: nextDocument,
      }));
      selectedGitChangeRef.current = null;
      setSelectedGitChange(null);
      setGitDiffPreview(null);
      setGitDiffLoading(false);
      gitDiffRequestTokenRef.current += 1;
      setActivePath(nextDocument.path);
      setMessage(null);
    },
    [
      activeDocumentRef,
      documentsRef,
      gitDiffRequestTokenRef,
      openPathsRef,
      previewPathRef,
      recordCurrentNavigationLocation,
      selectedGitChangeRef,
      setActivePath,
      setDocuments,
      setGitDiffLoading,
      setGitDiffPreview,
      setMessage,
      setOpenPaths,
      setPreviewPath,
      setSelectedGitChange,
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
