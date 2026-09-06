import type { AgentPickerOption } from "./agentPickerOption";

export const CHECKOUT_SEARCH_THRESHOLD = 12;
export const CHECKOUT_SEARCH_QUERY_LIMIT = 256;
export const CHECKOUT_REPOSITORY_PAGE_SIZE = 50;
export const CHECKOUT_SEARCH_BATCH_SIZE = 100;
export const CHECKOUT_SEARCH_TEXT_LIMIT = 4_096;

export interface CheckoutSearchResult {
  readonly rows: ReadonlyArray<AgentPickerOption>;
  readonly total: number;
  readonly excluded: number;
}

export function checkoutRepositoryStart(options: ReadonlyArray<AgentPickerOption>): number {
  const rootIndex = options.slice(0, 3).findIndex((option) => option.value.startsWith("root:"));
  if (rootIndex < 0) return options.length;
  return rootIndex + 1;
}

export function checkoutRepositoryPage(
  options: ReadonlyArray<AgentPickerOption>,
  start: number,
  page: number,
): CheckoutSearchResult {
  const offset = start + page * CHECKOUT_REPOSITORY_PAGE_SIZE;
  return {
    rows: options.slice(offset, offset + CHECKOUT_REPOSITORY_PAGE_SIZE),
    total: options.length - start,
    excluded: 0,
  };
}

export function createCheckoutSearch(
  options: ReadonlyArray<AgentPickerOption>,
  start: number,
  query: string,
  page: number,
): () => CheckoutSearchResult | null {
  const needle = query.slice(0, CHECKOUT_SEARCH_QUERY_LIMIT).toLowerCase();
  const offset = page * CHECKOUT_REPOSITORY_PAGE_SIZE;
  const rows: AgentPickerOption[] = [];
  let cursor = start;
  let total = 0;
  let excluded = 0;
  return () => {
    const end = Math.min(cursor + CHECKOUT_SEARCH_BATCH_SIZE, options.length);
    while (cursor < end) {
      const option = options[cursor];
      cursor += 1;
      if (option === undefined) continue;
      if (
        option.label.length > CHECKOUT_SEARCH_TEXT_LIMIT ||
        option.value.length > CHECKOUT_SEARCH_TEXT_LIMIT + 5
      ) {
        excluded += 1;
        continue;
      }
      if (
        !option.label.toLowerCase().includes(needle) &&
        !option.value.slice(5).toLowerCase().includes(needle)
      )
        continue;
      if (total >= offset && rows.length < CHECKOUT_REPOSITORY_PAGE_SIZE) rows.push(option);
      total += 1;
    }
    if (cursor < options.length) return null;
    return { rows, total, excluded };
  };
}

export function checkoutDisplayLabel(label: string): string {
  if (label.length <= CHECKOUT_SEARCH_TEXT_LIMIT) return label;
  return `${label.slice(0, CHECKOUT_SEARCH_TEXT_LIMIT)}… (name exceeds display limit)`;
}
