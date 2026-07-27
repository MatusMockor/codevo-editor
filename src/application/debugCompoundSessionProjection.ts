import type { DebugEvent } from "../domain/debug";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";
import {
  MAX_NODE_DEBUG_COMPOUND_MEMBERS,
  MIN_NODE_DEBUG_COMPOUND_MEMBERS,
} from "./nodeDebugCompoundSessionCoordinator";

export const MIN_DEBUG_COMPOUND_PROJECTED_SESSIONS = MIN_NODE_DEBUG_COMPOUND_MEMBERS;
export const MAX_DEBUG_COMPOUND_PROJECTED_SESSIONS = MAX_NODE_DEBUG_COMPOUND_MEMBERS;
export const MAX_PENDING_DEBUG_COMPOUND_PROJECTION_EVENTS = MAX_NODE_DEBUG_COMPOUND_MEMBERS * 4;
const MAX_TAINTED_DEBUG_COMPOUND_PROJECTION_ROOTS = MAX_PENDING_DEBUG_COMPOUND_PROJECTION_EVENTS;
const MAX_DEBUG_COMPOUND_PROJECTION_ROOT_BYTES = 4_096;
const UTF8_ENCODER = new TextEncoder();

declare const debugCompoundProjectionLeaseBrand: unique symbol;

/** Opaque authority for reading the selected child of one exact projection. */
export interface DebugCompoundProjectionLease {
  readonly [debugCompoundProjectionLeaseBrand]: true;
}

export type DebugCompoundProjectionSnapshot =
  | { readonly kind: "idle" }
  | {
      readonly hasSelectedSession: boolean;
      readonly kind: "active";
      readonly memberCount: number;
      readonly runningCount: number;
      readonly startingCount: number;
      readonly stoppedCount: number;
    }
  | {
      readonly kind: "ending";
      readonly memberCount: number;
      readonly remainingCount: number;
    };

type ChildState = "running" | "starting" | "stopped" | "terminated";

interface ProjectedChild {
  readonly index: number;
  readonly sessionId: number;
  lastSeq: number;
  lastStoppedOrder: number;
  state: ChildState;
}

interface ActiveProjection {
  ending: boolean;
  readonly children: Map<number, ProjectedChild>;
  readonly lease: DebugCompoundProjectionLease;
  readonly memberCount: number;
  nextEventOrder: number;
  readonly rootKey: string;
  selectedSessionId: number | null;
}

interface PendingEvent {
  readonly event: ProjectionEvent;
  readonly order: number;
  readonly rootKey: string;
}

interface ProjectionEvent {
  readonly payload:
    | { readonly kind: "resumed" | "started" }
    | { readonly kind: "stopped" }
    | { readonly kind: "terminated" };
  readonly rootPath: string;
  readonly seq: number;
  readonly sessionId: number;
}

const IDLE: DebugCompoundProjectionSnapshot = Object.freeze({ kind: "idle" });

/**
 * Minimal, pure compound-session read projection.
 *
 * The projection deliberately retains no launch recipe, arguments, environment,
 * stack frames or output. Exact child identities remain private and are exposed
 * only through the lease that created the projection.
 */
export class DebugCompoundSessionProjection {
  private active: ActiveProjection | null = null;
  private nextPendingOrder = 1;
  private readonly pending: PendingEvent[] = [];
  private readonly taintedRoots = new Set<string>();

  begin(rootPath: string, sessionIds: readonly number[]): DebugCompoundProjectionLease | null {
    let rootKey: string | null;
    let exactSessionIds: readonly number[];
    try {
      rootKey = safeRootKey(rootPath);
      exactSessionIds = Object.freeze(Array.isArray(sessionIds) ? [...sessionIds] : []);
    } catch {
      return null;
    }
    if (
      !rootKey ||
      !validSessionIds(exactSessionIds) ||
      (this.active !== null && !this.isComplete(this.active))
    ) {
      return null;
    }

    if (this.taintedRoots.delete(rootKey)) {
      this.clearPendingRoot(rootKey);
      return null;
    }

    const lease = Object.freeze({}) as DebugCompoundProjectionLease;
    const projection: ActiveProjection = {
      children: new Map(
        exactSessionIds.map((sessionId, index) => [
          sessionId,
          {
            index,
            lastSeq: 0,
            lastStoppedOrder: 0,
            sessionId,
            state: "starting" as const,
          },
        ]),
      ),
      ending: false,
      lease,
      memberCount: exactSessionIds.length,
      nextEventOrder: 1,
      rootKey,
      selectedSessionId: exactSessionIds[0] ?? null,
    };
    this.active = projection;

    const replay = this.pending
      .filter(
        ({ event, rootKey: eventRoot }) =>
          eventRoot === rootKey && projection.children.has(event.sessionId),
      )
      .sort((left, right) => left.event.seq - right.event.seq || left.order - right.order);
    this.clearPendingRoot(rootKey);
    for (const { event } of replay) {
      this.apply(projection, event);
    }
    return lease;
  }

