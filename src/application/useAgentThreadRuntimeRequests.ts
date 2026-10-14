import { useEffect, useMemo, useState } from "react";
import type { AgentRuntimeRequest, AgentThreadRequestsState } from "../domain/agentRuntimeRequest";
import type { AgentThreadRequestFeed, AgentThreadRequestScope } from "./agentThreadRequestPorts";
import {
  MAX_AGENT_THREAD_REQUEST_TURN_IDS,
  agentThreadRequestStore,
  type AgentThreadRequestObservation,
} from "./agentThreadRequestStore";

export type AgentRuntimeRequestsByTurnId = ReadonlyMap<string, readonly AgentRuntimeRequest[]>;

export interface AgentThreadRequestGaps {
  readonly incomplete: boolean;
  readonly unsaved: boolean;
}

export interface AgentThreadRequestClosure {
  readonly closed: readonly AgentRuntimeRequest[];
  readonly listedTurnIds: ReadonlySet<string>;
}

export interface AgentThreadRuntimeRequests {
  readonly byTurn: AgentRuntimeRequestsByTurnId;
  readonly uncoveredTurnIds: ReadonlySet<string>;
  readonly coveredTurnIds: ReadonlySet<string>;
  readonly gaps: AgentThreadRequestGaps;
  readonly open: readonly AgentRuntimeRequest[];
  readonly closure: AgentThreadRequestClosure;
}

interface Watched {
  readonly feed: AgentThreadRequestFeed | null;
  readonly key: string | null;
  readonly byTurn: AgentRuntimeRequestsByTurnId;
  readonly covered: ReadonlySet<string>;
  readonly gaps: AgentThreadRequestGaps;
  readonly open: readonly AgentRuntimeRequest[];
  readonly closed: readonly AgentRuntimeRequest[];
  readonly listed: ReadonlySet<string>;
}

const TURN_SEPARATOR = "\u0001";
const NO_REQUESTS_BY_TURN: AgentRuntimeRequestsByTurnId = new Map();
const NO_TURN_IDS: ReadonlySet<string> = new Set();
const NO_REQUESTS: readonly AgentRuntimeRequest[] = Object.freeze([]);
const UNSAVED: AgentThreadRequestGaps = { incomplete: false, unsaved: true };
const INCOMPLETE: AgentThreadRequestGaps = { incomplete: true, unsaved: false };
const INCOMPLETE_AND_UNSAVED: AgentThreadRequestGaps = { incomplete: true, unsaved: true };

export const NO_AGENT_THREAD_REQUEST_GAPS: AgentThreadRequestGaps = {
  incomplete: false,
  unsaved: false,
};

const NOTHING_WATCHED: Watched = {
  feed: null,
  key: null,
  byTurn: NO_REQUESTS_BY_TURN,
  covered: NO_TURN_IDS,
  gaps: NO_AGENT_THREAD_REQUEST_GAPS,
  open: NO_REQUESTS,
  closed: NO_REQUESTS,
  listed: NO_TURN_IDS,
};

export function useAgentThreadRuntimeRequests(
  feed: AgentThreadRequestFeed | null,
  scope: AgentThreadRequestScope | null,
  turnIds: readonly string[],
): AgentThreadRuntimeRequests {
  const rootKey = scope?.rootKey ?? null;
  const ownerId = scope?.ownerId ?? null;
  const threadId = scope?.threadId ?? null;
  const workspaceId = scope?.workspaceId ?? null;
  const key = watchKey(feed, rootKey, ownerId, threadId, workspaceId);
  const signature = turnIds.join(TURN_SEPARATOR);
  const [watched, setWatched] = useState(NOTHING_WATCHED);

  useEffect(() => {
    if (feed === null || key === null) return undefined;
    if (rootKey === null || ownerId === null || threadId === null) return undefined;
    const requested = signature === "" ? [] : signature.split(TURN_SEPARATOR);
    const asked = requested.slice(-MAX_AGENT_THREAD_REQUEST_TURN_IDS);
    let live = true;
    const release = agentThreadRequestStore(feed).watch(
      { rootKey, ownerId, threadId, workspaceId },
      asked,
      (observation) => {
        if (!live) return;
        setWatched((previous) => observed(previous, feed, key, asked, observation));
      },
    );
    return () => {
      live = false;
      release();
    };
  }, [feed, key, ownerId, rootKey, signature, threadId, workspaceId]);

  const owned = watched.feed === feed && watched.key === key && key !== null;
  const byTurn = owned ? watched.byTurn : NO_REQUESTS_BY_TURN;
  const covered = owned ? watched.covered : NO_TURN_IDS;
  const gaps = owned ? watched.gaps : NO_AGENT_THREAD_REQUEST_GAPS;
  const open = owned ? watched.open : NO_REQUESTS;
  const closed = owned ? watched.closed : NO_REQUESTS;
  const listedTurnIds = owned ? watched.listed : NO_TURN_IDS;
  const uncoveredTurnIds = useMemo(
    () => uncovered(signature === "" ? [] : signature.split(TURN_SEPARATOR), covered),
    [covered, signature],
  );
  const closure = useMemo(() => ({ closed, listedTurnIds }), [closed, listedTurnIds]);
  return useMemo(
    () => ({ byTurn, uncoveredTurnIds, coveredTurnIds: covered, gaps, open, closure }),
    [byTurn, closure, covered, gaps, open, uncoveredTurnIds],
  );
}

