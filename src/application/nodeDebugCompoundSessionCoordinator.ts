import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";

export const MAX_NODE_DEBUG_COMPOUND_MEMBERS = 8;
export const MIN_NODE_DEBUG_COMPOUND_MEMBERS = 2;
export const MAX_PENDING_NODE_DEBUG_COMPOUND_EVENTS = 32;
const MAX_NODE_DEBUG_COMPOUND_IDENTITY_BYTES = 4_096;
const UTF8_ENCODER = new TextEncoder();

export interface NodeDebugCompoundOwner {
  readonly launchConfigurationVersion: number;
  readonly rootPath: string;
  readonly workspaceEpoch: number;
  readonly workspaceId: string;
}

export interface NodeDebugCompoundEvent {
  readonly kind: "stopped" | "terminated";
  readonly rootPath: string;
  readonly sessionId: number;
}

declare const nodeDebugCompoundLeaseBrand: unique symbol;

/** Opaque authority for one exact compound start/group lifecycle. */
export interface NodeDebugCompoundLease {
  readonly [nodeDebugCompoundLeaseBrand]: true;
}

export type NodeDebugCompoundSnapshot =
  | { readonly kind: "idle" }
  | {
      readonly acceptedCount: number;
      readonly kind: "starting";
      readonly memberCount: number;
    }
  | {
      readonly acceptedCount: number;
      readonly kind: "ending";
      readonly memberCount: number;
      readonly remainingCount: number;
    }
  | {
      readonly activeCount: number;
      readonly hasSelectedSession: boolean;
      readonly kind: "active";
      readonly memberCount: number;
    };

export type NodeDebugCompoundAcceptance =
  { readonly kind: "accepted" } | { readonly kind: "ready" } | { readonly kind: "rejected" };

interface CompoundMember {
  readonly index: number;
  readonly sessionId: number;
  state: "running" | "stopped" | "terminated";
}

interface CompoundPlan {
  ending: boolean;
  readonly lease: NodeDebugCompoundLease;
  readonly memberCount: number;
  readonly members: Map<number, CompoundMember>;
  readonly owner: Readonly<NodeDebugCompoundOwner>;
  pendingEventOverflowed: boolean;
  selectedSessionId: number | null;
}

const IDLE: NodeDebugCompoundSnapshot = Object.freeze({ kind: "idle" });
const REJECTED: NodeDebugCompoundAcceptance = Object.freeze({ kind: "rejected" });

/**
 * Pure exact-owner state machine for a future multi-session Node compound.
 * It retains session IDs privately and exposes them only through an exact
 * lease when orchestration needs rollback or Stop All.
 */
export class NodeDebugCompoundSessionCoordinator {
  private plan: CompoundPlan | null = null;
  private readonly pendingEvents = new Map<string, Readonly<NodeDebugCompoundEvent>>();

  begin(owner: NodeDebugCompoundOwner, memberCount: number): NodeDebugCompoundLease | null {
    if (
      this.plan ||
      !validOwner(owner) ||
      !Number.isInteger(memberCount) ||
      memberCount < MIN_NODE_DEBUG_COMPOUND_MEMBERS ||
      memberCount > MAX_NODE_DEBUG_COMPOUND_MEMBERS
    ) {
      return null;
    }
    const lease = Object.freeze({}) as NodeDebugCompoundLease;
    this.plan = {
      ending: false,
      lease,
      memberCount,
      members: new Map(),
      owner: Object.freeze({ ...owner }),
      pendingEventOverflowed: false,
      selectedSessionId: null,
    };
    return lease;
  }

