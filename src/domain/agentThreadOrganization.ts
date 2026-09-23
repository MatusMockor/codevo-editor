import type { AgentThread, AgentThreadOwner, AgentThreadsState } from "./agentThread";
import { runningTurn } from "./agentThread";

export interface AgentThreadOrganizationPatch {
  readonly snoozedUntil?: number | null;
  readonly settledAt?: number | null;
  readonly sortOrder?: number | null;
}
export type AgentThreadDropSection = "pinned" | "active" | "settled";
export type AgentThreadPlacement = "before" | "after";
export const MAX_THREAD_ORGANIZATION_VALUE = 8_640_000_000_000_000;

export function validThreadOrganizationValue(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= MAX_THREAD_ORGANIZATION_VALUE)
  );
}

export function validThreadSortOrder(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      Math.abs(value) <= Number.MAX_SAFE_INTEGER)
  );
}

export function compareAgentThreadOrder(left: AgentThread, right: AgentThread): number {
  const leftManual = left.sortOrder != null;
  const rightManual = right.sortOrder != null;
  if (leftManual !== rightManual) return leftManual ? 1 : -1;
  return (
    (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
    right.updatedAtEpochMs - left.updatedAtEpochMs ||
    left.threadId.localeCompare(right.threadId)
  );
}

export function sameThreadOrganizationOwner(
  left: AgentThreadOwner,
  right: AgentThreadOwner,
): boolean {
  return (
    left.rootKey === right.rootKey &&
    left.ownerId === right.ownerId &&
    left.repositoryRoot === right.repositoryRoot
  );
}

export function updateAgentThreadOrganization(
  state: AgentThreadsState,
  threadId: string,
  owner: AgentThreadOwner,
  patch: AgentThreadOrganizationPatch,
): AgentThreadsState {
  const thread = state.threads.get(threadId);
  if (thread === undefined || !sameThreadOrganizationOwner(thread.owner, owner)) return state;
  const keys = Object.keys(patch);
  if (
    keys.length === 0 ||
    keys.some((key) => !["snoozedUntil", "settledAt", "sortOrder"].includes(key))
  )
    return state;
  if (
    (Object.prototype.hasOwnProperty.call(patch, "sortOrder") &&
      !validThreadSortOrder(patch.sortOrder)) ||
    ["snoozedUntil", "settledAt"].some(
      (key) =>
        Object.prototype.hasOwnProperty.call(patch, key) &&
        !validThreadOrganizationValue(patch[key as "snoozedUntil" | "settledAt"]),
    )
  )
    return state;
  if (patch.settledAt != null && runningTurn(thread) !== null) return state;
  const next = { ...thread, ...patch };
  if (next.settledAt != null && next.snoozedUntil != null) return state;
  if (
    next.snoozedUntil === thread.snoozedUntil &&
    next.settledAt === thread.settledAt &&
    next.sortOrder === thread.sortOrder
  )
    return state;
  const threads = new Map(state.threads);
  threads.set(threadId, next);
  return { threads };
}

export function agentThreadReorderPlan(
  threads: ReadonlyArray<AgentThread>,
  threadId: string,
  targetThreadId: string,
  placement: AgentThreadPlacement,
  now: number,
): ReadonlyArray<AgentThreadSortOrderAssignment> {
  if (
    threadId === targetThreadId ||
    !validThreadOrganizationValue(now) ||
    (placement !== "before" && placement !== "after")
  )
    return [];
  const moved = threads.find((thread) => thread.threadId === threadId);
  const target = threads.find((thread) => thread.threadId === targetThreadId);
  if (
    moved === undefined ||
    target === undefined ||
    !sameThreadOrganizationOwner(moved.owner, target.owner) ||
    section(moved, now) !== section(target, now)
  )
    return [];
  const remaining = threads
    .filter(
      (thread) =>
        thread.threadId !== threadId &&
        sameThreadOrganizationOwner(thread.owner, moved.owner) &&
        section(thread, now) === section(moved, now),
    )
    .sort(compareAgentThreadOrder);
  const position =
    remaining.findIndex((thread) => thread.threadId === targetThreadId) +
    (placement === "after" ? 1 : 0);
  const ordered = [...remaining.slice(0, position), moved, ...remaining.slice(position)];
  return minimalSortOrderPlan(ordered, position);
}

export interface AgentThreadSortOrderAssignment {
  readonly threadId: string;
  readonly sortOrder: number;
}

function minimalSortOrderPlan(
  ordered: ReadonlyArray<AgentThread>,
  position: number,
): ReadonlyArray<AgentThreadSortOrderAssignment> {
  const moved = ordered[position];
  const next = ordered[position + 1];
  if (moved === undefined) return [];
  if (next !== undefined && next.sortOrder == null) return numberThrough(ordered, position);
  const value = sortOrderBetween(ordered[position - 1]?.sortOrder ?? null, next?.sortOrder ?? null);
  if (value === null) return renumberFrom(ordered, position);
  return [{ threadId: moved.threadId, sortOrder: value }];
}

function numberThrough(
  ordered: ReadonlyArray<AgentThread>,
  position: number,
): ReadonlyArray<AgentThreadSortOrderAssignment> {
  const firstManual = ordered.findIndex(
    (thread, index) => index > position && thread.sortOrder != null,
  );
  const end = firstManual === -1 ? ordered.length : firstManual;
  const count = end - position;
  const base = firstManual === -1 ? count : (ordered[firstManual]?.sortOrder ?? count);
  const assignments = ordered.slice(position, end).map((thread, index) => ({
    threadId: thread.threadId,
    sortOrder: base - count + index,
  }));
  if (assignments.every((assignment) => validThreadSortOrder(assignment.sortOrder)))
    return assignments;
  return renumberFrom(ordered, position);
}

function renumberFrom(
  ordered: ReadonlyArray<AgentThread>,
  position: number,
): ReadonlyArray<AgentThreadSortOrderAssignment> {
  const firstManual = ordered.findIndex((thread) => thread.sortOrder != null);
  const start = firstManual === -1 ? position : Math.min(position, firstManual);
  return ordered
    .slice(start)
    .map((thread, index) => ({ threadId: thread.threadId, sortOrder: index }));
}

function sortOrderBetween(previous: number | null, next: number | null): number | null {
  if (previous === null && next === null) return 0;
  if (previous === null) return validSortOrderOrNull((next ?? 0) - 1);
  if (next === null) return validSortOrderOrNull(previous + 1);
  const integer = Math.floor(previous / 2 + next / 2);
  if (integer > previous && integer < next) return integer;
  const fraction = previous + (next - previous) / 2;
  if (fraction > previous && fraction < next) return validSortOrderOrNull(fraction);
  return null;
}

function validSortOrderOrNull(value: number): number | null {
  if (!validThreadSortOrder(value)) return null;
  return value;
}

function section(thread: AgentThread, now: number): string {
  if (thread.archived) return "archived";
  if (thread.settledAt != null) return "settled";
  if ((thread.snoozedUntil ?? 0) > now) return "snoozed";
  return thread.pinned ? "pinned" : "active";
}

export function reorderAgentThread(
  state: AgentThreadsState,
  threadId: string,
  owner: AgentThreadOwner,
  targetThreadId: string,
  placement: AgentThreadPlacement,
  now: number,
  destination?: AgentThreadDropSection,
): AgentThreadsState {
  const thread = state.threads.get(threadId);
  if (
    thread === undefined ||
    !sameThreadOrganizationOwner(thread.owner, owner) ||
    (placement !== "before" && placement !== "after")
  )
    return state;
  const target = state.threads.get(targetThreadId);
  if (!target || !sameThreadOrganizationOwner(thread.owner, target.owner)) return state;
  let prepared = state;
  if (destination !== undefined) {
    if (
      !["pinned", "active", "settled"].includes(destination) ||
      !validThreadOrganizationValue(now) ||
      thread.archived ||
      target.archived ||
      (targetThreadId !== threadId && section(target, now) !== destination) ||
      (destination === "settled" && runningTurn(thread) !== null)
    )
      return state;
    const next = {
      ...thread,
      pinned: destination === "pinned" ? true : destination === "active" ? false : thread.pinned,
      snoozedUntil: null,
      settledAt: destination === "settled" ? (thread.settledAt ?? now) : null,
    };
    const threads = new Map(state.threads);
    threads.set(threadId, next);
    prepared = { threads };
    if (targetThreadId === threadId) return prepared;
  }
  const plan = agentThreadReorderPlan(
    [...prepared.threads.values()],
    threadId,
    targetThreadId,
    placement,
    now,
  );
  const changed = plan.filter(
    (item) => state.threads.get(item.threadId)?.sortOrder !== item.sortOrder,
  );
  if (changed.length === 0) return prepared;
  const threads = new Map(prepared.threads);
  for (const item of changed)
    threads.set(item.threadId, { ...threads.get(item.threadId)!, sortOrder: item.sortOrder });
  return { threads };
}
