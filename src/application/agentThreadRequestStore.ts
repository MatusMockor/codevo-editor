import {
  mergeAgentThreadRequests,
  type AgentThreadRequests,
  type AgentThreadRequestsMerge,
  type AgentThreadRequestsSource,
  type AgentThreadRequestsState,
} from "../domain/agentRuntimeRequest";
import {
  MAX_AGENT_THREAD_REQUEST_TURN_IDS_PER_PULL,
  type AgentThreadRequestFeed,
  type AgentThreadRequestScope,
  type AgentThreadRequestsPage,
} from "./agentThreadRequestPorts";
import { BoundedRetry, attemptWithinDeadline, type BoundedRetryPolicy } from "./boundedRetry";

export const AGENT_THREAD_REQUEST_RETRY_BASE_MS = 250;
export const AGENT_THREAD_REQUEST_RETRY_CAP_MS = 5_000;
export const AGENT_THREAD_REQUEST_MAX_RETRIES = 10;
export const AGENT_THREAD_REQUEST_FAILURE_NOTICE_THRESHOLD = 3;
export const AGENT_THREAD_REQUEST_OPERATION_DEADLINE_MS = 5_000;
export const MAX_AGENT_THREAD_REQUEST_WATCHED_SCOPES = 64;
export const MAX_AGENT_THREAD_REQUEST_TURN_IDS = 256;
export const MAX_AGENT_THREAD_REQUEST_RACED_PULLS_PER_SYNC = 4;
export const MAX_AGENT_THREAD_REQUEST_EPOCH_CHANGES_PER_SYNC = 4;
export const MAX_AGENT_THREAD_REQUEST_CURSOR_PAGES_PER_TURN_PAGE = 128;
export const MAX_AGENT_THREAD_REQUEST_PULLS_PER_SYNC =
  MAX_AGENT_THREAD_REQUEST_TURN_IDS / MAX_AGENT_THREAD_REQUEST_TURN_IDS_PER_PULL +
  MAX_AGENT_THREAD_REQUEST_RACED_PULLS_PER_SYNC *
    MAX_AGENT_THREAD_REQUEST_CURSOR_PAGES_PER_TURN_PAGE;
export const MAX_AGENT_THREAD_REQUEST_RETIRED_EPOCHS = 8;

export type AgentThreadRequestObservation =
  | { readonly kind: "pending" }
  | {
      readonly kind: "observed";
      readonly state: AgentThreadRequestsState;
      readonly pendingTurnIds: readonly string[];
    }
  | { readonly kind: "unavailable" };

export interface AgentThreadRequestStore {
  watch(
    scope: AgentThreadRequestScope,
    turnIds: readonly string[],
    listener: (observation: AgentThreadRequestObservation) => void,
  ): () => void;
}

type Listener = (observation: AgentThreadRequestObservation) => void;

type PullOutcome = "complete" | "raced" | "failed";

interface CursorChain {
  readonly turnIds: readonly string[];
  readonly cursor: string | null;
  readonly pages: number;
  readonly restarted: boolean;
}

type Subscription =
  | { readonly kind: "idle" }
  | { readonly kind: "subscribing"; readonly lease: object }
  | { readonly kind: "live"; readonly lease: object; readonly release: () => void }
  | { readonly kind: "failed" };

interface TurnPlan {
  readonly turnIds: readonly string[];
  readonly capped: boolean;
}

interface WatchedThread {
  readonly key: string;
  readonly scope: AgentThreadRequestScope;
  readonly watchers: Map<Listener, TurnPlan>;
  readonly covered: Set<string>;
  readonly retry: BoundedRetry;
  readonly race: BoundedRetry;
  observation: AgentThreadRequestObservation;
  state: AgentThreadRequestsState | null;
  retiredEpochs: readonly string[];
  plan: TurnPlan;
  pushRevision: number;
  synced: boolean;
  pulling: boolean;
}

