import { AGENT_THREAD_BULK_LIMIT } from "./agentThreadBulkAction";
import type { AgentThreadSectionMove } from "./agentThreadOrganization";

export const AGENT_THREAD_UNDO_VISIBLE_MS = 5_000;
export const AGENT_THREAD_UNDO_CONFIRM_MS = 10_000;
export const AGENT_THREAD_UNDO_LIMIT = AGENT_THREAD_BULK_LIMIT;

export type AgentThreadUndoExecution =
  | { readonly kind: "local" }
  | {
      readonly kind: "remote";
      readonly serverId: string;
      readonly runnerId: string;
      readonly projectId: string;
      readonly conversationId: string;
    };

export interface AgentThreadUndoIdentity {
  readonly threadId: string;
  readonly rootKey: string;
  readonly ownerId: string;
  readonly repositoryRoot: string;
  readonly execution: AgentThreadUndoExecution;
}

export interface AgentThreadUndoPlacement {
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly snoozedUntil: number | null;
  readonly settledAt: number | null;
  readonly sortOrder: number | null;
}

export interface AgentThreadUndoSubject {
  readonly identity: AgentThreadUndoIdentity;
  readonly placement: AgentThreadUndoPlacement;
}

export type AgentThreadUndoAction =
  | { readonly kind: "unpin" }
  | { readonly kind: "settle" }
  | { readonly kind: "snooze"; readonly until: number }
  | { readonly kind: "archive" };

export type AgentThreadUndoActionKind = AgentThreadUndoAction["kind"];

export type AgentThreadUndoInverse =
  | { readonly kind: "pin"; readonly threadId: string }
  | {
      readonly kind: "unsettle";
      readonly threadId: string;
      readonly snoozedUntil: number | null;
    }
  | {
      readonly kind: "unsnooze";
      readonly threadId: string;
      readonly snoozedUntil: number | null;
      readonly settledAt: number | null;
    }
  | { readonly kind: "unarchive"; readonly threadId: string };

export interface AgentThreadUndoItem {
  readonly before: AgentThreadUndoSubject;
  readonly inverse: AgentThreadUndoInverse;
}

export interface AgentThreadUndoEntry {
  readonly id: number;
  readonly generation: number;
  readonly action: AgentThreadUndoAction;
  readonly items: ReadonlyArray<AgentThreadUndoItem>;
  readonly reselectThreadId: string | null;
}

export interface AgentThreadUndoRecord {
  readonly id: number;
  readonly generation: number;
  readonly action: AgentThreadUndoAction;
  readonly subjects: ReadonlyArray<AgentThreadUndoSubject>;
  readonly selectedThreadId: string | null;
}

export interface AgentThreadUndoOffer {
  readonly entry: AgentThreadUndoEntry;
  readonly applied: ReadonlyArray<AgentThreadUndoPlacement>;
}

export interface AgentThreadUndoState {
  readonly ownerKey: string | null;
  readonly generation: number;
  readonly awaiting: AgentThreadUndoEntry | null;
  readonly offered: AgentThreadUndoOffer | null;
  readonly restoring: AgentThreadUndoOffer | null;
}

export type AgentThreadUndoEvent =
  | { readonly kind: "recorded"; readonly entry: AgentThreadUndoEntry }
  | {
      readonly kind: "landed";
      readonly id: number;
      readonly applied: ReadonlyArray<AgentThreadUndoPlacement>;
    }
  | { readonly kind: "dropped"; readonly id: number }
  | { readonly kind: "undone"; readonly id: number }
  | { readonly kind: "restored"; readonly id: number }
  | { readonly kind: "ownerChanged"; readonly ownerKey: string | null };

export type AgentThreadUndoObservation =
  | { readonly kind: "pending" }
  | { readonly kind: "diverged" }
  | { readonly kind: "landed"; readonly applied: ReadonlyArray<AgentThreadUndoPlacement> };

export type AgentThreadUndoLookup = (threadId: string) => AgentThreadUndoSubject | null;

export function idleAgentThreadUndoState(ownerKey: string | null): AgentThreadUndoState {
  return { ownerKey, generation: 0, awaiting: null, offered: null, restoring: null };
}