  handleEvent(event: DebugEvent): boolean {
    const decoded = safelyDecodeLifecycleEvent(event);
    if (!decoded) return false;
    const rootKey = safeRootKey(decoded.rootPath);
    if (!rootKey) return false;

    const projection = this.active;
    if (!projection) {
      this.remember(rootKey, decoded);
      return false;
    }
    if (projection.rootKey !== rootKey) return false;

    const child = projection.children.get(decoded.sessionId);
    if (!child) return false;
    return this.apply(projection, decoded);
  }

  selectedSessionId(lease: DebugCompoundProjectionLease): number | null {
    const projection = this.active;
    if (!projection || projection.lease !== lease || projection.ending) return null;
    return projection.selectedSessionId;
  }

  snapshot(): DebugCompoundProjectionSnapshot {
    const projection = this.active;
    if (!projection || this.isComplete(projection)) return IDLE;

    if (projection.ending) {
      return Object.freeze({
        kind: "ending",
        memberCount: projection.memberCount,
        remainingCount: this.childrenInState(projection, "terminated", true),
      });
    }

    return Object.freeze({
      hasSelectedSession: projection.selectedSessionId !== null,
      kind: "active",
      memberCount: projection.memberCount,
      runningCount: this.childrenInState(projection, "running"),
      startingCount: this.childrenInState(projection, "starting"),
      stoppedCount: this.childrenInState(projection, "stopped"),
    });
  }

  /** Invalidates only the exact projection capability. */
  invalidate(lease: DebugCompoundProjectionLease): boolean {
    if (!this.active || this.active.lease !== lease) return false;
    this.clearPendingRoot(this.active.rootKey);
    this.active = null;
    return true;
  }

  private apply(projection: ActiveProjection, event: ProjectionEvent): boolean {
    const child = projection.children.get(event.sessionId);
    if (
      !child ||
      event.seq <= child.lastSeq ||
      (projection.ending && event.payload.kind !== "terminated")
    ) {
      return false;
    }

    const kind = event.payload.kind;
    if (
      (kind === "started" && child.state !== "starting") ||
      (kind === "stopped" && child.state !== "running") ||
      (kind === "resumed" && child.state !== "stopped") ||
      child.state === "terminated"
    ) {
      return false;
    }

    const eventOrder = projection.nextEventOrder++;
    child.lastSeq = event.seq;
    if (kind === "started") {
      child.state = "running";
    } else if (kind === "stopped") {
      child.state = "stopped";
      child.lastStoppedOrder = eventOrder;
      projection.selectedSessionId = child.sessionId;
    } else if (kind === "resumed") {
      child.state = "running";
      projection.selectedSessionId = this.preferredSession(projection);
    } else {
      child.state = "terminated";
      projection.ending = true;
      projection.selectedSessionId = null;
    }
    return true;
  }

  private preferredSession(projection: ActiveProjection): number | null {
    const children = [...projection.children.values()].filter(
      ({ state }) => state !== "terminated",
    );
    const latestStopped = children
      .filter(({ state }) => state === "stopped")
      .sort(
        (left, right) => right.lastStoppedOrder - left.lastStoppedOrder || left.index - right.index,
      )[0];
    return (
      latestStopped?.sessionId ??
      children.sort((left, right) => left.index - right.index)[0]?.sessionId ??
      null
    );
  }

  private childrenInState(projection: ActiveProjection, state: ChildState, invert = false): number {
    let count = 0;
    for (const child of projection.children.values()) {
      if ((child.state === state) !== invert) count += 1;
    }
    return count;
  }

