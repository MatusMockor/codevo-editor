import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { FilePrefetchCache } from "../domain/filePrefetchCache";
import {
  canRefreshDocumentFromExternalFileChange,
  type WorkspaceFileChangeEvent,
} from "../domain/workspaceFileChange";
import {
  isJavaScriptTypeScriptLanguageServerDocument,
  isLanguageServerDocument,
} from "../domain/languageServerDocumentSync";
import {
  createWorkspaceTextFileWithContent,
  detectLanguage,
  getFileName,
  getParentPath,
  isLspExcludedDirectoryPath,
  joinWorkspacePath,
  readWorkspaceTextFileSnapshot,
  workspaceRelativePath,
  type EditorDocument,
  type FileEntry,
  type WorkspaceFileGateway,
  type WorkspaceDescriptor,
} from "../domain/workspace";
import { phpNewFileTemplate } from "../domain/phpNewFileTemplate";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import {
  removeBookmarksForPath,
  renameBookmarksForPath,
  type Bookmark,
} from "../domain/bookmarks";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import type {
  DocumentSaveInvalidationScope,
  RunWithDocumentSaveExclusion,
} from "./documentSaveCoordinator";
import type { ResolveDocumentSaveOwnership } from "./documentSaveIdentity";

const WORKSPACE_DIRECTORY_REFRESH_DEBOUNCE_MS = 120;
const WORKSPACE_GIT_STATUS_REFRESH_DEBOUNCE_MS = 120;

type SidebarView = "files" | "git" | "php";

interface OpenFileOptions {
  pin?: boolean;
  readOnly?: boolean;
  recordNavigation?: boolean;
}

interface CloseDocumentOptions {
  recordRecentlyClosed?: boolean;
  skipConfirmation?: boolean;
}

export interface WorkbenchFileOperationsDependencies {
  workspaceRoot: string | null;
  workspaceDescriptor: WorkspaceDescriptor | null;
  activePath: string | null;
  sidebarView: SidebarView;
  languageServerDiagnosticsByPath: Record<string, unknown>;
  javaScriptTypeScriptDiagnosticsByPath: Record<string, unknown>;
  phpLocalDiagnosticsByPath: Record<string, unknown>;
  activePhpFrameworkProviders: readonly PhpFrameworkProvider[];
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  openPathsRef: MutableRefObject<string[]>;
  previewPathRef: MutableRefObject<string | null>;
  filePrefetchCacheRef: MutableRefObject<FilePrefetchCache>;
  workspaceFiles: WorkspaceFileGateway;
  prompter: WorkbenchPrompter;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setBookmarks: Dispatch<SetStateAction<Bookmark[]>>;
  setDocuments: Dispatch<SetStateAction<Record<string, EditorDocument>>>;
  setEntriesByDirectory: Dispatch<SetStateAction<Record<string, FileEntry[]>>>;
  setExpandedDirectories: Dispatch<SetStateAction<Set<string>>>;
  setManuallyCollapsedDirectories: Dispatch<SetStateAction<Set<string>>>;
  setMessage: Dispatch<SetStateAction<string | null>>;
  setOpenPaths: Dispatch<SetStateAction<string[]>>;
  setPreviewPath: Dispatch<SetStateAction<string | null>>;
  applyJavaScriptTypeScriptCreateEdits: (path: string) => Promise<boolean>;
  applyJavaScriptTypeScriptDeleteEdits: (path: string) => Promise<boolean>;
  applyJavaScriptTypeScriptRenameEdits: (
    oldPath: string,
    newPath: string,
  ) => Promise<boolean>;
  applyPhpRenameEdits: (oldPath: string, newPath: string) => Promise<void>;
  clearLanguageServerDiagnosticsForPath: (
    rootPath: string | null | undefined,
    path: string,
  ) => void;
  closeDocument: (path: string, options?: CloseDocumentOptions) => void;
  forgetExternallyRemovedDocumentPath: (path: string) => void;
  forgetRecentFile: (path: string) => void;
  forgetRecentLocationsForPath: (path: string) => void;
  invalidateFrameworkCachesForPath: (rootPath: string, path: string) => void;
  resolveDocumentSaveOwnership?: ResolveDocumentSaveOwnership;
  runWithDocumentSaveExclusion: RunWithDocumentSaveExclusion;
  invalidatePhpFrameworkSourcePath: (
    rootPath: string,
    path: string,
  ) => void;
  invalidatePhpFrameworkBindingsForFileChange: (
    event: WorkspaceFileChangeEvent,
  ) => void;
  markExternallyRemovedDocumentPath: (rootPath: string, path: string) => void;
  notifyJavaScriptTypeScriptFileCreated: (path: string) => Promise<void>;
  notifyJavaScriptTypeScriptFileDeleted: (path: string) => Promise<void>;
  notifyJavaScriptTypeScriptFileRenamed: (
    oldPath: string,
    newPath: string,
  ) => Promise<void>;
  notifyPhpFileRenamed: (oldPath: string, newPath: string) => Promise<void>;
  openFile: (entry: FileEntry, options?: OpenFileOptions) => Promise<boolean>;
  refreshDirectory: (path: string) => Promise<void>;
  refreshGitStatus: () => Promise<void>;
  remapRecentFile: (
    oldPath: string,
    entry: { name: string; path: string },
  ) => void;
  remapRecentLocations: (
    oldPath: string,
    entry: { name: string; path: string; relativePath: string },
  ) => void;
  reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
  reportChangedDocuments: (paths: readonly string[]) => void;
  syncClosedDocument: (document: EditorDocument) => Promise<void>;
  syncClosedJavaScriptTypeScriptDocument: (
    document: EditorDocument,
  ) => Promise<void>;
  workspacePathBelongsToRoot: (
    path: string,
    workspaceRoot: string | null | undefined,
  ) => boolean;
}

