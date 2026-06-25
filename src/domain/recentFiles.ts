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

// Drops the entry for a path that no longer exists (the file was deleted) so the
// MRU never offers a dead entry whose reopen would fail. A missing path is a
// no-op (returns an equivalent fresh list). Pure: never mutates the input.
export function removeRecentFile(
  list: readonly RecentFileEntry[],
  path: string,
): RecentFileEntry[] {
  return list.filter((entry) => entry.path !== path);
}

// Remaps a renamed/moved file in place: the old path's entry keeps its MRU
// position but adopts the new path and name. When the destination path already
// has an entry it is collapsed into the remapped one (no duplicate). A missing
// old path is a no-op. Pure: never mutates the input.
export function renameRecentFile(
  list: readonly RecentFileEntry[],
  oldPath: string,
  next: RecentFileEntry,
): RecentFileEntry[] {
  const oldIndex = list.findIndex((entry) => entry.path === oldPath);

  if (oldIndex < 0) {
    return [...list];
  }

  // Remap in place, then drop any OTHER entry that already used the destination
  // path so the remapped entry (its name and MRU position) is the survivor —
  // regardless of whether the pre-existing duplicate sat before or after it.
  return list
    .map((entry, index) => (index === oldIndex ? next : entry))
    .filter((entry, index) => index === oldIndex || entry.path !== next.path);
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
