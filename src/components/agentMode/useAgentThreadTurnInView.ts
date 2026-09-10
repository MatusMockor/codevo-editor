import { useEffect, useState, type RefObject } from "react";

export const MAX_OBSERVED_AGENT_TURNS = 256;
export const AGENT_TURN_IN_VIEW_MARGIN = "-15% 0px -70% 0px";

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

    const observer = new IntersectionObserver(
      (records) => {
        if (!active) return;
        for (const record of records) {
          const position = order.get(record.target);
          if (position === undefined) continue;
          if (record.isIntersecting) {
            visible.add(position);
            continue;
          }
          visible.delete(position);
        }
        const first = lowest(visible);
        if (first === null) return;
        const found = ids[first];
        if (found === undefined) return;
        setTurnId(found);
      },
      { root: container, rootMargin: AGENT_TURN_IN_VIEW_MARGIN },
    );

    const targets = Array.from(container.querySelectorAll<HTMLElement>("[data-agent-turn]")).slice(
      0,
      MAX_OBSERVED_AGENT_TURNS,
    );

    for (const target of targets) {
      const id = target.dataset.agentTurn;
      if (id === undefined) continue;
      order.set(target, ids.length);
      ids.push(id);
      observer.observe(target);
    }

    return () => {
      active = false;
      observer.disconnect();
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