export interface WorkbenchFileOperations {
  createFile: () => Promise<void>;
  createDirectory: () => Promise<void>;
  renameActiveDocument: () => Promise<void>;
  renameEntry: (entry: FileEntry) => Promise<void>;
  deleteActiveDocument: () => Promise<void>;
  handleWorkspaceFileChange: (event: WorkspaceFileChangeEvent) => void;
}

export function useWorkbenchFileOperations(
  dependencies: WorkbenchFileOperationsDependencies,
): WorkbenchFileOperations {
  const {
    workspaceRoot,
    workspaceDescriptor,
    activePath,
    sidebarView,
    languageServerDiagnosticsByPath,
    javaScriptTypeScriptDiagnosticsByPath,
    phpLocalDiagnosticsByPath,
    activePhpFrameworkProviders,
    activeDocumentRef,
    currentWorkspaceRootRef,
    documentsRef,
    openPathsRef,
    previewPathRef,
    filePrefetchCacheRef,
    workspaceFiles,
    prompter,
    setActivePath,
    setBookmarks,
    setDocuments,
    setEntriesByDirectory,
    setExpandedDirectories,
    setManuallyCollapsedDirectories,
    setMessage,
    setOpenPaths,
    setPreviewPath,
    applyJavaScriptTypeScriptCreateEdits,
    applyJavaScriptTypeScriptDeleteEdits,
    applyJavaScriptTypeScriptRenameEdits,
    applyPhpRenameEdits,
    clearLanguageServerDiagnosticsForPath,
    closeDocument,
    forgetExternallyRemovedDocumentPath,
    forgetRecentFile,
    forgetRecentLocationsForPath,
    invalidateFrameworkCachesForPath,
    resolveDocumentSaveOwnership,
    runWithDocumentSaveExclusion,
    invalidatePhpFrameworkBindingsForFileChange,
    invalidatePhpFrameworkSourcePath,
    markExternallyRemovedDocumentPath,
    notifyJavaScriptTypeScriptFileCreated,
    notifyJavaScriptTypeScriptFileDeleted,
    notifyJavaScriptTypeScriptFileRenamed,
    notifyPhpFileRenamed,
    openFile,
    refreshDirectory,
    refreshGitStatus,
    remapRecentFile,
    remapRecentLocations,
    reportChangedDocuments,
    reportErrorForActiveWorkspaceRoot,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    workspacePathBelongsToRoot,
  } = dependencies;

  const pendingWorkspaceDirectoryRefreshesRef = useRef<Set<string>>(new Set());
  const workspaceDirectoryRefreshTimerRef = useRef<
    ReturnType<typeof setTimeout> | null
  >(null);
  const workspaceGitStatusRefreshTimerRef = useRef<
    ReturnType<typeof setTimeout> | null
  >(null);

  const createFile = useCallback(async () => {
    if (!workspaceRoot) {
      return;
    }

    const relativePath = prompter.prompt("New file path", "src/NewFile.php");

    if (!relativePath) {
      return;
    }

    const requestedRoot = workspaceRoot;
    const path = joinWorkspacePath(requestedRoot, relativePath);

    try {
      const mayCreate = await applyJavaScriptTypeScriptCreateEdits(path);
      if (!mayCreate) {
        return;
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      const template = phpNewFileTemplate(
        relativePath,
        workspaceDescriptor?.php?.psr4Roots ?? [],
        activePhpFrameworkProviders,
      );

      if (template) {
        await createWorkspaceTextFileWithContent(
          workspaceFiles,
          path,
          template.content,
        );
      } else {
        await workspaceFiles.createTextFile(path);
      }
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      await notifyJavaScriptTypeScriptFileCreated(path);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      const parentPath = getParentPath(path);
      setExpandedDirectories((current) => new Set(current).add(parentPath));
      await refreshDirectory(parentPath);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      await openFile({ kind: "file", name: getFileName(path), path });
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(requestedRoot, "Create File", error);
    }
  }, [
    applyJavaScriptTypeScriptCreateEdits,
    activePhpFrameworkProviders,
    currentWorkspaceRootRef,
    notifyJavaScriptTypeScriptFileCreated,
    openFile,
    prompter,
    refreshDirectory,
    reportErrorForActiveWorkspaceRoot,
    setExpandedDirectories,
    workspaceFiles,
    workspaceDescriptor,
    workspaceRoot,
  ]);

  const createDirectory = useCallback(async () => {
    if (!workspaceRoot) {
      return;
    }

    const relativePath = prompter.prompt("New folder path", "src/Domain");

    if (!relativePath) {
      return;
    }

    const requestedRoot = workspaceRoot;
    const path = joinWorkspacePath(requestedRoot, relativePath);

    try {
      await workspaceFiles.createDirectory(path);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      const parentPath = getParentPath(path);
      setExpandedDirectories((current) => new Set(current).add(parentPath));
      await refreshDirectory(parentPath);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setMessage(`Created ${path}`);
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(requestedRoot, "Create Folder", error);
    }
  }, [
    currentWorkspaceRootRef,
    prompter,
    refreshDirectory,
    reportErrorForActiveWorkspaceRoot,
    setExpandedDirectories,
    setMessage,
    workspaceFiles,
    workspaceRoot,
  ]);

  const renameActiveDocument = useCallback(async () => {
    const document = activeDocumentRef.current;
    if (!document) {
      return;
    }

    const requestedRoot = workspaceRoot;
    if (!requestedRoot) {
      return;
    }

    const nextName = prompter.prompt("Rename file", document.name);

    if (!nextName || nextName === document.name) {
      return;
    }

    const parentPath = getParentPath(document.path);
    const oldPath = document.path;
    const nextPath = joinWorkspacePath(parentPath, nextName);
    const invalidationScope = resolveDocumentSaveInvalidationScope(
      "file",
      requestedRoot,
      oldPath,
      resolveDocumentSaveOwnership,
    );
    if (!invalidationScope) {
      return;
    }

    try {
      if (isLanguageServerDocument(document)) {
        await applyPhpRenameEdits(document.path, nextPath);
      }

      if (isJavaScriptTypeScriptLanguageServerDocument(document)) {
        const mayRename = await applyJavaScriptTypeScriptRenameEdits(
          document.path,
          nextPath,
        );
        if (!mayRename) {
          return;
        }
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      await runWithDocumentSaveExclusion(invalidationScope, async () => {
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }
        await workspaceFiles.renamePath(oldPath, nextPath);
        filePrefetchCacheRef.current.invalidate(document.path);
        filePrefetchCacheRef.current.invalidate(nextPath);
        if (isLanguageServerDocument(document)) {
          await notifyPhpFileRenamed(document.path, nextPath);
        }

        if (isJavaScriptTypeScriptLanguageServerDocument(document)) {
          await notifyJavaScriptTypeScriptFileRenamed(document.path, nextPath);
        }

        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        await syncClosedDocument(document);
        await syncClosedJavaScriptTypeScriptDocument(document);

        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          )
        ) {
          return;
        }

        clearLanguageServerDiagnosticsForPath(requestedRoot, oldPath);

        setDocuments((current) => {
          const currentDocument = current[document.path] ?? document;
          const renamedDocument = {
            ...currentDocument,
            language: detectLanguage(nextPath),
            name: nextName,
            path: nextPath,
          };
          const next = { ...current };
          delete next[document.path];
          next[nextPath] = renamedDocument;
          return next;
        });
        setOpenPaths((current) =>
          current.map((path) => (path === document.path ? nextPath : path)),
        );
        setActivePath(nextPath);
        remapRecentFile(oldPath, { name: nextName, path: nextPath });
        remapRecentLocations(oldPath, {
          name: nextName,
          path: nextPath,
          relativePath:
            workspaceRelativePath(requestedRoot, nextPath) ?? nextPath,
        });
        setBookmarks((current) =>
          renameBookmarksForPath(current, oldPath, nextPath),
        );
        await refreshDirectory(parentPath);
        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          )
        ) {
          return;
        }

        setMessage(`Renamed ${document.name}`);
      });
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(requestedRoot, "Rename File", error);
    }
  }, [
    activeDocumentRef,
    applyJavaScriptTypeScriptRenameEdits,
    applyPhpRenameEdits,
    clearLanguageServerDiagnosticsForPath,
    currentWorkspaceRootRef,
    filePrefetchCacheRef,
    runWithDocumentSaveExclusion,
    notifyJavaScriptTypeScriptFileRenamed,
    notifyPhpFileRenamed,
    prompter,
    refreshDirectory,
    remapRecentFile,
    remapRecentLocations,
    reportErrorForActiveWorkspaceRoot,
    resolveDocumentSaveOwnership,
    setActivePath,
    setBookmarks,
    setDocuments,
    setMessage,
    setOpenPaths,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    workspaceFiles,
    workspaceRoot,
  ]);

  const renameEntry = useCallback(
    async (entry: FileEntry) => {
      if (entry.kind !== "directory") {
        return;
      }

      const requestedRoot = workspaceRoot;
      if (!requestedRoot) {
        return;
      }

      const nextName = prompter.prompt("Rename folder", entry.name);

      if (!nextName || nextName === entry.name) {
        return;
      }

      const oldPath = entry.path;
      const parentPath = getParentPath(oldPath);
      const nextPath = joinWorkspacePath(parentPath, nextName);

      if (nextPath === oldPath) {
        return;
      }

      const skipLspRename = isLspExcludedDirectoryPath(requestedRoot, oldPath);
      const invalidationScope = resolveDocumentSaveInvalidationScope(
        "directory",
        requestedRoot,
        oldPath,
        resolveDocumentSaveOwnership,
      );
      if (!invalidationScope) {
        return;
      }

      try {
        if (!skipLspRename) {
          await applyPhpRenameEdits(oldPath, nextPath);

          const mayRename = await applyJavaScriptTypeScriptRenameEdits(
            oldPath,
            nextPath,
          );
          if (!mayRename) {
            return;
          }
        }

        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          )
        ) {
          return;
        }

        await runWithDocumentSaveExclusion(invalidationScope, async () => {
          if (
            !workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              requestedRoot,
            )
          ) {
            return;
          }
          await workspaceFiles.renamePath(oldPath, nextPath);
          filePrefetchCacheRef.current.invalidate(oldPath);
          filePrefetchCacheRef.current.invalidate(nextPath);

          if (!skipLspRename) {
            await notifyPhpFileRenamed(oldPath, nextPath);
            await notifyJavaScriptTypeScriptFileRenamed(oldPath, nextPath);
          }

          if (
            !workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              requestedRoot,
            )
          ) {
            return;
          }

          const diagnosticPaths = new Set([
            ...Object.keys(languageServerDiagnosticsByPath),
            ...Object.keys(javaScriptTypeScriptDiagnosticsByPath),
            ...Object.keys(phpLocalDiagnosticsByPath),
            ...Object.keys(documentsRef.current),
          ]);

          for (const diagnosticPath of diagnosticPaths) {
            if (isPathInDirectory(diagnosticPath, oldPath)) {
              clearLanguageServerDiagnosticsForPath(
                requestedRoot,
                diagnosticPath,
              );
            }
          }

          const remappedDocuments = Object.values(documentsRef.current).filter(
            (document) =>
              remapPathForDirectoryRename(document.path, oldPath, nextPath) !==
              document.path,
          );
          await Promise.all(
            remappedDocuments.flatMap((document) => [
              syncClosedDocument(document),
              syncClosedJavaScriptTypeScriptDocument(document),
            ]),
          );

          const nextDocuments: Record<string, EditorDocument> = {};
          for (const document of Object.values(documentsRef.current)) {
            const remappedPath = remapPathForDirectoryRename(
              document.path,
              oldPath,
              nextPath,
            );
            const remappedDocument =
              remappedPath === document.path
                ? document
                : {
                    ...document,
                    language: detectLanguage(remappedPath),
                    name: getFileName(remappedPath),
                    path: remappedPath,
                  };
            nextDocuments[remappedDocument.path] = remappedDocument;
          }

          const nextOpenPaths = openPathsRef.current.map((path) =>
            remapPathForDirectoryRename(path, oldPath, nextPath),
          );
          const nextPreviewPath = previewPathRef.current
            ? remapPathForDirectoryRename(
                previewPathRef.current,
                oldPath,
                nextPath,
              )
            : null;
          const nextActivePath = activePath
            ? remapPathForDirectoryRename(activePath, oldPath, nextPath)
            : null;

          documentsRef.current = nextDocuments;
          openPathsRef.current = nextOpenPaths;
          previewPathRef.current = nextPreviewPath;
          activeDocumentRef.current = nextActivePath
            ? (nextDocuments[nextActivePath] ?? null)
            : null;

          setDocuments(nextDocuments);
          setOpenPaths(nextOpenPaths);
          setPreviewPath(nextPreviewPath);
          setActivePath(nextActivePath);
          setEntriesByDirectory((current) =>
            remapEntriesByDirectoryForDirectoryRename(
              current,
              oldPath,
              nextPath,
            ),
          );
          setExpandedDirectories((current) =>
            remapPathSetForDirectoryRename(current, oldPath, nextPath),
          );
          setManuallyCollapsedDirectories((current) =>
            remapPathSetForDirectoryRename(current, oldPath, nextPath),
          );

          const directoriesToRefresh = new Set([
            parentPath,
            getParentPath(nextPath),
          ]);
          for (const directory of directoriesToRefresh) {
            await refreshDirectory(directory);
            if (
              !workspaceRootKeysEqual(
                currentWorkspaceRootRef.current,
                requestedRoot,
              )
            ) {
              return;
            }
          }

          setMessage(`Renamed ${entry.name}`);
        });
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(requestedRoot, "Rename Folder", error);
      }
    },
    [
      activeDocumentRef,
      activePath,
      applyJavaScriptTypeScriptRenameEdits,
      applyPhpRenameEdits,
      clearLanguageServerDiagnosticsForPath,
      currentWorkspaceRootRef,
      documentsRef,
      filePrefetchCacheRef,
      runWithDocumentSaveExclusion,
      javaScriptTypeScriptDiagnosticsByPath,
      languageServerDiagnosticsByPath,
      notifyJavaScriptTypeScriptFileRenamed,
      notifyPhpFileRenamed,
      openPathsRef,
      phpLocalDiagnosticsByPath,
      previewPathRef,
      prompter,
      refreshDirectory,
      resolveDocumentSaveOwnership,
      reportErrorForActiveWorkspaceRoot,
      setActivePath,
      setDocuments,
      setEntriesByDirectory,
      setExpandedDirectories,
      setManuallyCollapsedDirectories,
      setMessage,
      setOpenPaths,
      setPreviewPath,
      syncClosedDocument,
      syncClosedJavaScriptTypeScriptDocument,
      workspaceFiles,
      workspaceRoot,
    ],
  );

  const deleteActiveDocument = useCallback(async () => {
    const document = activeDocumentRef.current;
    if (!document) {
      return;
    }

    const requestedRoot = workspaceRoot;
    if (!requestedRoot) {
      return;
    }

    if (!prompter.confirm(`Delete ${document.name}?`)) {
      return;
    }

    const parentPath = getParentPath(document.path);
    const deletedPath = document.path;
    const invalidationScope = resolveDocumentSaveInvalidationScope(
      "file",
      requestedRoot,
      deletedPath,
      resolveDocumentSaveOwnership,
    );
    if (!invalidationScope) {
      return;
    }

    try {
      const mayDelete = await applyJavaScriptTypeScriptDeleteEdits(deletedPath);
      if (!mayDelete) {
        return;
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      await runWithDocumentSaveExclusion(invalidationScope, async () => {
        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          )
        ) {
          return;
        }
        await workspaceFiles.deletePath(deletedPath);
        filePrefetchCacheRef.current.invalidate(deletedPath);
        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          )
        ) {
          return;
        }

        if (isJavaScriptTypeScriptLanguageServerDocument(document)) {
          await syncClosedJavaScriptTypeScriptDocument(document);
        }
        await notifyJavaScriptTypeScriptFileDeleted(deletedPath);
        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          )
        ) {
          return;
        }

        closeDocument(deletedPath, {
          recordRecentlyClosed: false,
          skipConfirmation: true,
        });
        forgetRecentFile(deletedPath);
        forgetRecentLocationsForPath(deletedPath);
        setBookmarks((current) => removeBookmarksForPath(current, deletedPath));
        clearLanguageServerDiagnosticsForPath(requestedRoot, deletedPath);
        await refreshDirectory(parentPath);
        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          )
        ) {
          return;
        }

        setMessage(`Deleted ${document.name}`);
      });
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(requestedRoot, "Delete File", error);
    }
  }, [
    activeDocumentRef,
    applyJavaScriptTypeScriptDeleteEdits,
    clearLanguageServerDiagnosticsForPath,
    closeDocument,
    currentWorkspaceRootRef,
    filePrefetchCacheRef,
    forgetRecentFile,
    forgetRecentLocationsForPath,
    runWithDocumentSaveExclusion,
    notifyJavaScriptTypeScriptFileDeleted,
    prompter,
    refreshDirectory,
    reportErrorForActiveWorkspaceRoot,
    resolveDocumentSaveOwnership,
    setBookmarks,
    setMessage,
    syncClosedJavaScriptTypeScriptDocument,
    workspaceFiles,
    workspaceRoot,
  ]);

  const flushPendingWorkspaceDirectoryRefreshes = useCallback(() => {
    workspaceDirectoryRefreshTimerRef.current = null;
    const directories = Array.from(
      pendingWorkspaceDirectoryRefreshesRef.current,
    );
    pendingWorkspaceDirectoryRefreshesRef.current = new Set();

    directories.forEach((directory) => {
      if (
        !workspacePathBelongsToRoot(directory, currentWorkspaceRootRef.current)
      ) {
        return;
      }

      void refreshDirectory(directory);
    });
  }, [currentWorkspaceRootRef, refreshDirectory, workspacePathBelongsToRoot]);

  const queueWorkspaceDirectoryRefresh = useCallback(
    (directory: string) => {
      pendingWorkspaceDirectoryRefreshesRef.current.add(directory);

      if (workspaceDirectoryRefreshTimerRef.current) {
        return;
      }

      workspaceDirectoryRefreshTimerRef.current = setTimeout(() => {
        flushPendingWorkspaceDirectoryRefreshes();
      }, WORKSPACE_DIRECTORY_REFRESH_DEBOUNCE_MS);
    },
    [flushPendingWorkspaceDirectoryRefreshes],
  );

  const queueWorkspaceGitStatusRefresh = useCallback(
    (requestedRoot: string) => {
      if (sidebarView !== "git") {
        return;
      }

      if (workspaceGitStatusRefreshTimerRef.current) {
        clearTimeout(workspaceGitStatusRefreshTimerRef.current);
      }

      workspaceGitStatusRefreshTimerRef.current = setTimeout(() => {
        workspaceGitStatusRefreshTimerRef.current = null;

        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          )
        ) {
          return;
        }

        void refreshGitStatus();
      }, WORKSPACE_GIT_STATUS_REFRESH_DEBOUNCE_MS);
    },
    [currentWorkspaceRootRef, refreshGitStatus, sidebarView],
  );

  const handleExternalRemovedPath = useCallback(
    (requestedRoot: string, removedPath: string) => {
      markExternallyRemovedDocumentPath(requestedRoot, removedPath);
      closeDocument(removedPath, { recordRecentlyClosed: false });
      clearLanguageServerDiagnosticsForPath(requestedRoot, removedPath);
      filePrefetchCacheRef.current.invalidate(removedPath);
      queueWorkspaceDirectoryRefresh(getParentPath(removedPath));
    },
    [
      clearLanguageServerDiagnosticsForPath,
      closeDocument,
      filePrefetchCacheRef,
      markExternallyRemovedDocumentPath,
      queueWorkspaceDirectoryRefresh,
    ],
  );

  const refreshOpenDocumentFromExternalFileChange = useCallback(
    async (requestedRoot: string, path: string): Promise<void> => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      const openDocument = documentsRef.current[path];

      if (!canRefreshDocumentFromExternalFileChange(openDocument)) {
        return;
      }

      let refreshedSnapshot;

      try {
        refreshedSnapshot = await readWorkspaceTextFileSnapshot(
          workspaceFiles,
          path,
        );
      } catch {
        return;
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      const latestDocument = documentsRef.current[path];

      if (!canRefreshDocumentFromExternalFileChange(latestDocument)) {
        return;
      }

      setDocuments((current) => {
        const currentDocument = current[path];

        if (!canRefreshDocumentFromExternalFileChange(currentDocument)) {
          return current;
        }

        return {
          ...current,
          [path]: {
            ...currentDocument,
            content: refreshedSnapshot.content,
            savedContent: refreshedSnapshot.content,
            revision: refreshedSnapshot.revision,
          },
        };
      });
      reportChangedDocuments([path]);
    },
    [
      currentWorkspaceRootRef,
      documentsRef,
      reportChangedDocuments,
      setDocuments,
      workspaceFiles,
    ],
  );

  const handleWorkspaceFileChange = useCallback(
    (event: WorkspaceFileChangeEvent) => {
      const requestedRoot = currentWorkspaceRootRef.current;

      if (
        !requestedRoot ||
        !workspaceRootKeysEqual(requestedRoot, event.rootPath)
      ) {
        return;
      }

      queueWorkspaceGitStatusRefresh(requestedRoot);
      invalidatePhpFrameworkBindingsForFileChange(event);

      invalidatePhpFrameworkSourcePath(requestedRoot, event.path);
      invalidateFrameworkCachesForPath(requestedRoot, event.path);

      if (event.previousPath) {
        invalidatePhpFrameworkSourcePath(requestedRoot, event.previousPath);
        invalidateFrameworkCachesForPath(requestedRoot, event.previousPath);
      }

      if (event.kind === "deleted") {
        handleExternalRemovedPath(requestedRoot, event.path);
        return;
      }

      if (event.kind === "renamed") {
        if (event.previousPath) {
          handleExternalRemovedPath(requestedRoot, event.previousPath);
        }

        forgetExternallyRemovedDocumentPath(event.path);
        queueWorkspaceDirectoryRefresh(getParentPath(event.path));
        return;
      }

      if (event.kind === "created" || event.kind === "modified") {
        queueWorkspaceDirectoryRefresh(getParentPath(event.path));
      }

      if (event.kind === "modified" && event.fileKind !== "directory") {
        void refreshOpenDocumentFromExternalFileChange(requestedRoot, event.path);
      }
    },
    [
      currentWorkspaceRootRef,
      forgetExternallyRemovedDocumentPath,
      handleExternalRemovedPath,
      invalidateFrameworkCachesForPath,
      invalidatePhpFrameworkBindingsForFileChange,
      invalidatePhpFrameworkSourcePath,
      queueWorkspaceDirectoryRefresh,
      queueWorkspaceGitStatusRefresh,
      refreshOpenDocumentFromExternalFileChange,
    ],
  );

  useEffect(
    () => () => {
      if (workspaceDirectoryRefreshTimerRef.current) {
        clearTimeout(workspaceDirectoryRefreshTimerRef.current);
        workspaceDirectoryRefreshTimerRef.current = null;
      }

      if (workspaceGitStatusRefreshTimerRef.current) {
        clearTimeout(workspaceGitStatusRefreshTimerRef.current);
        workspaceGitStatusRefreshTimerRef.current = null;
      }
    },
    [],
  );

  return {
    createFile,
    createDirectory,
    renameActiveDocument,
    renameEntry,
    deleteActiveDocument,
    handleWorkspaceFileChange,
  };
}

