import {
  AGENT_MARKDOWN_VIEWPORT_ROOT_MARGIN,
  isWithinAgentMarkdownViewport,
  type AgentMarkdownViewport,
  type AgentMarkdownViewportBand,
} from "../../application/agentMarkdownViewport";

export function createIntersectionAgentMarkdownViewport(
  resolveRoot: () => Element | null,
): AgentMarkdownViewport | null {
  if (typeof IntersectionObserver !== "function") return null;

  const waiting = new Map<Element, () => void>();
  let observer: IntersectionObserver | null = null;

  const deliver = (entries: ReadonlyArray<IntersectionObserverEntry>): void => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const onEnter = waiting.get(entry.target);
      if (onEnter === undefined) continue;
      waiting.delete(entry.target);
      observer?.unobserve(entry.target);
      onEnter();
    }
  };

  const active = (): IntersectionObserver => {
    if (observer !== null) return observer;
    observer = new IntersectionObserver(deliver, {
      root: resolveRoot(),
      rootMargin: AGENT_MARKDOWN_VIEWPORT_ROOT_MARGIN,
    });
    return observer;
  };

  return {
    contains(element) {
      return isWithinAgentMarkdownViewport(band(element), rootBand(resolveRoot()));
    },
    observe(element, onEnter) {
      const target = active();
      waiting.set(element, onEnter);
      target.observe(element);
      return () => {
        waiting.delete(element);
        target.unobserve(element);
      };
    },
    dispose() {
      waiting.clear();
      observer?.disconnect();
      observer = null;
    },
  };
}

function band(element: Element): AgentMarkdownViewportBand {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom };
}

function rootBand(root: Element | null): AgentMarkdownViewportBand {
  if (root !== null) return band(root);
  return { top: 0, bottom: window.innerHeight || document.documentElement.clientHeight };
}
