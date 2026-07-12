export const SEARCH_QUERY_HISTORY_LIMIT = 20;

export function pushSearchQuery(
  history: readonly string[],
  query: string,
  limit = SEARCH_QUERY_HISTORY_LIMIT,
): readonly string[] {
  if (!query.trim()) {
    return history;
  }

  if (history[0] === query) {
    return history;
  }

  const rest = isTypingRefinement(history[0], query)
    ? history.slice(1)
    : history;

  return [query, ...rest.filter((entry) => entry !== query)].slice(0, limit);
}

function isTypingRefinement(
  head: string | undefined,
  query: string,
): boolean {
  if (!head) {
    return false;
  }

  return query.startsWith(head) || head.startsWith(query);
}

export class SearchQueryHistoryStore {
  private activeRoot: string | null = null;
  private readonly histories = new Map<string, readonly string[]>();

  activate(workspaceRoot: string | null): void {
    this.activeRoot = workspaceRoot;
  }

  active(): readonly string[] {
    if (!this.activeRoot) {
      return [];
    }

    return this.get(this.activeRoot);
  }

  root(): string | null {
    return this.activeRoot;
  }

  get(workspaceRoot: string): readonly string[] {
    return this.histories.get(workspaceRoot) ?? [];
  }

  push(workspaceRoot: string, query: string): void {
    const current = this.get(workspaceRoot);
    const next = pushSearchQuery(current, query);

    if (next === current) {
      return;
    }

    this.histories.set(workspaceRoot, next);
  }

  clear(): void {
    this.activeRoot = null;
    this.histories.clear();
  }
}

export const searchQueryHistorySession = new SearchQueryHistoryStore();
