import {
  useCallback,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  navigateBack,
  navigateForward,
  recordNavigationLocation,
  type NavigationHistory,
  type NavigationLocation,
} from "../domain/navigation";
import {
  pushRecentFile,
  removeRecentFile,
  renameRecentFile,
  type RecentFileEntry,
} from "../domain/recentFiles";
import {
  buildRecentLocation,
  pushRecentLocation,
  removeRecentLocationsForPath,
  renameRecentLocationsPath,
  type RecentLocation,
} from "../domain/recentLocations";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRelativePath } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";

/**
 * Collaborators the Recent Files / Recent Locations / navigation-snapshot
 * concern needs from the workbench shell. `recentFiles`/`recentLocations`/
 * `navigationHistory` themselves stay shell-owned (same seam shape as
 * `bookmarks`/`setBookmarks` for `useBookmarks`) because they are part of the
 * per-tab cached workbench state (captured/restored by the shell's cache
 * lifecycle alongside documents/openPaths/bookmarks) - only the setters are
 * injected here. The Recent Files switcher / Recent Locations panel toggles
 * are ALSO shell-owned (unlike a purely-hook-local panel toggle) because
 * unrelated shell flows (Escape/close-all-overlays, file delete/rename
 * cleanup, opening a recent file) flip them directly outside this hook's
 * boundary too.
 */
export interface RecentNavigationDependencies {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  resolveCurrentWorkspaceRuntimeOwner: () => WorkspaceRuntimeOwner | null;
  activeDocument: EditorDocument | null;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  setRecentFiles: Dispatch<SetStateAction<RecentFileEntry[]>>;
  setRecentLocations: Dispatch<SetStateAction<RecentLocation[]>>;
  setNavigationHistory: Dispatch<SetStateAction<NavigationHistory>>;
  setRecentFilesSwitcherOpen: (isOpen: boolean) => void;
  setRecentLocationsPanelOpen: (isOpen: boolean) => void;
  // Closed for mutual exclusivity whenever the switcher/panel opens (PhpStorm
  // parity: only one of these overlays is visible at a time).
  setQuickOpenOpen: (isOpen: boolean) => void;
  setClassOpenOpen: (isOpen: boolean) => void;
  setWorkspaceSymbolsOpen: (isOpen: boolean) => void;
}

export interface RecentNavigation {
  recordRecentFile: (entry: RecentFileEntry) => void;
  forgetRecentFile: (path: string) => void;
  remapRecentFile: (oldPath: string, entry: RecentFileEntry) => void;
  openRecentFilesSwitcher: () => void;
  forgetRecentLocationsForPath: (path: string) => void;
  remapRecentLocations: (
    oldPath: string,
    next: { name: string; path: string; relativePath: string },
  ) => void;
  openRecentLocationsPanel: () => void;
  currentNavigationLocation: () => NavigationLocation | null;
  recordNavigationLocationSnapshot: (
    location: NavigationLocation | null,
  ) => void;
  recordRecentLocationSnapshot: (location: NavigationLocation | null) => void;
  recordCurrentNavigationLocation: () => void;
}

/**
 * Recent Files (Cmd+E MRU), Recent Locations (Cmd+Shift+E), and the
 * navigation-history snapshot recording that feeds both the Recent Locations
 * panel and back/forward history (see {@link useNavigationHistory}). Owns
 * every mutator/opener; the underlying lists and the switcher/panel toggles
 * are injected (see {@link RecentNavigationDependencies}) since the shell's
 * per-tab cache lifecycle and other overlay flows read/write them directly.
 */
