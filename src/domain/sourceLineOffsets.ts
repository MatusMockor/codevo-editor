import type { EditorPosition } from "./languageServerFeatures";

// Precompute the byte offset at which each line starts, once per source, so
// converting an offset to a line/column is an O(log lines) binary search
// instead of an O(offset) rescan.
export function computeLineStartOffsets(source: string): number[] {
  const lineStartOffsets = [0];

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "\n") {
      continue;
    }

    lineStartOffsets.push(index + 1);
  }

  return lineStartOffsets;
}

export function lineColumnAt(
  lineStartOffsets: number[],
  offset: number,
): EditorPosition {
  let low = 0;
  let high = lineStartOffsets.length - 1;

  while (low < high) {
    const mid = (low + high + 1) >> 1;

    if (lineStartOffsets[mid] <= offset) {
      low = mid;
      continue;
    }

    high = mid - 1;
  }

  return {
    column: offset - lineStartOffsets[low] + 1,
    lineNumber: low + 1,
  };
}
