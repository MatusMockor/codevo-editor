import type {
  CodeHighlightOutcome,
  CodeHighlightRequest,
} from "../../application/codeHighlight/codeHighlighter";

export const MAX_CACHED_HIGHLIGHTS = 48;
export const MAX_CACHED_HIGHLIGHT_CHARS = 4 * 1_048_576;

interface CacheEntry {
  readonly request: CodeHighlightRequest;
  readonly outcome: CodeHighlightOutcome;
}

export interface HighlightCache {
  get(request: CodeHighlightRequest): CodeHighlightOutcome | null;
  set(request: CodeHighlightRequest, outcome: CodeHighlightOutcome): void;
  readonly size: number;
  readonly totalChars: number;
}

export function createHighlightCache(
  maxEntries = MAX_CACHED_HIGHLIGHTS,
  maxChars = MAX_CACHED_HIGHLIGHT_CHARS,
): HighlightCache {
  const entries = new Map<string, CacheEntry>();
  let totalChars = 0;
  const evict = (key: string) => {
    const entry = entries.get(key);
    if (entry === undefined) return;
    entries.delete(key);
    totalChars -= entry.request.text.length;
  };
  return {
    get(request) {
      const key = cacheKey(request);
      const entry = entries.get(key);
      if (entry === undefined || entry.request.text !== request.text) return null;
      entries.delete(key);
      entries.set(key, entry);
      return entry.outcome;
    },
    set(request, outcome) {
      const size = request.text.length;
      if (size > maxChars || maxEntries <= 0) return;
      const key = cacheKey(request);
      evict(key);
      while (entries.size >= maxEntries || totalChars + size > maxChars) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        evict(oldest.value);
      }
      entries.set(key, { request, outcome });
      totalChars += size;
    },
    get size() {
      return entries.size;
    },
    get totalChars() {
      return totalChars;
    },
  };
}

function cacheKey(request: CodeHighlightRequest): string {
  return `${request.theme}\u0000${request.language}\u0000${request.text.length}\u0000${contentHash(request.text)}`;
}

function contentHash(text: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}