export function useRecentNavigation(
  dependencies: RecentNavigationDependencies,
): RecentNavigation {
  const {
    currentWorkspaceRootRef,
    resolveCurrentWorkspaceRuntimeOwner,
    activeDocument,
    activeEditorPositionRef,
    documentsRef,
    setRecentFiles,
    setRecentLocations,
    setNavigationHistory,
    setRecentFilesSwitcherOpen,
    setRecentLocationsPanelOpen,
    setQuickOpenOpen,
    setClassOpenOpen,
    setWorkspaceSymbolsOpen,
  } = dependencies;

  // Records a file at the head of the per-workspace MRU buffer. Called whenever a
  // document is opened or activated so the Cmd+E switcher always reflects the
  // user's most recent navigation order.
  const recordRecentFile = useCallback((entry: RecentFileEntry) => {
    setRecentFiles((current) => pushRecentFile(current, entry));
  }, []);

  const forgetRecentFile = useCallback((path: string) => {
    setRecentFiles((current) => removeRecentFile(current, path));
  }, []);

  const remapRecentFile = useCallback(
    (oldPath: string, entry: RecentFileEntry) => {
      setRecentFiles((current) => renameRecentFile(current, oldPath, entry));
    },
    [],
  );

  const openRecentFilesSwitcher = useCallback(() => {
    if (!currentWorkspaceRootRef.current) {
      return;
    }

    setQuickOpenOpen(false);
    setClassOpenOpen(false);
    setWorkspaceSymbolsOpen(false);
    setRecentLocationsPanelOpen(false);
    setRecentFilesSwitcherOpen(true);
  }, []);

  const forgetRecentLocationsForPath = useCallback((path: string) => {
    setRecentLocations((current) =>
      removeRecentLocationsForPath(current, path),
    );
  }, []);

  const remapRecentLocations = useCallback(
    (oldPath: string, next: { name: string; path: string; relativePath: string }) => {
      setRecentLocations((current) =>
        renameRecentLocationsPath(current, oldPath, next),
      );
    },
    [],
  );

  const openRecentLocationsPanel = useCallback(() => {
    if (!currentWorkspaceRootRef.current) {
      return;
    }

    setQuickOpenOpen(false);
    setClassOpenOpen(false);
    setWorkspaceSymbolsOpen(false);
    setRecentFilesSwitcherOpen(false);
    setRecentLocationsPanelOpen(true);
  }, []);

  const currentNavigationLocation =
    useCallback((): NavigationLocation | null => {
      if (!activeDocument) {
        return null;
      }

      return {
        path: activeDocument.path,
        position: activeEditorPositionRef.current || {
          column: 1,
          lineNumber: 1,
        },
      };
    }, [activeDocument]);

  const recordNavigationLocationSnapshot = useCallback((
    location: NavigationLocation | null,
  ) => {
    const owner = resolveCurrentWorkspaceRuntimeOwner();

    if (!owner) {
      return;
    }

    writeNavigationHistory(
      setNavigationHistory,
      (current) =>
        recordOwnedNavigationLocation(current, location, owner.ownerKey),
    );
  }, [resolveCurrentWorkspaceRuntimeOwner, setNavigationHistory]);

  // Records a visited/edited POSITION in the per-workspace Recent Locations
  // history. Reads documents + workspace root from refs (so it stays stable on
  // the navigation hot path) and delegates snippet/relative-path extraction to
  // the pure domain helper. Targets outside the workspace yield a null location
  // and are dropped. Isolation: the requested root is captured by the ref read,
  // so a navigation in the active tab never appends to another tab's history.
  const recordRecentLocationSnapshot = useCallback(
    (location: NavigationLocation | null) => {
      const root = currentWorkspaceRootRef.current;

      if (!location || !root) {
        return;
      }

      const document = documentsRef.current[location.path];
      const built = buildRecentLocation({
        content: document?.content ?? null,
        name: document?.name ?? null,
        navigation: location,
        relativePath: workspaceRelativePath(root, location.path),
      });

      if (!built) {
        return;
      }

      setRecentLocations((current) => pushRecentLocation(current, built));
    },
    [],
  );

  const recordCurrentNavigationLocation = useCallback(() => {
    const location = currentNavigationLocation();
    recordNavigationLocationSnapshot(location);
    recordRecentLocationSnapshot(location);
  }, [
    currentNavigationLocation,
    recordNavigationLocationSnapshot,
    recordRecentLocationSnapshot,
  ]);

  return {
    recordRecentFile,
    forgetRecentFile,
    remapRecentFile,
    openRecentFilesSwitcher,
    forgetRecentLocationsForPath,
    remapRecentLocations,
    openRecentLocationsPanel,
    currentNavigationLocation,
    recordNavigationLocationSnapshot,
    recordRecentLocationSnapshot,
    recordCurrentNavigationLocation,
  };
}

