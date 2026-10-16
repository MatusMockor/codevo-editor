import { isAgentQuestionTool } from "./agentQuestionTranscript";
import type { AgentRuntimeRequest } from "./agentRuntimeRequest";

export type ClosedAgentRuntimeRequest = Exclude<
  AgentRuntimeRequest,
  { readonly status: "pending" | "submitting" }
>;

export interface AgentTurnRequestAnchorTool {
  readonly key: string;
  readonly toolId: string;
}

export interface AgentTurnRequestAnchors {
  readonly keyByToolId: ReadonlyMap<string, string>;
  readonly visibleKeyByToolId: ReadonlyMap<string, string>;
  readonly toolIdByKey: ReadonlyMap<string, string>;
  readonly workKeys: ReadonlySet<string>;
  readonly hasWork: boolean;
}

export type AgentTurnRequestSlot =
  | { readonly kind: "anchor"; readonly key: string }
  | { readonly kind: "work" }
  | { readonly kind: "unanchored" };

export type AgentTurnRequestHolds = ReadonlyMap<string, AgentTurnRequestSlot>;

export interface AgentTurnToolCall {
  readonly kind: string;
  readonly toolId?: string;
  readonly name?: string;
}

export interface AgentTurnRequestRows {
  readonly byAnchor: ReadonlyMap<string, readonly ClosedAgentRuntimeRequest[]>;
  readonly questionToolIds: ReadonlySet<string>;
  readonly work: readonly ClosedAgentRuntimeRequest[];
  readonly unanchored: readonly ClosedAgentRuntimeRequest[];
}

export interface AgentTurnRequestRowsSource {
  readonly turnId: string;
  readonly requests: readonly AgentRuntimeRequest[];
  readonly anchors: AgentTurnRequestAnchors;
  readonly questionToolIds: readonly string[] | null;
  readonly held: AgentTurnRequestHolds;
}

export const NO_AGENT_REQUEST_HISTORY: readonly ClosedAgentRuntimeRequest[] = [];

export const AGENT_REQUEST_WORK_SLOT: AgentTurnRequestSlot = { kind: "work" };

export const AGENT_REQUEST_UNANCHORED_SLOT: AgentTurnRequestSlot = { kind: "unanchored" };

export const NO_AGENT_TURN_REQUEST_HOLDS: AgentTurnRequestHolds = new Map();

export const NO_AGENT_TURN_REQUEST_ROWS: AgentTurnRequestRows = {
  byAnchor: new Map(),
  questionToolIds: new Set(),
  work: NO_AGENT_REQUEST_HISTORY,
  unanchored: NO_AGENT_REQUEST_HISTORY,
};

export function isClosedAgentRuntimeRequest(
  request: AgentRuntimeRequest,
): request is ClosedAgentRuntimeRequest {
  const status = request.status;
  switch (status) {
    case "pending":
    case "submitting":
      return false;
    case "resolved":
    case "cancelled":
    case "expired":
    case "timedOut":
      return true;
    default:
      return unsupportedStatus(status);
  }
}

export function agentTurnQuestionToolIds(
  events: ReadonlyArray<AgentTurnToolCall>,
): readonly string[] {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.kind !== "toolCall" || event.toolId === undefined) continue;
    if (event.name === undefined || !isAgentQuestionTool(event.name)) continue;
    ids.add(event.toolId);
  }
  return [...ids];
}

export function agentTurnRequestAnchors(
  workTools: ReadonlyArray<AgentTurnRequestAnchorTool> | null,
  visibleTools: ReadonlyArray<AgentTurnRequestAnchorTool>,
): AgentTurnRequestAnchors {
  const keyByToolId = new Map<string, string>();
  const visibleKeyByToolId = new Map<string, string>();
  const toolIdByKey = new Map<string, string>();
  const workKeys = new Set<string>();
  for (const tool of workTools ?? []) {
    if (keyByToolId.has(tool.toolId) || toolIdByKey.has(tool.key)) continue;
    keyByToolId.set(tool.toolId, tool.key);
    toolIdByKey.set(tool.key, tool.toolId);
    workKeys.add(tool.key);
  }
  for (const tool of visibleTools) {
    if (visibleKeyByToolId.has(tool.toolId) || toolIdByKey.has(tool.key)) continue;
    visibleKeyByToolId.set(tool.toolId, tool.key);
    toolIdByKey.set(tool.key, tool.toolId);
    if (!keyByToolId.has(tool.toolId)) keyByToolId.set(tool.toolId, tool.key);
  }
  return { keyByToolId, visibleKeyByToolId, toolIdByKey, workKeys, hasWork: workTools !== null };
}

export function agentTurnWorkHoldsRequest(
  anchors: AgentTurnRequestAnchors,
  held: AgentTurnRequestHolds,
): boolean {
  for (const slot of held.values()) {
    if (slot.kind === "work" && anchors.hasWork) return true;
    if (slot.kind === "anchor" && anchors.workKeys.has(slot.key)) return true;
  }
  return false;
}

export function sameAgentTurnRequestSlot(
  left: AgentTurnRequestSlot,
  right: AgentTurnRequestSlot,
): boolean {
  if (left.kind === "anchor" && right.kind === "anchor") return left.key === right.key;
  return left.kind === right.kind;
}

