import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { Bookmark } from "../domain/bookmarks";
import type { BottomPanelView } from "../domain/bottomPanel";
import type { EditorGroupsState } from "../domain/editorGroups";
import type {
  IndexHealthLogEntry,
  IndexProgressState,
} from "../domain/indexProgress";
import type { MarkdownPreviewTab } from "../domain/markdownPreview";
import type { NavigationHistory } from "../domain/navigation";
import type { RecentFileEntry } from "../domain/recentFiles";
import type { RecentLocation } from "../domain/recentLocations";
import type {
  EditorDocument,
  FileEntry,
  ImageTab,
} from "../domain/workspace";
import {
  buildEditorSurfaceSnapshot,
  selectEditorSurfaceRestore,
  type EditorSurfaceSnapshot,
} from "../domain/workspaceSessionSnapshot";
import type { WorkspaceIdentityDescriptor } from "../infrastructure/tauriWorkspaceIdentityGateway";
import type { SidebarView } from "./useWorkbenchController";

export interface CachedWorkspaceWorkbenchState {
  bookmarks: Bookmark[];
  bottomPanelView: BottomPanelView;
  bottomPanelVisible: boolean;
  editorSurface: EditorSurfaceSnapshot;
  entriesByDirectory: Record<string, FileEntry[]>;
  expandedDirectories: Set<string>;
  indexHealthLogs: IndexHealthLogEntry[];
  indexProgress: IndexProgressState;
  manuallyCollapsedDirectories: Set<string>;
  navigationHistory: NavigationHistory;
  recentFiles: RecentFileEntry[];
  recentLocations: RecentLocation[];
  sidebarView: SidebarView;
  workspaceIdentityDescriptor: WorkspaceIdentityDescriptor | null;
}

export interface WorkspaceStateCacheDependencies {
  activePath: string | null;
  bookmarks: Bookmark[];
  bottomPanelView: BottomPanelView;
  bottomPanelVisible: boolean;
  documents: Record<string, EditorDocument>;
  editorGroups: EditorGroupsState;
  entriesByDirectory: Record<string, FileEntry[]>;
  expandedDirectories: Set<string>;
  imageTabs: Record<string, ImageTab>;
  imageTabsRef: MutableRefObject<Record<string, ImageTab>>;
  indexHealthLogs: IndexHealthLogEntry[];
  indexProgress: IndexProgressState;
  manuallyCollapsedDirectories: Set<string>;
  markdownPreviewTabs: Record<string, MarkdownPreviewTab>;
  markdownPreviewTabsRef: MutableRefObject<Record<string, MarkdownPreviewTab>>;
  navigationHistory: NavigationHistory;
  openPaths: string[];
  previewPath: string | null;
  recentFiles: RecentFileEntry[];
  recentLocations: RecentLocation[];
  restoreCachedIndexState: (
    indexProgress: IndexProgressState,
    indexHealthLogs: IndexHealthLogEntry[],
  ) => void;
  restoreHistory: (history: NavigationHistory) => void;
  setBookmarks: Dispatch<SetStateAction<Bookmark[]>>;
  setBottomPanelView: Dispatch<SetStateAction<BottomPanelView>>;
  setBottomPanelVisible: Dispatch<SetStateAction<boolean>>;
  setDocuments: Dispatch<SetStateAction<Record<string, EditorDocument>>>;
  setEntriesByDirectory: Dispatch<
    SetStateAction<Record<string, FileEntry[]>>
  >;
  setExpandedDirectories: Dispatch<SetStateAction<Set<string>>>;
  setImageTabs: Dispatch<SetStateAction<Record<string, ImageTab>>>;
  setManuallyCollapsedDirectories: Dispatch<SetStateAction<Set<string>>>;
  setMarkdownPreviewTabs: Dispatch<
    SetStateAction<Record<string, MarkdownPreviewTab>>
  >;
  setRecentFiles: Dispatch<SetStateAction<RecentFileEntry[]>>;
  setRecentLocations: Dispatch<SetStateAction<RecentLocation[]>>;
  setSidebarView: Dispatch<SetStateAction<SidebarView>>;
  setWorkspaceIdentityDescriptor: Dispatch<
    SetStateAction<WorkspaceIdentityDescriptor | null>
  >;
  sidebarView: SidebarView;
  updateEditorGroups: (
    update: (current: EditorGroupsState) => EditorGroupsState,
  ) => void;
  workspaceIdentityDescriptor: WorkspaceIdentityDescriptor | null;
}

export interface WorkspaceStateCache {
  workspaceStateCacheRef: MutableRefObject<
    Record<string, CachedWorkspaceWorkbenchState>
  >;
  cacheCurrentWorkspaceState: (rootPath: string) => void;
  restoreCachedWorkspaceState: (cached: CachedWorkspaceWorkbenchState) => void;
  clearWorkspaceStateCache: () => void;
}

