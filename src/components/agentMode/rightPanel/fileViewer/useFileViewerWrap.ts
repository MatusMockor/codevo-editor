import { useCallback, useState } from "react";

export const FILE_VIEWER_WRAP_STORAGE_KEY = "codevo.fileViewer.wrap";
export const FILE_VIEWER_TREE_STORAGE_KEY = "codevo.fileViewer.tree";

export function useFileViewerWrap(): readonly [boolean, () => void] {
  return useStoredFlag(FILE_VIEWER_WRAP_STORAGE_KEY, false);
}

export function useFileViewerTreeShown(): readonly [boolean, () => void] {
  return useStoredFlag(FILE_VIEWER_TREE_STORAGE_KEY, true);
}

function useStoredFlag(key: string, fallback: boolean): readonly [boolean, () => void] {
  const [value, setValue] = useState(() => readFlag(key, fallback));
  const toggle = useCallback(() => {
    writeFlag(key, !value);
    setValue(!value);
  }, [key, value]);
  return [value, toggle] as const;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const stored = storage()?.getItem(key);
    if (stored === "true") return true;
    if (stored === "false") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    storage()?.setItem(key, value ? "true" : "false");
  } catch {
    return;
  }
}
