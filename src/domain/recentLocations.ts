// Per-workspace history of recent EDIT / navigation LOCATIONS (file + line +
// the text of that line as a context snippet). Unlike the Recent Files MRU
// (recentFiles.ts), which tracks whole files, this tracks the concrete POSITIONS
// the user was at or edited, newest first - the data behind the PhpStorm-style
// Recent Locations dialog (Cmd+Shift+E).
//
// These are pure helpers: the workbench controller owns the actual state (so it
// can be cached/restored per workspace tab, exactly like recent files and the
// navigation history) and delegates every mutation here.

export interface RecentLocation {
  // Absolute path (used to reopen the document for navigation).
  path: string;
  // Workspace-relative path (used for display / stable identity across renames).
  relativePath: string;
  // File name (last path segment) for the panel heading.
  name: string;
  // 1-based caret line.
  line: number;
  // 1-based caret column (carried so the jump restores the exact spot).
  column: number;
  // Trimmed text of `line`, shown as the context snippet in the panel.
  snippet: string;
}

export interface RecentLocationNavigationTarget {
  path: string;
  position: { column: number; lineNumber: number };
}

export interface BuildRecentLocationInput {
  // Full text of the document the location points into, for the snippet.
  content: string | null;
  // Display name (file name). When absent it is derived from the path.
  name: string | null;
  // The navigation target (path + caret position) being recorded.
  navigation: RecentLocationNavigationTarget | null;
  // Workspace-relative path; null when the target is outside the workspace.
  relativePath: string | null;
}

export const RECENT_LOCATIONS_LIMIT = 50;

// Two visits to the same file whose lines are within this many rows of each
// other are treated as the SAME spot: scrolling a few lines or fixing the line
// just above should not flood the list with near-identical entries. The newer
// visit replaces (and refreshes the snippet of) the head entry instead.
export const RECENT_LOCATION_NEAR_LINES = 3;

// Builds a RecentLocation from a navigation target plus the document content,
// extracting the context snippet (the trimmed text of the caret line). Returns
// null when there is nothing to record (no navigation target) or the target is
// outside the workspace (no relative path) - the controller drops those rather
// than recording a position it cannot display or safely reopen. Pure.
export function buildRecentLocation(
  input: BuildRecentLocationInput,
): RecentLocation | null {
  if (!input.navigation || !input.relativePath) {
    return null;
  }

  const line = Math.max(1, Math.trunc(input.navigation.position.lineNumber));
  const column = Math.max(1, Math.trunc(input.navigation.position.column));

  return {
    column,
    line,
    name: input.name || lastSegment(input.navigation.path),
    path: input.navigation.path,
    relativePath: input.relativePath,
    snippet: snippetForLine(input.content, line),
  };
}

// Pushes a location to the head, newest first. When it sits on (or within
// RECENT_LOCATION_NEAR_LINES of) the CURRENT head entry's line in the SAME file,
// the head is replaced with the newer location rather than duplicated - so a
// burst of small movements collapses to one fresh entry. The list is bounded so
// a long session never grows it without limit. Pure: never mutates the input.
export function pushRecentLocation(
  list: readonly RecentLocation[],
  location: RecentLocation | null,
  limit: number = RECENT_LOCATIONS_LIMIT,
): RecentLocation[] {
  if (!location) {
    return list as RecentLocation[];
  }

  const head = list[0];

  if (head && isNearby(head, location)) {
    return [location, ...list.slice(1)].slice(0, Math.max(limit, 0));
  }

  return [location, ...list].slice(0, Math.max(limit, 0));
}

// Drops every location for a path that no longer exists (file deleted) so the
// panel never offers a dead position whose reopen would fail. Pure.
export function removeRecentLocationsForPath(
  list: readonly RecentLocation[],
  path: string,
): RecentLocation[] {
  return list.filter((entry) => entry.path !== path);
}

export interface RenamedLocationTarget {
  name: string;
  path: string;
  relativePath: string;
}

// Remaps every location of a renamed/moved file in place (keeping each entry's
// line, column and snippet) so the recorded positions survive a rename. A
// missing old path is a no-op. Pure: never mutates the input.
export function renameRecentLocationsPath(
  list: readonly RecentLocation[],
  oldPath: string,
  next: RenamedLocationTarget,
): RecentLocation[] {
  return list.map((entry) =>
    entry.path === oldPath
      ? {
          ...entry,
          name: next.name,
          path: next.path,
          relativePath: next.relativePath,
        }
      : entry,
  );
}

function snippetForLine(content: string | null, line: number): string {
  if (!content) {
    return "";
  }

  // `line` is 1-based; the document is split on newlines so index line-1 is the
  // caret row. A line out of range (stale content) yields an empty snippet.
  return (content.split("\n")[line - 1] ?? "").trim();
}

function lastSegment(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] || path;
}

function isNearby(head: RecentLocation, location: RecentLocation): boolean {
  if (head.path !== location.path) {
    return false;
  }

  return Math.abs(head.line - location.line) <= RECENT_LOCATION_NEAR_LINES;
}
