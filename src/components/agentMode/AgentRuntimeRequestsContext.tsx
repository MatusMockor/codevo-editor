import { createContext, useCallback, useMemo, useSyncExternalStore } from "react";
import type { AgentRuntimeRequest } from "../../domain/agentRuntimeRequest";
import type { AgentTurnEvent } from "../../domain/agentThread";
import {
  NO_AGENT_REQUEST_HISTORY,
  NO_AGENT_TURN_REQUEST_HOLDS,
  NO_AGENT_TURN_REQUEST_ROWS,
  agentTurnQuestionToolIds,
  agentTurnRequestAnchors,
  agentTurnRequestRows,
  agentTurnWorkHoldsRequest,
  sameAgentTurnRequestSlot,
  type AgentTurnRequestAnchorTool,
  type AgentTurnRequestAnchors,
  type AgentTurnRequestHolds,
  type AgentTurnRequestRows,
  type AgentTurnRequestSlot,
  type ClosedAgentRuntimeRequest,
} from "../../domain/agentTurnRequestRows";
import { agentActivityEntries } from "./agentActivityGrouping";
import { isAgentSubagentToolItem, type AgentTurnItem } from "./agentTurnProjection";

export type AgentRuntimeRequestsByTurn = ReadonlyMap<string, readonly AgentRuntimeRequest[]>;

type Listener = () => void;
type TurnEvents = ReadonlyArray<AgentTurnEvent> | null;

export interface AgentRuntimeRequestsSource {
  readonly inert: boolean;
  requestsOf(turnId: string): readonly AgentRuntimeRequest[];
  subscribe(turnId: string, listener: Listener): () => void;
}

export interface AgentRuntimeRequestsStore extends AgentRuntimeRequestsSource {
  publish(byTurn: AgentRuntimeRequestsByTurn): void;
}

export interface AgentTurnRequestsChannel {
  requests(): readonly AgentRuntimeRequest[];
  held(): AgentTurnRequestHolds;
  hold(requestId: string, slot: AgentTurnRequestSlot): void;
  release(requestId: string): void;
  subscribe(listener: Listener): () => void;
}

export interface AgentTurnRequestsScope {
  readonly channel: AgentTurnRequestsChannel;
  readonly anchors: AgentTurnRequestAnchors;
  rows(): AgentTurnRequestRows;
  workHeld(): boolean;
}

const NO_REQUESTS: readonly AgentRuntimeRequest[] = [];
const unsubscribed = (): void => undefined;
const subscribeToNothing = (): (() => void) => unsubscribed;

export const INERT_AGENT_RUNTIME_REQUESTS: AgentRuntimeRequestsSource = {
  inert: true,
  requestsOf: () => NO_REQUESTS,
  subscribe: subscribeToNothing,
};

export const AgentRuntimeRequestsContext = createContext<AgentRuntimeRequestsSource>(
  INERT_AGENT_RUNTIME_REQUESTS,
);

export const AgentTurnRequestsScopeContext = createContext<AgentTurnRequestsScope | null>(null);

export function createAgentRuntimeRequestsStore(
  initial: AgentRuntimeRequestsByTurn = new Map(),
): AgentRuntimeRequestsStore {
  let current = retained(new Map(), initial);
  const listeners = new Map<string, Set<Listener>>();
  return {
    inert: false,
    requestsOf: (turnId) => current.get(turnId) ?? NO_REQUESTS,
    subscribe(turnId, listener) {
      const known = listeners.get(turnId) ?? new Set<Listener>();
      known.add(listener);
      listeners.set(turnId, known);
      return () => {
        known.delete(listener);
        if (known.size === 0 && listeners.get(turnId) === known) listeners.delete(turnId);
      };
    },
    publish(byTurn) {
      const previous = current;
      current = retained(previous, byTurn);
      for (const turnId of new Set([...previous.keys(), ...current.keys()])) {
        if (previous.get(turnId) === current.get(turnId)) continue;
        for (const listener of [...(listeners.get(turnId) ?? [])]) listener();
      }
    },
  };
}

function retained(
  previous: AgentRuntimeRequestsByTurn,
  next: AgentRuntimeRequestsByTurn,
): AgentRuntimeRequestsByTurn {
  const kept = new Map<string, readonly AgentRuntimeRequest[]>();
  for (const [turnId, requests] of next) {
    if (requests.length === 0) continue;
    const known = previous.get(turnId);
    kept.set(turnId, known !== undefined && sameItems(known, requests) ? known : requests);
  }
  return kept;
}