function resolveDocumentSaveInvalidationScope(
  kind: "file" | "directory",
  rootPath: string,
  path: string,
  resolveOwnership: ResolveDocumentSaveOwnership | undefined,
): DocumentSaveInvalidationScope | null {
  if (!resolveOwnership) {
    return { kind, rootPath, path };
  }

  const ownership = resolveOwnership(rootPath, path);
  if (!ownership) {
    return null;
  }

  return { kind, ...ownership };
}

function isPathInDirectory(path: string, directoryPath: string): boolean {
  return (
    path === directoryPath || path.startsWith(`${directoryPath.replace(/\/+$/, "")}/`)
  );
}

function remapPathForDirectoryRename(
  path: string,
  oldDirectoryPath: string,
  newDirectoryPath: string,
): string {
  const normalizedOldDirectoryPath = oldDirectoryPath.replace(/\/+$/, "");

  if (path === normalizedOldDirectoryPath) {
    return newDirectoryPath;
  }

  const oldPrefix = `${normalizedOldDirectoryPath}/`;

  if (!path.startsWith(oldPrefix)) {
    return path;
  }

  return `${newDirectoryPath}${path.slice(normalizedOldDirectoryPath.length)}`;
}

function remapPathSetForDirectoryRename(
  paths: Set<string>,
  oldDirectoryPath: string,
  newDirectoryPath: string,
): Set<string> {
  const next = new Set<string>();

  for (const path of paths) {
    next.add(remapPathForDirectoryRename(path, oldDirectoryPath, newDirectoryPath));
  }

  return next;
}

function remapEntriesByDirectoryForDirectoryRename(
  entriesByDirectory: Record<string, FileEntry[]>,
  oldDirectoryPath: string,
  newDirectoryPath: string,
): Record<string, FileEntry[]> {
  const next: Record<string, FileEntry[]> = {};

  for (const [directoryPath, entries] of Object.entries(entriesByDirectory)) {
    const nextDirectoryPath = remapPathForDirectoryRename(
      directoryPath,
      oldDirectoryPath,
      newDirectoryPath,
    );

    next[nextDirectoryPath] = entries.map((entry) => {
      const nextEntryPath = remapPathForDirectoryRename(
        entry.path,
        oldDirectoryPath,
        newDirectoryPath,
      );

      if (nextEntryPath === entry.path) {
        return entry;
      }

      return {
        ...entry,
        name: getFileName(nextEntryPath),
        path: nextEntryPath,
      };
    });
  }

  return next;
}
