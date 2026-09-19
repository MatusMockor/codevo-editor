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
import {
  NO_AGENT_TURN_LOG_EVIDENCE,
  type AgentTurnLogEvidenceLookup,
} from "../domain/agentTurnContentLoss";
import type { AgentTurnLogFactsSource } from "./agentTurnLogStatusStore";
import { useRemoteThreadSearchResults } from "./useRemoteThreadSearchResults";
import type {
  AgentHistorySearchPort,
  AgentThreadSearchSurface,
  AgentThreadView,
} from "./agentThreadPorts";

export const AGENT_THREAD_SEARCH_DEBOUNCE_MS = 120;
export const MAX_AGENT_THREAD_SEARCH_INDEX_DOCUMENTS = 128;
export const MAX_AGENT_THREAD_SEARCH_INDEX_BYTES = 4 * 1_024 * 1_024;
export const MAX_AGENT_THREAD_SEARCH_FACTS_REQUESTS = 8;

export type AgentThreadEvidenceRevisionLookup = (threadId: string) => number;

export interface AgentThreadSearchOptions {
  readonly historySearch?: AgentHistorySearchPort;
  readonly debounceMs?: number;
  readonly limit?: number;
  readonly evidenceOf?: AgentTurnLogEvidenceLookup;
  readonly turnLog?: AgentTurnLogFactsSource;
}

export interface IndexedAgentThread {
  readonly thread: AgentThread;
  readonly evidenceRevision: number;
  readonly document: AgentThreadSearchDocument;
}

export interface AgentThreadSearchIndex {
  readonly entries: ReadonlyMap<string, IndexedAgentThread>;
  readonly documentsTruncated: boolean;
}

export const EMPTY_AGENT_THREAD_SEARCH_INDEX: AgentThreadSearchIndex = {
  entries: new Map(),
  documentsTruncated: false,
};

const NO_EVIDENCE_REVISIONS: ReadonlyMap<string, number> = new Map();

export function useAgentThreadSearch(
  views: ReadonlyArray<AgentThreadView>,
  options: AgentThreadSearchOptions = {},
): AgentThreadSearchSurface {
  const debounceMs = options.debounceMs ?? AGENT_THREAD_SEARCH_DEBOUNCE_MS;
  const limit = options.limit ?? MAX_THREAD_SEARCH_RESULTS;
  const evidenceOf = options.evidenceOf ?? NO_AGENT_TURN_LOG_EVIDENCE;
  const turnLog = options.turnLog;

  const [query, setQueryState] = useState("");
  const [published, setPublished] = useState<AgentThreadSearchResult | null>(null);
  const [pending, setPending] = useState(false);
  const [evidenceRevisions, setEvidenceRevisions] =
    useState<ReadonlyMap<string, number>>(NO_EVIDENCE_REVISIONS);

  const evidenceRevisionOf = useCallback<AgentThreadEvidenceRevisionLookup>(
    (threadId) => evidenceRevisions.get(threadId) ?? turnLog?.evidenceRevisionOf(threadId) ?? 0,
    [evidenceRevisions, turnLog],
  );

  const indexRef = useRef<AgentThreadSearchIndex>(EMPTY_AGENT_THREAD_SEARCH_INDEX);
  const index = useMemo(
    () => reconcileAgentThreadSearchIndex(indexRef.current, views, evidenceOf, evidenceRevisionOf),
    [evidenceOf, evidenceRevisionOf, views],
  );
  indexRef.current = index;

  useEffect(() => {
    if (turnLog === undefined) return;
    const sync = (): void =>
      setEvidenceRevisions((current) => nextEvidenceRevisions(current, indexRef.current, turnLog));
    sync();
    return turnLog.subscribe(sync);
  }, [index, turnLog]);

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

  useEffect(() => {
    if (turnLog === undefined) return;
    if (published === null) return;
    for (const match of published.matches.slice(0, MAX_AGENT_THREAD_SEARCH_FACTS_REQUESTS)) {
      turnLog.ensureThreadFacts(match.threadId);
    }
  }, [published, turnLog]);

  useEffect(() => cancelScheduled, [cancelScheduled]);

  const result = useMemo(() => retainKnownThreads(published, index), [index, published]);
  const normalizedQuery = normalizeThreadSearchQuery(query);
  const active = normalizedQuery !== null;
  const remote = useRemoteThreadSearchResults(
    options.historySearch,
    normalizedQuery,
    views,
    debounceMs,
  );
  const merged = useMemo(() => {
    const localResult = result?.query === normalizedQuery ? result : null;
    if (remote.result === null) return localResult;
    const matches = new Map(localResult?.matches.map((match) => [match.threadId, match]) ?? []);
    for (const match of remote.result.matches) matches.set(match.threadId, match);
    return {
      query: remote.result.query,
      matches: [...matches.values()].slice(0, limit),
      truncated:
        matches.size > limit || remote.result.truncated || (localResult?.truncated ?? false),
      documentsTruncated:
        remote.result.documentsTruncated || (localResult?.documentsTruncated ?? false),
    };
  }, [limit, normalizedQuery, remote.result, result]);

  return useMemo(
    () => ({
      query,
      active,
      result: active ? merged : null,
      pending: pending || remote.pending,
      setQuery,
      clear,
    }),
    [active, clear, pending, query, merged, remote.pending, setQuery],
  );
}