export function useWorkspaceStateCache(
  dependencies: WorkspaceStateCacheDependencies,
): WorkspaceStateCache {
  const {
    activePath,
    bookmarks,
    bottomPanelView,
    bottomPanelVisible,
    documents,
    editorGroups,
    entriesByDirectory,
    expandedDirectories,
    imageTabs,
    imageTabsRef,
    indexHealthLogs,
    indexProgress,
    manuallyCollapsedDirectories,
    markdownPreviewTabs,
    markdownPreviewTabsRef,
    navigationHistory,
    openPaths,
    previewPath,
    recentFiles,
    recentLocations,
    restoreCachedIndexState,
    restoreHistory,
    setBookmarks,
    setBottomPanelView,
    setBottomPanelVisible,
    setDocuments,
    setEntriesByDirectory,
    setExpandedDirectories,
    setImageTabs,
    setManuallyCollapsedDirectories,
    setMarkdownPreviewTabs,
    setRecentFiles,
    setRecentLocations,
    setSidebarView,
    setWorkspaceIdentityDescriptor,
    sidebarView,
    updateEditorGroups,
    workspaceIdentityDescriptor,
  } = dependencies;

  const workspaceStateCacheRef = useRef<
    Record<string, CachedWorkspaceWorkbenchState>
  >({});

  const cacheCurrentWorkspaceState = useCallback(
    (rootPath: string) => {
      workspaceStateCacheRef.current[rootPath] = {
        bookmarks,
        bottomPanelView,
        bottomPanelVisible,
        editorSurface: buildEditorSurfaceSnapshot({
          activePath,
          documents,
          editorGroups,
          imageTabs,
          markdownPreviewTabs,
          openPaths,
          previewPath,
        }),
        entriesByDirectory,
        expandedDirectories: new Set(expandedDirectories),
        indexHealthLogs,
        indexProgress,
        manuallyCollapsedDirectories: new Set(manuallyCollapsedDirectories),
        navigationHistory,
        recentFiles,
        recentLocations,
        sidebarView,
        workspaceIdentityDescriptor,
      };
    },
    [
      activePath,
      bookmarks,
      bottomPanelView,
      bottomPanelVisible,
      documents,
      entriesByDirectory,
      editorGroups,
      manuallyCollapsedDirectories,
      expandedDirectories,
      imageTabs,
      markdownPreviewTabs,
      indexHealthLogs,
      indexProgress,
      navigationHistory,
      openPaths,
      previewPath,
      recentFiles,
      recentLocations,
      sidebarView,
      workspaceIdentityDescriptor,
    ],
  );

  const restoreCachedWorkspaceState = useCallback(
    (cached: CachedWorkspaceWorkbenchState) => {
      const editorSurface = selectEditorSurfaceRestore(cached.editorSurface);

      setEntriesByDirectory(cached.entriesByDirectory);
      setExpandedDirectories(new Set(cached.expandedDirectories));
      restoreCachedIndexState(cached.indexProgress, cached.indexHealthLogs);
      setManuallyCollapsedDirectories(
        new Set(cached.manuallyCollapsedDirectories),
      );
      setDocuments(editorSurface.documents);
      imageTabsRef.current = editorSurface.imageTabs;
      setImageTabs(editorSurface.imageTabs);
      markdownPreviewTabsRef.current = editorSurface.markdownPreviewTabs;
      setMarkdownPreviewTabs(editorSurface.markdownPreviewTabs);
      updateEditorGroups(() => editorSurface.editorGroups);
      setRecentFiles(cached.recentFiles);
      setRecentLocations(cached.recentLocations);
      setBookmarks(cached.bookmarks);
      setWorkspaceIdentityDescriptor(cached.workspaceIdentityDescriptor);
      restoreHistory(cached.navigationHistory);
      setSidebarView(cached.sidebarView);
      setBottomPanelView(cached.bottomPanelView);
      setBottomPanelVisible(cached.bottomPanelVisible);
    },
    [
      imageTabsRef,
      markdownPreviewTabsRef,
      restoreCachedIndexState,
      restoreHistory,
      setBookmarks,
      setBottomPanelView,
      setBottomPanelVisible,
      setDocuments,
      setEntriesByDirectory,
      setExpandedDirectories,
      setImageTabs,
      setManuallyCollapsedDirectories,
      setMarkdownPreviewTabs,
      setRecentFiles,
      setRecentLocations,
      setSidebarView,
      setWorkspaceIdentityDescriptor,
      updateEditorGroups,
    ],
  );

  const clearWorkspaceStateCache = useCallback(() => {
    workspaceStateCacheRef.current = {};
  }, []);

  return {
    workspaceStateCacheRef,
    cacheCurrentWorkspaceState,
    restoreCachedWorkspaceState,
    clearWorkspaceStateCache,
  };
}