const PENDING: AgentThreadRequestObservation = Object.freeze({ kind: "pending" });
const UNAVAILABLE: AgentThreadRequestObservation = Object.freeze({ kind: "unavailable" });
const IDLE: Subscription = Object.freeze({ kind: "idle" });
const FAILED: Subscription = Object.freeze({ kind: "failed" });
const NO_TURN_IDS: readonly string[] = Object.freeze([]);
const NO_TURNS: TurnPlan = Object.freeze({ turnIds: NO_TURN_IDS, capped: false });
const RETRY_POLICY: BoundedRetryPolicy = Object.freeze({
  baseMs: AGENT_THREAD_REQUEST_RETRY_BASE_MS,
  capMs: AGENT_THREAD_REQUEST_RETRY_CAP_MS,
  maxRetries: AGENT_THREAD_REQUEST_MAX_RETRIES,
  noticeThreshold: AGENT_THREAD_REQUEST_FAILURE_NOTICE_THRESHOLD,
});
const RACE_POLICY: BoundedRetryPolicy = Object.freeze({
  baseMs: AGENT_THREAD_REQUEST_RETRY_BASE_MS,
  capMs: AGENT_THREAD_REQUEST_RETRY_CAP_MS,
  maxRetries: Number.POSITIVE_INFINITY,
  noticeThreshold: Number.POSITIVE_INFINITY,
});
const stores = new WeakMap<AgentThreadRequestFeed, AgentThreadRequestStore>();

export function agentThreadRequestStore(feed: AgentThreadRequestFeed): AgentThreadRequestStore {
  const existing = stores.get(feed);
  if (existing !== undefined) return existing;
  const created = new FeedAgentThreadRequestStore(feed);
  stores.set(feed, created);
  return created;
}

class FeedAgentThreadRequestStore implements AgentThreadRequestStore {
  private readonly watched = new Map<string, WatchedThread>();
  private readonly reconnect = new BoundedRetry(RETRY_POLICY);
  private subscription: Subscription = IDLE;

  constructor(private readonly feed: AgentThreadRequestFeed) {}

  watch(
    scope: AgentThreadRequestScope,
    turnIds: readonly string[],
    listener: Listener,
  ): () => void {
    const entry = this.admit(scope);
    if (entry === null) {
      deliver(listener, UNAVAILABLE);
      return () => undefined;
    }
    const registration: Listener = (observation) => listener(observation);
    entry.watchers.set(registration, boundedTurns(turnIds));
    const shown = entry.observation;
    this.replan(entry);
    if (entry.observation === shown) deliver(registration, shown);
    this.refresh(entry);
    return () => this.leave(entry, registration);
  }

  private admit(scope: AgentThreadRequestScope): WatchedThread | null {
    const key = scopeKey(scope);
    const existing = this.watched.get(key);
    if (existing !== undefined) return existing;
    if (this.watched.size >= MAX_AGENT_THREAD_REQUEST_WATCHED_SCOPES) this.reclaim();
    if (this.watched.size >= MAX_AGENT_THREAD_REQUEST_WATCHED_SCOPES) return null;
    const entry: WatchedThread = {
      key,
      scope: {
        rootKey: scope.rootKey,
        ownerId: scope.ownerId,
        threadId: scope.threadId,
        workspaceId: scope.workspaceId,
      },
      watchers: new Map(),
      covered: new Set(),
      retry: new BoundedRetry(RETRY_POLICY),
      race: new BoundedRetry(RACE_POLICY),
      observation: this.reconnect.persistent ? UNAVAILABLE : PENDING,
      state: null,
      retiredEpochs: NO_TURN_IDS,
      plan: NO_TURNS,
      pushRevision: 0,
      synced: false,
      pulling: false,
    };
    this.watched.set(key, entry);
    return entry;
  }

  private leave(entry: WatchedThread, registration: Listener): void {
    if (!entry.watchers.delete(registration)) return;
    if (entry.watchers.size > 0) {
      this.replan(entry);
      return;
    }
    queueMicrotask(() => this.retire(entry));
  }

  private retire(entry: WatchedThread): void {
    if (!this.forget(entry) || this.watched.size > 0) return;
    this.disconnect();
  }

  private reclaim(): void {
    for (const entry of [...this.watched.values()]) this.forget(entry);
  }

  private forget(entry: WatchedThread): boolean {
    if (entry.watchers.size > 0 || !this.watching(entry)) return false;
    calm(entry);
    this.watched.delete(entry.key);
    return true;
  }

  private replan(entry: WatchedThread): void {
    const plans = [...entry.watchers.values()];
    const union = boundedTurns(plans.flatMap((plan) => plan.turnIds));
    entry.plan = { turnIds: union.turnIds, capped: union.capped || plans.some(isCapped) };
    const wanted = new Set(entry.plan.turnIds);
    for (const turnId of [...entry.covered]) {
      if (!wanted.has(turnId)) entry.covered.delete(turnId);
    }
    if (settled(entry)) calm(entry);
    this.flag(entry);
    this.present(entry);
  }

