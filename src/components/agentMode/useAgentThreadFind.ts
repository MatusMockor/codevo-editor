import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentThread, AgentTurn, AgentTurnEvent } from "../../domain/agentThread";
import {
  MAX_THREAD_FIND_HITS,
  MAX_THREAD_SEARCH_QUERY_CHARS,
  findInThread,
  type AgentThreadFindHit,
} from "../../domain/agentThreadSearch";
import type { AgentThreadRevealRequest } from "./agentSidebarPresentation";
import { useLiveAgentThread } from "../../application/agentThreads/useLiveAgentThread";

export const AGENT_THREAD_FIND_DEBOUNCE_MS = 80;

export interface AgentThreadFindControl {
  readonly open: boolean;
  readonly query: string;
  readonly index: number;
  readonly searchTarget: AgentThreadRevealRequest | null;
  readonly reveal: AgentThreadRevealRequest | null;
  openBar(): void;
  close(): void;
  setQuery(query: string): void;
  navigate(index: number): void;
  requestReveal(reveal: AgentThreadRevealRequest): void;
  resolveReveal(index: number): void;
  dropReveal(): void;
}

export interface AgentThreadFindResults {
  readonly hits: ReadonlyArray<AgentThreadFindHit>;
  readonly hitIndex: number;
  readonly truncated: boolean;
  readonly reveal: AgentThreadRevealRequest | null;
}

interface PublishedHits {
  readonly query: string;
  readonly thread: AgentThread | null;
  readonly hits: ReadonlyArray<AgentThreadFindHit>;
}

const NO_HITS: ReadonlyArray<AgentThreadFindHit> = [];
const NOTHING_PUBLISHED: PublishedHits = { query: "", thread: null, hits: NO_HITS };

export function useAgentThreadFindControl(shown: AgentThread | null): AgentThreadFindControl {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const [index, setIndex] = useState(0);
  const [searchTarget, setSearchTarget] = useState<AgentThreadRevealRequest | null>(null);
  const [reveal, setReveal] = useState<AgentThreadRevealRequest | null>(null);
  const ownerKey = shown === null ? null : JSON.stringify([shown.threadId, shown.owner]);
  const ownerRef = useRef(ownerKey);
  useLayoutEffect(() => {
    if (ownerRef.current === ownerKey) return;
    ownerRef.current = ownerKey;
    setQueryState("");
    setSearchTarget(null);
    setReveal(null);
    setIndex(0);
  }, [ownerKey]);

  const openBar = useCallback((): void => setOpen(true), []);

  const close = useCallback((): void => {
    setOpen(false);
    setQueryState("");
    setSearchTarget(null);
    setIndex(0);
    setReveal(null);
  }, []);

  const setQuery = useCallback((next: string): void => {
    setQueryState(next.slice(0, MAX_THREAD_SEARCH_QUERY_CHARS));
    setSearchTarget(null);
    setReveal(null);
    setIndex(0);
  }, []);

  const navigate = useCallback((next: number): void => setIndex(Math.max(0, next)), []);

  const requestReveal = useCallback((next: AgentThreadRevealRequest): void => {
    setOpen(true);
    setQueryState(next.query.slice(0, MAX_THREAD_SEARCH_QUERY_CHARS));
    setSearchTarget(next.resolveQuery === true ? next : null);
    setIndex(0);
    setReveal(next);
  }, []);

  const resolveReveal = useCallback((found: number): void => {
    setIndex(found);
    setReveal(null);
  }, []);

  const dropReveal = useCallback((): void => setReveal(null), []);

  return useMemo(
    () => ({
      open,
      query,
      index,
      searchTarget,
      reveal,
      openBar,
      close,
      setQuery,
      navigate,
      requestReveal,
      resolveReveal,
      dropReveal,
    }),
    [
      close,
      dropReveal,
      index,
      navigate,
      open,
      openBar,
      query,
      requestReveal,
      resolveReveal,
      reveal,
      searchTarget,
      setQuery,
    ],
  );
}

