import type { AgentThreadFindHit } from "../../../domain/agentThreadSearch";
import type { AgentThreadRevealRequest } from "../agentSidebarPresentation";
import { agentThreadColumnKey, type AgentThreadColumnAnchor } from "../agentThreadColumn";
import type { AgentTurnHighlightCursor } from "../agentTurnHighlightModel";
import { agentTurnItemKey, normalizeAgentTurnEventOffset } from "../agentTurnItemKeys";

export interface AgentRevealTarget {
  readonly element: HTMLElement;
  readonly block: "start" | "center";
}

export function turnCursor(
  hits: ReadonlyArray<AgentThreadFindHit>,
  index: number,
): AgentTurnHighlightCursor | null {
  const hit = hits[index];
  if (hit === undefined) return null;

  if (hit.scope !== "turn") return null;

  let occurrence = 0;
  for (let position = 0; position < index; position += 1) {
    const other = hits[position];
    if (other === undefined) continue;
    if (other.scope !== "turn") continue;
    if (other.turnId !== hit.turnId) continue;
    if (other.eventIndex !== hit.eventIndex) continue;
    occurrence += 1;
  }

  if (hit.eventIndex === null) return { kind: "prompt", occurrence };
  return { kind: "event", eventIndex: hit.eventIndex, occurrence };
}

export function revealTarget(
  container: HTMLElement,
  reveal: AgentThreadRevealRequest | null,
  activeHit: AgentThreadFindHit | null,
): AgentRevealTarget | null {
  const current = container.querySelector<HTMLElement>(".agent-find__hit--current");
  if (current !== null) return { element: current, block: "center" };

  const turnHit = activeHit === null || activeHit.scope !== "turn" ? null : activeHit;
  const turnId = reveal?.turnId ?? turnHit?.turnId ?? null;
  if (turnId === null) {
    const imported = importedElement(container, activeHit);
    return imported === null ? null : { element: imported, block: "start" };
  }

  const turn = turnElement(container, turnId);
  if (turn === null) return null;

  const eventIndex = reveal?.eventIndex ?? turnHit?.eventIndex ?? null;
  if (eventIndex === null) return { element: turn, block: "start" };

  const event = eventElement(turn, eventIndex);
  if (event === null) return { element: turn, block: "start" };

  return { element: event, block: "start" };
}

function importedElement(
  container: HTMLElement,
  activeHit: AgentThreadFindHit | null,
): HTMLElement | null {
  if (activeHit === null) return null;
  if (activeHit.scope !== "imported") return null;

  return container.querySelector<HTMLElement>(`[data-agent-event="x${activeHit.exchangeIndex}"]`);
}

export function columnElement(
  container: HTMLElement,
  anchor: AgentThreadColumnAnchor,
): HTMLElement | null {
  const key = agentThreadColumnKey(anchor);
  const candidates = Array.from(container.querySelectorAll<HTMLElement>("[data-agent-column]"));
  return candidates.find((candidate) => candidate.dataset.agentColumn === key) ?? null;
}

export interface AgentTurnEventOffset {
  readonly turnId: string;
  readonly offset: number;
}

export function prependedTurnIds(
  previous: ReadonlyArray<AgentTurnEventOffset>,
  next: ReadonlyArray<AgentTurnEventOffset>,
): ReadonlyArray<string> {
  if (previous.length === 0) return [];
  const before = new Map(previous.map((entry) => [entry.turnId, entry.offset]));
  const shifted: string[] = [];
  for (const entry of next) {
    const was = before.get(entry.turnId);
    if (was === undefined) continue;
    if (entry.offset >= was) continue;
    shifted.push(entry.turnId);
  }
  return shifted;
}

export function turnInsertionTops(
  container: HTMLElement,
  turnIds: ReadonlyArray<string>,
): ReadonlyArray<number> | null {
  const containerTop = container.getBoundingClientRect().top;
  const tops: number[] = [];
  for (const turnId of turnIds) {
    const turn = turnElement(container, turnId);
    if (turn === null) return null;
    const events = turn.querySelector<HTMLElement>(".agent-turn__events");
    if (events === null) return null;
    tops.push(container.scrollTop + events.getBoundingClientRect().top - containerTop);
  }
  return tops;
}

function turnElement(container: HTMLElement, turnId: string): HTMLElement | null {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>("[data-agent-turn]"));
  return candidates.find((candidate) => candidate.dataset.agentTurn === turnId) ?? null;
}

function eventElement(turn: HTMLElement, eventIndex: number): HTMLElement | null {
  const key = agentTurnItemKey(eventIndex, turnEventOffset(turn));
  const candidates = Array.from(turn.querySelectorAll<HTMLElement>("[data-agent-event]"));
  return candidates.find((candidate) => candidate.dataset.agentEvent === key) ?? null;
}

function turnEventOffset(turn: HTMLElement): number {
  const raw = turn.dataset.agentTurnOffset;
  if (raw === undefined) return 0;
  return normalizeAgentTurnEventOffset(Number.parseInt(raw, 10));
}
