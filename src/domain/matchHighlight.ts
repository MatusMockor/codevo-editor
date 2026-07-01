// Search-result label highlighting for the Quick Open / Search Everywhere
// palettes. The Rust file and symbol search backends both match with a plain
// case-insensitive substring (see `score_result` in workspace.rs and the
// `LIKE '%query%'` clause in index.rs), not a fuzzy subsequence, so this stays
// a substring split rather than a fuzzy scorer: the highlighted range always
// reflects the exact text that made the row match. Pure and presentation-free
// so the palettes can render whatever markup they want around the segments.

export interface QueryHighlightSegments {
  before: string;
  match: string;
  after: string;
}

const NO_MATCH = (text: string): QueryHighlightSegments => ({
  before: text,
  match: "",
  after: "",
});

export function splitQueryHighlight(
  text: string,
  query: string,
): QueryHighlightSegments {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return NO_MATCH(text);
  }

  const index = text.toLowerCase().indexOf(trimmedQuery.toLowerCase());

  if (index < 0) {
    return NO_MATCH(text);
  }

  return {
    before: text.slice(0, index),
    match: text.slice(index, index + trimmedQuery.length),
    after: text.slice(index + trimmedQuery.length),
  };
}
