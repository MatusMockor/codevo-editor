import type { DebugEvent } from "../domain/debug";
import { MAX_PENDING_DEBUG_START_EVENTS } from "./debugStartDescriptor";

const MAX_PENDING_DEBUG_START_SESSIONS = 4;
const OVERFLOW_SESSION_ID = 0;

export type PendingDebugStartEvents = Map<string, Map<number, DebugEvent[]>>;

export function retainPendingDebugStartEvent(
  registry: PendingDebugStartEvents,
  rootKey: string,
  event: DebugEvent,
): void {
  const bySession = registry.get(rootKey) ?? new Map<number, DebugEvent[]>();
  if (bySession.has(OVERFLOW_SESSION_ID)) return;
  if (!bySession.has(event.sessionId) && bySession.size >= MAX_PENDING_DEBUG_START_SESSIONS) {
    bySession.clear();
    bySession.set(
      OVERFLOW_SESSION_ID,
      Array.from({ length: MAX_PENDING_DEBUG_START_EVENTS + 1 }, () => event),
    );
    registry.set(rootKey, bySession);
    return;
  }
  const pending = bySession.get(event.sessionId) ?? [];
  if (pending.length >= MAX_PENDING_DEBUG_START_EVENTS) {
    if (event.payload.kind === "functionBreakpointsVerified") {
      if (pending.length === MAX_PENDING_DEBUG_START_EVENTS) pending.push(event);
    } else {
      pending.shift();
      pending.push(event);
    }
  } else {
    pending.push(event);
  }
  bySession.set(event.sessionId, pending);
  registry.set(rootKey, bySession);
}

export function pendingDebugStartEventsForSession(
  registry: PendingDebugStartEvents,
  rootKey: string,
  sessionId: number,
): readonly DebugEvent[] {
  const bySession = registry.get(rootKey);
  return bySession?.get(OVERFLOW_SESSION_ID) ?? bySession?.get(sessionId) ?? [];
}