export function agentThreadUndoEntry(record: AgentThreadUndoRecord): AgentThreadUndoEntry | null {
  if (record.subjects.length > AGENT_THREAD_UNDO_LIMIT) return null;
  const seen = new Set<string>();
  const items: AgentThreadUndoItem[] = [];
  for (const subject of record.subjects) {
    if (seen.has(subject.identity.threadId)) continue;
    seen.add(subject.identity.threadId);
    if (forwardLanded(record.action, subject.placement, subject.placement)) continue;
    items.push({ before: subject, inverse: inverseOf(record.action, subject) });
  }
  if (items.length === 0) return null;
  return {
    id: record.id,
    generation: record.generation,
    action: record.action,
    items,
    reselectThreadId: reselectTarget(record, items),
  };
}

export function agentThreadSectionUndoAction(
  moves: ReadonlyArray<AgentThreadSectionMove>,
): AgentThreadUndoAction | null {
  if (moves.length !== 1) return null;
  const move = moves[0];
  if (move === "togglePin") return { kind: "unpin" };
  if (move === "settle") return { kind: "settle" };
  return null;
}

export function sameAgentThreadUndoIdentity(
  left: AgentThreadUndoIdentity,
  right: AgentThreadUndoIdentity,
): boolean {
  return (
    left.threadId === right.threadId &&
    left.rootKey === right.rootKey &&
    left.ownerId === right.ownerId &&
    left.repositoryRoot === right.repositoryRoot &&
    sameExecution(left.execution, right.execution)
  );
}

export function sameAgentThreadUndoPlacement(
  left: AgentThreadUndoPlacement,
  right: AgentThreadUndoPlacement,
): boolean {
  return (
    left.pinned === right.pinned &&
    left.archived === right.archived &&
    left.snoozedUntil === right.snoozedUntil &&
    left.settledAt === right.settledAt &&
    left.sortOrder === right.sortOrder
  );
}

export function agentThreadUndoObservation(
  entry: AgentThreadUndoEntry,
  lookup: AgentThreadUndoLookup,
): AgentThreadUndoObservation {
  const applied: AgentThreadUndoPlacement[] = [];
  let waiting = false;
  for (const item of entry.items) {
    const current = currentSubject(item, lookup);
    if (current === null) return { kind: "diverged" };
    if (sameAgentThreadUndoPlacement(current.placement, item.before.placement)) {
      waiting = true;
      continue;
    }
    if (!forwardLanded(entry.action, item.before.placement, current.placement)) {
      return { kind: "diverged" };
    }
    applied.push(current.placement);
  }
  if (waiting) return { kind: "pending" };
  return { kind: "landed", applied };
}

export function agentThreadUndoItemApplied(
  offer: AgentThreadUndoOffer,
  index: number,
  lookup: AgentThreadUndoLookup,
): boolean {
  const item = offer.entry.items[index];
  const applied = offer.applied[index];
  if (item === undefined || applied === undefined) return false;
  const current = currentSubject(item, lookup);
  if (current === null) return false;
  return sameAgentThreadUndoPlacement(current.placement, applied);
}

export function agentThreadUndoOfferValid(
  offer: AgentThreadUndoOffer,
  lookup: AgentThreadUndoLookup,
): boolean {
  if (offer.applied.length !== offer.entry.items.length) return false;
  return offer.entry.items.every((_item, index) =>
    agentThreadUndoItemApplied(offer, index, lookup),
  );
}

export function agentThreadUndoUnrestoredIds(
  entry: AgentThreadUndoEntry,
  lookup: AgentThreadUndoLookup,
): ReadonlyArray<string> {
  const unrestored: string[] = [];
  for (const item of entry.items) {
    const current = currentSubject(item, lookup);
    if (current !== null && sameAgentThreadUndoPlacement(current.placement, item.before.placement))
      continue;
    unrestored.push(item.before.identity.threadId);
  }
  return unrestored;
}

export function agentThreadUndoReduce(
  state: AgentThreadUndoState,
  event: AgentThreadUndoEvent,
): AgentThreadUndoState {
  switch (event.kind) {
    case "recorded":
      if (event.entry.generation !== state.generation) return state;
      return { ...state, awaiting: event.entry };
    case "landed":
      return landed(state, event.id, event.applied);
    case "dropped":
      return dropped(state, event.id);
    case "undone":
      return undone(state, event.id);
    case "restored":
      if (state.restoring?.entry.id !== event.id) return state;
      return { ...state, restoring: null };
    case "ownerChanged":
      if (state.ownerKey === event.ownerKey) return state;
      return {
        ownerKey: event.ownerKey,
        generation: state.generation + 1,
        awaiting: null,
        offered: null,
        restoring: null,
      };
    default:
      return unsupportedEvent(event);
  }
}

export function agentThreadUndoMessage(kind: AgentThreadUndoActionKind, count: number): string {
  const subject = count === 1 ? "Thread" : `${count} threads`;
  return `${subject} ${pastTense(kind)}`;
}

