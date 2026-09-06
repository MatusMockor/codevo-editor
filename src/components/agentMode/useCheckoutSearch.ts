import { useEffect, useMemo, useState } from "react";
import type { AgentPickerOption } from "./agentPickerOption";
import {
  CHECKOUT_REPOSITORY_PAGE_SIZE,
  CHECKOUT_SEARCH_QUERY_LIMIT,
  CHECKOUT_SEARCH_THRESHOLD,
  checkoutRepositoryPage,
  checkoutRepositoryStart,
  createCheckoutSearch,
  type CheckoutSearchResult,
} from "./agentCheckoutSearch";

type Options = ReadonlyArray<AgentPickerOption>;
interface SearchRequest {
  readonly options: Options;
  readonly identity: object;
  readonly query: string;
  readonly page: number;
  readonly generation: number;
  readonly open: boolean;
}
interface SearchResponse extends SearchRequest {
  readonly result: CheckoutSearchResult;
}

export function useCheckoutSearch(
  options: Options,
  checkout: boolean,
  open: boolean,
  identity: object = options,
) {
  const [request, setRequest] = useState<SearchRequest>({
    options,
    identity,
    query: "",
    page: 0,
    generation: 0,
    open,
  });
  const [response, setResponse] = useState<SearchResponse | null>(null);
  if (request.options !== options || request.identity !== identity || request.open !== open) {
    const preserve = request.identity === identity && request.open === open;
    setRequest({
      options,
      identity,
      query: preserve ? request.query : "",
      page: preserve ? request.page : 0,
      generation: request.generation + 1,
      open,
    });
    setResponse(null);
  }
  const generation = request.generation;
  const start = checkout ? checkoutRepositoryStart(options) : options.length;
  const enabled = checkout && options.length - start >= CHECKOUT_SEARCH_THRESHOLD;
  const query = request.options === options && open ? request.query : "";
  const page = request.options === options && open ? request.page : 0;
  const plain = useMemo(() => checkoutRepositoryPage(options, start, page), [options, start, page]);
  const current =
    response?.options === options &&
    response.identity === identity &&
    response.generation === generation &&
    response.query === query &&
    response.page === page;
  const result = query === "" ? plain : current ? response.result : null;
  const visibleOptions = useMemo(() => {
    if (!enabled) return options;
    return [...options.slice(0, start), ...(result?.rows ?? [])];
  }, [enabled, options, result, start]);

  useEffect(() => {
    if (!open || !enabled || query === "") return;
    const advance = createCheckoutSearch(options, start, query, page);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      if (cancelled) return;
      const result = advance();
      if (result === null) {
        timer = setTimeout(step, 0);
        return;
      }
      setResponse({ options, identity, query, page, generation, open, result });
    };
    timer = setTimeout(step, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, generation, identity, open, options, page, query, start]);

  return {
    enabled,
    query,
    page,
    total: result?.total ?? null,
    busy: result === null,
    excluded: result?.excluded ?? 0,
    visibleOptions,
    keyboardEntryIndex: query === "" ? 0 : result !== null && result.rows.length > 0 ? start : null,
    setQuery: (value: string) =>
      setRequest((current) => {
        if (current.options !== options || current.generation !== generation || !current.open)
          return current;
        return { ...current, query: value.slice(0, CHECKOUT_SEARCH_QUERY_LIMIT), page: 0 };
      }),
    setPage: (value: number) => {
      if (result === null) return;
      const last = Math.max(0, Math.ceil(result.total / CHECKOUT_REPOSITORY_PAGE_SIZE) - 1);
      setRequest((current) => {
        if (
          current.options !== options ||
          current.generation !== generation ||
          !current.open ||
          current.query !== query ||
          current.page !== page
        )
          return current;
        return { ...current, page: Math.min(Math.max(0, value), last) };
      });
    },
  };
}