/**
 * Collaborators the back/forward navigation-history playback needs from the
 * workbench shell. `navigationHistory` stays shell-owned for the same reason
 * as `recentFiles`/`recentLocations` in {@link useRecentNavigation} (per-tab
 * cache lifecycle); `currentNavigationLocation` /
 * `recordCurrentNavigationLocation` / `forgetRecentLocationsForPath` are the
 * sibling {@link useRecentNavigation} hook's own exports (the two hooks cover
 * one cohesive "navigation history" concern but are mounted separately in the
 * shell because this one needs `openPathForNavigation`, which is only
 * available later in the shell's render order than the Recent Files/Locations
 * mutators are).
 */
export interface NavigationHistoryDependencies {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  resolveCurrentWorkspaceRuntimeOwner: () => WorkspaceRuntimeOwner | null;
  workspaceRoot: string | null;
  navigationHistory: NavigationHistory;
  setNavigationHistory: Dispatch<SetStateAction<NavigationHistory>>;
  setRecentLocationsPanelOpen: (isOpen: boolean) => void;
  setEditorRevealTarget: (target: NavigationLocation | null) => void;
  currentNavigationLocation: () => NavigationLocation | null;
  recordCurrentNavigationLocation: () => void;
  forgetRecentLocationsForPath: (path: string) => void;
  openPathForNavigation: (
    path: string,
    options?: { readOnly?: boolean; shouldCommit?: () => boolean },
  ) => Promise<boolean>;
  shouldOpenNavigationTargetReadOnly: (
    rootPath: string,
    path: string,
  ) => boolean;
}

export interface NavigationHistoryPlayback {
  navigateBackward: () => Promise<void>;
  navigateForwardInHistory: () => Promise<void>;
  openRecentLocation: (location: RecentLocation) => Promise<void>;
}

type NavigationHistorySetter = Dispatch<SetStateAction<NavigationHistory>>;

interface NavigationHistoryTransaction {
  current: NavigationHistory | null;
}

const navigationHistoryTransactions = new WeakMap<
  NavigationHistorySetter,
  NavigationHistoryTransaction
>();

function writeNavigationHistory(
  setNavigationHistory: NavigationHistorySetter,
  update: (current: NavigationHistory) => NavigationHistory,
): void {
  const transaction = navigationHistoryTransactions.get(setNavigationHistory);

  if (!transaction?.current) {
    setNavigationHistory(update);
    return;
  }

  const next = update(transaction.current);
  transaction.current = next;
  setNavigationHistory(next);
}

function recordOwnedNavigationLocation(
  history: NavigationHistory,
  location: NavigationLocation | null,
  ownerKey: string,
): NavigationHistory {
  if (!location) {
    return history;
  }

  const ownedHistory =
    history.ownerKey && history.ownerKey !== ownerKey
      ? createOwnedNavigationHistory(ownerKey)
      : history;
  const next = recordNavigationLocation(ownedHistory, location);

  if (next === ownedHistory && next.ownerKey === ownerKey) {
    return next;
  }

  return { ...next, ownerKey };
}

function createOwnedNavigationHistory(ownerKey: string): NavigationHistory {
  return {
    backStack: [],
    forwardStack: [],
    ownerKey,
  };
}

function compareAndSetNavigationHistory(
  transaction: NavigationHistoryTransaction,
  setNavigationHistory: NavigationHistorySetter,
  requestedHistory: NavigationHistory,
  nextHistory: NavigationHistory,
): boolean {
  if (transaction.current !== requestedHistory) {
    return false;
  }

  transaction.current = nextHistory;
  setNavigationHistory(nextHistory);
  return true;
}

