import type { ReactNode } from "react";
import { splitQueryHighlight } from "../domain/matchHighlight";

interface HighlightedTextProps {
  className?: string;
  query: string;
  text: string;
}

export function HighlightedText({
  className = "match-highlight",
  query,
  text,
}: HighlightedTextProps): ReactNode {
  const segments = splitQueryHighlight(text, query);

  if (segments.length === 0) {
    return <>{text}</>;
  }

  return (
    <>
      {segments.map((segment, index) =>
        segment.highlighted ? (
          <mark className={className} key={index}>
            {segment.text}
          </mark>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}
