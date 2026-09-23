import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import type { AgentMarkdownViewport } from "../../application/agentMarkdownViewport";
import type { AgentTurn } from "../../domain/agentThread";

export const AGENT_PINNED_DISTANCE_PX = 32;
export const AGENT_USER_SENT_TURN_WINDOW_MS = 15_000;

export interface AgentThreadFollowSource {
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly threadId: string;
  readonly pageKey: string | null;
  readonly lastTurn: AgentTurn | null;
  readonly contentRevision: unknown;
  readonly queuedPrompts: ReadonlyArray<string>;
  readonly viewport: AgentMarkdownViewport | null;
  readonly now?: () => number;
}

export interface AgentThreadFollow {
  readonly pinnedRef: MutableRefObject<boolean>;
  readonly atLatest: boolean;
  readonly unseenActivity: boolean;
  readonly followLatest: () => void;
  readonly jumpToLatest: () => void;
  readonly release: () => void;
}

interface RenderedTail {
  readonly threadId: string;
  readonly pageKey: string | null;
  readonly turnId: string | null;
  readonly contentRevision: unknown;
  readonly queuedPrompts: ReadonlySet<string>;
}

export function useAgentThreadFollow({
  scrollRef,
  threadId,
  pageKey,
  lastTurn,
  contentRevision,
  queuedPrompts,
  viewport,
  now = Date.now,
}: AgentThreadFollowSource): AgentThreadFollow {
  const pinnedRef = useRef(true);
  const [atLatest, setAtLatest] = useState(true);
  const [unseenActivity, setUnseenActivity] = useState(false);
  const renderedRef = useRef<RenderedTail>({
    threadId,
    pageKey,
    turnId: null,
    contentRevision: null,
    queuedPrompts: new Set(),
  });

  const markPinned = useCallback((pinned: boolean) => {
    pinnedRef.current = pinned;
    setAtLatest(pinned);
    if (pinned) setUnseenActivity(false);
  }, []);

  const followLatest = useCallback(() => {
    const container = scrollRef.current;
    if (container === null) return;
    if (!pinnedRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [scrollRef]);

  const jumpToLatest = useCallback(() => {
    const container = scrollRef.current;
    if (container === null) return;
    container.scrollTop = container.scrollHeight;
    markPinned(true);
    viewport?.remeasure();
  }, [markPinned, scrollRef, viewport]);

  const release = useCallback(() => markPinned(false), [markPinned]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container === null) return;
    const updatePinnedState = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      markPinned(distanceFromBottom <= AGENT_PINNED_DISTANCE_PX);
    };
    container.addEventListener("scroll", updatePinnedState, { passive: true });
    return () => container.removeEventListener("scroll", updatePinnedState);
  }, [markPinned, scrollRef, threadId]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container === null) return;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!pinnedRef.current) return;
      container.scrollTop = container.scrollHeight;
    });
    observer.observe(container);
    const content = container.firstElementChild;
    if (content !== null) observer.observe(content);
    return () => observer.disconnect();
  }, [scrollRef, threadId]);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (container === null) return;
    const previous = renderedRef.current;
    const turnId = lastTurn?.turnId ?? null;
    renderedRef.current = {
      threadId,
      pageKey,
      turnId,
      contentRevision,
      queuedPrompts: new Set(queuedPrompts),
    };
    const replaced = previous.threadId !== threadId || previous.pageKey !== pageKey;
    const newTurn = previous.turnId !== turnId;
    const sentByUser = newTurn && turnSentByUser(lastTurn, previous.queuedPrompts, now());
    if (!replaced && !sentByUser && !pinnedRef.current) {
      if (newTurn || previous.contentRevision !== contentRevision) setUnseenActivity(true);
      return;
    }
    const before = container.scrollTop;
    container.scrollTop = container.scrollHeight;
    markPinned(true);
    if (container.scrollTop === before) return;
    viewport?.remeasure();
  }, [
    contentRevision,
    lastTurn,
    markPinned,
    now,
    pageKey,
    queuedPrompts,
    scrollRef,
    threadId,
    viewport,
  ]);

  return { pinnedRef, atLatest, unseenActivity, followLatest, jumpToLatest, release };
}

export function turnSentByUser(
  turn: AgentTurn | null,
  queuedBefore: ReadonlySet<string>,
  nowEpochMs: number,
): boolean {
  if (turn === null) return false;
  if (turn.status.kind !== "pending" && turn.status.kind !== "running") return false;
  if (queuedBefore.has(turn.prompt)) return false;
  const age = nowEpochMs - turn.startedAtEpochMs;
  return age >= 0 && age <= AGENT_USER_SENT_TURN_WINDOW_MS;
}