function workspaceNavigationRequestIsCurrent(
  currentWorkspaceRootRef: MutableRefObject<string | null>,
  resolveCurrentWorkspaceRuntimeOwner: () => WorkspaceRuntimeOwner | null,
  requestedRoot: string,
  requestedOwner: WorkspaceRuntimeOwner,
): boolean {
  if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
    return false;
  }

  return (
    resolveCurrentWorkspaceRuntimeOwner()?.ownerKey === requestedOwner.ownerKey
  );
}

/**
 * Back/forward navigation history (PhpStorm parity) plus jumping to a Recent
 * Location from its panel. The history stack itself is injected (see
 * {@link NavigationHistoryDependencies}) since it is per-tab cached workbench
 * state; this hook owns the back/forward traversal and the recent-location
 * jump handler.
 */
export function useNavigationHistory(
  dependencies: NavigationHistoryDependencies,
): NavigationHistoryPlayback {
  const {
    currentWorkspaceRootRef,
    resolveCurrentWorkspaceRuntimeOwner,
    workspaceRoot,
    navigationHistory,
    setNavigationHistory,
    setRecentLocationsPanelOpen,
    setEditorRevealTarget,
    currentNavigationLocation,
    recordCurrentNavigationLocation,
    forgetRecentLocationsForPath,
    openPathForNavigation,
    shouldOpenNavigationTargetReadOnly,
  } = dependencies;
  const navigationHistoryTransaction = useRef<NavigationHistory | null>(null);
  const currentOwnerKey =
    resolveCurrentWorkspaceRuntimeOwner()?.ownerKey ?? null;

  useLayoutEffect(() => {
    if (
      currentOwnerKey &&
      navigationHistory.ownerKey &&
      navigationHistory.ownerKey !== currentOwnerKey
    ) {
      const next = createOwnedNavigationHistory(currentOwnerKey);
      navigationHistoryTransaction.current = next;
      setNavigationHistory(next);
      return;
    }

    navigationHistoryTransaction.current = navigationHistory;
    navigationHistoryTransactions.set(
      setNavigationHistory,
      navigationHistoryTransaction,
    );

    return () => {
      if (
        navigationHistoryTransactions.get(setNavigationHistory) !==
        navigationHistoryTransaction
      ) {
        return;
      }

      navigationHistoryTransactions.delete(setNavigationHistory);
    };
  }, [
    navigationHistory,
    currentOwnerKey,
    setNavigationHistory,
    workspaceRoot,
  ]);

  const applyNavigationLocation = useCallback(
    async (
      location: NavigationLocation,
      requestedRoot: string,
      shouldCommit: () => boolean,
    ) => {
      const opened = await openPathForNavigation(location.path, {
        readOnly: shouldOpenNavigationTargetReadOnly(
          requestedRoot,
          location.path,
        ),
        shouldCommit,
      });

      if (!shouldCommit()) {
        return false;
      }

      if (!opened) {
        return false;
      }

      return true;
    },
    [openPathForNavigation, shouldOpenNavigationTargetReadOnly],
  );

  const commitNavigation = useCallback(
    (
      requestedHistory: NavigationHistory,
      nextHistory: NavigationHistory,
      target: NavigationLocation,
      shouldCommit: () => boolean,
    ) => {
      if (!shouldCommit()) {
        return;
      }

      const committed = compareAndSetNavigationHistory(
        navigationHistoryTransaction,
        setNavigationHistory,
        requestedHistory,
        nextHistory,
      );

      if (!committed) {
        return;
      }

      setEditorRevealTarget(target);
    },
    [navigationHistoryTransaction, setNavigationHistory],
  );

  const navigateBackward = useCallback(async () => {
    const requestedRoot = currentWorkspaceRootRef.current;
    const requestedOwner = resolveCurrentWorkspaceRuntimeOwner();
    const requestedHistory = navigationHistory;

    if (!requestedRoot || !requestedOwner) {
      return;
    }

    if (
      navigationHistory.ownerKey &&
      navigationHistory.ownerKey !== requestedOwner.ownerKey
    ) {
      return;
    }

    const next = navigateBack(navigationHistory, currentNavigationLocation());

    if (!next.target) {
      return;
    }

    const shouldCommit = () =>
      navigationHistoryTransaction.current === requestedHistory &&
      workspaceNavigationRequestIsCurrent(
        currentWorkspaceRootRef,
        resolveCurrentWorkspaceRuntimeOwner,
        requestedRoot,
        requestedOwner,
      );
    const applied = await applyNavigationLocation(
      next.target,
      requestedRoot,
      shouldCommit,
    );

    if (!applied) {
      return;
    }

    commitNavigation(
      requestedHistory,
      next.history,
      next.target,
      shouldCommit,
    );
  }, [
    applyNavigationLocation,
    commitNavigation,
    currentNavigationLocation,
    navigationHistory,
    resolveCurrentWorkspaceRuntimeOwner,
  ]);

  const navigateForwardInHistory = useCallback(async () => {
    const requestedRoot = currentWorkspaceRootRef.current;
    const requestedOwner = resolveCurrentWorkspaceRuntimeOwner();
    const requestedHistory = navigationHistory;

    if (!requestedRoot || !requestedOwner) {
      return;
    }

    if (
      navigationHistory.ownerKey &&
      navigationHistory.ownerKey !== requestedOwner.ownerKey
    ) {
      return;
    }

    const next = navigateForward(navigationHistory, currentNavigationLocation());

    if (!next.target) {
      return;
    }

    const shouldCommit = () =>
      navigationHistoryTransaction.current === requestedHistory &&
      workspaceNavigationRequestIsCurrent(
        currentWorkspaceRootRef,
        resolveCurrentWorkspaceRuntimeOwner,
        requestedRoot,
        requestedOwner,
      );
    const applied = await applyNavigationLocation(
      next.target,
      requestedRoot,
      shouldCommit,
    );

    if (!applied) {
      return;
    }

    commitNavigation(
      requestedHistory,
      next.history,
      next.target,
      shouldCommit,
    );
  }, [
    applyNavigationLocation,
    commitNavigation,
    currentNavigationLocation,
    navigationHistory,
    resolveCurrentWorkspaceRuntimeOwner,
  ]);

  // Jumps to a recent location from the panel. Mirrors the navigation flow:
  // snapshot where we were (so Back works and the spot stays in history), then
  // reveal the target. Isolation: the requested root and runtime owner are
  // captured up front and re-checked after the await, so a workspace switch or
  // same-root owner replacement drops the stale result for another tab.
  const openRecentLocation = useCallback(
    async (location: RecentLocation) => {
      const requestedRoot = currentWorkspaceRootRef.current;
      const requestedOwner = resolveCurrentWorkspaceRuntimeOwner();

      if (!requestedRoot || !requestedOwner) {
        return;
      }

      recordCurrentNavigationLocation();

      const target: NavigationLocation = {
        path: location.path,
        position: { column: location.column, lineNumber: location.line },
      };
      const shouldCommit = () =>
        workspaceNavigationRequestIsCurrent(
          currentWorkspaceRootRef,
          resolveCurrentWorkspaceRuntimeOwner,
          requestedRoot,
          requestedOwner,
        );
      const opened = await openPathForNavigation(target.path, {
        readOnly: shouldOpenNavigationTargetReadOnly(
          requestedRoot,
          target.path,
        ),
        shouldCommit,
      });

      if (!shouldCommit()) {
        return;
      }

      if (!opened) {
        // The file vanished out from under the panel (deleted/moved outside the
        // editor). Drop every dead position so it stops being offered.
        forgetRecentLocationsForPath(location.path);
        setRecentLocationsPanelOpen(false);
        return;
      }

      setEditorRevealTarget(target);
      setRecentLocationsPanelOpen(false);
    },
    [
      forgetRecentLocationsForPath,
      openPathForNavigation,
      recordCurrentNavigationLocation,
      resolveCurrentWorkspaceRuntimeOwner,
      shouldOpenNavigationTargetReadOnly,
    ],
  );

  return {
    navigateBackward,
    navigateForwardInHistory,
    openRecentLocation,
  };
}
