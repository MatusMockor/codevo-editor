import {
  agentBandPin,
  type AgentBandPin,
  type AgentBandPinObserver,
} from "../../application/agentBandPin";

export function createIntersectionAgentBandPin(
  resolveRoot: () => Element | null,
): AgentBandPinObserver | null {
  if (typeof IntersectionObserver !== "function") return null;

  const listeners = new Map<Element, (pin: AgentBandPin) => void>();
  let observer: IntersectionObserver | null = null;

  const deliver = (entries: ReadonlyArray<IntersectionObserverEntry>): void => {
    for (const entry of entries) {
      const onChange = listeners.get(entry.target);
      if (onChange === undefined) continue;
      onChange(
        agentBandPin({
          intersecting: entry.isIntersecting,
          top: entry.boundingClientRect.top,
          rootTop: entry.rootBounds?.top ?? 0,
          rootHeight: entry.rootBounds?.height ?? 0,
        }),
      );
    }
  };

  const active = (): IntersectionObserver => {
    if (observer !== null) return observer;
    observer = new IntersectionObserver(deliver, { root: resolveRoot(), threshold: 0 });
    return observer;
  };

  return {
    observe(sentinel, onChange) {
      const target = active();
      listeners.set(sentinel, onChange);
      target.observe(sentinel);
      return () => {
        listeners.delete(sentinel);
        target.unobserve(sentinel);
      };
    },
    dispose() {
      listeners.clear();
      observer?.disconnect();
      observer = null;
    },
  };
}
