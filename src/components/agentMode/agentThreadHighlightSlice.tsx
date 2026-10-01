import type { ReactNode } from "react";
import type { AgentThreadSearchRange } from "../../domain/agentThreadSearch";

export interface HighlightSlice {
  readonly start: number;
  readonly end: number;
}

export function highlightSliceNodes(
  text: string,
  slice: HighlightSlice,
  ranges: ReadonlyArray<AgentThreadSearchRange>,
  current: number | null,
  indexOffset = 0,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = slice.start;
  for (let offset = firstRangeEndingAfter(ranges, slice.start); offset < ranges.length; offset++) {
    const range = ranges[offset];
    if (range === undefined || range.start >= slice.end) break;
    const start = Math.max(range.start, slice.start);
    const end = Math.min(range.end, slice.end);
    const index = indexOffset + offset;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    nodes.push(
      <mark
        className={
          index === current ? "agent-find__hit agent-find__hit--current" : "agent-find__hit"
        }
        data-hit-index={index}
        key={`h${index}`}
      >
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < slice.end) nodes.push(text.slice(cursor, slice.end));
  return nodes;
}

function firstRangeEndingAfter(
  ranges: ReadonlyArray<AgentThreadSearchRange>,
  position: number,
): number {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const ends = ranges[middle]?.end ?? position;
    if (ends <= position) {
      low = middle + 1;
      continue;
    }
    high = middle;
  }
  return low;
}
