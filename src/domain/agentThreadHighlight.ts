import { MIN_THREAD_SEARCH_QUERY_CHARS, type AgentThreadSearchRange } from "./agentThreadSearch";

const NO_RANGES: ReadonlyArray<AgentThreadSearchRange> = [];

export function highlightNeedle(query: string): string | null {
  const needle = query.trim().toLowerCase();
  if (needle.length < MIN_THREAD_SEARCH_QUERY_CHARS) return null;
  return needle;
}

export function highlightRanges(
  text: string,
  query: string,
): ReadonlyArray<AgentThreadSearchRange> {
  const needle = highlightNeedle(query);
  if (needle === null) return NO_RANGES;
  return needleRanges(text, needle);
}

export function highlightOccurrences(text: string, query: string): number {
  return highlightRanges(text, query).length;
}

export function foldCasePreservingLength(text: string): string {
  const lowered = text.toLowerCase();
  if (lowered.length === text.length) return lowered;
  let folded = "";
  for (const character of text) {
    const lower = character.toLowerCase();
    folded += lower.length === character.length ? lower : character;
  }
  return folded;
}

function needleRanges(text: string, needle: string): ReadonlyArray<AgentThreadSearchRange> {
  const haystack = foldCasePreservingLength(text);
  const ranges: AgentThreadSearchRange[] = [];
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    ranges.push({ start: index, end: index + needle.length });
    index = haystack.indexOf(needle, index + needle.length);
  }
  return ranges;
}
