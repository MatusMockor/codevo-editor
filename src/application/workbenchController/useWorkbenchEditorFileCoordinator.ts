import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { IndexProgressState } from "../../domain/indexProgress";
import { isLanguageServerDocument } from "../../domain/languageServerDocumentSync";
import type { PhpFileOutline, PhpFileStructureScope } from "../../domain/phpFileOutline";
import { emptyPhpTree } from "../../domain/phpTree";
import type { EditorDocument, TextSearchGateway } from "../../domain/workspace";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import {
  isBlockedByManuallyCollapsedDirectory,
  parentDirectoriesInWorkspace,
} from "./workspacePathPolicy";
import {
  useWorkbenchGitChangesCoordinator,
  useWorkbenchGitDiscoveryCoordinator,
} from "./useWorkbenchGitCoordinator";
import { useWorkbenchDocumentTabs } from "../useWorkbenchDocumentTabs";
import type { useEditorSessionState } from "../useEditorSessionState";
import { gitChangeForDiffDocumentPath } from "../useGitDiffWorkspace";
import { usePhpChangeSignatureWorkflow } from "../usePhpChangeSignatureWorkflow";
import { usePhpOutline } from "../usePhpOutline";
import { useWorkspaceEditFileOperations } from "../useWorkspaceEditFileOperations";
import type { useWorkbenchLanguageDocumentSyncCoordinator } from "./useWorkbenchLanguageDocumentSyncCoordinator";
import type { useWorkspaceDirectoryExplorer } from "./useWorkspaceDirectoryExplorer";

type DocumentTabsDependencies = Parameters<typeof useWorkbenchDocumentTabs>[0];
type GitChangesDependencies = Parameters<typeof useWorkbenchGitChangesCoordinator>[0];
type PhpOutlineDependencies = Parameters<typeof usePhpOutline>[0];
type WorkspaceEditDependencies = Parameters<typeof useWorkspaceEditFileOperations>[0];
type LanguageDocumentSync = ReturnType<typeof useWorkbenchLanguageDocumentSyncCoordinator>;
type DirectoryExplorer = ReturnType<typeof useWorkspaceDirectoryExplorer>;
type EditorSession = Pick<
  ReturnType<typeof useEditorSessionState>,
  | "activeDocument"
  | "activeDocumentRef"
  | "activePath"
  | "documentTabSession"
  | "documents"
  | "documentsRef"
  | "openPathsRef"
  | "previewPathRef"
  | "reconcileDocumentSessionTopology"
  | "reportChangedDocuments"
  | "setActivePath"
  | "setDocuments"
  | "setOpenPaths"
  | "setPreviewPath"
  | "subscribeChangedDocuments"
>;
type GitDiscovery = Pick<
  ReturnType<typeof useWorkbenchGitDiscoveryCoordinator>,
  | "applyGitOperationStatuses"
  | "cancelGitDiffDocument"
  | "connectDiffPreviewReconciliation"
  | "getGitDiffDocument"
  | "getSelectedGitDiffDocument"
  | "gitOperationCurrency"
  | "gitRepositoryMappings"
  | "gitRepositoryStatuses"
  | "gitStatus"
  | "loadGitDiffDocument"
  | "reconcileGitDiffDocument"
  | "reloadGitDiffDocument"
>;
type EditorFileGitChangesDependencies = Omit<
  GitChangesDependencies,
  "connectDiffPreviewReconciliation" | "diffPreview" | "documentsRef" | "gitWorkspace"
> & {
  readonly gitWorkspace: Omit<
    GitChangesDependencies["gitWorkspace"],
    | "applyGitOperationStatuses"
    | "gitOperationCurrency"
    | "gitRepositoryMappings"
    | "gitRepositoryStatuses"
    | "gitStatus"
  >;
};

