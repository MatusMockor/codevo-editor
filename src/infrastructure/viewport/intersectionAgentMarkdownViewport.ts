import {
  AGENT_MARKDOWN_VIEWPORT_ROOT_MARGIN,
  isWithinAgentMarkdownViewport,
  type AgentMarkdownViewport,
  type AgentMarkdownViewportBand,
  type AgentMarkdownViewportWatcher,
} from "../../application/agentMarkdownViewport";

export function createIntersectionAgentMarkdownViewport(
  resolveRoot: () => Element | null,
): AgentMarkdownViewport | null {
  if (typeof IntersectionObserver !== "function") return null;

  const waiting = new Map<Element, () => void>();
  const watched = new Map<Element, Watched>();
  let observer: IntersectionObserver | null = null;
  let presence: IntersectionObserver | null = null;

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

  const settle = (target: Element, position: "inside" | "outside"): void => {
    const record = watched.get(target);
    if (record === undefined || record.position === position) return;
    const previous = record.position;
    record.position = position;
    if (position === "inside") {
      record.watcher.enter();
      return;
    }
    if (previous === "inside") record.watcher.leave();
  };

  const resolveUnknown = (root: AgentMarkdownViewportBand): void => {
    for (const [element, record] of [...watched]) {
      if (record.position !== "unknown") continue;
      if (!isRendered(element)) continue;
      if (!isWithinAgentMarkdownViewport(band(element), root)) continue;
      settle(element, "inside");
    }
  };

  const deliverPresence = (entries: ReadonlyArray<IntersectionObserverEntry>): void => {
    for (const entry of entries) settle(entry.target, entry.isIntersecting ? "inside" : "outside");
  };

  const activePresence = (): IntersectionObserver => {
    if (presence !== null) return presence;
    presence = new IntersectionObserver(deliverPresence, {
      root: resolveRoot(),
      rootMargin: AGENT_MARKDOWN_VIEWPORT_ROOT_MARGIN,
    });
    return presence;
  };

  const active = (): IntersectionObserver => {
    if (observer !== null) return observer;
    observer = new IntersectionObserver(deliver, {
      root: resolveRoot(),
      rootMargin: AGENT_MARKDOWN_VIEWPORT_ROOT_MARGIN,
    });
    return observer;
  };

  const contains = (element: Element): boolean =>
    isWithinAgentMarkdownViewport(band(element), rootBand(resolveRoot()));

  return {
    contains,
    observe(element, onEnter) {
      const target = active();
      waiting.set(element, onEnter);
      target.observe(element);
      return () => {
        waiting.delete(element);
        target.unobserve(element);
      };
    },
    watch(element, watcher) {
      const target = activePresence();
      watched.set(element, { watcher, position: "unknown" });
      target.observe(element);
      if (isRendered(element) && contains(element)) settle(element, "inside");
      return () => {
        watched.delete(element);
        target.unobserve(element);
      };
    },
    remeasure() {
      if (waiting.size === 0 && watched.size === 0) return;
      const root = rootBand(resolveRoot());
      for (const [element, onEnter] of [...waiting]) {
        if (!isWithinAgentMarkdownViewport(band(element), root)) continue;
        waiting.delete(element);
        observer?.unobserve(element);
        onEnter();
      }
      resolveUnknown(root);
    },
    dispose() {
      waiting.clear();
      watched.clear();
      observer?.disconnect();
      observer = null;
      presence?.disconnect();
      presence = null;
    },
  };
}

type Position = "unknown" | "inside" | "outside";

interface Watched {
  readonly watcher: AgentMarkdownViewportWatcher;
  position: Position;
}

function isRendered(element: Element): boolean {
  if (!element.isConnected) return false;
  if (typeof element.checkVisibility !== "function") return false;
  return element.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
}

function band(element: Element): AgentMarkdownViewportBand {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom };
}

function rootBand(root: Element | null): AgentMarkdownViewportBand {
  if (root !== null) return band(root);
  return { top: 0, bottom: window.innerHeight || document.documentElement.clientHeight };
}
