import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentThread } from "../domain/agentThread";
import {
  MAX_THREAD_SEARCH_QUERY_CHARS,
  MAX_THREAD_SEARCH_RESULTS,
  buildAgentThreadSearchDocument,
  normalizeThreadSearchQuery,
  searchAgentThreadDocuments,
  type AgentThreadSearchDocument,
  type AgentThreadSearchResult,
} from "../domain/agentThreadSearch";
import type { AgentThreadSearchSurface, AgentThreadView } from "./agentThreadPorts";

export const AGENT_THREAD_SEARCH_DEBOUNCE_MS = 120;
export const MAX_AGENT_THREAD_SEARCH_INDEX_DOCUMENTS = 128;
export const MAX_AGENT_THREAD_SEARCH_INDEX_BYTES = 4 * 1_024 * 1_024;

export interface AgentThreadSearchOptions {
  readonly debounceMs?: number;
  readonly limit?: number;
}

interface IndexedThread {
  readonly thread: AgentThread;
  readonly document: AgentThreadSearchDocument;
}

interface SearchIndex {
  readonly entries: ReadonlyMap<string, IndexedThread>;
  readonly documentsTruncated: boolean;
}

const EMPTY_INDEX: SearchIndex = { entries: new Map(), documentsTruncated: false };

export function useAgentThreadSearch(
  views: ReadonlyArray<AgentThreadView>,
  options: AgentThreadSearchOptions = {},
): AgentThreadSearchSurface {
  const debounceMs = options.debounceMs ?? AGENT_THREAD_SEARCH_DEBOUNCE_MS;
  const limit = options.limit ?? MAX_THREAD_SEARCH_RESULTS;

  const [query, setQueryState] = useState("");
  const [published, setPublished] = useState<AgentThreadSearchResult | null>(null);
  const [pending, setPending] = useState(false);

  const indexRef = useRef<SearchIndex>(EMPTY_INDEX);
  const index = useMemo(() => reconcileIndex(indexRef.current, views), [views]);
  indexRef.current = index;

  const generationRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const normalizedRef = useRef<string | null>(null);
  const policyRef = useRef({ debounceMs, limit });
  const observedPolicyRef = useRef({ debounceMs, limit });
  policyRef.current = { debounceMs, limit };

  const cancelScheduled = useCallback((): void => {
    generationRef.current += 1;
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const schedule = useCallback(
    (normalized: string): void => {
      cancelScheduled();
      const generation = generationRef.current;
      setPending(true);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (generation !== generationRef.current) return;
        const result = searchIndex(indexRef.current, normalized, policyRef.current.limit);
        if (generation !== generationRef.current) return;
        setPublished(result);
        setPending(false);
      }, policyRef.current.debounceMs);
    },
    [cancelScheduled],
  );

  const scheduleRefresh = useCallback(
    (normalized: string): void => {
      if (timerRef.current !== null) return;
      schedule(normalized);
    },
    [schedule],
  );

  const setQuery = useCallback(
    (raw: string): void => {
      const clipped = raw.slice(0, MAX_THREAD_SEARCH_QUERY_CHARS);
      setQueryState(clipped);
      const normalized = normalizeThreadSearchQuery(clipped);
      normalizedRef.current = normalized;
      if (normalized === null) {
        cancelScheduled();
        setPublished(null);
        setPending(false);
        return;
      }
      schedule(normalized);
    },
    [cancelScheduled, schedule],
  );

  const clear = useCallback((): void => setQuery(""), [setQuery]);

  useEffect(() => {
    const observed = observedPolicyRef.current;
    if (observed.debounceMs === debounceMs && observed.limit === limit) return;
    observedPolicyRef.current = { debounceMs, limit };
    const normalized = normalizedRef.current;
    if (normalized === null) return;
    schedule(normalized);
  }, [debounceMs, limit, schedule]);

  useEffect(() => {
    const normalized = normalizedRef.current;
    if (normalized === null) return;
    scheduleRefresh(normalized);
  }, [index, scheduleRefresh]);

  useEffect(() => cancelScheduled, [cancelScheduled]);

  const result = useMemo(() => retainKnownThreads(published, index), [index, published]);
  const active = normalizeThreadSearchQuery(query) !== null;

  return useMemo(
    () => ({ query, active, result: active ? result : null, pending, setQuery, clear }),
    [active, clear, pending, query, result, setQuery],
  );
}

function reconcileIndex(previous: SearchIndex, views: ReadonlyArray<AgentThreadView>): SearchIndex {
  const next = new Map<string, IndexedThread>();
  let retainedBytes = 0;
  const candidates = [...views].sort(compareViewsForRetention);
  for (const view of candidates) {
    if (next.size >= MAX_AGENT_THREAD_SEARCH_INDEX_DOCUMENTS) break;
    const thread = view.thread;
    const cached = previous.entries.get(thread.threadId);
    const entry =
      cached !== undefined && cached.thread === thread
        ? cached
        : { thread, document: buildAgentThreadSearchDocument(thread) };
    if (retainedBytes + entry.document.byteLength > MAX_AGENT_THREAD_SEARCH_INDEX_BYTES) break;
    retainedBytes += entry.document.byteLength;
    next.set(thread.threadId, entry);
  }
  const documentsTruncated = next.size < views.length;
  if (documentsTruncated === previous.documentsTruncated && sameEntries(previous.entries, next)) {
    return previous;
  }
  return { entries: next, documentsTruncated };
}

function searchIndex(index: SearchIndex, query: string, limit: number): AgentThreadSearchResult {
  const documents: AgentThreadSearchDocument[] = [];
  for (const entry of index.entries.values()) documents.push(entry.document);
  const result = searchAgentThreadDocuments(documents, query, limit);
  if (!index.documentsTruncated || result.documentsTruncated) return result;
  return { ...result, documentsTruncated: true };
}

function retainKnownThreads(
  result: AgentThreadSearchResult | null,
  index: SearchIndex,
): AgentThreadSearchResult | null {
  if (result === null) return null;
  const matches = result.matches.filter((match) => index.entries.has(match.threadId));
  const documentsTruncated = result.documentsTruncated || index.documentsTruncated;
  if (
    matches.length === result.matches.length &&
    documentsTruncated === result.documentsTruncated
  ) {
    return result;
  }
  return { ...result, matches, documentsTruncated };
}

function compareViewsForRetention(left: AgentThreadView, right: AgentThreadView): number {
  const recency = right.thread.updatedAtEpochMs - left.thread.updatedAtEpochMs;
  if (recency !== 0) return recency;
  if (left.thread.threadId < right.thread.threadId) return -1;
  if (left.thread.threadId > right.thread.threadId) return 1;
  return 0;
}

function sameEntries(
  previous: ReadonlyMap<string, IndexedThread>,
  next: ReadonlyMap<string, IndexedThread>,
): boolean {
  if (previous.size !== next.size) return false;
  for (const [threadId, entry] of next) {
    if (previous.get(threadId) !== entry) return false;
  }
  return true;
}
