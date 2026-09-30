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

export interface AgentTranscriptTurnOffset {
  readonly turnId: string;
  readonly offsetPx: number;
}

export type AgentTranscriptTurnMeasure =
  | { readonly kind: "measured"; readonly offsetPx: number }
  | { readonly kind: "missing" }
  | { readonly kind: "unmeasured" };

export function agentTranscriptTurnMeasure(
  container: HTMLElement,
  turnId: string,
): AgentTranscriptTurnMeasure {
  const turn = findTurn(container, turnId);
  if (turn === null) return { kind: "missing" };
  const offsetPx = turnOffset(container, turn);
  if (offsetPx === null) return { kind: "unmeasured" };
  return { kind: "measured", offsetPx };
}

export function agentTranscriptAnchorTurn(
  container: HTMLElement,
  anchor: AgentTranscriptAnchor,
): AgentTranscriptTurnOffset | null {
  const turn =
    turnInAnchor(container, anchor) ??
    turnBeforeAnchor(container, anchor) ??
    container.querySelector(TURN_SELECTOR);
  if (turn === null) return null;
  const turnId = turn.getAttribute(TURN_ATTRIBUTE);
  if (turnId === null || turnId === "") return null;
  const offsetPx = turnOffset(container, turn);
  if (offsetPx === null) return null;
  return { turnId, offsetPx };
}

const TURN_ATTRIBUTE = "data-agent-turn";
const TURN_SELECTOR = `[${TURN_ATTRIBUTE}]`;
const MAX_TURN_SIBLING_PROBE = 8;

function findTurn(container: HTMLElement, turnId: string): Element | null {
  for (const candidate of container.querySelectorAll(TURN_SELECTOR)) {
    if (candidate.getAttribute(TURN_ATTRIBUTE) === turnId) return candidate;
  }
  return null;
}

function turnOffset(container: HTMLElement, turn: Element): number | null {
  if (container.clientHeight <= 0) return null;
  const rect = renderedRect(turn);
  if (rect === null) return null;
  return rect.top - viewportTop(container);
}

function liveAnchorElements(container: HTMLElement, anchor: AgentTranscriptAnchor): Element[] {
  return anchor
    .map((entry) => entry.element)
    .filter((element) => element.isConnected && container.contains(element));
}

function turnInAnchor(container: HTMLElement, anchor: AgentTranscriptAnchor): Element | null {
  return (
    liveAnchorElements(container, anchor).find((element) => element.hasAttribute(TURN_ATTRIBUTE)) ??
    null
  );
}

function turnBeforeAnchor(container: HTMLElement, anchor: AgentTranscriptAnchor): Element | null {
  for (const element of liveAnchorElements(container, anchor)) {
    let sibling = element.previousElementSibling;
    for (let probe = 0; sibling !== null && probe < MAX_TURN_SIBLING_PROBE; probe += 1) {
      if (sibling.hasAttribute(TURN_ATTRIBUTE)) return sibling;
      sibling = sibling.previousElementSibling;
    }
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
