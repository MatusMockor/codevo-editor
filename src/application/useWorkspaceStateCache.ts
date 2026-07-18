import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { Bookmark } from "../domain/bookmarks";
import type { BottomPanelView } from "../domain/bottomPanel";
import type { Breakpoint } from "../domain/debug";
import type {
  IndexHealthLogEntry,
  IndexProgressState,
} from "../domain/indexProgress";
import type { NavigationHistory } from "../domain/navigation";
import type { RecentFileEntry } from "../domain/recentFiles";
import type { RecentLocation } from "../domain/recentLocations";
import type { FileEntry } from "../domain/workspace";
import { createEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";
import type { EditorSurfaceSnapshot } from "../domain/workspaceSessionSnapshot";
import type { WorkspaceIdentityDescriptor } from "../infrastructure/tauriWorkspaceIdentityGateway";
import type { SidebarView } from "./useWorkbenchController";

export interface CachedWorkspaceWorkbenchState {
  bookmarks: Bookmark[];
  bottomPanelView: BottomPanelView;
  bottomPanelVisible: boolean;
  breakpoints?: Breakpoint[];
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
  breakpoints?: Breakpoint[];
  entriesByDirectory: Record<string, FileEntry[]>;
  expandedDirectories: Set<string>;
  indexHealthLogs: IndexHealthLogEntry[];
  indexProgress: IndexProgressState;
  manuallyCollapsedDirectories: Set<string>;
  navigationHistory: NavigationHistory;
  recentFiles: RecentFileEntry[];
  recentLocations: RecentLocation[];
  restoreBreakpoints?: (breakpoints: Breakpoint[]) => void;
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
    breakpoints,
    entriesByDirectory,
    expandedDirectories,
    indexHealthLogs,
    indexProgress,
    manuallyCollapsedDirectories,
    navigationHistory,
    recentFiles,
    recentLocations,
    restoreBreakpoints,
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
      const identityKey = workspaceIdentityStateCacheKey(
        identity.workspaceId,
        identity.canonicalRoot,
      );
      const cache = workspaceStateCacheRef.current;
      const identityState = cache[identityKey];
      const matchingAliases = Object.entries(cache).filter(
        ([key, cached]) =>
          key !== identityKey && cachedStateHasWorkspaceId(cached, identity),
      );
      const requestedKey = normalizedWorkspaceRootKey(requestedRootPath);
      const selectedKey = normalizedWorkspaceRootKey(identity.selectedPath);
      const canonicalKey = normalizedWorkspaceRootKey(identity.canonicalRoot);
      const winner =
        identityState ??
        matchingAliases.find(([key]) => key === requestedKey)?.[1] ??
        matchingAliases.find(([key]) => key === selectedKey)?.[1] ??
        matchingAliases.find(([key]) => key === canonicalKey)?.[1] ??
        matchingAliases[0]?.[1];

      for (const [key] of matchingAliases) {
        delete cache[key];
      }

      if (!winner) {
        return null;
      }

      cache[identityKey] = winner;
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
        const rootKey = normalizedWorkspaceRootKey(rootPath);
        return workspaceStateCacheRef.current[rootKey] ?? null;
      }

      return coalesceWorkspaceStateCache(identity, rootPath);
    },
    [coalesceWorkspaceStateCache],
  );

  const forgetCachedWorkspaceState = useCallback(
    (rootPath: string, identity?: WorkspaceIdentityDescriptor | null) => {
      if (!identity) {
        delete workspaceStateCacheRef.current[
          normalizedWorkspaceRootKey(rootPath)
        ];
        return;
      }

      const cache = workspaceStateCacheRef.current;

      for (const [key, cached] of Object.entries(cache)) {
        if (!cachedStateHasWorkspaceId(cached, identity)) {
          continue;
        }

        delete cache[key];
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
        ? workspaceIdentityStateCacheKey(
            workspaceIdentityDescriptor.workspaceId,
            workspaceIdentityDescriptor.canonicalRoot,
          )
        : normalizedWorkspaceRootKey(rootPath);
      workspaceStateCacheRef.current[cacheKey] = {
        bookmarks,
        bottomPanelView,
        bottomPanelVisible,
        breakpoints,
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
      breakpoints,
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
      restoreBreakpoints?.(cached.breakpoints ?? []);
      setWorkspaceIdentityDescriptor(cached.workspaceIdentityDescriptor);
      restoreHistory(cached.navigationHistory);
      setSidebarView(cached.sidebarView);
      setBottomPanelView(cached.bottomPanelView);
      setBottomPanelVisible(cached.bottomPanelVisible);
    },
    [
      restoreBreakpoints,
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

export function workspaceIdentityStateCacheKey(
  workspaceId: string,
  canonicalRoot?: string,
): string {
  if (canonicalRoot) {
    return createEditorSessionOwnerKey(workspaceId, canonicalRoot);
  }

  return `workspace-id:${JSON.stringify(workspaceId)}`;
}

function cachedStateHasWorkspaceId(
  cached: CachedWorkspaceWorkbenchState,
  identity: WorkspaceIdentityDescriptor,
): boolean {
  const cachedIdentity = cached.workspaceIdentityDescriptor;
  if (!cachedIdentity) {
    return false;
  }

  return workspaceIdentityStateCacheKey(
    cachedIdentity.workspaceId,
    cachedIdentity.canonicalRoot,
  ) === workspaceIdentityStateCacheKey(
    identity.workspaceId,
    identity.canonicalRoot,
  );
}
