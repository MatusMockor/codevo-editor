import { pathFromLanguageServerUri } from "./languageServerFeatures";
import type { LanguageServerLocation } from "./languageServerFeatures";

/**
 * Aggregated "Find All References" result for a single symbol. The panel renders
 * this read-only view; the controller builds it from the references gateway
 * (`textDocument/references`, `includeDeclaration: true`) for the symbol under
 * the cursor. `symbol` is the human-readable label shown in the header.
 */
export interface ReferencesView {
  locations: LanguageServerLocation[];
  symbol: string;
}

/**
 * A single reference row: one occurrence of the symbol at `path:line`. `line`
 * and `column` are 1-based for display; `relativePath` is workspace-relative
 * (or the absolute path when it sits outside the root). The 0-based `range`
 * powers navigation through the controller.
 */
export interface ReferenceRow {
  column: number;
  id: string;
  line: number;
  location: LanguageServerLocation;
  path: string;
  relativePath: string;
}

/**
 * A group of references that all live in the same file, ordered by line.
 */
export interface ReferenceGroup {
  path: string;
  relativePath: string;
  rows: ReferenceRow[];
}

/**
 * Builds the flat, navigation-ordered list of reference rows from the view.
 * Rows are sorted by file path, then line, then column so the panel and its
 * keyboard navigation share one stable order. Locations whose URI cannot be
 * mapped to a file path are dropped (nothing to navigate to).
 */
export function referenceRows(
  view: ReferencesView,
  workspaceRoot: string | null,
): ReferenceRow[] {
  const rows = view.locations.flatMap((location, index) =>
    referenceRow(location, workspaceRoot, index),
  );

  return rows.sort(compareReferenceRows);
}

/**
 * Groups the (already sorted) rows by file so the panel can show a header per
 * file. Each group preserves the row order produced by {@link referenceRows}.
 */
export function referenceGroups(rows: ReferenceRow[]): ReferenceGroup[] {
  const groups: ReferenceGroup[] = [];

  for (const row of rows) {
    const last = groups[groups.length - 1];

    if (last && last.path === row.path) {
      last.rows.push(row);
      continue;
    }

    groups.push({
      path: row.path,
      relativePath: row.relativePath,
      rows: [row],
    });
  }

  return groups;
}

export function referencesSummaryLabel(count: number): string {
  if (count === 0) {
    return "No references";
  }

  return count === 1 ? "1 reference" : `${count} references`;
}

function referenceRow(
  location: LanguageServerLocation,
  workspaceRoot: string | null,
  index: number,
): ReferenceRow[] {
  const path = pathFromLanguageServerUri(location.uri);

  if (!path) {
    return [];
  }

  const line = location.range.start.line + 1;
  const column = location.range.start.character + 1;

  return [
    {
      column,
      id: `${location.uri}:${line}:${column}:${index}`,
      line,
      location,
      path,
      relativePath: relativeReferencePath(workspaceRoot, path),
    },
  ];
}

function compareReferenceRows(left: ReferenceRow, right: ReferenceRow): number {
  const byPath = left.path.localeCompare(right.path);

  if (byPath !== 0) {
    return byPath;
  }

  if (left.line !== right.line) {
    return left.line - right.line;
  }

  return left.column - right.column;
}

function relativeReferencePath(
  workspaceRoot: string | null,
  path: string,
): string {
  if (!workspaceRoot) {
    return path;
  }

  const normalizedRoot = workspaceRoot.endsWith("/")
    ? workspaceRoot
    : `${workspaceRoot}/`;

  if (path.startsWith(normalizedRoot)) {
    return path.slice(normalizedRoot.length);
  }

  return path;
}
