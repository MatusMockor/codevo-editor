// Per-workspace MRU (most-recently-used) buffer of files the user has opened or
// activated. The newest file is kept at the head, paths are de-duplicated (an
// existing entry is moved to the head rather than appended), and the list is
// bounded so a long editing session never grows it without limit.
//
// These are pure helpers: the workbench controller owns the actual state (so it
// can be cached/restored per workspace tab) and delegates every mutation here.

export interface RecentFileEntry {
  name: string;
  path: string;
}

export const RECENT_FILES_LIMIT = 50;

export function pushRecentFile(
  list: readonly RecentFileEntry[],
  entry: RecentFileEntry,
  limit: number = RECENT_FILES_LIMIT,
): RecentFileEntry[] {
  const deduped = list.filter((candidate) => candidate.path !== entry.path);
  return [entry, ...deduped].slice(0, Math.max(limit, 0));
}

// Items to show in the switcher. The current file is dropped from the list and
// surfaced as the default selection target separately so a single Cmd+E + Enter
// flips back to the previous file (PhpStorm parity). When nothing else is recent
// the current file is kept so the switcher is never empty.
export function recentFilesForSwitcher(
  list: readonly RecentFileEntry[],
  activePath: string | null,
): RecentFileEntry[] {
  if (!activePath) {
    return [...list];
  }

  const withoutActive = list.filter((entry) => entry.path !== activePath);

  if (withoutActive.length === 0) {
    return [...list];
  }

  return withoutActive;
}
