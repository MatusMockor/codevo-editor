// Per-workspace bookmarks (PhpStorm parity). The user marks a line in a file,
// jumps between marks, and browses them in a panel. A bookmark binds to a
// path + line number (1-based, matching EditorPosition.lineNumber) plus the
// preview text of that line at the time it was marked.
//
// These are pure helpers: the workbench controller owns the actual state (so it
// can be cached/restored per workspace tab — same isolation contract as the
// recent-files MRU) and delegates every mutation here. Nothing here touches
// Monaco, React, or the filesystem.

export interface Bookmark {
  lineNumber: number;
  path: string;
  preview: string;
}

// A cursor location used to anchor next/previous navigation. It need not itself
// be a bookmark — navigation finds the nearest bookmark after/before it.
export interface BookmarkLocation {
  lineNumber: number;
  path: string;
}

function isSameLine(bookmark: Bookmark, path: string, lineNumber: number): boolean {
  return bookmark.path === path && bookmark.lineNumber === lineNumber;
}

export function hasBookmark(
  list: readonly Bookmark[],
  path: string,
  lineNumber: number,
): boolean {
  return list.some((bookmark) => isSameLine(bookmark, path, lineNumber));
}

// Adds the bookmark when its path+line is not already marked, otherwise removes
// the existing one (PhpStorm F11 toggle semantics). Pure: never mutates input.
export function toggleBookmark(
  list: readonly Bookmark[],
  bookmark: Bookmark,
): Bookmark[] {
  if (hasBookmark(list, bookmark.path, bookmark.lineNumber)) {
    return list.filter(
      (entry) => !isSameLine(entry, bookmark.path, bookmark.lineNumber),
    );
  }

  return [...list, bookmark];
}

// Drops every bookmark for a deleted file so the panel never offers a dead mark.
export function removeBookmarksForPath(
  list: readonly Bookmark[],
  path: string,
): Bookmark[] {
  return list.filter((bookmark) => bookmark.path !== path);
}

// Re-points every bookmark for a renamed/moved file onto the new path, keeping
// its line and preview. A missing old path is a no-op. Pure: never mutates.
export function renameBookmarksForPath(
  list: readonly Bookmark[],
  oldPath: string,
  newPath: string,
): Bookmark[] {
  return list.map((bookmark) =>
    bookmark.path === oldPath ? { ...bookmark, path: newPath } : bookmark,
  );
}

// Canonical browse/navigation order: by path, then ascending line number.
export function sortBookmarks(list: readonly Bookmark[]): Bookmark[] {
  return [...list].sort((left, right) => {
    const byPath = left.path.localeCompare(right.path);

    if (byPath !== 0) {
      return byPath;
    }

    return left.lineNumber - right.lineNumber;
  });
}

// True when `candidate` sorts strictly after `anchor` in (path, line) order.
// Both arguments only need a path + line, so this works for bookmarks and bare
// cursor locations alike.
function isAfter(
  candidate: BookmarkLocation,
  anchor: BookmarkLocation,
): boolean {
  const byPath = candidate.path.localeCompare(anchor.path);

  if (byPath !== 0) {
    return byPath > 0;
  }

  return candidate.lineNumber > anchor.lineNumber;
}

// The next bookmark strictly after the given location in sorted order, wrapping
// to the first bookmark when the location is at/after the last. With no current
// location, starts at the first. Returns null only when there are no bookmarks.
export function nextBookmark(
  list: readonly Bookmark[],
  location: BookmarkLocation | null,
): Bookmark | null {
  const sorted = sortBookmarks(list);

  if (sorted.length === 0) {
    return null;
  }

  if (!location) {
    return sorted[0];
  }

  const next = sorted.find((bookmark) => isAfter(bookmark, location));

  return next ?? sorted[0];
}

// The previous bookmark strictly before the given location in sorted order,
// wrapping to the last bookmark when the location is at/before the first. With
// no current location, starts at the last. Null only when there are none.
export function previousBookmark(
  list: readonly Bookmark[],
  location: BookmarkLocation | null,
): Bookmark | null {
  const sorted = sortBookmarks(list);

  if (sorted.length === 0) {
    return null;
  }

  const last = sorted[sorted.length - 1];

  if (!location) {
    return last;
  }

  const before = [...sorted]
    .reverse()
    .find((bookmark) => isAfter(location, bookmark));

  return before ?? last;
}