export function agentThreadUndoFailureMessage(unrestored: number, total: number): string {
  if (total === 1) return "Undo failed. The thread was not restored.";
  return `Undo failed. ${unrestored} of ${total} threads were not restored.`;
}

function landed(
  state: AgentThreadUndoState,
  id: number,
  applied: ReadonlyArray<AgentThreadUndoPlacement>,
): AgentThreadUndoState {
  const entry = state.awaiting;
  if (entry === null || entry.id !== id) return state;
  if (applied.length !== entry.items.length) return { ...state, awaiting: null };
  return { ...state, awaiting: null, offered: { entry, applied } };
}

function dropped(state: AgentThreadUndoState, id: number): AgentThreadUndoState {
  if (state.awaiting?.id === id) return { ...state, awaiting: null };
  if (state.offered?.entry.id === id) return { ...state, offered: null };
  return state;
}

function undone(state: AgentThreadUndoState, id: number): AgentThreadUndoState {
  const offer = state.offered;
  if (offer === null || offer.entry.id !== id) return state;
  if (state.restoring !== null) return state;
  return { ...state, offered: null, restoring: offer };
}

function currentSubject(
  item: AgentThreadUndoItem,
  lookup: AgentThreadUndoLookup,
): AgentThreadUndoSubject | null {
  const current = lookup(item.before.identity.threadId);
  if (current === null) return null;
  if (!sameAgentThreadUndoIdentity(current.identity, item.before.identity)) return null;
  return current;
}

function forwardLanded(
  action: AgentThreadUndoAction,
  before: AgentThreadUndoPlacement,
  current: AgentThreadUndoPlacement,
): boolean {
  switch (action.kind) {
    case "unpin":
      return sameAgentThreadUndoPlacement(current, { ...before, pinned: false });
    case "settle":
      return (
        current.settledAt !== null &&
        sameAgentThreadUndoPlacement(
          { ...current, settledAt: null },
          { ...before, settledAt: null, snoozedUntil: null },
        )
      );
    case "snooze":
      return sameAgentThreadUndoPlacement(current, {
        ...before,
        snoozedUntil: action.until,
        settledAt: null,
      });
    case "archive":
      return sameAgentThreadUndoPlacement(current, { ...before, archived: true });
    default:
      return unsupportedAction(action);
  }
}

function inverseOf(
  action: AgentThreadUndoAction,
  subject: AgentThreadUndoSubject,
): AgentThreadUndoInverse {
  const threadId = subject.identity.threadId;
  const before = subject.placement;
  switch (action.kind) {
    case "unpin":
      return { kind: "pin", threadId };
    case "settle":
      return { kind: "unsettle", threadId, snoozedUntil: before.snoozedUntil };
    case "snooze":
      return {
        kind: "unsnooze",
        threadId,
        snoozedUntil: before.snoozedUntil,
        settledAt: before.settledAt,
      };
    case "archive":
      return { kind: "unarchive", threadId };
    default:
      return unsupportedAction(action);
  }
}

function reselectTarget(
  record: AgentThreadUndoRecord,
  items: ReadonlyArray<AgentThreadUndoItem>,
): string | null {
  if (record.action.kind !== "archive") return null;
  const selected = record.selectedThreadId;
  if (selected === null) return null;
  if (!items.some((item) => item.before.identity.threadId === selected)) return null;
  return selected;
}

function sameExecution(left: AgentThreadUndoExecution, right: AgentThreadUndoExecution): boolean {
  if (left.kind === "local" || right.kind === "local") return left.kind === right.kind;
  return (
    left.serverId === right.serverId &&
    left.runnerId === right.runnerId &&
    left.projectId === right.projectId &&
    left.conversationId === right.conversationId
  );
}

function pastTense(kind: AgentThreadUndoActionKind): string {
  switch (kind) {
    case "unpin":
      return "unpinned";
    case "settle":
      return "settled";
    case "snooze":
      return "snoozed";
    case "archive":
      return "archived";
    default:
      return unsupportedKind(kind);
  }
}

function unsupportedAction(action: never): never {
  throw new TypeError(`Unsupported agent thread undo action: ${JSON.stringify(action)}.`);
}

function unsupportedKind(kind: never): never {
  throw new TypeError(`Unsupported agent thread undo action kind: ${String(kind)}.`);
}

function unsupportedEvent(event: never): never {
  throw new TypeError(`Unsupported agent thread undo event: ${JSON.stringify(event)}.`);
}
