export interface QueryHighlightSegment {
  text: string;
  highlighted: boolean;
}

export function splitQueryHighlight(
  text: string,
  query: string,
): QueryHighlightSegment[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) {
    return [];
  }

  const matchedIndexes = matchedQueryIndexes(text, tokens);
  if (!matchedIndexes) {
    return [];
  }

  const segments: QueryHighlightSegment[] = [];
  let segmentStart = 0;
  let segmentHighlighted = matchedIndexes.has(0);
  for (let index = 1; index < text.length; index += 1) {
    const highlighted = matchedIndexes.has(index);
    if (highlighted === segmentHighlighted) {
      continue;
    }
    segments.push({
      text: text.slice(segmentStart, index),
      highlighted: segmentHighlighted,
    });
    segmentStart = index;
    segmentHighlighted = highlighted;
  }
  segments.push({
    text: text.slice(segmentStart),
    highlighted: segmentHighlighted,
  });
  return segments;
}

export function matchesQuery(text: string, query: string): boolean {
  const tokens = queryTokens(query);
  if (tokens.length === 0) {
    return true;
  }

  return matchedQueryIndexes(text, tokens) !== null;
}

function matchedQueryIndexes(
  text: string,
  tokens: readonly string[],
): Set<number> | null {
  const filenameStart = text.lastIndexOf("/") + 1;
  const matchedIndexes = new Set<number>();
  for (const token of tokens) {
    const indexes =
      matchTokenIndexes(text, token, filenameStart) ??
      matchTokenIndexes(text, token, 0);
    if (!indexes) {
      return null;
    }
    for (const index of indexes) {
      matchedIndexes.add(index);
    }
  }

  return matchedIndexes;
}

function matchTokenIndexes(
  text: string,
  token: string,
  minimumStart: number,
): number[] | null {
  const wanted = Array.from(token);
  const indexes: number[] = [];
  let wantedIndex = 0;
  let index = minimumStart;
  for (const candidate of text.slice(minimumStart)) {
    if (candidate.toLowerCase() !== wanted[wantedIndex]?.toLowerCase()) {
      index += candidate.length;
      continue;
    }
    for (let offset = 0; offset < candidate.length; offset += 1) {
      indexes.push(index + offset);
    }
    wantedIndex += 1;
    if (wantedIndex === wanted.length) {
      return indexes;
    }
    index += candidate.length;
  }
  return null;
}

function queryTokens(query: string): string[] {
  const tokens: string[] = [];
  let token = "";
  for (const character of query) {
    if (character.trim() !== "") {
      token += character;
      continue;
    }
    if (token !== "") {
      tokens.push(token);
      token = "";
    }
  }
  if (token !== "") {
    tokens.push(token);
  }
  return tokens;
}
