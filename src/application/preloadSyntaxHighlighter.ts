export type SyntaxHighlighterPreloader = () => Promise<unknown>;

export function preloadSyntaxHighlighter(preload: SyntaxHighlighterPreloader): void {
  void preload().catch(() => {
    // The lazy consumer retries and reports an error when a document opens.
  });
}