function watchKey(
  feed: AgentThreadRequestFeed | null,
  rootKey: string | null,
  ownerId: string | null,
  threadId: string | null,
  workspaceId: string | null,
): string | null {
  if (feed === null || rootKey === null || ownerId === null || threadId === null) return null;
  return JSON.stringify([rootKey, ownerId, threadId, workspaceId]);
}

function observed(
  previous: Watched,
  feed: AgentThreadRequestFeed,
  key: string,
  asked: readonly string[],
  observation: AgentThreadRequestObservation,
): Watched {
  const known = previous.feed === feed && previous.key === key ? previous : null;
  const kind = observation.kind;
  switch (kind) {
    case "pending":
    case "unavailable":
      return settled(known, {
        feed,
        key,
        byTurn: NO_REQUESTS_BY_TURN,
        covered: NO_TURN_IDS,
        gaps: NO_AGENT_THREAD_REQUEST_GAPS,
        open: NO_REQUESTS,
        closed: NO_REQUESTS,
        listed: NO_TURN_IDS,
      });
    case "observed": {
      const waiting = new Set(observation.pendingTurnIds);
      const covered = new Set(asked.filter((turnId) => !waiting.has(turnId)));
      return settled(known, {
        feed,
        key,
        byTurn: grouped(observation.state.requests, covered),
        covered,
        gaps: gapsOf(observation.state),
        open: openRequests(observation.state.requests, new Set(asked)),
        closed: closedRequests(observation.state.requests),
        listed: completelyListed(observation.state) ? covered : NO_TURN_IDS,
      });
    }
    default:
      return unsupportedObservation(kind);
  }
}

function settled(known: Watched | null, next: Watched): Watched {
  if (known === null) return { ...next, byTurn: sharedMap(null, next.byTurn) };
  const byTurn = sharedMap(known.byTurn, next.byTurn);
  const covered = sameSet(known.covered, next.covered) ? known.covered : next.covered;
  const open = sameItems(known.open, next.open) ? known.open : next.open;
  const closed = sameItems(known.closed, next.closed) ? known.closed : next.closed;
  const listed = sameSet(known.listed, next.listed) ? known.listed : next.listed;
  if (
    byTurn === known.byTurn &&
    covered === known.covered &&
    next.gaps === known.gaps &&
    open === known.open &&
    closed === known.closed &&
    listed === known.listed
  )
    return known;
  return { ...next, byTurn, covered, open, closed, listed };
}

function openRequests(
  requests: readonly AgentRuntimeRequest[],
  asked: ReadonlySet<string>,
): readonly AgentRuntimeRequest[] {
  const open = requests.filter(
    (request) =>
      asked.has(request.turnId) &&
      (request.status === "pending" || request.status === "submitting"),
  );
  return open.length === 0 ? NO_REQUESTS : open;
}

function closedRequests(requests: readonly AgentRuntimeRequest[]): readonly AgentRuntimeRequest[] {
  const closed = requests.filter(
    (request) => request.status !== "pending" && request.status !== "submitting",
  );
  return closed.length === 0 ? NO_REQUESTS : closed;
}

function completelyListed(state: AgentThreadRequestsState): boolean {
  return !state.truncated && state.unreadable === 0;
}

function gapsOf(state: AgentThreadRequestsState): AgentThreadRequestGaps {
  const incomplete = state.truncated || state.unreadable > 0;
  const unsaved = state.journal === "degraded";
  if (incomplete && unsaved) return INCOMPLETE_AND_UNSAVED;
  if (incomplete) return INCOMPLETE;
  if (unsaved) return UNSAVED;
  return NO_AGENT_THREAD_REQUEST_GAPS;
}

function grouped(
  requests: readonly AgentRuntimeRequest[],
  covered: ReadonlySet<string>,
): AgentRuntimeRequestsByTurnId {
  const byTurn = new Map<string, AgentRuntimeRequest[]>();
  for (const request of requests) {
    if (!covered.has(request.turnId)) continue;
    const known = byTurn.get(request.turnId);
    if (known !== undefined) known.push(request);
    if (known === undefined) byTurn.set(request.turnId, [request]);
  }
  return byTurn;
}

function sharedMap(
  previous: AgentRuntimeRequestsByTurnId | null,
  next: AgentRuntimeRequestsByTurnId,
): AgentRuntimeRequestsByTurnId {
  if (next.size === 0) return NO_REQUESTS_BY_TURN;
  if (previous === null) return next;
  const shared = new Map<string, readonly AgentRuntimeRequest[]>();
  let unchanged = previous.size === next.size;
  for (const [turnId, requests] of next) {
    const known = previous.get(turnId);
    const kept = known !== undefined && sameItems(known, requests) ? known : requests;
    if (kept !== known) unchanged = false;
    shared.set(turnId, kept);
  }
  return unchanged ? previous : shared;
}

function uncovered(turnIds: readonly string[], covered: ReadonlySet<string>): ReadonlySet<string> {
  const missing = turnIds.filter((turnId) => !covered.has(turnId));
  return missing.length === 0 ? NO_TURN_IDS : new Set(missing);
}

function sameItems<Item>(left: readonly Item[], right: readonly Item[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}

function unsupportedObservation(kind: never): never {
  throw new TypeError(`Unsupported agent thread request observation: ${String(kind)}.`);
}
