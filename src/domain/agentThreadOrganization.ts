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
  if (left.sortOrder == null && right.sortOrder != null) return 1;
  if (left.sortOrder != null && right.sortOrder == null) return -1;
  const a = left.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const b = right.sortOrder ?? Number.MAX_SAFE_INTEGER;
  return (
    a - b ||
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

/** Renumber one owner/section atomically, avoiding fractional key exhaustion. */
export function agentThreadReorderPlan(
  threads: ReadonlyArray<AgentThread>,
  threadId: string,
  targetThreadId: string,
  placement: AgentThreadPlacement,
  now: number,
): ReadonlyArray<{ readonly threadId: string; readonly sortOrder: number }> {
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
  const siblings = threads
    .filter(
      (thread) =>
        sameThreadOrganizationOwner(thread.owner, moved.owner) &&
        section(thread, now) === section(moved, now),
    )
    .sort(compareAgentThreadOrder);
  const remaining = siblings.filter((thread) => thread.threadId !== threadId);
  const index = remaining.findIndex((thread) => thread.threadId === targetThreadId);
  remaining.splice(index + (placement === "after" ? 1 : 0), 0, moved);
  return remaining.map((thread, sortOrder) => ({ threadId: thread.threadId, sortOrder }));
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
