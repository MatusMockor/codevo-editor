import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { Bookmark } from "../domain/bookmarks";
import type { BottomPanelView } from "../domain/bottomPanel";
import type {
  IndexHealthLogEntry,
  IndexProgressState,
} from "../domain/indexProgress";
import type { NavigationHistory } from "../domain/navigation";
import type { RecentFileEntry } from "../domain/recentFiles";
import type { RecentLocation } from "../domain/recentLocations";
import type { FileEntry } from "../domain/workspace";
import type { EditorSurfaceSnapshot } from "../domain/workspaceSessionSnapshot";
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
  bookmarks: Bookmark[];
  bottomPanelView: BottomPanelView;
  bottomPanelVisible: boolean;
  entriesByDirectory: Record<string, FileEntry[]>;
  expandedDirectories: Set<string>;
  indexHealthLogs: IndexHealthLogEntry[];
  indexProgress: IndexProgressState;
  manuallyCollapsedDirectories: Set<string>;
  navigationHistory: NavigationHistory;
  recentFiles: RecentFileEntry[];
  recentLocations: RecentLocation[];
  restoreCachedIndexState: (
    indexProgress: IndexProgressState,
    indexHealthLogs: IndexHealthLogEntry[],
  ) => void;
  restoreHistory: (history: NavigationHistory) => void;
  restoreEditorSurface: (
    rootPath: string,
    snapshot: EditorSurfaceSnapshot,
  ) => void;
  setBookmarks: Dispatch<SetStateAction<Bookmark[]>>;
  setBottomPanelView: Dispatch<SetStateAction<BottomPanelView>>;
  setBottomPanelVisible: Dispatch<SetStateAction<boolean>>;
  setEntriesByDirectory: Dispatch<
    SetStateAction<Record<string, FileEntry[]>>
  >;
  setExpandedDirectories: Dispatch<SetStateAction<Set<string>>>;
  setManuallyCollapsedDirectories: Dispatch<SetStateAction<Set<string>>>;
  setRecentFiles: Dispatch<SetStateAction<RecentFileEntry[]>>;
  setRecentLocations: Dispatch<SetStateAction<RecentLocation[]>>;
  setSidebarView: Dispatch<SetStateAction<SidebarView>>;
  setWorkspaceIdentityDescriptor: Dispatch<
    SetStateAction<WorkspaceIdentityDescriptor | null>
  >;
  sidebarView: SidebarView;
  snapshotEditorSurface: (rootPath: string) => EditorSurfaceSnapshot;
  workspaceIdentityDescriptor: WorkspaceIdentityDescriptor | null;
}

export interface WorkspaceStateCache {
  workspaceStateCacheRef: MutableRefObject<
    Record<string, CachedWorkspaceWorkbenchState>
  >;
  cacheCurrentWorkspaceState: (rootPath: string) => void;
  restoreCachedWorkspaceState: (
    rootPath: string,
    cached: CachedWorkspaceWorkbenchState,
  ) => void;
  clearWorkspaceStateCache: () => void;
}

export function useWorkspaceStateCache(
  dependencies: WorkspaceStateCacheDependencies,
): WorkspaceStateCache {
  const {
    bookmarks,
    bottomPanelView,
    bottomPanelVisible,
    entriesByDirectory,
    expandedDirectories,
    indexHealthLogs,
    indexProgress,
    manuallyCollapsedDirectories,
    navigationHistory,
    recentFiles,
    recentLocations,
    restoreCachedIndexState,
    restoreEditorSurface,
    restoreHistory,
    setBookmarks,
    setBottomPanelView,
    setBottomPanelVisible,
    setEntriesByDirectory,
    setExpandedDirectories,
    setManuallyCollapsedDirectories,
    setRecentFiles,
    setRecentLocations,
    setSidebarView,
    setWorkspaceIdentityDescriptor,
    sidebarView,
    snapshotEditorSurface,
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
        editorSurface: snapshotEditorSurface(rootPath),
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
      bookmarks,
      bottomPanelView,
      bottomPanelVisible,
      entriesByDirectory,
      manuallyCollapsedDirectories,
      expandedDirectories,
      indexHealthLogs,
      indexProgress,
      navigationHistory,
      recentFiles,
      recentLocations,
      sidebarView,
      snapshotEditorSurface,
      workspaceIdentityDescriptor,
    ],
  );

  const restoreCachedWorkspaceState = useCallback(
    (rootPath: string, cached: CachedWorkspaceWorkbenchState) => {
      setEntriesByDirectory(cached.entriesByDirectory);
      setExpandedDirectories(new Set(cached.expandedDirectories));
      restoreCachedIndexState(cached.indexProgress, cached.indexHealthLogs);
      setManuallyCollapsedDirectories(
        new Set(cached.manuallyCollapsedDirectories),
      );
      restoreEditorSurface(rootPath, cached.editorSurface);
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
      restoreCachedIndexState,
      restoreEditorSurface,
      restoreHistory,
      setBookmarks,
      setBottomPanelView,
      setBottomPanelVisible,
      setEntriesByDirectory,
      setExpandedDirectories,
      setManuallyCollapsedDirectories,
      setRecentFiles,
      setRecentLocations,
      setSidebarView,
      setWorkspaceIdentityDescriptor,
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