export function useAgentThreadFindResults(
  control: AgentThreadFindControl | null,
  shown: AgentThread | null,
): AgentThreadFindResults {
  const open = control?.open ?? false;
  const query = control?.query ?? "";
  const searchTarget = control?.searchTarget ?? null;
  const reveal = control?.reveal ?? null;
  const live = useLiveAgentThread(open ? shown : null);
  const thread = open ? live : shown;
  const [published, setPublished] = useState<PublishedHits>(NOTHING_PUBLISHED);
  const generationRef = useRef(0);
  const ownerKey = thread === null ? null : JSON.stringify([thread.threadId, thread.owner]);
  const ownerRef = useRef(ownerKey);
  const sameOwner = ownerRef.current === ownerKey;
  useLayoutEffect(() => {
    if (ownerRef.current === ownerKey) return;
    ownerRef.current = ownerKey;
    generationRef.current += 1;
    setPublished(NOTHING_PUBLISHED);
  }, [ownerKey]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    if (!open || thread === null) {
      setPublished(NOTHING_PUBLISHED);
      return;
    }
    const timer = setTimeout(() => {
      if (generation !== generationRef.current) return;
      const hits = findInThread(thread, query);
      const target =
        searchTarget !== null ? findRevealTarget(thread, query, searchTarget) : undefined;
      const targetPresent =
        target === undefined ||
        hits.some(
          (hit) =>
            hit.scope === "turn" &&
            hit.turnId === target.turnId &&
            hit.eventIndex === target.eventIndex &&
            hit.start === target.start,
        );
      const visibleHits = targetPresent
        ? hits
        : [...hits.slice(0, MAX_THREAD_FIND_HITS - 1), target!];
      setPublished({ query, thread, hits: visibleHits });
    }, AGENT_THREAD_FIND_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, query, searchTarget, thread]);

  const current =
    control !== null &&
    sameOwner &&
    open &&
    published.thread === thread &&
    published.query === query;
  const hits = current ? published.hits : NO_HITS;
  const hitIndex = hits.length === 0 ? -1 : Math.min(control?.index ?? 0, hits.length - 1);
  const truncated = hits.length >= MAX_THREAD_FIND_HITS;
  const publishedReveal = current ? reveal : null;
  const resolveReveal = control?.resolveReveal;
  const dropReveal = control?.dropReveal;
  const close = control?.close;

  useEffect(() => {
    if (reveal === null || !current) return;
    const found = hits.findIndex((hit) => sameHit(hit, reveal, thread));
    if (found >= 0) {
      resolveReveal?.(found);
    } else if (
      reveal.resolveQuery !== true &&
      thread?.turns.some((turn) => turn.turnId === reveal.turnId)
    ) {
      dropReveal?.();
    }
  }, [current, dropReveal, hits, resolveReveal, reveal, thread]);

  useEffect(() => {
    if (thread !== null || !open) return;
    close?.();
  }, [close, open, thread]);

  return useMemo(
    () => ({ hits, hitIndex, truncated, reveal: publishedReveal }),
    [hitIndex, hits, publishedReveal, truncated],
  );
}

function sameHit(
  hit: AgentThreadFindHit,
  reveal: AgentThreadRevealRequest,
  thread: AgentThread | null,
): boolean {
  if (hit.scope !== "turn") return false;

  if (reveal.resolveQuery === true) {
    const turn = thread?.turns.find((candidate) => candidate.turnId === reveal.turnId);
    return (
      hit.turnId === reveal.turnId && turn !== undefined && matchesRevealSource(turn, hit, reveal)
    );
  }
  return (
    hit.turnId === reveal.turnId &&
    hit.eventIndex === reveal.eventIndex &&
    hit.start === reveal.start
  );
}

function findRevealTarget(
  thread: AgentThread,
  query: string,
  target: AgentThreadRevealRequest,
): Extract<AgentThreadFindHit, { readonly scope: "turn" }> | undefined {
  const turn = thread.turns.find((candidate) => candidate.turnId === target.turnId);
  if (turn === undefined) return undefined;
  const searchableTurn =
    target.resolveSource === undefined
      ? turn
      : {
          ...turn,
          prompt: target.resolveSource === "assistant" ? "" : turn.prompt,
          events: turn.events.map((event): AgentTurnEvent =>
            eventSource(event) === target.resolveSource
              ? event
              : { kind: "assistantText", text: "" },
          ),
        };
  const hits = findInThread({ ...thread, turns: [searchableTurn], externalOrigin: null }, query);
  return hits.find(
    (hit): hit is Extract<AgentThreadFindHit, { readonly scope: "turn" }> =>
      hit.scope === "turn" && matchesRevealSource(turn, hit, target),
  );
}

function matchesRevealSource(
  turn: AgentTurn,
  hit: Extract<AgentThreadFindHit, { readonly scope: "turn" }>,
  target: AgentThreadRevealRequest,
): boolean {
  if (target.resolveSource === undefined) return true;
  if (hit.eventIndex === null) return target.resolveSource === "user";
  return eventSource(turn.events[hit.eventIndex]) === target.resolveSource;
}

function eventSource(event: AgentTurnEvent | undefined): "user" | "assistant" | null {
  if (event?.kind === "userMessage") return "user";
  if (event?.kind === "assistantText" || event?.kind === "result") return "assistant";
  return null;
}
