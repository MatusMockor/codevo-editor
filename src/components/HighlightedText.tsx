import type { ReactNode } from "react";
import { splitQueryHighlight } from "../domain/matchHighlight";

interface HighlightedTextProps {
  className?: string;
  query: string;
  text: string;
}

// Wraps the substring of `text` that matched `query` in a <mark> so palette
// rows (Quick Open, Search Everywhere) show *why* a result matched, mirroring
// the existing text-search match highlight (PhpStorm/VS Code standard). An
// empty query or no match renders the plain text untouched.
export function HighlightedText({
  className = "match-highlight",
  query,
  text,
}: HighlightedTextProps): ReactNode {
  const { after, before, match } = splitQueryHighlight(text, query);

  if (!match) {
    return <>{text}</>;
  }

  return (
    <>
      {before}
      <mark className={className}>{match}</mark>
      {after}
    </>
  );
}
