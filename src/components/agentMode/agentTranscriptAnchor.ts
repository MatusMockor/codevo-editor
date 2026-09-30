export const AGENT_PINNED_DISTANCE_PX = 32;
export const AGENT_AT_BOTTOM_EPSILON_PX = 1;

const MAX_ANCHOR_DEPTH = 16;
const MAX_UNRENDERED_PROBE = 32;

export interface AgentTranscriptAnchorEntry {
  readonly element: Element;
  readonly offset: number;
}

export type AgentTranscriptAnchor = ReadonlyArray<AgentTranscriptAnchorEntry>;

export interface AgentTranscriptScroll {
  readonly following: boolean;
  readonly movedBy: number;
  readonly distanceFromBottom: number;
}

export function agentFollowsAfterScroll({
  following,
  movedBy,
  distanceFromBottom,
}: AgentTranscriptScroll): boolean {
  if (movedBy < 0) return distanceFromBottom <= AGENT_AT_BOTTOM_EPSILON_PX ? following : false;
  return distanceFromBottom <= AGENT_PINNED_DISTANCE_PX;
}

export function agentDistanceFromBottom(container: HTMLElement): number {
  return container.scrollHeight - container.scrollTop - container.clientHeight;
}

export function selectAgentTranscriptAnchor(container: HTMLElement): AgentTranscriptAnchor {
  const viewTop = viewportTop(container);
  const chain: AgentTranscriptAnchorEntry[] = [];
  let parent: Element = container;
  while (chain.length < MAX_ANCHOR_DEPTH) {
    const crossing = firstChildCrossing(parent, viewTop);
    if (crossing === null) break;
    chain.push({ element: crossing.element, offset: crossing.top - viewTop });
    parent = crossing.element;
  }
  return chain;
}

export function agentTranscriptAnchorAt(
  container: HTMLElement,
  target: Element,
): AgentTranscriptAnchor {
  const viewTop = viewportTop(container);
  const chain: AgentTranscriptAnchorEntry[] = [];
  let element: Element | null = target;
  while (element !== null && element !== container && chain.length < MAX_ANCHOR_DEPTH) {
    const rect = renderedRect(element);
    if (rect !== null) chain.unshift({ element, offset: rect.top - viewTop });
    element = element.parentElement;
  }
  if (element !== container) return [];
  return chain;
}

export interface AgentTranscriptAnchorDrift {
  readonly drift: number;
  readonly lostDepth: boolean;
}

export function agentTranscriptAnchorDrift(
  container: HTMLElement,
  anchor: AgentTranscriptAnchor,
): AgentTranscriptAnchorDrift | null {
  const viewTop = viewportTop(container);
  for (let depth = anchor.length - 1; depth >= 0; depth -= 1) {
    const entry = anchor[depth];
    if (entry === undefined) continue;
    if (!entry.element.isConnected || !container.contains(entry.element)) continue;
    const rect = renderedRect(entry.element);
    if (rect === null) continue;
    return { drift: rect.top - viewTop - entry.offset, lostDepth: depth < anchor.length - 1 };
  }
  return null;
}

function viewportTop(container: HTMLElement): number {
  return container.getBoundingClientRect().top + container.clientTop;
}

function renderedRect(element: Element): DOMRect | null {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return rect;
}

function firstChildCrossing(
  parent: Element,
  viewTop: number,
): { readonly element: Element; readonly top: number } | null {
  const children = parent.children;
  let low = 0;
  let high = children.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const child = children[middle];
    if (child !== undefined && child.getBoundingClientRect().bottom > viewTop) high = middle;
    else low = middle + 1;
  }
  const limit = Math.min(children.length, low + MAX_UNRENDERED_PROBE);
  for (let index = low; index < limit; index += 1) {
    const child = children[index];
    if (child === undefined) continue;
    const rect = renderedRect(child);
    if (rect === null || rect.bottom <= viewTop) continue;
    return { element: child, top: rect.top };
  }
  return null;
}
