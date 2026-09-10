import type { ReactNode } from "react";
import { highlightRanges } from "../../domain/agentThreadHighlight";

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

  const nodes: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, offset) => {
    const index = indexOffset + offset;
    if (range.start > cursor) nodes.push(text.slice(cursor, range.start));
    nodes.push(
      <mark
        className={
          index === current ? "agent-find__hit agent-find__hit--current" : "agent-find__hit"
        }
        data-hit-index={index}
        key={`h${index}`}
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));

  return <>{nodes}</>;
}