export function useWorkbenchPhpOutlineState() {
  const [phpTree, setPhpTree] = useState(emptyPhpTree);
  const [phpTreeLoading, setPhpTreeLoading] = useState(false);
  const [phpTreeExpandedNodeIds, setPhpTreeExpandedNodeIds] = useState(new Set<string>());
  const [phpFileOutlinesByPath, setPhpFileOutlinesByPath] = useState<
    Record<string, PhpFileOutline>
  >({});
  const [phpInheritedFileOutlinesByPath, setPhpInheritedFileOutlinesByPath] = useState<
    Record<string, PhpFileOutline>
  >({});
  const [expandedPhpFilePaths, setExpandedPhpFilePaths] = useState(new Set<string>());
  const [loadingPhpFileOutlinePaths, setLoadingPhpFileOutlinePaths] = useState(new Set<string>());
  const [loadingInheritedPhpFileOutlinePaths, setLoadingInheritedPhpFileOutlinePaths] = useState(
    new Set<string>(),
  );
  const [phpFileOutlineExpandedNodeIds, setPhpFileOutlineExpandedNodeIds] = useState(
    new Set<string>(),
  );
  const resetPhpOutlineState = useCallback(() => {
    setPhpTree(emptyPhpTree());
    setPhpTreeExpandedNodeIds(new Set());
    setPhpTreeLoading(false);
    setPhpFileOutlinesByPath({});
    setPhpInheritedFileOutlinesByPath({});
    setExpandedPhpFilePaths(new Set());
    setLoadingPhpFileOutlinePaths(new Set());
    setLoadingInheritedPhpFileOutlinePaths(new Set());
    setPhpFileOutlineExpandedNodeIds(new Set());
  }, []);

  return {
    expandedPhpFilePaths,
    loadingInheritedPhpFileOutlinePaths,
    loadingPhpFileOutlinePaths,
    phpFileOutlineExpandedNodeIds,
    phpFileOutlinesByPath,
    phpInheritedFileOutlinesByPath,
    phpTree,
    phpTreeExpandedNodeIds,
    phpTreeLoading,
    resetPhpOutlineState,
    setExpandedPhpFilePaths,
    setLoadingInheritedPhpFileOutlinePaths,
    setLoadingPhpFileOutlinePaths,
    setPhpFileOutlineExpandedNodeIds,
    setPhpFileOutlinesByPath,
    setPhpInheritedFileOutlinesByPath,
    setPhpTree,
    setPhpTreeExpandedNodeIds,
    setPhpTreeLoading,
  };
}

interface DirectoryDependencies {
  readonly cachedDirectoryNeedsRefresh: DirectoryExplorer["cachedDirectoryNeedsRefresh"];
  readonly entriesByDirectory: Readonly<Record<string, readonly unknown[]>>;
  readonly isSessionPathInWorkspace: WorkspaceEditDependencies["isSessionPathInWorkspace"];
  readonly loadDirectory: DirectoryExplorer["loadDirectory"];
  readonly loadingDirectories: Set<string>;
  readonly manuallyCollapsedDirectories: Set<string>;
  readonly revealActiveFileInTree: boolean;
  readonly setExpandedDirectories: Dispatch<SetStateAction<Set<string>>>;
}

interface FileStructureDependencies {
  readonly fileStructureOpen: boolean;
  readonly fileStructureScope: PhpFileStructureScope;
  readonly loadingInheritedPhpFileOutlinePaths: ReadonlySet<string>;
  readonly loadingPhpFileOutlinePaths: ReadonlySet<string>;
  readonly openJavaScriptTypeScriptFileStructure: (document: EditorDocument) => boolean;
  readonly setCallHierarchyView: (view: null) => void;
  readonly setClassOpenOpen: (open: boolean) => void;
  readonly setFileStructureInitialQuery: (query: string) => void;
  readonly setFileStructureOpen: Dispatch<SetStateAction<boolean>>;
  readonly setFileStructureScope: Dispatch<SetStateAction<PhpFileStructureScope>>;
  readonly setPaletteOpen: (open: boolean) => void;
  readonly setQuickOpenOpen: (open: boolean) => void;
  readonly setReferencesView: (view: null) => void;
  readonly setSettingsOpen: (open: boolean) => void;
  readonly setTextSearchOpen: (open: boolean) => void;
  readonly setTypeHierarchyView: (view: null) => void;
  readonly setWorkspaceSymbolsOpen: (open: boolean) => void;
}

interface ChangeSignatureDependencies {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly flushPendingDocumentChange: LanguageDocumentSync["flushPendingDocumentChange"];
  readonly getPhpDocumentSyncVersion: (rootPath: string, path: string) => number | null;
  readonly indexProgress: IndexProgressState;
  readonly languageServerFeaturesGateway: WorkspaceEditDependencies["languageServerFeaturesGateway"];
  readonly textSearch: TextSearchGateway;
  readonly workspaceFiles: WorkspaceEditDependencies["workspaceFiles"];
  readonly workspaceTrusted: boolean;
}

