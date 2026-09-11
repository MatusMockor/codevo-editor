import { useEffect, useState, type RefObject } from "react";

export const MAX_OBSERVED_AGENT_COLUMN_ENTRIES = 256;

export function sampledColumnTargets<T>(
  entries: ReadonlyArray<T>,
  limit: number = MAX_OBSERVED_AGENT_COLUMN_ENTRIES,
): ReadonlyArray<T> {
  if (limit < 1) return [];
  if (entries.length <= limit) return entries;
  if (limit === 1) return entries.slice(0, 1);

  const step = (entries.length - 1) / (limit - 1);
  const picked: T[] = [];
  for (let slot = 0; slot < limit; slot += 1) {
    const entry = entries[Math.floor(slot * step)];
    if (entry === undefined) continue;
    picked.push(entry);
  }

  return picked;
}

export interface AgentTurnInViewOptions {
  readonly scrollRef: RefObject<HTMLElement | null>;
  readonly threadId: string;
  readonly columnSignature: string;
  readonly enabled: boolean;
}

export function useAgentThreadTurnInView({
  columnSignature,
  enabled,
  scrollRef,
  threadId,
}: AgentTurnInViewOptions): string | null {
  const [columnKey, setColumnKey] = useState<string | null>(null);

  useEffect(() => {
    setColumnKey(null);
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

    const targets = sampledColumnTargets(
      Array.from(container.querySelectorAll<HTMLElement>("[data-agent-column]")),
    );

    for (const target of targets) {
      const id = target.dataset.agentColumn;
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
          if (found !== undefined) setColumnKey(found);
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
  }, [columnSignature, enabled, scrollRef, threadId]);

  return columnKey;
}

function lowest(positions: ReadonlySet<number>): number | null {
  let found: number | null = null;
  for (const position of positions) {
    if (found !== null && position >= found) continue;
    found = position;
  }

  return found;
}