export function agentTurnRequestRows(
  source: AgentTurnRequestRowsSource,
  previous: AgentTurnRequestRows = NO_AGENT_TURN_REQUEST_ROWS,
): AgentTurnRequestRows {
  if (source.requests.length === 0) return NO_AGENT_TURN_REQUEST_ROWS;
  const owned = source.requests
    .filter((request) => request.turnId === source.turnId)
    .sort(compareRequests);
  const targets = requestTargets(owned, source.questionToolIds);
  const byAnchor = new Map<string, ClosedAgentRuntimeRequest[]>();
  const work: ClosedAgentRuntimeRequest[] = [];
  const unanchored: ClosedAgentRuntimeRequest[] = [];
  for (const request of owned) {
    if (!isClosedAgentRuntimeRequest(request)) continue;
    const slot = requestSlot(source, request, targets.get(request));
    switch (slot.kind) {
      case "anchor":
        byAnchor.set(slot.key, [...(byAnchor.get(slot.key) ?? []), request]);
        break;
      case "work":
        work.push(request);
        break;
      case "unanchored":
        unanchored.push(request);
        break;
      default:
        return unsupportedSlot(slot);
    }
  }
  return shared(
    { byAnchor, questionToolIds: questionOwners(owned, targets), work, unanchored },
    previous,
  );
}

function requestSlot(
  source: AgentTurnRequestRowsSource,
  request: ClosedAgentRuntimeRequest,
  toolId: string | undefined,
): AgentTurnRequestSlot {
  const held = source.held.get(request.id);
  if (held !== undefined && slotExists(source.anchors, held)) return held;
  const resolved = request.status === "resolved";
  const rows = resolved ? source.anchors.keyByToolId : source.anchors.visibleKeyByToolId;
  const key = toolId === undefined ? undefined : rows.get(toolId);
  if (key !== undefined) return { kind: "anchor", key };
  if (resolved && source.anchors.hasWork) return AGENT_REQUEST_WORK_SLOT;
  return AGENT_REQUEST_UNANCHORED_SLOT;
}

function slotExists(anchors: AgentTurnRequestAnchors, slot: AgentTurnRequestSlot): boolean {
  switch (slot.kind) {
    case "anchor":
      return anchors.toolIdByKey.has(slot.key);
    case "work":
      return anchors.hasWork;
    case "unanchored":
      return true;
    default:
      return unsupportedSlot(slot);
  }
}

function requestTargets(
  owned: readonly AgentRuntimeRequest[],
  questionToolIds: readonly string[] | null,
): ReadonlyMap<AgentRuntimeRequest, string> {
  const targets = new Map<AgentRuntimeRequest, string>();
  for (const request of owned) {
    if (request.anchorToolId !== null) targets.set(request, request.anchorToolId);
  }
  if (questionToolIds === null) return targets;
  const loose = owned.filter(
    (request) => request.anchorToolId === null && request.body.kind === "question",
  );
  if (loose.length === 0) return targets;
  const claimed = new Set(
    owned
      .filter((request) => request.body.kind === "question" && request.anchorToolId !== null)
      .map((request) => request.anchorToolId),
  );
  const free = [...new Set(questionToolIds)].filter((toolId) => !claimed.has(toolId));
  if (free.length !== loose.length) return targets;
  loose.forEach((request, index) => {
    const toolId = free[index];
    if (toolId !== undefined) targets.set(request, toolId);
  });
  return targets;
}

function questionOwners(
  owned: readonly AgentRuntimeRequest[],
  targets: ReadonlyMap<AgentRuntimeRequest, string>,
): ReadonlySet<string> {
  const owners = new Set<string>();
  for (const request of owned) {
    const toolId = targets.get(request);
    if (toolId !== undefined && request.body.kind === "question") owners.add(toolId);
  }
  return owners;
}

function shared(next: AgentTurnRequestRows, previous: AgentTurnRequestRows): AgentTurnRequestRows {
  const byAnchor = new Map<string, readonly ClosedAgentRuntimeRequest[]>();
  for (const [key, history] of next.byAnchor) {
    byAnchor.set(key, sameOr(previous.byAnchor.get(key), history));
  }
  const unanchored = sameOr(previous.unanchored, next.unanchored);
  const work = sameOr(previous.work, next.work);
  const questionToolIds = sameSet(previous.questionToolIds, next.questionToolIds)
    ? previous.questionToolIds
    : next.questionToolIds;
  const unchanged =
    unanchored === previous.unanchored &&
    work === previous.work &&
    questionToolIds === previous.questionToolIds &&
    byAnchor.size === previous.byAnchor.size &&
    [...byAnchor].every(([key, history]) => previous.byAnchor.get(key) === history);
  if (unchanged) return previous;
  const empty = byAnchor.size + unanchored.length + work.length + questionToolIds.size === 0;
  if (empty) return NO_AGENT_TURN_REQUEST_ROWS;
  return { byAnchor, questionToolIds, work, unanchored };
}

function sameOr<Item>(
  previous: readonly Item[] | undefined,
  next: readonly Item[],
): readonly Item[] {
  if (previous === undefined || previous.length !== next.length) return next;
  return previous.every((item, index) => item === next[index]) ? previous : next;
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}

function compareRequests(left: AgentRuntimeRequest, right: AgentRuntimeRequest): number {
  if (left.order !== right.order) return left.order - right.order;
  if (left.createdAtEpochMs !== right.createdAtEpochMs)
    return left.createdAtEpochMs - right.createdAtEpochMs;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function unsupportedSlot(slot: never): never {
  throw new TypeError(`Unsupported agent runtime request slot: ${JSON.stringify(slot)}.`);
}

function unsupportedStatus(status: never): never {
  throw new TypeError(`Unsupported agent runtime request status: ${String(status)}.`);
}
