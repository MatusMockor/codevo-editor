import { useCallback, useState } from "react";
import {
  encodeDiffViewWrap,
  parseDiffViewLayout,
  parseDiffViewWrap,
  type DiffViewLayout,
} from "../../../../domain/diffView/diffViewPreferences";

export const DIFF_LAYOUT_STORAGE_KEY = "codevo.diff.layout";
export const DIFF_WRAP_STORAGE_KEY = "codevo.diff.wrap";

export interface AgentDiffViewPreferences {
  readonly layout: DiffViewLayout;
  readonly wrap: boolean;
  setLayout(layout: DiffViewLayout): void;
  setWrap(wrap: boolean): void;
}

export function useAgentDiffViewPreferences(): AgentDiffViewPreferences {
  const [layout, setLayoutState] = useState(() =>
    parseDiffViewLayout(readItem(DIFF_LAYOUT_STORAGE_KEY)),
  );
  const [wrap, setWrapState] = useState(() => parseDiffViewWrap(readItem(DIFF_WRAP_STORAGE_KEY)));
  const setLayout = useCallback((next: DiffViewLayout) => {
    setLayoutState(next);
    writeItem(DIFF_LAYOUT_STORAGE_KEY, next);
  }, []);
  const setWrap = useCallback((next: boolean) => {
    setWrapState(next);
    writeItem(DIFF_WRAP_STORAGE_KEY, encodeDiffViewWrap(next));
  }, []);
  return { layout, wrap, setLayout, setWrap };
}

function readItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    return;
  }
}