interface WorkbenchEditorFileCoordinatorDependencies {
  readonly changeSignature: ChangeSignatureDependencies;
  readonly directory: DirectoryDependencies;
  readonly documentTabs: Omit<DocumentTabsDependencies, "documentTabSession">;
  readonly editorSession: EditorSession;
  readonly fileStructure: FileStructureDependencies;
  readonly gitChanges: EditorFileGitChangesDependencies;
  readonly gitDiscovery: GitDiscovery;
  readonly openFileRef: MutableRefObject<ReturnType<typeof useWorkbenchDocumentTabs>["openFile"]>;
  readonly phpOutline: Omit<PhpOutlineDependencies, "documents" | "openFile">;
  readonly workspaceEdits: Omit<
    WorkspaceEditDependencies,
    | "documentsRef"
    | "openPathsRef"
    | "previewPathRef"
    | "reconcileDocumentSessionTopology"
    | "refreshDirectory"
    | "reportChangedDocuments"
    | "setActivePath"
    | "setDocuments"
    | "setOpenPaths"
    | "setPreviewPath"
  >;
}

export function useWorkbenchEditorFileCoordinator({
  changeSignature,
  directory,
  documentTabs: documentTabDependencies,
  editorSession,
  fileStructure,
  gitChanges: gitChangeDependencies,
  gitDiscovery,
  openFileRef,
  phpOutline: phpOutlineDependencies,
  workspaceEdits: workspaceEditDependencies,
}: WorkbenchEditorFileCoordinatorDependencies) {
  const {
    cachedDirectoryNeedsRefresh,
    entriesByDirectory,
    isSessionPathInWorkspace,
    loadDirectory,
    loadingDirectories,
    manuallyCollapsedDirectories,
    revealActiveFileInTree,
    setExpandedDirectories,
  } = directory;
  const { currentWorkspaceRootRef, workspaceRoot } = documentTabDependencies;
  const { activeDocument, activeDocumentRef, activePath } = editorSession;
  const {
    fileStructureOpen,
    fileStructureScope,
    loadingInheritedPhpFileOutlinePaths,
    loadingPhpFileOutlinePaths,
    openJavaScriptTypeScriptFileStructure,
    setCallHierarchyView,
    setClassOpenOpen,
    setFileStructureInitialQuery,
    setFileStructureOpen,
    setFileStructureScope,
    setPaletteOpen,
    setQuickOpenOpen,
    setReferencesView,
    setSettingsOpen,
    setTextSearchOpen,
    setTypeHierarchyView,
    setWorkspaceSymbolsOpen,
  } = fileStructure;
  const { setMessage: setPhpOutlineMessage } = phpOutlineDependencies;
  const {
    currentWorkspaceRootRef: changeSignatureCurrentWorkspaceRootRef,
    flushPendingDocumentChange,
    getPhpDocumentSyncVersion,
    indexProgress,
    languageServerFeaturesGateway,
    textSearch,
    workspaceFiles,
    workspaceTrusted,
  } = changeSignature;
  const refreshDirectory = useCallback(
    async (path: string) => {
      await loadDirectory(path);
    },
    [loadDirectory],
  );
  const refreshWorkspace = useCallback(async () => {
    if (!workspaceRoot) {
      return;
    }

    await refreshDirectory(workspaceRoot);
  }, [refreshDirectory, workspaceRoot]);

  const documentTabs = useWorkbenchDocumentTabs({
    ...documentTabDependencies,
    documentTabSession: editorSession.documentTabSession,
  });
  openFileRef.current = documentTabs.openFile;

  const revealPathInTree = useCallback(
    (path: string, respectManualCollapses: boolean) => {
      const requestedRoot = workspaceRoot;

      if (!requestedRoot) {
        return;
      }

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) ||
        !isSessionPathInWorkspace(requestedRoot, path)
      ) {
        return;
      }

      const directories = parentDirectoriesInWorkspace(requestedRoot, path);

      if (directories.length === 0) {
        return;
      }

      setExpandedDirectories((current) => {
        const next = new Set(current);
        let changed = false;

        for (const parentDirectory of directories) {
          if (
            respectManualCollapses &&
            isBlockedByManuallyCollapsedDirectory(parentDirectory, manuallyCollapsedDirectories)
          ) {
            continue;
          }

          if (next.has(parentDirectory)) {
            continue;
          }

          next.add(parentDirectory);
          changed = true;
        }

        return changed ? next : current;
      });

      for (const parentDirectory of directories) {
        if (
          (respectManualCollapses &&
            isBlockedByManuallyCollapsedDirectory(parentDirectory, manuallyCollapsedDirectories)) ||
          (entriesByDirectory[parentDirectory] && !cachedDirectoryNeedsRefresh(parentDirectory)) ||
          loadingDirectories.has(parentDirectory)
        ) {
          continue;
        }

        void loadDirectory(parentDirectory, { clearMessage: false });
      }
    },
    [
      cachedDirectoryNeedsRefresh,
      currentWorkspaceRootRef,
      entriesByDirectory,
      isSessionPathInWorkspace,
      loadDirectory,
      loadingDirectories,
      manuallyCollapsedDirectories,
      setExpandedDirectories,
      workspaceRoot,
    ],
  );

  const revealDirectoryInTree = useCallback(
    (path: string) => revealPathInTree(path, false),
    [revealPathInTree],
  );

  useEffect(() => {
    if (!activePath || !revealActiveFileInTree) {
      return;
    }

    revealPathInTree(activePath, true);
  }, [activePath, revealActiveFileInTree, revealPathInTree]);

  const gitChanges = useWorkbenchGitChangesCoordinator({
    ...gitChangeDependencies,
    connectDiffPreviewReconciliation: gitDiscovery.connectDiffPreviewReconciliation,
    diffPreview: {
      cancelGitDiffDocument: gitDiscovery.cancelGitDiffDocument,
      documentTabSession: editorSession.documentTabSession,
      getGitDiffDocument: gitDiscovery.getGitDiffDocument,
      getSelectedGitDiffDocument: gitDiscovery.getSelectedGitDiffDocument,
      gitChangeForDiffDocumentPath,
      loadGitDiffDocument: gitDiscovery.loadGitDiffDocument,
      reconcileGitDiffDocument: gitDiscovery.reconcileGitDiffDocument,
      reloadGitDiffDocument: gitDiscovery.reloadGitDiffDocument,
    },
    documentsRef: editorSession.documentsRef,
    gitWorkspace: {
      ...gitChangeDependencies.gitWorkspace,
      applyGitOperationStatuses: gitDiscovery.applyGitOperationStatuses,
      gitOperationCurrency: gitDiscovery.gitOperationCurrency,
      gitRepositoryMappings: gitDiscovery.gitRepositoryMappings,
      gitRepositoryStatuses: gitDiscovery.gitRepositoryStatuses,
      gitStatus: gitDiscovery.gitStatus,
    },
  });
  const phpOutline = usePhpOutline({
    ...phpOutlineDependencies,
    documents: editorSession.documents,
    openFile: documentTabs.openFile,
  });
  const { loadInheritedPhpFileOutline, loadPhpFileOutline } = phpOutline;

  const setFileStructureScopeMode = useCallback(
    (scope: PhpFileStructureScope) => {
      setFileStructureScope(scope);

      if (
        scope === "inherited" &&
        activeDocument &&
        !loadingInheritedPhpFileOutlinePaths.has(activeDocument.path)
      ) {
        void loadInheritedPhpFileOutline(activeDocument.path);
      }
    },
    [
      activeDocument,
      loadingInheritedPhpFileOutlinePaths,
      setFileStructureScope,
      loadInheritedPhpFileOutline,
    ],
  );

  const openFileStructureWithInitialQuery = useCallback(
    (initialQuery: string) => {
      const document = activeDocumentRef.current;
      if (!document) {
        setPhpOutlineMessage("Open a PHP, JavaScript, or TypeScript file to show structure.");
        return;
      }

      setFileStructureInitialQuery(initialQuery);
      setPaletteOpen(false);
      setQuickOpenOpen(false);
      setClassOpenOpen(false);
      setWorkspaceSymbolsOpen(false);
      setTextSearchOpen(false);
      setSettingsOpen(false);
      setCallHierarchyView(null);
      setTypeHierarchyView(null);
      setReferencesView(null);

      if (openJavaScriptTypeScriptFileStructure(document)) {
        return;
      }

      if (!isLanguageServerDocument(document)) {
        setPhpOutlineMessage(
          "File structure is available for PHP, JavaScript, and TypeScript files.",
        );
        return;
      }

      const nextScope =
        fileStructureOpen && fileStructureScope === "current" ? "inherited" : "current";
      setFileStructureScopeMode(nextScope);
      setFileStructureOpen(true);

      if (!loadingPhpFileOutlinePaths.has(document.path)) {
        void loadPhpFileOutline(document.path);
      }
    },
    [
      fileStructureOpen,
      fileStructureScope,
      loadingPhpFileOutlinePaths,
      openJavaScriptTypeScriptFileStructure,
      setCallHierarchyView,
      setClassOpenOpen,
      setFileStructureInitialQuery,
      setFileStructureOpen,
      setPaletteOpen,
      setQuickOpenOpen,
      setReferencesView,
      setSettingsOpen,
      setTextSearchOpen,
      setTypeHierarchyView,
      setWorkspaceSymbolsOpen,
      activeDocumentRef,
      loadPhpFileOutline,
      setPhpOutlineMessage,
      setFileStructureScopeMode,
    ],
  );
  const openFileStructure = useCallback(
    () => openFileStructureWithInitialQuery(""),
    [openFileStructureWithInitialQuery],
  );

  const workspaceEdits = useWorkspaceEditFileOperations({
    ...workspaceEditDependencies,
    documentsRef: editorSession.documentsRef,
    openPathsRef: editorSession.openPathsRef,
    previewPathRef: editorSession.previewPathRef,
    reconcileDocumentSessionTopology: editorSession.reconcileDocumentSessionTopology,
    refreshDirectory,
    reportChangedDocuments: editorSession.reportChangedDocuments,
    setActivePath: editorSession.setActivePath,
    setDocuments: editorSession.setDocuments,
    setOpenPaths: editorSession.setOpenPaths,
    setPreviewPath: editorSession.setPreviewPath,
  });
  const { applyPhpLanguageServerWorkspaceEdit } = workspaceEdits;

  const phpChangeSignaturePorts = useMemo(
    () => ({
      applyWorkspaceEdit: (
        edit: Parameters<typeof applyPhpLanguageServerWorkspaceEdit>[0],
        rootPath: string,
        openPaths: string[],
        expectedClosedFileHashes: Readonly<Record<string, string>>,
      ) =>
        applyPhpLanguageServerWorkspaceEdit(edit, {
          expectedClosedFileHashes,
          openPaths,
          rootPath,
        }),
      currentRootPath: () => changeSignatureCurrentWorkspaceRootRef.current,
      flushDocument: flushPendingDocumentChange,
      getOpenDocument: (path: string) => {
        const document = editorSession.documentsRef.current[path];
        const rootPath = changeSignatureCurrentWorkspaceRootRef.current;
        if (!document || !rootPath) {
          return null;
        }
        return {
          content: document.content,
          path: document.path,
          version: getPhpDocumentSyncVersion(rootPath, path),
        };
      },
      isWorkspaceTrusted: () => workspaceTrusted,
      isReferenceIndexComplete: (rootPath: string) =>
        indexProgress.status === "completed" &&
        indexProgress.erroredEntries === 0 &&
        workspaceRootKeysEqual(indexProgress.rootPath, rootPath),
      languageServer: languageServerFeaturesGateway,
      notifyClosedDocumentsChanged: async (rootPath: string, paths: string[]) => {
        if (paths.length === 0) {
          return;
        }
        if (
          !workspaceRootKeysEqual(changeSignatureCurrentWorkspaceRootRef.current, rootPath) ||
          !workspaceTrusted
        ) {
          return;
        }
        await languageServerFeaturesGateway.didChangeWatchedFiles(
          rootPath,
          paths.map((path) => ({ changeType: "changed" as const, path })),
        );
      },
      readClosedDocument: async (path: string) => {
        if (!workspaceFiles.readTextFileSnapshot) {
          return null;
        }
        const snapshot = await workspaceFiles.readTextFileSnapshot(path);
        if (!snapshot.revision) {
          return null;
        }
        return {
          content: snapshot.content,
          contentHash: snapshot.revision.contentHash,
          path,
          version: null,
        };
      },
      searchReferencePaths: async (rootPath: string, callableName: string) => {
        const limit = 20_001;
        const results = await textSearch.searchText(rootPath, callableName, limit, {
          caseSensitive: false,
          fileMask: "*.php",
          isRegex: false,
          preserveCase: false,
          wholeWord: true,
        });
        return {
          complete: results.length < limit,
          paths: [...new Set(results.map((result) => result.path))],
        };
      },
      subscribeChangedDocuments: editorSession.subscribeChangedDocuments,
    }),
    [
      changeSignatureCurrentWorkspaceRootRef,
      flushPendingDocumentChange,
      getPhpDocumentSyncVersion,
      indexProgress.erroredEntries,
      indexProgress.rootPath,
      indexProgress.status,
      languageServerFeaturesGateway,
      textSearch,
      workspaceFiles,
      workspaceTrusted,
      editorSession.documentsRef,
      editorSession.subscribeChangedDocuments,
      applyPhpLanguageServerWorkspaceEdit,
    ],
  );
  const phpChangeSignature = usePhpChangeSignatureWorkflow(phpChangeSignaturePorts);

  return {
    directory: {
      refreshDirectory,
      refreshWorkspace,
      revealDirectoryInTree,
      revealPathInTree,
    },
    documentTabs,
    fileStructure: {
      openFileStructure,
      openFileStructureWithInitialQuery,
      setFileStructureScopeMode,
    },
    gitChanges,
    phpChangeSignature,
    phpOutline,
    workspaceEdits,
  };
}
