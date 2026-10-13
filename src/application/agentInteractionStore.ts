import type { AgentInteractionSnapshot } from "../domain/agentInteractionSnapshot";
import type { AgentInteractionFeed, AgentInteractionOwner } from "./agentInteractionPorts";
import { BoundedRetry, attemptWithinDeadline, type BoundedRetryPolicy } from "./boundedRetry";

export const AGENT_INTERACTION_RETRY_BASE_MS = 250;
export const AGENT_INTERACTION_RETRY_CAP_MS = 5_000;
export const AGENT_INTERACTION_MAX_RETRIES = 10;
export const AGENT_INTERACTION_FAILURE_NOTICE_THRESHOLD = 3;
export const AGENT_INTERACTION_OPERATION_DEADLINE_MS = 5_000;
export const MAX_AGENT_INTERACTION_WATCHED_OWNERS = 64;

export type AgentInteractionObservation =
  | { readonly kind: "pending" }
  | { readonly kind: "observed"; readonly snapshot: AgentInteractionSnapshot }
  | { readonly kind: "unavailable" };

export interface AgentInteractionStore {
  watch(
    owner: AgentInteractionOwner,
    listener: (observation: AgentInteractionObservation) => void,
  ): () => void;
}

type Listener = (observation: AgentInteractionObservation) => void;

type Subscription =
  | { readonly kind: "idle" }
  | { readonly kind: "subscribing"; readonly lease: object }
  | { readonly kind: "live"; readonly lease: object; readonly release: () => void }
  | { readonly kind: "failed" };

interface WatchedOwner {
  readonly key: string;
  readonly owner: AgentInteractionOwner;
  readonly listeners: Set<Listener>;
  readonly retry: BoundedRetry;
  observation: AgentInteractionObservation;
  applied: AgentInteractionSnapshot | null;
  resyncing: boolean;
}

const PENDING: AgentInteractionObservation = Object.freeze({ kind: "pending" });
const UNAVAILABLE: AgentInteractionObservation = Object.freeze({ kind: "unavailable" });
const IDLE: Subscription = Object.freeze({ kind: "idle" });
const FAILED: Subscription = Object.freeze({ kind: "failed" });
const RETRY_POLICY: BoundedRetryPolicy = Object.freeze({
  baseMs: AGENT_INTERACTION_RETRY_BASE_MS,
  capMs: AGENT_INTERACTION_RETRY_CAP_MS,
  maxRetries: AGENT_INTERACTION_MAX_RETRIES,
  noticeThreshold: AGENT_INTERACTION_FAILURE_NOTICE_THRESHOLD,
});
const stores = new WeakMap<AgentInteractionFeed, AgentInteractionStore>();

export function agentInteractionStore(feed: AgentInteractionFeed): AgentInteractionStore {
  const existing = stores.get(feed);
  if (existing !== undefined) return existing;
  const created = new FeedAgentInteractionStore(feed);
  stores.set(feed, created);
  return created;
}

class FeedAgentInteractionStore implements AgentInteractionStore {
  private readonly watched = new Map<string, WatchedOwner>();
  private readonly reconnect = new BoundedRetry(RETRY_POLICY);
  private subscription: Subscription = IDLE;

  constructor(private readonly feed: AgentInteractionFeed) {}

  watch(owner: AgentInteractionOwner, listener: Listener): () => void {
    const entry = this.admit(owner);
    if (entry === null) {
      deliver(listener, UNAVAILABLE);
      return () => undefined;
    }
    const registration: Listener = (observation) => listener(observation);
    entry.listeners.add(registration);
    deliver(registration, entry.observation);
    this.refresh(entry);
    return () => this.leave(entry, registration);
  }

  private admit(owner: AgentInteractionOwner): WatchedOwner | null {
    const key = ownerKey(owner);
    const existing = this.watched.get(key);
    if (existing !== undefined) return existing;
    if (this.watched.size >= MAX_AGENT_INTERACTION_WATCHED_OWNERS) return null;
    const entry: WatchedOwner = {
      key,
      owner: { workspaceId: owner.workspaceId, taskId: owner.taskId },
      listeners: new Set(),
      retry: new BoundedRetry(RETRY_POLICY),
      observation: this.reconnect.persistent ? UNAVAILABLE : PENDING,
      applied: null,
      resyncing: false,
    };
    this.watched.set(key, entry);
    return entry;
  }

  private leave(entry: WatchedOwner, registration: Listener): void {
    if (!entry.listeners.delete(registration) || entry.listeners.size > 0) return;
    entry.retry.reset();
    if (this.watching(entry)) this.watched.delete(entry.key);
    if (this.watched.size > 0) return;
    this.disconnect();
  }

