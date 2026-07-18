import type { Breakpoint } from "./debug";
import {
  deserializeBreakpoints,
  serializeBreakpoints,
} from "./debugBreakpoints";
import { normalizedWorkspaceRootKey } from "./workspaceRootKey";

export interface BreakpointStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY_PREFIX = "mockor.debug.breakpoints.";

export function debugBreakpointStorageKey(workspaceRoot: string): string {
  return `${STORAGE_KEY_PREFIX}${normalizedWorkspaceRootKey(workspaceRoot)}`;
}

export function loadPersistedBreakpoints(
  storage: BreakpointStorage,
  workspaceRoot: string,
): Breakpoint[] {
  let raw: string | null;

  try {
    raw = storage.getItem(debugBreakpointStorageKey(workspaceRoot));
  } catch {
    return [];
  }

  if (raw === null) {
    return [];
  }

  return deserializeBreakpoints(raw);
}

export function savePersistedBreakpoints(
  storage: BreakpointStorage,
  workspaceRoot: string,
  breakpoints: readonly Breakpoint[],
): void {
  const key = debugBreakpointStorageKey(workspaceRoot);

  try {
    if (breakpoints.length === 0) {
      storage.removeItem(key);
      return;
    }

    storage.setItem(key, serializeBreakpoints(breakpoints));
  } catch {
    return;
  }
}
