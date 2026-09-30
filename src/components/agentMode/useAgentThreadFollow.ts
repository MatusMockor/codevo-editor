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
import type { AgentTranscriptPositionMemory } from "../../application/agentTranscriptPositionMemory";
import type { AgentTurn } from "../../domain/agentThread";
import { AgentTranscriptFollowController } from "./agentTranscriptFollowController";
import { useAgentTranscriptPositionMemoryContext } from "./agentTranscriptPositionMemoryContext";
import { useAgentTranscriptPositionSync } from "./useAgentTranscriptPositionSync";

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
  readonly positionMemory?: AgentTranscriptPositionMemory | null;
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
  positionMemory,
}: AgentThreadFollowSource): AgentThreadFollow {
  const contextPositionMemory = useAgentTranscriptPositionMemoryContext();
  const positionSync = useAgentTranscriptPositionSync(
    positionMemory === undefined ? contextPositionMemory : positionMemory,
    now,
  );
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

  const controllerFor = useAgentTranscriptFollowController(scrollRef, pinnedRef, markPinned, now);

  const followLatest = useCallback(() => {
    controllerFor()?.followIfFollowing();
  }, [controllerFor]);

  const jumpToLatest = useCallback(() => {
    const controller = controllerFor();
    if (controller === null) return;
    controller.follow();
    positionSync.record(controller);
    viewport?.remeasure();
  }, [controllerFor, positionSync, viewport]);

  const release = useCallback(() => {
    const controller = controllerFor();
    if (controller === null) return;
    controller.release();
    positionSync.record(controller);
  }, [controllerFor, positionSync]);

  const settleRestored = useCallback(
    (controller: AgentTranscriptFollowController) => {
      setUnseenActivity(false);
      positionSync.record(controller);
      viewport?.remeasure();
    },
    [positionSync, viewport],
  );

  useEffect(() => {
    const controller = controllerFor();
    if (controller === null) return;
    const container = controller.container;
    const onScroll = () => {
      controller.handleScroll();
      positionSync.record(controller);
    };
    const onWheel = (event: WheelEvent) => {
      positionSync.cancel();
      controller.handleWheel(event.deltaX, event.deltaY, event.target);
      positionSync.record(controller);
    };
    const onClick = (event: MouseEvent) => controller.handleClick(event.target);
    const onUserIntent = () => positionSync.cancel();
    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("click", onClick, { capture: true });
    container.addEventListener("pointerdown", onUserIntent, { passive: true });
    container.addEventListener("keydown", onUserIntent);
    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("click", onClick, { capture: true });
      container.removeEventListener("pointerdown", onUserIntent);
      container.removeEventListener("keydown", onUserIntent);
    };
  }, [controllerFor, positionSync, threadId]);

  useEffect(() => {
    const controller = controllerFor();
    if (controller === null) return;
    if (typeof ResizeObserver === "undefined") return;
    const container = controller.container;
    const observer = new ResizeObserver(() => {
      if (positionSync.retry(controller) === "restored") settleRestored(controller);
      controller.handleLayout();
      positionSync.record(controller);
    });
    observer.observe(container);
    const content = container.firstElementChild;
    if (content !== null) observer.observe(content);
    return () => observer.disconnect();
  }, [controllerFor, positionSync, settleRestored, threadId]);

  useLayoutEffect(() => {
    const controller = controllerFor();
    if (controller === null) return;
    const previous = renderedRef.current;
    const turnId = lastTurn?.turnId ?? null;
    renderedRef.current = {
      threadId,
      pageKey,
      turnId,
      contentRevision,
      queuedPrompts: new Set(queuedPrompts),
    };
    const restore = positionSync.settle(controller, threadId);
    if (restore === "restored") {
      settleRestored(controller);
      return;
    }
    const replaced =
      restore === "missing" || previous.threadId !== threadId || previous.pageKey !== pageKey;
    const newTurn = previous.turnId !== turnId;
    const sentByUser = newTurn && turnSentByUser(lastTurn, previous.queuedPrompts, now());
    if (!replaced && !sentByUser && !controller.isFollowing) {
      if (newTurn || previous.contentRevision !== contentRevision) setUnseenActivity(true);
      return;
    }
    const moved = replaced || sentByUser ? controller.follow() : controller.followIfFollowing();
    positionSync.record(controller);
    if (!moved) return;
    viewport?.remeasure();
  }, [
    contentRevision,
    controllerFor,
    lastTurn,
    now,
    pageKey,
    positionSync,
    queuedPrompts,
    settleRestored,
    threadId,
    viewport,
  ]);

  return { pinnedRef, atLatest, unseenActivity, followLatest, jumpToLatest, release };
}

function useAgentTranscriptFollowController(
  scrollRef: RefObject<HTMLDivElement | null>,
  pinnedRef: MutableRefObject<boolean>,
  onFollowingChange: (following: boolean) => void,
  now: () => number,
): () => AgentTranscriptFollowController | null {
  const controllerRef = useRef<AgentTranscriptFollowController | null>(null);
  return useCallback(() => {
    const container = scrollRef.current;
    if (container === null) return null;
    const current = controllerRef.current;
    if (current !== null && current.container === container) return current;
    const next = new AgentTranscriptFollowController(
      container,
      pinnedRef.current,
      onFollowingChange,
      now,
    );
    controllerRef.current = next;
    return next;
  }, [now, onFollowingChange, pinnedRef, scrollRef]);
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
