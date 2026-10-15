import { useCallback, useState } from "react";

export const FILE_VIEWER_WRAP_STORAGE_KEY = "codevo.fileViewer.wrap";

export function useFileViewerWrap(): readonly [boolean, () => void] {
  const [wrap, setWrap] = useState(readWrap);
  const toggle = useCallback(() => {
    writeWrap(!wrap);
    setWrap(!wrap);
  }, [wrap]);
  return [wrap, toggle] as const;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readWrap(): boolean {
  try {
    return storage()?.getItem(FILE_VIEWER_WRAP_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeWrap(wrap: boolean): void {
  try {
    storage()?.setItem(FILE_VIEWER_WRAP_STORAGE_KEY, wrap ? "true" : "false");
  } catch {
    return;
  }
}