  accept(
    lease: NodeDebugCompoundLease,
    memberIndex: number,
    sessionId: number,
  ): NodeDebugCompoundAcceptance {
    const plan = this.exactPlan(lease);
    if (
      !plan ||
      !Number.isInteger(memberIndex) ||
      memberIndex < 0 ||
      memberIndex >= plan.memberCount ||
      !validSessionId(sessionId) ||
      plan.members.has(memberIndex) ||
      [...plan.members.values()].some((member) => member.sessionId === sessionId)
    ) {
      return REJECTED;
    }
    const event = this.pendingEvents.get(eventKey(plan.owner.rootPath, sessionId));
    if (event) this.pendingEvents.delete(eventKey(plan.owner.rootPath, sessionId));
    const member: CompoundMember = {
      index: memberIndex,
      sessionId,
      state:
        event?.kind === "terminated"
          ? "terminated"
          : event?.kind === "stopped"
            ? "stopped"
            : "running",
    };
    plan.members.set(memberIndex, member);
    if (member.state === "terminated") {
      plan.ending = true;
      plan.selectedSessionId = null;
    } else if (member.state === "stopped" && !plan.ending) {
      plan.selectedSessionId = sessionId;
    }
    // Once an exact-root early event may have been evicted, no subsequently accepted member can
    // be proven live. Keep recording valid IDs so the exact lease can roll the backend group back,
    // but never allow the compound to become ready.
    if (plan.pendingEventOverflowed) return REJECTED;
    if (plan.members.size < plan.memberCount) return Object.freeze({ kind: "accepted" });
    if (this.liveMembers(plan).length === 0) {
      this.plan = null;
      return REJECTED;
    }
    return Object.freeze({ kind: "ready" });
  }

  handleEvent(event: NodeDebugCompoundEvent): boolean {
    if (!validEvent(event)) return false;
    const plan = this.plan;
    if (!plan) {
      this.rememberEvent(event);
      return false;
    }
    if (!rootMatches(plan.owner.rootPath, event.rootPath)) return false;
    const member = [...plan.members.values()].find(
      (candidate) => candidate.sessionId === event.sessionId,
    );
    if (!member) {
      this.rememberEvent(event);
      return false;
    }
    if (event.kind === "stopped") {
      if (member.state === "terminated") return false;
      if (plan.ending) return true;
      member.state = "stopped";
      plan.selectedSessionId = member.sessionId;
      return true;
    }
    if (member.state === "terminated") return false;
    member.state = "terminated";
    plan.ending = true;
    plan.selectedSessionId = null;
    if (plan.members.size === plan.memberCount && this.liveMembers(plan).length === 0) {
      this.plan = null;
    }
    return true;
  }

  /** Clears a failed partial start and returns only its exact live sessions. */
  rollback(lease: NodeDebugCompoundLease): readonly number[] {
    const plan = this.exactPlan(lease);
    if (!plan) return Object.freeze([]);
    const sessionIds = this.liveSessionIds(plan);
    this.plan = null;
    this.clearPendingRoot(plan.owner.rootPath);
    return sessionIds;
  }

  /** Invalidates only the exact owner generation and returns exact live sessions. */
  invalidate(owner: NodeDebugCompoundOwner): readonly number[] {
    if (!validOwner(owner)) return Object.freeze([]);
    const plan = this.plan;
    if (!plan) {
      this.clearPendingRoot(owner.rootPath);
      return Object.freeze([]);
    }
    if (!ownersEqual(plan.owner, owner)) return Object.freeze([]);
    const sessionIds = this.liveSessionIds(plan);
    this.plan = null;
    this.clearPendingRoot(owner.rootPath);
    return sessionIds;
  }

  /** Returns the exact live group for Stop All without publishing it in snapshots. */
  stopAll(lease: NodeDebugCompoundLease): readonly number[] {
    const plan = this.exactPlan(lease);
    return plan ? this.liveSessionIds(plan) : Object.freeze([]);
  }

  selectedSession(lease: NodeDebugCompoundLease): number | null {
    return this.exactPlan(lease)?.selectedSessionId ?? null;
  }