  private refresh(entry: WatchedOwner): void {
    const subscription = this.subscription;
    switch (subscription.kind) {
      case "idle":
        this.connect();
        return;
      case "subscribing":
        return;
      case "failed":
        if (this.reconnect.waiting) return;
        this.reconnect.rearm();
        this.connect();
        return;
      case "live":
        if (entry.observation.kind === "observed" || entry.resyncing || entry.retry.waiting) return;
        entry.retry.rearm();
        void this.resync(entry);
        return;
      default: {
        const exhaustive: never = subscription;
        return exhaustive;
      }
    }
  }

  private connect(): void {
    const lease = {};
    this.subscription = { kind: "subscribing", lease };
    void this.subscribe(lease);
  }

  private disconnect(): void {
    const subscription = this.subscription;
    this.subscription = IDLE;
    this.reconnect.reset();
    if (subscription.kind === "live") release(subscription.release);
  }

  private async subscribe(lease: object): Promise<void> {
    const opened = await this.open(lease);
    if (!this.holds(lease)) {
      if (opened !== null) release(opened);
      return;
    }
    if (opened === null) {
      this.subscription = FAILED;
      this.reconnect.fail(() => this.connect());
      if (!this.reconnect.persistent) return;
      for (const entry of [...this.watched.values()]) this.publish(entry, UNAVAILABLE);
      return;
    }
    this.reconnect.reset();
    this.subscription = { kind: "live", lease, release: opened };
    for (const entry of [...this.watched.values()]) void this.resync(entry);
  }

  private async open(lease: object): Promise<(() => void) | null> {
    const attempt = await attemptWithinDeadline(
      () => this.feed.subscribeInteractions((snapshot) => this.receive(lease, snapshot)),
      AGENT_INTERACTION_OPERATION_DEADLINE_MS,
      release,
    );
    if (attempt.kind !== "settled") return null;
    return attempt.value;
  }

  private holds(lease: object): boolean {
    const subscription = this.subscription;
    if (subscription.kind !== "subscribing" && subscription.kind !== "live") return false;
    return subscription.lease === lease;
  }

  private watching(entry: WatchedOwner): boolean {
    return this.watched.get(entry.key) === entry;
  }

  private receive(lease: object, snapshot: AgentInteractionSnapshot): void {
    if (!this.holds(lease)) return;
    const entry = this.watched.get(ownerKey(snapshot));
    if (entry === undefined || newest(entry.applied, snapshot) !== snapshot) return;
    this.observe(entry, snapshot);
  }

  private async resync(entry: WatchedOwner): Promise<void> {
    if (entry.resyncing || this.subscription.kind !== "live" || !this.watching(entry)) return;
    entry.resyncing = true;
    const snapshot = await this.current(entry.owner);
    entry.resyncing = false;
    if (!this.watching(entry)) return;
    if (snapshot !== null) {
      this.observe(entry, newest(entry.applied, snapshot));
      return;
    }
    if (entry.observation.kind === "observed") return;
    entry.retry.fail(() => {
      void this.resync(entry);
    });
    if (entry.retry.persistent) this.publish(entry, UNAVAILABLE);
  }

  private async current(owner: AgentInteractionOwner): Promise<AgentInteractionSnapshot | null> {
    const attempt = await attemptWithinDeadline(
      () => this.feed.currentInteractions(owner),
      AGENT_INTERACTION_OPERATION_DEADLINE_MS,
    );
    if (attempt.kind !== "settled" || ownerKey(attempt.value) !== ownerKey(owner)) return null;
    return attempt.value;
  }

  private observe(entry: WatchedOwner, snapshot: AgentInteractionSnapshot): void {
    entry.applied = snapshot;
    entry.retry.reset();
    const observed = entry.observation;
    if (observed.kind === "observed" && observed.snapshot === snapshot) return;
    this.publish(entry, { kind: "observed", snapshot });
  }

  private publish(entry: WatchedOwner, observation: AgentInteractionObservation): void {
    if (entry.observation === observation || !this.watching(entry)) return;
    entry.observation = observation;
    for (const listener of [...entry.listeners]) {
      if (entry.listeners.has(listener)) deliver(listener, observation);
    }
  }
}

function ownerKey(owner: AgentInteractionOwner): string {
  return JSON.stringify([owner.workspaceId, owner.taskId]);
}

function newest(
  applied: AgentInteractionSnapshot | null,
  snapshot: AgentInteractionSnapshot,
): AgentInteractionSnapshot {
  if (applied === null || snapshot.sequence > applied.sequence) return snapshot;
  return applied;
}

function deliver(listener: Listener, observation: AgentInteractionObservation): void {
  try {
    listener(observation);
  } catch {
    return;
  }
}

function release(unsubscribe: () => void): void {
  try {
    unsubscribe();
  } catch {
    return;
  }
}