  private isComplete(projection: ActiveProjection): boolean {
    return this.childrenInState(projection, "terminated") === projection.memberCount;
  }

  private remember(rootKey: string, event: ProjectionEvent): void {
    if (
      this.pending.some(
        (pending) =>
          pending.rootKey === rootKey &&
          pending.event.sessionId === event.sessionId &&
          pending.event.seq === event.seq,
      )
    ) {
      return;
    }
    if (this.pending.length >= MAX_PENDING_DEBUG_COMPOUND_PROJECTION_EVENTS) {
      const evicted = this.pending.shift();
      if (evicted) this.markTainted(evicted.rootKey);
    }
    this.pending.push({
      event,
      order: this.nextPendingOrder++,
      rootKey,
    });
  }

  private markTainted(rootKey: string): void {
    if (this.taintedRoots.has(rootKey)) return;
    if (this.taintedRoots.size >= MAX_TAINTED_DEBUG_COMPOUND_PROJECTION_ROOTS) {
      const oldest = this.taintedRoots.values().next().value;
      if (oldest !== undefined) this.taintedRoots.delete(oldest);
    }
    this.taintedRoots.add(rootKey);
  }

  private clearPendingRoot(rootKey: string): void {
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      if (this.pending[index]?.rootKey === rootKey) this.pending.splice(index, 1);
    }
  }
}

function decodedEvent(
  event: Readonly<DebugEvent>,
  kind: ProjectionEvent["payload"]["kind"],
): ProjectionEvent {
  return Object.freeze({
    payload: Object.freeze({ kind }),
    rootPath: event.rootPath,
    seq: event.seq,
    sessionId: event.sessionId,
  });
}

function decodeLifecycleEvent(event: DebugEvent): ProjectionEvent | null {
  if (
    !event ||
    typeof event !== "object" ||
    !validSessionId(event.sessionId) ||
    !Number.isSafeInteger(event.seq) ||
    event.seq <= 0 ||
    !event.payload ||
    typeof event.payload !== "object"
  ) {
    return null;
  }
  switch (event.payload.kind) {
    case "started":
      return event.payload.sessionId === event.sessionId ? decodedEvent(event, "started") : null;
    case "stopped":
      return validStopReason(event.payload.reason) &&
        Array.isArray(event.payload.frames) &&
        Number.isSafeInteger(event.payload.pauseGeneration) &&
        event.payload.pauseGeneration >= 0
        ? decodedEvent(event, "stopped")
        : null;
    case "resumed":
      return decodedEvent(event, "resumed");
    case "terminated":
      return event.payload.exitCode === null ||
        (Number.isSafeInteger(event.payload.exitCode) &&
          Math.abs(event.payload.exitCode) <= 2_147_483_647)
        ? decodedEvent(event, "terminated")
        : null;
    default:
      return null;
  }
}

export function decodableLifecycleEvent(event: DebugEvent): boolean {
  return safelyDecodeLifecycleEvent(event) !== null;
}

function safelyDecodeLifecycleEvent(event: DebugEvent): ProjectionEvent | null {
  try {
    return decodeLifecycleEvent(event);
  } catch {
    return null;
  }
}

function validSessionIds(sessionIds: readonly number[]): boolean {
  return (
    Array.isArray(sessionIds) &&
    sessionIds.length >= MIN_DEBUG_COMPOUND_PROJECTED_SESSIONS &&
    sessionIds.length <= MAX_DEBUG_COMPOUND_PROJECTED_SESSIONS &&
    sessionIds.every(validSessionId) &&
    new Set(sessionIds).size === sessionIds.length
  );
}

function validSessionId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validStopReason(value: unknown): boolean {
  return (
    value === "breakpoint" ||
    value === "step" ||
    value === "pause" ||
    value === "entry" ||
    value === "exception" ||
    value === "restart"
  );
}

function safeRootKey(rootPath: string): string | null {
  if (
    typeof rootPath !== "string" ||
    rootPath.length === 0 ||
    UTF8_ENCODER.encode(rootPath).byteLength > MAX_DEBUG_COMPOUND_PROJECTION_ROOT_BYTES ||
    /[\p{Cc}\u2028\u2029]/u.test(rootPath)
  ) {
    return null;
  }
  return normalizedWorkspaceRootKey(rootPath);
}
