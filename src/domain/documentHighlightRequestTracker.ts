/**
 * Per-registration dedup tracker for document-highlight requests.
 *
 * Monaco's WordHighlighter fires a `provideDocumentHighlights` request whenever
 * the cursor enters a new word. Holding an arrow key across code or rapidly
 * clicking through identifiers makes Monaco re-request highlights for the same
 * word it just resolved, flooding the language server and churning decorations.
 *
 * This tracker remembers the last word resolved per model URI together with the
 * highlights it produced. When the next request targets the same word for the
 * same model, the cached highlights are returned without issuing a new request,
 * so existing decorations stay in place instead of being recomputed.
 *
 * Isolation: a tracker instance is created per `register...` call (one per open
 * workspace tab), so no highlight state leaks between projects. The cache keys
 * on the model URI, so distinct documents never share entries.
 */
export interface DocumentHighlightRequestTracker<THighlight> {
  /**
   * Returns the cached highlights when the word under the cursor matches the
   * last resolved request for the same document version. Returns `undefined`
   * when a fresh request is required (different word, changed document version,
   * or no prior entry). Keying on the version id keeps cached ranges from
   * becoming stale after an edit.
   */
  cached(uri: string, word: string, version: number): THighlight[] | undefined;
  /** Records the highlights resolved for a model URI + word + version triple. */
  remember(
    uri: string,
    word: string,
    version: number,
    highlights: THighlight[],
  ): void;
  /** Forgets any cached entry for a model URI (e.g. when the model closes). */
  forget(uri: string): void;
}

interface TrackedHighlightEntry<THighlight> {
  highlights: THighlight[];
  version: number;
  word: string;
}

export function createDocumentHighlightRequestTracker<
  THighlight,
>(): DocumentHighlightRequestTracker<THighlight> {
  const entries = new Map<string, TrackedHighlightEntry<THighlight>>();

  return {
    cached(uri, word, version) {
      const entry = entries.get(uri);

      if (!entry || entry.word !== word || entry.version !== version) {
        return undefined;
      }

      return entry.highlights;
    },
    remember(uri, word, version, highlights) {
      entries.set(uri, { highlights, version, word });
    },
    forget(uri) {
      entries.delete(uri);
    },
  };
}