  private refresh(entry: WatchedThread): void {
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
        if (entry.pulling || backingOff(entry) || settled(entry)) return;
        entry.retry.rearm();
        void this.sync(entry);
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
    for (const entry of [...this.watched.values()]) void this.sync(entry);
  }

  private async open(lease: object): Promise<(() => void) | null> {
    const attempt = await attemptWithinDeadline(
      () => this.feed.subscribeThreadRequests((message) => this.receive(lease, message)),
      AGENT_THREAD_REQUEST_OPERATION_DEADLINE_MS,
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

  private watching(entry: WatchedThread): boolean {
    return this.watched.get(entry.key) === entry;
  }

  private receive(lease: object, message: AgentThreadRequests): void {
    if (!this.holds(lease)) return;
    for (const entry of [...this.watched.values()]) {
      if (this.watching(entry) && accepts(entry.scope, message)) this.take(entry, message);
    }
  }

  private take(entry: WatchedThread, message: AgentThreadRequests): void {
    if (entry.retiredEpochs.includes(message.epoch)) return;
    entry.pushRevision += 1;
    this.apply(entry, merging(entry, message, "push"));
    this.present(entry);
    if (backingOff(entry) || settled(entry)) return;
    void this.sync(entry);
  }

  private async sync(entry: WatchedThread): Promise<void> {
    if (entry.pulling || this.subscription.kind !== "live" || !this.watching(entry)) return;
    entry.pulling = true;
    const outcome = await this.pull(entry);
    entry.pulling = false;
    if (!this.watching(entry)) return;
    const again = (): void => {
      void this.sync(entry);
    };
    switch (outcome) {
      case "complete":
        calm(entry);
        entry.synced = true;
        this.present(entry);
        return;
      case "raced":
        entry.race.fail(again);
        return;
      case "failed":
        entry.retry.fail(again);
        if (!entry.retry.persistent || entry.observation.kind === "observed") return;
        this.publish(entry, UNAVAILABLE);
        return;
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  }

  private async pull(entry: WatchedThread): Promise<PullOutcome> {
    let raced = 0;
    let epochChanges = 0;
    let chain = chainStart(entry);
    for (let pulls = 0; pulls < MAX_AGENT_THREAD_REQUEST_PULLS_PER_SYNC; pulls += 1) {
      const pushRevision = entry.pushRevision;
      const page = await this.current(entry.scope, chain);
      if (!this.watching(entry)) return "failed";
      if (page === null) {
        if (chain.cursor === null || chain.restarted) return "failed";
        chain = { ...chain, cursor: null, pages: 0, restarted: true };
        continue;
      }
      if (entry.pushRevision !== pushRevision) {
        raced += 1;
        if (raced >= MAX_AGENT_THREAD_REQUEST_RACED_PULLS_PER_SYNC) return "raced";
        chain = chainStart(entry);
        continue;
      }
      const epoch = entry.state?.epoch ?? page.message.epoch;
      this.apply(entry, merging(entry, page.message, "pull"));
      if (epoch !== page.message.epoch) {
        epochChanges += 1;
        const exhausted = epochChanges >= MAX_AGENT_THREAD_REQUEST_EPOCH_CHANGES_PER_SYNC;
        const abandoned = chain.cursor !== null;
        if (exhausted || abandoned) this.present(entry);
        if (exhausted) return "failed";
        if (abandoned) {
          chain = chainStart(entry);
          continue;
        }
      }
      if (page.nextCursor !== null) {
        this.present(entry);
        if (chain.pages + 1 >= MAX_AGENT_THREAD_REQUEST_CURSOR_PAGES_PER_TURN_PAGE) return "failed";
        chain = { ...chain, cursor: page.nextCursor, pages: chain.pages + 1 };
        continue;
      }
      for (const turnId of chain.turnIds) entry.covered.add(turnId);
      if (missing(entry).length === 0) return "complete";
      this.present(entry);
      chain = chainStart(entry);
    }
    return "failed";
  }

  private async current(
    scope: AgentThreadRequestScope,
    chain: CursorChain,
  ): Promise<AgentThreadRequestsPage | null> {
    const attempt = await attemptWithinDeadline(
      () => this.feed.currentThreadRequests(scope, chain.turnIds, chain.cursor),
      AGENT_THREAD_REQUEST_OPERATION_DEADLINE_MS,
    );
    if (attempt.kind !== "settled" || !accepts(scope, attempt.value.message)) return null;
    return attempt.value;
  }

  private apply(entry: WatchedThread, message: AgentThreadRequestsMerge): void {
    const previous = entry.state;
    const next = mergeAgentThreadRequests(previous, message);
    entry.state = next;
    if (previous !== null && previous.epoch !== next.epoch) supersede(entry, previous.epoch);
    if (!message.reset && previous?.epoch === next.epoch) return;
    entry.covered.clear();
    entry.synced = false;
  }

  private flag(entry: WatchedThread): void {
    const state = entry.state;
    if (state === null || state.truncated || !entry.plan.capped) return;
    entry.state = mergeAgentThreadRequests(state, {
      ...state,
      requests: [],
      truncated: true,
      reset: false,
      source: "push",
    });
  }

  private present(entry: WatchedThread): void {
    const state = entry.state;
    const shown = entry.observation;
    if (state === null) return;
    if (!entry.synced && shown.kind !== "observed") return;
    const pendingTurnIds = pendingTurns(entry, shown);
    if (
      shown.kind === "observed" &&
      shown.state === state &&
      shown.pendingTurnIds === pendingTurnIds
    )
      return;
    this.publish(entry, { kind: "observed", state, pendingTurnIds });
  }

  private publish(entry: WatchedThread, observation: AgentThreadRequestObservation): void {
    if (entry.observation === observation || !this.watching(entry)) return;
    entry.observation = observation;
    for (const listener of [...entry.watchers.keys()]) {
      if (entry.observation !== observation || !this.watching(entry)) return;
      if (entry.watchers.has(listener)) deliver(listener, observation);
    }
  }
}

function scopeKey(scope: AgentThreadRequestScope): string {
  return JSON.stringify([scope.rootKey, scope.ownerId, scope.threadId, scope.workspaceId]);
}

function accepts(scope: AgentThreadRequestScope, message: AgentThreadRequests): boolean {
  if (message.threadId !== scope.threadId) return false;
  return message.workspaceId === null || message.workspaceId === scope.workspaceId;
}

function boundedTurns(turnIds: readonly string[]): TurnPlan {
  const unique = [...new Set(turnIds)];
  return {
    turnIds: unique.slice(-MAX_AGENT_THREAD_REQUEST_TURN_IDS),
    capped: unique.length > MAX_AGENT_THREAD_REQUEST_TURN_IDS,
  };
}

function isCapped(plan: TurnPlan): boolean {
  return plan.capped;
}

function missing(entry: WatchedThread): readonly string[] {
  return entry.plan.turnIds.filter((turnId) => !entry.covered.has(turnId));
}

function chainStart(entry: WatchedThread): CursorChain {
  return {
    turnIds: missing(entry).slice(0, MAX_AGENT_THREAD_REQUEST_TURN_IDS_PER_PULL),
    cursor: null,
    pages: 0,
    restarted: false,
  };
}

function backingOff(entry: WatchedThread): boolean {
  return entry.retry.waiting || entry.race.waiting;
}

function calm(entry: WatchedThread): void {
  entry.retry.reset();
  entry.race.reset();
}

function settled(entry: WatchedThread): boolean {
  return entry.synced && missing(entry).length === 0;
}

function pendingTurns(
  entry: WatchedThread,
  shown: AgentThreadRequestObservation,
): readonly string[] {
  const pending = missing(entry);
  if (pending.length === 0) return NO_TURN_IDS;
  if (shown.kind !== "observed" || !sameTurns(shown.pendingTurnIds, pending)) return pending;
  return shown.pendingTurnIds;
}

function sameTurns(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((turnId, index) => turnId === right[index]);
}

function supersede(entry: WatchedThread, retiredEpoch: string): void {
  const current = entry.state?.epoch;
  const kept = entry.retiredEpochs.filter((epoch) => epoch !== current && epoch !== retiredEpoch);
  entry.retiredEpochs = [...kept, retiredEpoch].slice(-MAX_AGENT_THREAD_REQUEST_RETIRED_EPOCHS);
}

function merging(
  entry: WatchedThread,
  message: AgentThreadRequests,
  source: AgentThreadRequestsSource,
): AgentThreadRequestsMerge {
  return {
    ...message,
    reset: message.reset && source === "push",
    truncated: message.truncated || entry.plan.capped,
    source,
  };
}

function deliver(listener: Listener, observation: AgentThreadRequestObservation): void {
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
