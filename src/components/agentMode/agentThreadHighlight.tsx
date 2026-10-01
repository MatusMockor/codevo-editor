import type { ReactNode } from "react";
import { highlightRanges } from "../../domain/agentThreadHighlight";
import { highlightSliceNodes } from "./agentThreadHighlightSlice";

export function HighlightRun({
  current,
  indexOffset = 0,
  query,
  text,
}: {
  readonly current: number | null;
  readonly indexOffset?: number;
  readonly query: string;
  readonly text: string;
}): ReactNode {
  const ranges = highlightRanges(text, query);
  if (ranges.length === 0) return <>{text}</>;
  const slice = { start: 0, end: text.length };
  return <>{highlightSliceNodes(text, slice, ranges, current, indexOffset)}</>;
}
