import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentThread } from "../../domain/agentThread";
import {
  MAX_THREAD_SEARCH_QUERY_CHARS,
  findInThread,
  type AgentThreadFindHit,
} from "../../domain/agentThreadSearch";
import { MAX_RENDERED_EVENTS_PER_TURN } from "./agentModePresentation";
import type { AgentThreadRevealRequest } from "./agentSidebarPresentation";

export const AGENT_THREAD_FIND_DEBOUNCE_MS = 80;

export interface AgentThreadFindState {
  readonly open: boolean;
  readonly query: string;
  readonly hits: ReadonlyArray<AgentThreadFindHit>;
  readonly hitIndex: number;
  readonly reveal: AgentThreadRevealRequest | null;
  openBar(): void;
  close(): void;
  setQuery(query: string): void;
  navigate(index: number): void;
  requestReveal(reveal: AgentThreadRevealRequest): void;
}

interface PublishedHits {
  readonly query: string;
  readonly thread: AgentThread | null;
  readonly hits: ReadonlyArray<AgentThreadFindHit>;
}

const NO_HITS: ReadonlyArray<AgentThreadFindHit> = [];
const NOTHING_PUBLISHED: PublishedHits = { query: "", thread: null, hits: NO_HITS };

export function useAgentThreadFind(thread: AgentThread | null): AgentThreadFindState {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const [index, setIndex] = useState(0);
  const [reveal, setReveal] = useState<AgentThreadRevealRequest | null>(null);
  const [published, setPublished] = useState<PublishedHits>(NOTHING_PUBLISHED);
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    if (!open || thread === null) {
      setPublished(NOTHING_PUBLISHED);
      return;
    }
    const timer = setTimeout(() => {
      if (generation !== generationRef.current) return;
      const hits = findInThread(thread, query, { maxEventsPerTurn: MAX_RENDERED_EVENTS_PER_TURN });
      setPublished({ query, thread, hits });
    }, AGENT_THREAD_FIND_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, query, thread]);

  const current = open && published.thread === thread && published.query === query;
  const hits = current ? published.hits : NO_HITS;
  const hitIndex = hits.length === 0 ? -1 : Math.min(index, hits.length - 1);
  const publishedReveal = current ? reveal : null;

  useEffect(() => {
    if (reveal === null || !current) return;
    const found = hits.findIndex((hit) => sameHit(hit, reveal));
    if (found >= 0) setIndex(found);
    setReveal(null);
  }, [current, hits, reveal]);

  useEffect(() => {
    if (thread !== null || !open) return;
    setOpen(false);
    setQueryState("");
    setIndex(0);
    setReveal(null);
  }, [open, thread]);

  const openBar = useCallback((): void => setOpen(true), []);

  const close = useCallback((): void => {
    setOpen(false);
    setQueryState("");
    setIndex(0);
    setReveal(null);
  }, []);

  const setQuery = useCallback((next: string): void => {
    setQueryState(next.slice(0, MAX_THREAD_SEARCH_QUERY_CHARS));
    setIndex(0);
  }, []);

  const navigate = useCallback((next: number): void => setIndex(Math.max(0, next)), []);

  const requestReveal = useCallback((next: AgentThreadRevealRequest): void => {
    setOpen(true);
    setQueryState(next.query.slice(0, MAX_THREAD_SEARCH_QUERY_CHARS));
    setIndex(0);
    setReveal(next);
  }, []);

  return useMemo(
    () => ({
      open,
      query,
      hits,
      hitIndex,
      reveal: publishedReveal,
      openBar,
      close,
      setQuery,
      navigate,
      requestReveal,
    }),
    [
      close,
      hitIndex,
      hits,
      navigate,
      open,
      openBar,
      publishedReveal,
      query,
      requestReveal,
      setQuery,
    ],
  );
}

function sameHit(hit: AgentThreadFindHit, reveal: AgentThreadRevealRequest): boolean {
  return (
    hit.turnId === reveal.turnId &&
    hit.eventIndex === reveal.eventIndex &&
    hit.start === reveal.start
  );
}