function sameItems<Item>(left: readonly Item[], right: readonly Item[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function createAgentTurnRequestsChannel(
  source: AgentRuntimeRequestsSource,
  turnId: string,
): AgentTurnRequestsChannel {
  const listeners = new Set<Listener>();
  let held: AgentTurnRequestHolds = NO_AGENT_TURN_REQUEST_HOLDS;

  function publishHolds(next: Map<string, AgentTurnRequestSlot>): void {
    held = next.size === 0 ? NO_AGENT_TURN_REQUEST_HOLDS : next;
    for (const listener of [...listeners]) listener();
  }

  return {
    requests: () => source.requestsOf(turnId),
    held: () => held,
    hold(requestId, slot) {
      const known = held.get(requestId);
      if (known !== undefined && sameAgentTurnRequestSlot(known, slot)) return;
      publishHolds(new Map(held).set(requestId, slot));
    },
    release(requestId) {
      if (!held.has(requestId)) return;
      const next = new Map(held);
      next.delete(requestId);
      publishHolds(next);
    },
    subscribe(listener) {
      const stop = source.subscribe(turnId, listener);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        stop();
      };
    },
  };
}

export function createAgentTurnRequestsScope(
  channel: AgentTurnRequestsChannel,
  turnId: string,
  workItems: ReadonlyArray<AgentTurnItem> | null,
  visibleItems: ReadonlyArray<AgentTurnItem>,
  events: TurnEvents,
): AgentTurnRequestsScope {
  const anchors = agentTurnRequestAnchors(
    workItems === null ? null : anchorTools(workItems),
    anchorTools(visibleItems),
  );
  let questionTools: { readonly ids: readonly string[] | null } | null = null;
  let seen = {
    requests: NO_REQUESTS,
    held: NO_AGENT_TURN_REQUEST_HOLDS,
    rows: NO_AGENT_TURN_REQUEST_ROWS,
  };

  function questionToolIds(requests: readonly AgentRuntimeRequest[]): readonly string[] | null {
    if (events === null) return null;
    const pairs = requests.some(
      (request) => request.anchorToolId === null && request.body.kind === "question",
    );
    if (!pairs) return null;
    questionTools ??= { ids: agentTurnQuestionToolIds(events) };
    return questionTools.ids;
  }

  return {
    channel,
    anchors,
    rows() {
      const requests = channel.requests();
      const held = channel.held();
      if (requests === seen.requests && held === seen.held) return seen.rows;
      const rows = agentTurnRequestRows(
        { turnId, requests, anchors, questionToolIds: questionToolIds(requests), held },
        seen.rows,
      );
      seen = { requests, held, rows };
      return rows;
    },
    workHeld: () => agentTurnWorkHoldsRequest(anchors, channel.held()),
  };
}

function anchorTools(
  items: ReadonlyArray<AgentTurnItem>,
): ReadonlyArray<AgentTurnRequestAnchorTool> {
  if (!items.some((item) => item.kind === "tool")) return [];
  const tools: AgentTurnRequestAnchorTool[] = [];
  for (const entry of agentActivityEntries(items)) {
    if (entry.kind !== "item") continue;
    if (entry.item.kind !== "tool" || isAgentSubagentToolItem(entry.item)) continue;
    tools.push(entry.item);
  }
  return tools;
}

export function useAgentTurnRequestsScope(
  source: AgentRuntimeRequestsSource,
  turnId: string,
  workItems: ReadonlyArray<AgentTurnItem> | null,
  visibleItems: ReadonlyArray<AgentTurnItem>,
  events: ReadonlyArray<AgentTurnEvent>,
  eventsTruncated: boolean,
): AgentTurnRequestsScope | null {
  const channel = useMemo(() => createAgentTurnRequestsChannel(source, turnId), [source, turnId]);
  const active = useSyncExternalStore(
    channel.subscribe,
    useCallback(() => channel.requests().length > 0, [channel]),
  );
  const complete = eventsTruncated ? null : events;
  return useMemo(
    () =>
      active
        ? createAgentTurnRequestsScope(channel, turnId, workItems, visibleItems, complete)
        : null,
    [active, channel, complete, turnId, visibleItems, workItems],
  );
}

export function useAgentToolRequestHistory(
  scope: AgentTurnRequestsScope,
  itemKey: string,
): readonly ClosedAgentRuntimeRequest[] {
  return useSyncExternalStore(
    scope.channel.subscribe,
    useCallback(
      () => scope.rows().byAnchor.get(itemKey) ?? NO_AGENT_REQUEST_HISTORY,
      [itemKey, scope],
    ),
  );
}

export function useAgentToolOwnsQuestion(scope: AgentTurnRequestsScope, toolId: string): boolean {
  return useSyncExternalStore(
    scope.channel.subscribe,
    useCallback(() => scope.rows().questionToolIds.has(toolId), [scope, toolId]),
  );
}

export function useAgentTurnWorkHeld(scope: AgentTurnRequestsScope | null): boolean {
  return useSyncExternalStore(
    scope?.channel.subscribe ?? subscribeToNothing,
    useCallback(() => scope !== null && scope.workHeld(), [scope]),
  );
}

export function useAgentWorkRequests(
  scope: AgentTurnRequestsScope,
): readonly ClosedAgentRuntimeRequest[] {
  return useSyncExternalStore(
    scope.channel.subscribe,
    useCallback(() => scope.rows().work, [scope]),
  );
}

export function useAgentUnanchoredRequests(
  scope: AgentTurnRequestsScope,
): readonly ClosedAgentRuntimeRequest[] {
  return useSyncExternalStore(
    scope.channel.subscribe,
    useCallback(() => scope.rows().unanchored, [scope]),
  );
}
