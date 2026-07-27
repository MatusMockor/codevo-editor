import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";

const STORAGE_KEY_PREFIX = "mockor.debug.breakpointGroups.collapsed.";
const MAX_COLLAPSED_FILE_PATHS = 10_000;
const MAX_FILE_PATH_LENGTH = 4_096;

export interface BreakpointGroupCollapseStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface UseBreakpointGroupCollapseStateResult {
  readonly collapsedFilePaths: ReadonlySet<string>;
  toggle(filePath: string): boolean;
}

interface CollapseState {
  readonly collapsedFilePaths: ReadonlySet<string>;
  readonly rootKey: string;
}

export function useBreakpointGroupCollapseState(
  workspaceRoot: string | null,
  activeFilePaths: readonly string[],
  storage?: BreakpointGroupCollapseStorage,
): UseBreakpointGroupCollapseStateResult {
  const rootKey = normalizedWorkspaceRootKey(workspaceRoot);
  const activeFilePathSet = useMemo(() => new Set(activeFilePaths), [activeFilePaths]);
  const storageRef = useRef(storage);
  storageRef.current = storage;
  const [state, setState] = useState<CollapseState>(() => ({
    collapsedFilePaths: retainActiveFilePaths(
      loadCollapsedFilePaths(storage, rootKey),
      activeFilePathSet,
    ),
    rootKey,
  }));

  useLayoutEffect(() => {
    const currentPaths =
      state.rootKey === rootKey
        ? state.collapsedFilePaths
        : loadCollapsedFilePaths(storageRef.current, rootKey);
    const collapsedFilePaths = retainActiveFilePaths(currentPaths, activeFilePathSet);
    persistCollapsedFilePaths(storageRef.current, rootKey, collapsedFilePaths);
    if (state.rootKey === rootKey && setsEqual(state.collapsedFilePaths, collapsedFilePaths)) {
      return;
    }
    setState({ collapsedFilePaths, rootKey });
  }, [activeFilePathSet, rootKey, state.collapsedFilePaths, state.rootKey]);

  const toggle = useCallback(
    (filePath: string) => {
      if (!filePath) {
        return false;
      }
      setState((current) => {
        const currentPaths =
          current.rootKey === rootKey
            ? retainActiveFilePaths(current.collapsedFilePaths, activeFilePathSet)
            : retainActiveFilePaths(
                loadCollapsedFilePaths(storageRef.current, rootKey),
                activeFilePathSet,
              );
        const collapsedFilePaths = new Set(currentPaths);
        if (collapsedFilePaths.has(filePath)) {
          collapsedFilePaths.delete(filePath);
          persistCollapsedFilePaths(storageRef.current, rootKey, collapsedFilePaths);
          return { collapsedFilePaths, rootKey };
        }
        collapsedFilePaths.add(filePath);
        persistCollapsedFilePaths(storageRef.current, rootKey, collapsedFilePaths);
        return { collapsedFilePaths, rootKey };
      });
      return true;
    },
    [activeFilePathSet, rootKey],
  );

  if (state.rootKey !== rootKey) {
    return {
      collapsedFilePaths: retainActiveFilePaths(
        loadCollapsedFilePaths(storageRef.current, rootKey),
        activeFilePathSet,
      ),
      toggle,
    };
  }

  return {
    collapsedFilePaths: retainActiveFilePaths(state.collapsedFilePaths, activeFilePathSet),
    toggle,
  };
}

export function breakpointGroupCollapseStorageKey(workspaceRoot: string): string {
  return `${STORAGE_KEY_PREFIX}${normalizedWorkspaceRootKey(workspaceRoot)}`;
}

function loadCollapsedFilePaths(
  storage: BreakpointGroupCollapseStorage | undefined,
  rootKey: string,
): ReadonlySet<string> {
  if (!rootKey) {
    return new Set();
  }
  try {
    const raw = (storage ?? window.localStorage).getItem(
      breakpointGroupCollapseStorageKey(rootKey),
    );
    if (raw === null) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    const paths = new Set<string>();
    for (const value of parsed) {
      if (typeof value !== "string" || value.length === 0 || value.length > MAX_FILE_PATH_LENGTH) {
        continue;
      }
      paths.add(value);
      if (paths.size >= MAX_COLLAPSED_FILE_PATHS) {
        break;
      }
    }
    return paths;
  } catch {
    return new Set();
  }
}

function persistCollapsedFilePaths(
  storage: BreakpointGroupCollapseStorage | undefined,
  rootKey: string,
  collapsedFilePaths: ReadonlySet<string>,
): void {
  if (!rootKey) {
    return;
  }
  try {
    const target = storage ?? window.localStorage;
    const boundedPaths = [...collapsedFilePaths]
      .filter((path) => path.length > 0 && path.length <= MAX_FILE_PATH_LENGTH)
      .sort()
      .slice(0, MAX_COLLAPSED_FILE_PATHS);
    if (boundedPaths.length === 0) {
      target.removeItem(breakpointGroupCollapseStorageKey(rootKey));
      return;
    }
    target.setItem(breakpointGroupCollapseStorageKey(rootKey), JSON.stringify(boundedPaths));
  } catch {
    return;
  }
}

function retainActiveFilePaths(
  collapsedFilePaths: ReadonlySet<string>,
  activeFilePaths: ReadonlySet<string>,
): ReadonlySet<string> {
  const retained = new Set<string>();
  let removed = false;
  for (const filePath of collapsedFilePaths) {
    if (activeFilePaths.has(filePath)) {
      retained.add(filePath);
      continue;
    }
    removed = true;
  }
  if (!removed) {
    return collapsedFilePaths;
  }
  return retained;
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}