  snapshot(): NodeDebugCompoundSnapshot {
    const plan = this.plan;
    if (!plan) return IDLE;
    if (plan.ending) {
      return Object.freeze({
        acceptedCount: plan.members.size,
        kind: "ending",
        memberCount: plan.memberCount,
        remainingCount: this.liveMembers(plan).length,
      });
    }
    if (plan.members.size < plan.memberCount) {
      return Object.freeze({
        acceptedCount: plan.members.size,
        kind: "starting",
        memberCount: plan.memberCount,
      });
    }
    return Object.freeze({
      activeCount: this.liveMembers(plan).length,
      hasSelectedSession: plan.selectedSessionId !== null,
      kind: "active",
      memberCount: plan.memberCount,
    });
  }

  private exactPlan(lease: NodeDebugCompoundLease): CompoundPlan | null {
    return this.plan?.lease === lease ? this.plan : null;
  }

  private liveMembers(plan: CompoundPlan): readonly CompoundMember[] {
    return [...plan.members.values()].filter((member) => member.state !== "terminated");
  }

  private liveSessionIds(plan: CompoundPlan): readonly number[] {
    return Object.freeze(
      [...this.liveMembers(plan)]
        .sort((left, right) => left.index - right.index)
        .map((member) => member.sessionId),
    );
  }

  private rememberEvent(event: NodeDebugCompoundEvent): void {
    const key = eventKey(event.rootPath, event.sessionId);
    const existing = this.pendingEvents.get(key);
    if (existing) {
      if (existing.kind === "stopped" && event.kind === "terminated") {
        this.pendingEvents.set(key, Object.freeze({ ...event }));
      }
      return;
    }
    if (this.pendingEvents.size >= MAX_PENDING_NODE_DEBUG_COMPOUND_EVENTS) {
      const oldest = this.pendingEvents.keys().next().value;
      if (oldest !== undefined) {
        const evicted = this.pendingEvents.get(oldest);
        if (
          this.plan &&
          evicted &&
          rootMatches(this.plan.owner.rootPath, event.rootPath) &&
          rootMatches(this.plan.owner.rootPath, evicted.rootPath)
        ) {
          this.plan.pendingEventOverflowed = true;
        }
        this.pendingEvents.delete(oldest);
      }
    }
    this.pendingEvents.set(key, Object.freeze({ ...event }));
  }

  private clearPendingRoot(rootPath: string): void {
    for (const [key, event] of this.pendingEvents) {
      if (rootMatches(event.rootPath, rootPath)) this.pendingEvents.delete(key);
    }
  }
}

function validOwner(owner: NodeDebugCompoundOwner): boolean {
  return (
    safeIdentity(owner.rootPath) &&
    safeIdentity(owner.workspaceId) &&
    Number.isSafeInteger(owner.workspaceEpoch) &&
    owner.workspaceEpoch >= 0 &&
    Number.isSafeInteger(owner.launchConfigurationVersion) &&
    owner.launchConfigurationVersion >= 0
  );
}

function ownersEqual(left: NodeDebugCompoundOwner, right: NodeDebugCompoundOwner): boolean {
  return (
    validOwner(right) &&
    rootMatches(left.rootPath, right.rootPath) &&
    left.workspaceId === right.workspaceId &&
    left.workspaceEpoch === right.workspaceEpoch &&
    left.launchConfigurationVersion === right.launchConfigurationVersion
  );
}

function validEvent(event: NodeDebugCompoundEvent): boolean {
  return (
    (event.kind === "stopped" || event.kind === "terminated") &&
    safeIdentity(event.rootPath) &&
    validSessionId(event.sessionId)
  );
}

function validSessionId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function safeIdentity(value: string): boolean {
  return (
    value.length > 0 &&
    UTF8_ENCODER.encode(value).byteLength <= MAX_NODE_DEBUG_COMPOUND_IDENTITY_BYTES &&
    !/[\p{Cc}\u2028\u2029]/u.test(value)
  );
}

function rootMatches(left: string, right: string): boolean {
  return normalizedWorkspaceRootKey(left) === normalizedWorkspaceRootKey(right);
}

function eventKey(rootPath: string, sessionId: number): string {
  return `${normalizedWorkspaceRootKey(rootPath)}\0${sessionId}`;
}
