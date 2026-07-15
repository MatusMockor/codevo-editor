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
import { createWorkspaceRoot } from "../domain/workspacePath";
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
  setEntriesByDirectory: Dispatch<SetStateAction<Record<string, FileEntry[]>>>;
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
  resolveCachedWorkspaceState: (
    rootPath: string,
    identity?: WorkspaceIdentityDescriptor | null,
  ) => CachedWorkspaceWorkbenchState | null;
  coalesceWorkspaceStateCache: (
    identity: WorkspaceIdentityDescriptor,
    requestedRootPath?: string,
  ) => CachedWorkspaceWorkbenchState | null;
  forgetCachedWorkspaceState: (
    rootPath: string,
    identity?: WorkspaceIdentityDescriptor | null,
  ) => void;
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

  const coalesceWorkspaceStateCache = useCallback(
    (
      identity: WorkspaceIdentityDescriptor,
      requestedRootPath?: string,
    ): CachedWorkspaceWorkbenchState | null => {
      const canonicalKey = normalizedCanonicalRootKey(identity);
      const cache = workspaceStateCacheRef.current;
      const canonicalState = cache[canonicalKey];
      const requestedState = requestedRootPath
        ? cache[requestedRootPath]
        : undefined;
      const selectedState = cache[identity.selectedPath];
      const describedAlias = Object.entries(cache).find(
        ([key, cached]) =>
          key !== canonicalKey &&
          cachedStateDescribesCanonicalRoot(cached, canonicalKey),
      )?.[1];
      const winner =
        canonicalState ?? requestedState ?? selectedState ?? describedAlias;

      for (const [key, cached] of Object.entries(cache)) {
        if (key === canonicalKey) {
          continue;
        }

        if (
          key === requestedRootPath ||
          key === identity.selectedPath ||
          cachedStateDescribesCanonicalRoot(cached, canonicalKey)
        ) {
          delete cache[key];
        }
      }

      if (!winner) {
        return null;
      }

      cache[canonicalKey] = winner;
      return winner;
    },
    [],
  );

  const resolveCachedWorkspaceState = useCallback(
    (
      rootPath: string,
      identity?: WorkspaceIdentityDescriptor | null,
    ): CachedWorkspaceWorkbenchState | null => {
      if (!identity) {
        return workspaceStateCacheRef.current[rootPath] ?? null;
      }

      return coalesceWorkspaceStateCache(identity, rootPath);
    },
    [coalesceWorkspaceStateCache],
  );

  const forgetCachedWorkspaceState = useCallback(
    (rootPath: string, identity?: WorkspaceIdentityDescriptor | null) => {
      if (!identity) {
        delete workspaceStateCacheRef.current[rootPath];
        return;
      }

      const canonicalKey = normalizedCanonicalRootKey(identity);
      const cache = workspaceStateCacheRef.current;

      for (const [key, cached] of Object.entries(cache)) {
        if (
          key === rootPath ||
          key === identity.selectedPath ||
          key === canonicalKey ||
          cachedStateDescribesCanonicalRoot(cached, canonicalKey)
        ) {
          delete cache[key];
        }
      }
    },
    [],
  );

  const cacheCurrentWorkspaceState = useCallback(
    (rootPath: string) => {
      if (workspaceIdentityDescriptor) {
        coalesceWorkspaceStateCache(workspaceIdentityDescriptor, rootPath);
      }

      const cacheKey = workspaceIdentityDescriptor
        ? normalizedCanonicalRootKey(workspaceIdentityDescriptor)
        : rootPath;
      workspaceStateCacheRef.current[cacheKey] = {
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
      coalesceWorkspaceStateCache,
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
    resolveCachedWorkspaceState,
    coalesceWorkspaceStateCache,
    forgetCachedWorkspaceState,
    restoreCachedWorkspaceState,
    clearWorkspaceStateCache,
  };
}

function normalizedCanonicalRootKey(
  identity: WorkspaceIdentityDescriptor,
): string {
  const root = createWorkspaceRoot(
    identity.workspaceId,
    identity.canonicalRoot,
    identity.policy,
  );

  if (!root.ok) {
    return identity.canonicalRoot;
  }

  return root.value.nativePath;
}

function cachedStateDescribesCanonicalRoot(
  cached: CachedWorkspaceWorkbenchState,
  canonicalKey: string,
): boolean {
  const identity = cached.workspaceIdentityDescriptor;

  if (!identity) {
    return false;
  }

  return normalizedCanonicalRootKey(identity) === canonicalKey;
}
