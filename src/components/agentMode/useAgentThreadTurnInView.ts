import { useEffect, useState, type RefObject } from "react";

export const MAX_OBSERVED_AGENT_TURNS = 256;

export interface AgentTurnInViewOptions {
  readonly scrollRef: RefObject<HTMLElement | null>;
  readonly threadId: string;
  readonly turnSignature: string;
  readonly enabled: boolean;
}

export function useAgentThreadTurnInView({
  enabled,
  scrollRef,
  threadId,
  turnSignature,
}: AgentTurnInViewOptions): string | null {
  const [turnId, setTurnId] = useState<string | null>(null);

  useEffect(() => {
    setTurnId(null);
  }, [enabled, threadId]);

  useEffect(() => {
    if (!enabled) return;
    const container = scrollRef.current;
    if (container === null) return;
    if (typeof IntersectionObserver !== "function") return;

    const order = new Map<Element, number>();
    const ids: string[] = [];
    const visible = new Set<number>();
    let active = true;

    let observer: IntersectionObserver | null = null;
    let generation = 0;
    let observedHeight = -1;

    const targets = Array.from(container.querySelectorAll<HTMLElement>("[data-agent-turn]")).slice(
      0,
      MAX_OBSERVED_AGENT_TURNS,
    );

    for (const target of targets) {
      const id = target.dataset.agentTurn;
      if (id === undefined) continue;
      order.set(target, ids.length);
      ids.push(id);
    }

    const refresh = () => {
      if (!active) return;
      const height = container.clientHeight;
      if (height === observedHeight) return;
      observedHeight = height;
      const lease = ++generation;
      observer?.disconnect();
      visible.clear();
      // Percentage root margins resolve against width, even for top and bottom.
      // Use the scrollport height to retain the 15–30% reading band at any aspect ratio.
      observer = new IntersectionObserver(
        (records) => {
          if (!active || lease !== generation) return;
          for (const record of records) {
            const position = order.get(record.target);
            if (position === undefined) continue;
            if (record.isIntersecting) visible.add(position);
            else visible.delete(position);
          }
          const first = lowest(visible);
          if (first === null) return;
          const found = ids[first];
          if (found !== undefined) setTurnId(found);
        },
        { root: container, rootMargin: `${-height * 0.15}px 0px ${-height * 0.7}px 0px` },
      );
      for (const target of order.keys()) observer.observe(target);
    };
    refresh();
    const resizeObserver =
      typeof ResizeObserver === "function" ? new ResizeObserver(refresh) : null;
    resizeObserver?.observe(container);
    window.addEventListener("resize", refresh);

    return () => {
      active = false;
      observer?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", refresh);
      order.clear();
      visible.clear();
    };
  }, [enabled, scrollRef, threadId, turnSignature]);

  return turnId;
}

function lowest(positions: ReadonlySet<number>): number | null {
  let found: number | null = null;
  for (const position of positions) {
    if (found !== null && position >= found) continue;
    found = position;
  }

  return found;
}
