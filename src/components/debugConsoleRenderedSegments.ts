import type { DebugConsoleRenderItem } from "./debugConsoleRenderItems";
import type { WindowedRow } from "./useWindowedRows";

export interface DebugConsoleRenderedSegment {
  readonly items: readonly DebugConsoleRenderItem[];
  readonly key: string;
  readonly kind: "entry" | "tree";
  readonly offsetTop: number;
}

/**
 * Reconstructs semantic entry/tree wrappers from a possibly discontinuous
 * virtual window. Pinned tree rows receive an exact row key while the normal
 * window retains one stable key per result entry.
 */
export function segmentDebugConsoleRenderedRows(
  rows: readonly WindowedRow[],
  items: readonly DebugConsoleRenderItem[],
): readonly DebugConsoleRenderedSegment[] {
  const segments: DebugConsoleRenderedSegment[] = [];
  let cursor = 0;

  while (cursor < rows.length) {
    const firstRow = rows[cursor]!;
    const firstItem = items[firstRow.index];

    if (!firstItem) {
      cursor += 1;
      continue;
    }

    if (firstItem.kind === "entry") {
      segments.push({
        items: [firstItem],
        key: firstItem.id,
        kind: "entry",
        offsetTop: firstRow.offsetTop,
      });
      cursor += 1;
      continue;
    }

    const segmentItems: DebugConsoleRenderItem[] = [firstItem];
    let hasWindowRow = !firstRow.pinned;
    let nextCursor = cursor + 1;
    let previousIndex = firstRow.index;

    while (nextCursor < rows.length) {
      const nextRow = rows[nextCursor]!;
      const nextItem = items[nextRow.index];

      if (
        !nextItem ||
        nextItem.kind === "entry" ||
        nextItem.entryId !== firstItem.entryId ||
        nextRow.index !== previousIndex + 1
      ) {
        break;
      }

      segmentItems.push(nextItem);
      hasWindowRow ||= !nextRow.pinned;
      previousIndex = nextRow.index;
      nextCursor += 1;
    }

    segments.push({
      items: segmentItems,
      key: hasWindowRow
        ? `tree-${firstItem.entryId}:window`
        : `tree-${firstItem.entryId}:pinned:${firstItem.id}`,
      kind: "tree",
      offsetTop: firstRow.offsetTop,
    });
    cursor = nextCursor;
  }

  return segments;
}