export function reconcileAgentThreadSearchIndex(
  previous: AgentThreadSearchIndex,
  views: ReadonlyArray<AgentThreadView>,
  evidenceOf: AgentTurnLogEvidenceLookup,
  evidenceRevisionOf: AgentThreadEvidenceRevisionLookup,
): AgentThreadSearchIndex {
  const next = new Map<string, IndexedAgentThread>();
  let retainedBytes = 0;
  const candidates = [...views].sort(compareViewsForRetention);
  for (const view of candidates) {
    if (next.size >= MAX_AGENT_THREAD_SEARCH_INDEX_DOCUMENTS) break;
    const thread = view.thread;
    const cached = previous.entries.get(thread.threadId);
    const evidenceRevision = evidenceRevisionOf(thread.threadId);
    const reusable =
      cached !== undefined &&
      cached.thread === thread &&
      cached.evidenceRevision === evidenceRevision;
    const entry = reusable
      ? cached
      : {
          thread,
          evidenceRevision,
          document: buildAgentThreadSearchDocument(thread, evidenceOf),
        };
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

function searchIndex(
  index: AgentThreadSearchIndex,
  query: string,
  limit: number,
): AgentThreadSearchResult {
  const documents: AgentThreadSearchDocument[] = [];
  for (const entry of index.entries.values()) documents.push(entry.document);
  const result = searchAgentThreadDocuments(documents, query, limit);
  if (!index.documentsTruncated || result.documentsTruncated) return result;
  return { ...result, documentsTruncated: true };
}

function retainKnownThreads(
  result: AgentThreadSearchResult | null,
  index: AgentThreadSearchIndex,
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

function nextEvidenceRevisions(
  current: ReadonlyMap<string, number>,
  index: AgentThreadSearchIndex,
  turnLog: AgentTurnLogFactsSource,
): ReadonlyMap<string, number> {
  const next = new Map<string, number>();
  let changed = current.size !== index.entries.size;
  for (const threadId of index.entries.keys()) {
    const revision = turnLog.evidenceRevisionOf(threadId);
    next.set(threadId, revision);
    if (current.get(threadId) !== revision) changed = true;
  }
  if (!changed) return current;
  return next;
}

function sameEntries(
  previous: ReadonlyMap<string, IndexedAgentThread>,
  next: ReadonlyMap<string, IndexedAgentThread>,
): boolean {
  if (previous.size !== next.size) return false;
  for (const [threadId, entry] of next) {
    if (previous.get(threadId) !== entry) return false;
  }
  return true;
}
