import type { AgentRuntimeRequest, AgentThreadRequests } from "../domain/agentRuntimeRequest";
import {
  remoteAgentThreadRequestIdentity,
  type RemoteAgentThreadRequestIdentity,
} from "../domain/remoteAgentThreadRequestScope";
import {
  MAX_AGENT_THREAD_REQUEST_TURN_IDS_PER_PULL,
  type AgentThreadRequestFeed,
  type AgentThreadRequestScope,
  type AgentThreadRequestsPage,
} from "./agentThreadRequestPorts";
import { attemptWithinDeadline, type DeadlineAttempt, type MonotonicClock } from "./boundedRetry";
import {
  RemoteAgentThreadRequestConfirmations,
  type RemoteAgentThreadRequestConfirmation,
} from "./remoteAgentThreadRequestConfirmations";
import {
  MAX_REMOTE_AGENT_THREAD_REQUEST_TURNS,
  RemoteAgentThreadRequestNotSentError,
  type RemoteAgentThreadRequestGateway,
  type RemoteAgentThreadRequestResponse,
  type RemoteAgentThreadRequestTurn,
  type RemoteAgentThreadRequestsPage,
  type RemoteAgentThreadRequestsRequest,
  type RemoteAgentThreadRespondRequest,
  type RemoteAgentThreadRespondResult,
} from "./remoteAgentThreadRequestPorts";
import {
  RemoteAgentThreadRequestWatch,
  isRemoteAgentThreadRequestDescription,
  remoteAgentThreadRequestKey,
  type RemoteAgentThreadRequestDescription,
  type RemoteAgentThreadRequestReadStep,
} from "./remoteAgentThreadRequestWatch";

export const MAX_REMOTE_AGENT_THREAD_REQUEST_TRACKED_SCOPES = 64;
export const MAX_REMOTE_AGENT_THREAD_REQUEST_QUEUED_PULLS = 64;
export const MAX_REMOTE_AGENT_THREAD_REQUEST_SUBSCRIBERS = 8;
export const MAX_REMOTE_AGENT_THREAD_REQUEST_LIVE_RESPONSES = 32;
export const MAX_REMOTE_AGENT_THREAD_REQUEST_GUARDED_RESPONSES = 256;
export const REMOTE_AGENT_THREAD_REQUEST_READ_SETTLEMENT_MS = 75_000;
export const REMOTE_AGENT_THREAD_REQUEST_RESPOND_SETTLEMENT_MS = 150_000;
export const MAX_REMOTE_AGENT_THREAD_REQUEST_UNDESCRIBED_PULLS = 64;
export const MAX_REMOTE_AGENT_THREAD_REQUEST_READ_RETRIES = 5;
export const REMOTE_AGENT_THREAD_REQUEST_READ_DEADLINE_MS = 65_000;
export const REMOTE_AGENT_THREAD_REQUEST_PULL_DEADLINE_MS = 5_000;
export const REMOTE_AGENT_THREAD_REQUEST_RESPOND_DEADLINE_MS = 15_000;
export const REMOTE_AGENT_THREAD_REQUEST_READ_RETRY_BASE_MS = 1_000;
export const REMOTE_AGENT_THREAD_REQUEST_READ_RETRY_CAP_MS = 30_000;

export type { RemoteAgentThreadRequestConfirmation } from "./remoteAgentThreadRequestConfirmations";
export type {
  RemoteAgentThreadRequestDescription,
  RemoteAgentThreadRequestSource,
} from "./remoteAgentThreadRequestWatch";

export type RemoteAgentThreadRequestDescribeOutcome =
  | { readonly kind: "tracked" }
  | { readonly kind: "refused"; readonly reason: "notRemote" | "invalid" | "capacity" };

export type RemoteAgentThreadRequestRespondOutcome =
  | { readonly kind: "answered" }
  | { readonly kind: "notAnswerable" }
  | {
      readonly kind: "deliveryUncertain";
      readonly confirmation: Promise<RemoteAgentThreadRequestConfirmation>;
    }
  | {
      readonly kind: "notSent";
      readonly reason: "notDescribed" | "unreachable" | "alreadySending" | "busy" | "refused";
    };

export interface RemoteAgentThreadRequestFeed extends AgentThreadRequestFeed {
  describe(
    scope: AgentThreadRequestScope,
    description: RemoteAgentThreadRequestDescription,
  ): RemoteAgentThreadRequestDescribeOutcome;
  release(scope: AgentThreadRequestScope): void;
  respond(
    scope: AgentThreadRequestScope,
    turnId: string,
    requestId: string,
    response: RemoteAgentThreadRequestResponse,
  ): Promise<RemoteAgentThreadRequestRespondOutcome>;
  reconnected(serverId: string): void;
}

type Timer = ReturnType<typeof setTimeout>;

interface Reading {
  readonly lease: object;
  readonly call: Promise<RemoteAgentThreadRequestsPage>;
}
type Handler = (message: AgentThreadRequests) => void;

interface LaneRead {
  readonly lease: object;
  readonly thread: Tracked;
  readonly turnIds: ReadonlySet<string>;
  readonly cursor: string | null;
  readonly joined: PullJob[];
}

interface Lane {
  readonly serverId: string;
  readonly threads: Set<Tracked>;
  readonly pulls: PullJob[];
  current: LaneRead | null;
  lease: object | null;
  since: number;
  stranded: Timer | undefined;
  timer: Timer | undefined;
}

interface Guard {
  readonly since: number;
}

interface Tracked {
  readonly key: string;
  readonly identity: RemoteAgentThreadRequestIdentity;
  readonly watch: RemoteAgentThreadRequestWatch;
  readonly lane: Lane;
  readonly confirmations: RemoteAgentThreadRequestConfirmations;
  reachable: boolean;
  reading: boolean;
  failures: number;
  stalled: boolean;
  retry: Timer | undefined;
  wake: Timer | undefined;
  pulls: number;
  pullFailed: boolean;
  kickOwed: boolean;
  restarted: boolean;
}

interface PullJob {
  readonly thread: Tracked;
  readonly turnIds: readonly string[];
  readonly cursor: string | null;
  readonly resolve: (page: AgentThreadRequestsPage) => void;
  readonly reject: (reason: Error) => void;
  timer: Timer | undefined;
  done: boolean;
}

type Sent =
  | { readonly kind: "responded"; readonly result: RemoteAgentThreadRespondResult }
  | { readonly kind: "refused" }
  | { readonly kind: "unknown" };

const MAX_TURNS_PER_PULL = Math.min(
  MAX_AGENT_THREAD_REQUEST_TURN_IDS_PER_PULL,
  MAX_REMOTE_AGENT_THREAD_REQUEST_TURNS,
);
const TRACKED: RemoteAgentThreadRequestDescribeOutcome = Object.freeze({ kind: "tracked" });
const NOT_REMOTE: RemoteAgentThreadRequestDescribeOutcome = Object.freeze({
  kind: "refused",
  reason: "notRemote",
});
const INVALID: RemoteAgentThreadRequestDescribeOutcome = Object.freeze({
  kind: "refused",
  reason: "invalid",
});
const CAPACITY: RemoteAgentThreadRequestDescribeOutcome = Object.freeze({
  kind: "refused",
  reason: "capacity",
});
const ANSWERED: RemoteAgentThreadRequestRespondOutcome = Object.freeze({ kind: "answered" });
const NOT_ANSWERABLE: RemoteAgentThreadRequestRespondOutcome = Object.freeze({
  kind: "notAnswerable",
});
const BUSY: RemoteAgentThreadRequestRespondOutcome = Object.freeze({
  kind: "notSent",
  reason: "busy",
});
const REFUSED: RemoteAgentThreadRequestRespondOutcome = Object.freeze({
  kind: "notSent",
  reason: "refused",
});
const SEND_REFUSED: Sent = Object.freeze({ kind: "refused" });
const SEND_UNKNOWN: Sent = Object.freeze({ kind: "unknown" });
const NOT_DESCRIBED: RemoteAgentThreadRequestRespondOutcome = Object.freeze({
  kind: "notSent",
  reason: "notDescribed",
});
const UNREACHABLE: RemoteAgentThreadRequestRespondOutcome = Object.freeze({
  kind: "notSent",
  reason: "unreachable",
});
const ALREADY_SENDING: RemoteAgentThreadRequestRespondOutcome = Object.freeze({
  kind: "notSent",
  reason: "alreadySending",
});

const monotonicNow: MonotonicClock = () => performance.now();

export function createRemoteAgentThreadRequestFeed(
  gateway: RemoteAgentThreadRequestGateway,
  clock: MonotonicClock = monotonicNow,
): RemoteAgentThreadRequestFeed {
  return new GatewayRemoteAgentThreadRequestFeed(gateway, clock);
}

class GatewayRemoteAgentThreadRequestFeed implements RemoteAgentThreadRequestFeed {
  private readonly tracked = new Map<string, Tracked>();
  private readonly lanes = new Map<string, Lane>();
  private readonly handlers = new Set<Handler>();
  private readonly undescribed = new Set<string>();
  private readonly sends = new Map<string, Guard>();

  constructor(
    private readonly gateway: RemoteAgentThreadRequestGateway,
    private readonly clock: MonotonicClock,
  ) {}

  describe(
    scope: AgentThreadRequestScope,
    description: RemoteAgentThreadRequestDescription,
  ): RemoteAgentThreadRequestDescribeOutcome {
    const identity = remoteAgentThreadRequestIdentity(scope);
    if (identity === null) return NOT_REMOTE;
    if (!isRemoteAgentThreadRequestDescription(description)) return INVALID;
    const key = scopeKey(scope);
    const known = this.tracked.get(key);
    if (known !== undefined && known.watch.source === description.source) {
      this.redescribe(known, description);
      return TRACKED;
    }
    if (known === undefined && !this.admits(identity.serverId)) return CAPACITY;
    const owed = known === undefined ? this.undescribed.delete(key) : unsynced(known);
    if (known !== undefined) this.drop(known);
    const lane = this.laneOf(identity.serverId);
    const watch = new RemoteAgentThreadRequestWatch(identity, description.source);
    watch.describe(description.turns, description.awaiting);
    const thread: Tracked = {
      key,
      identity,
      watch,
      lane,
      confirmations: new RemoteAgentThreadRequestConfirmations(),
      reachable: description.reachable,
      reading: false,
      failures: 0,
      stalled: false,
      retry: undefined,
      wake: undefined,
      pulls: 0,
      pullFailed: owed,
      kickOwed: owed,
      restarted: false,
    };
    this.tracked.set(key, thread);
    lane.threads.add(thread);
    this.arm(thread);
    this.pump(lane);
    return TRACKED;
  }

  release(scope: AgentThreadRequestScope): void {
    const key = scopeKey(scope);
    this.undescribed.delete(key);
    const thread = this.tracked.get(key);
    if (thread === undefined) return;
    this.drop(thread);
    this.pump(thread.lane);
  }

  reconnected(serverId: string): void {
    const lane = this.lanes.get(serverId);
    if (lane === undefined) return;
    for (const thread of [...lane.threads]) {
      thread.reachable = true;
      this.recover(thread);
    }
    this.pump(lane);
  }

  currentThreadRequests(
    scope: AgentThreadRequestScope,
    turnIds: readonly string[],
    cursor: string | null,
  ): Promise<AgentThreadRequestsPage> {
    const key = scopeKey(scope);
    const thread = this.tracked.get(key);
    if (thread === undefined) {
      this.remember(scope, key);
      return Promise.reject(new Error("The remote thread is not described."));
    }
    if (!thread.reachable || !this.serves(thread, turnIds)) return refused(thread);
    const lane = thread.lane;
    const waiting = lane.pulls.length + (lane.current?.joined.length ?? 0);
    if (waiting >= MAX_REMOTE_AGENT_THREAD_REQUEST_QUEUED_PULLS) return refused(thread);
    return new Promise((resolve, reject) => {
      const job: PullJob = {
        thread,
        turnIds: [...turnIds],
        cursor,
        resolve,
        reject,
        timer: undefined,
        done: false,
      };
      job.timer = setTimeout(() => {
        this.settlePull(job, null);
        this.pump(lane);
      }, REMOTE_AGENT_THREAD_REQUEST_PULL_DEADLINE_MS);
      thread.pulls += 1;
      if (this.join(lane, job)) return;
      lane.pulls.push(job);
      this.pump(lane);
    });
  }

  subscribeThreadRequests(handler: Handler): Promise<() => void> {
    if (this.handlers.size >= MAX_REMOTE_AGENT_THREAD_REQUEST_SUBSCRIBERS)
      return Promise.reject(new Error("Too many remote thread request subscribers."));
    const registration: Handler = (message) => handler(message);
    this.handlers.add(registration);
    return Promise.resolve(() => {
      this.handlers.delete(registration);
    });
  }

  async respond(
    scope: AgentThreadRequestScope,
    turnId: string,
    requestId: string,
    response: RemoteAgentThreadRequestResponse,
  ): Promise<RemoteAgentThreadRequestRespondOutcome> {
    const scopeId = scopeKey(scope);
    const thread = this.tracked.get(scopeId);
    const turn = thread?.watch.turn(turnId) ?? null;
    if (thread === undefined || turn === null) return NOT_DESCRIBED;
    if (!thread.reachable) return UNREACHABLE;
    const key = remoteAgentThreadRequestKey(turnId, requestId);
    const send = guardKey(scopeId, key);
    if (this.sends.has(send)) return ALREADY_SENDING;
    if (this.sends.size >= MAX_REMOTE_AGENT_THREAD_REQUEST_GUARDED_RESPONSES) return BUSY;
    if (this.liveSends() >= MAX_REMOTE_AGENT_THREAD_REQUEST_LIVE_RESPONSES) return BUSY;
    const guard: Guard = { since: this.clock() };
    this.sends.set(send, guard);
    const { serverId, runnerId, conversationId: threadId } = thread.identity;
    const sent = this.send({ serverId, runnerId, threadId, turn, requestId, response });
    void sent.then(() => this.unguard(send, guard));
    const attempt = await attemptWithinDeadline(
      () => sent,
      REMOTE_AGENT_THREAD_REQUEST_RESPOND_DEADLINE_MS,
    );
    if (attempt.kind === "settled") return this.concluded(thread, turnId, key, attempt.value);
    return { kind: "deliveryUncertain", confirmation: this.overdue(thread, turnId, key, sent) };
  }

  private async send(request: RemoteAgentThreadRespondRequest): Promise<Sent> {
    try {
      return { kind: "responded", result: await this.gateway.respond(request) };
    } catch (error) {
      return error instanceof RemoteAgentThreadRequestNotSentError ? SEND_REFUSED : SEND_UNKNOWN;
    }
  }

  private liveSends(): number {
    const now = this.clock();
    return [...this.sends.values()].filter(
      (guard) => now - guard.since < REMOTE_AGENT_THREAD_REQUEST_RESPOND_SETTLEMENT_MS,
    ).length;
  }

  private unguard(send: string, guard: Guard): void {
    if (this.sends.get(send) === guard) this.sends.delete(send);
  }

  private observeClosed(thread: Tracked, requests: readonly AgentRuntimeRequest[]): void {
    for (const request of requests) {
      if (request.status === "pending" || request.status === "submitting") continue;
      this.sends.delete(
        guardKey(thread.key, remoteAgentThreadRequestKey(request.turnId, request.id)),
      );
    }
  }

  private overdue(
    thread: Tracked,
    turnId: string,
    key: string,
    sent: Promise<Sent>,
  ): Promise<RemoteAgentThreadRequestConfirmation> {
    const watched = this.owns(thread) && thread.reachable && thread.watch.turn(turnId) !== null;
    const confirmation = watched
      ? thread.confirmations.await(key, turnId, "awaitingSettlement")
      : Promise.resolve<RemoteAgentThreadRequestConfirmation>("unconfirmed");
    void sent.then((late) => this.settledLate(thread, turnId, key, late));
    return confirmation;
  }

  private settledLate(thread: Tracked, turnId: string, key: string, sent: Sent): void {
    if (sent.kind === "responded" && sent.result.outcome !== "deliveryUncertain") {
      thread.confirmations.settle(key, "settled");
      this.learned(thread, turnId, sent);
      return;
    }
    if (sent.kind === "responded") this.announce(thread, sent.result.message);
    thread.confirmations.open(key);
    this.reread(thread, turnId);
  }

  private learned(thread: Tracked, turnId: string, sent: Sent): void {
    if (sent.kind === "responded" && this.announce(thread, sent.result.message)) return;
    this.reread(thread, turnId);
  }

  private concluded(
    thread: Tracked,
    turnId: string,
    key: string,
    sent: Sent,
  ): RemoteAgentThreadRequestRespondOutcome {
    const kind = sent.kind;
    switch (kind) {
      case "responded":
        return this.answered(thread, turnId, key, sent.result);
      case "refused":
        return REFUSED;
      case "unknown":
        return this.uncertain(thread, turnId, key);
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
  }

  private answered(
    thread: Tracked,
    turnId: string,
    key: string,
    result: RemoteAgentThreadRespondResult,
  ): RemoteAgentThreadRequestRespondOutcome {
    const outcome = result.outcome;
    switch (outcome) {
      case "answered":
        if (!this.announce(thread, result.message)) this.reread(thread, turnId);
        return ANSWERED;
      case "notAnswerable":
        if (!this.announce(thread, result.message)) this.reread(thread, turnId);
        return NOT_ANSWERABLE;
      case "deliveryUncertain":
        this.announce(thread, result.message);
        return this.uncertain(thread, turnId, key);
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  }

  private uncertain(
    thread: Tracked,
    turnId: string,
    key: string,
  ): RemoteAgentThreadRequestRespondOutcome {
    return { kind: "deliveryUncertain", confirmation: this.confirmation(thread, turnId, key) };
  }

  private confirmation(
    thread: Tracked,
    turnId: string,
    key: string,
  ): Promise<RemoteAgentThreadRequestConfirmation> {
    if (!this.owns(thread) || !thread.reachable || !thread.watch.force(turnId))
      return Promise.resolve("unconfirmed");
    const confirmation = thread.confirmations.await(key, turnId, "open");
    this.resume(thread);
    this.pump(thread.lane);
    return confirmation;
  }

  private reread(thread: Tracked, turnId: string): void {
    if (!this.owns(thread) || !thread.watch.force(turnId)) return;
    this.resume(thread);
    this.pump(thread.lane);
  }

  private announce(thread: Tracked, message: AgentThreadRequests | null): boolean {
    if (message === null || !this.owns(thread) || !thread.watch.owns(message)) return false;
    this.observeClosed(thread, message.requests);
    this.push(thread, thread.watch.deliver(message));
    return true;
  }

  private push(thread: Tracked, message: AgentThreadRequests | null): void {
    if (message === null) return;
    if (thread.pulls === 0) thread.kickOwed = false;
    for (const handler of [...this.handlers]) deliver(handler, message);
  }

  private redescribe(thread: Tracked, description: RemoteAgentThreadRequestDescription): void {
    const wasReachable = thread.reachable;
    const change = thread.watch.describe(description.turns, description.awaiting);
    thread.confirmations.prune(new Set(description.turns.map((turn) => turn.turnId)));
    thread.reachable = description.reachable;
    if (!description.reachable) {
      this.suspend(thread);
      return;
    }
    if (!wasReachable) this.recover(thread);
    if (change.added && thread.pullFailed) thread.kickOwed = true;
    if (change.moved) this.resume(thread);
    if (thread.watch.recheckDelay() === null) this.disarm(thread);
    this.arm(thread);
    this.pump(thread.lane);
  }

  private suspend(thread: Tracked): void {
    this.disarm(thread);
    clearTimeout(thread.retry);
    thread.retry = undefined;
    thread.confirmations.abandon();
  }

  private recover(thread: Tracked): void {
    this.resume(thread);
    this.disarm(thread);
    thread.kickOwed = unsynced(thread);
    thread.watch.revive();
  }

  private resume(thread: Tracked): void {
    clearTimeout(thread.retry);
    thread.retry = undefined;
    thread.failures = 0;
    thread.stalled = false;
  }

  private admits(serverId: string): boolean {
    if (this.tracked.size >= MAX_REMOTE_AGENT_THREAD_REQUEST_TRACKED_SCOPES) return false;
    return (
      this.lanes.has(serverId) || this.lanes.size < MAX_REMOTE_AGENT_THREAD_REQUEST_TRACKED_SCOPES
    );
  }

  private laneOf(serverId: string): Lane {
    const known = this.lanes.get(serverId);
    if (known !== undefined) return known;
    const lane: Lane = {
      serverId,
      threads: new Set(),
      pulls: [],
      current: null,
      lease: null,
      since: 0,
      stranded: undefined,
      timer: undefined,
    };
    this.lanes.set(serverId, lane);
    return lane;
  }

  private owns(thread: Tracked): boolean {
    return this.tracked.get(thread.key) === thread;
  }

  private remember(scope: AgentThreadRequestScope, key: string): void {
    if (remoteAgentThreadRequestIdentity(scope) === null) return;
    this.undescribed.delete(key);
    this.undescribed.add(key);
    const excess = this.undescribed.size - MAX_REMOTE_AGENT_THREAD_REQUEST_UNDESCRIBED_PULLS;
    for (const stale of [...this.undescribed].slice(0, Math.max(0, excess)))
      this.undescribed.delete(stale);
  }

  private serves(thread: Tracked, turnIds: readonly string[]): boolean {
    if (turnIds.length > MAX_TURNS_PER_PULL) return false;
    if (new Set(turnIds).size !== turnIds.length) return false;
    return turnIds.every((turnId) => thread.watch.turn(turnId) !== null);
  }

  private drop(thread: Tracked): void {
    this.tracked.delete(thread.key);
    thread.lane.threads.delete(thread);
    this.suspend(thread);
    const joined = thread.lane.current?.joined ?? [];
    for (const job of [...thread.lane.pulls, ...joined].filter(
      (queued) => queued.thread === thread,
    ))
      this.settlePull(job, null);
  }

  private join(lane: Lane, job: PullJob): boolean {
    const current = lane.current;
    if (current === null || current.thread !== job.thread) return false;
    if (current.cursor !== null || job.cursor !== null) return false;
    if (!job.turnIds.every((turnId) => current.turnIds.has(turnId))) return false;
    current.joined.push(job);
    return true;
  }

  private rejoin(lane: Lane, lease: object, page: RemoteAgentThreadRequestsPage | null): boolean {
    const current = lane.current;
    if (current === null || current.lease !== lease) return false;
    lane.current = null;
    const waiting = current.joined.filter((job) => !job.done);
    if (page === null || page.nextCursor !== null) {
      lane.pulls.unshift(...waiting);
      return false;
    }
    for (const job of waiting) this.settlePull(job, shared(page, job.turnIds));
    return waiting.length > 0;
  }

  private retire(lane: Lane): void {
    if (lane.lease !== null || lane.threads.size > 0 || lane.pulls.length > 0) return;
    clearTimeout(lane.timer);
    lane.timer = undefined;
    if (this.lanes.get(lane.serverId) === lane) this.lanes.delete(lane.serverId);
  }

  private pump(lane: Lane): void {
    this.reclaim(lane);
    if (lane.lease !== null) return;
    for (let job = lane.pulls.shift(); job !== undefined; job = lane.pulls.shift()) {
      const turns = this.pullTurns(job);
      if (turns !== null) {
        void this.pull(lane, job, turns);
        return;
      }
      this.settlePull(job, null);
    }
    if (lane.threads.size === 0) {
      this.retire(lane);
      return;
    }
    if (lane.timer !== undefined || !this.hasWork(lane)) return;
    lane.timer = setTimeout(() => {
      lane.timer = undefined;
      this.work(lane);
    }, 0);
  }

  private hasWork(lane: Lane): boolean {
    return [...lane.threads].some((thread) => kickDue(thread) || wantsRead(thread));
  }

  private work(lane: Lane): void {
    for (const thread of [...lane.threads]) this.kick(thread);
    if (lane.lease !== null) return;
    if (lane.pulls.length > 0) {
      this.pump(lane);
      return;
    }
    const thread = [...lane.threads].find(wantsRead);
    if (thread === undefined) return;
    lane.threads.delete(thread);
    lane.threads.add(thread);
    void this.read(lane, thread);
  }

  private kick(thread: Tracked): void {
    if (!this.owns(thread) || !kickDue(thread)) return;
    thread.kickOwed = false;
    if (!thread.pullFailed) return;
    const message = thread.watch.kick();
    if (message === null) {
      thread.watch.prime();
      return;
    }
    this.push(thread, message);
  }

  private pullTurns(job: PullJob): readonly RemoteAgentThreadRequestTurn[] | null {
    if (job.done || !this.owns(job.thread) || !job.thread.reachable) return null;
    const turns: RemoteAgentThreadRequestTurn[] = [];
    for (const turnId of job.turnIds) {
      const turn = job.thread.watch.turn(turnId);
      if (turn === null) return null;
      turns.push(turn);
    }
    return turns;
  }

  private async pull(
    lane: Lane,
    job: PullJob,
    turns: readonly RemoteAgentThreadRequestTurn[],
  ): Promise<void> {
    const reading = this.occupy(lane, job.thread, turns, job.cursor);
    const attempt = await this.within(reading, REMOTE_AGENT_THREAD_REQUEST_PULL_DEADLINE_MS);
    const page = this.owned(job.thread, attempt);
    if (job.done && page !== null) this.announce(job.thread, page.message);
    this.settlePull(job, page);
    if (attempt.kind === "timedOut")
      void reading.call.then((late) => this.announce(job.thread, late.message), ignore);
    this.vacate(lane, reading, attempt, REMOTE_AGENT_THREAD_REQUEST_PULL_DEADLINE_MS);
  }

  private settlePull(job: PullJob, page: RemoteAgentThreadRequestsPage | null): void {
    if (job.done) return;
    job.done = true;
    clearTimeout(job.timer);
    job.timer = undefined;
    const thread = job.thread;
    const queued = thread.lane.pulls.indexOf(job);
    if (queued >= 0) thread.lane.pulls.splice(queued, 1);
    const joined = thread.lane.current?.joined.indexOf(job) ?? -1;
    if (joined >= 0) thread.lane.current?.joined.splice(joined, 1);
    thread.pulls -= 1;
    if (page === null) {
      thread.pullFailed = true;
      job.reject(new Error("Remote thread requests could not be read."));
      return;
    }
    thread.pullFailed = false;
    thread.kickOwed = false;
    thread.watch.adopt(page.message);
    this.observeClosed(thread, page.message.requests);
    job.resolve(page);
  }

  private async read(lane: Lane, thread: Tracked): Promise<void> {
    const step = thread.watch.begin();
    if (step.fresh)
      thread.confirmations.bind(step.chain, new Set(step.turns.map((turn) => turn.turnId)));
    thread.reading = true;
    const reading = this.occupy(lane, thread, step.turns, step.cursor);
    lane.current = {
      lease: reading.lease,
      thread,
      turnIds: new Set(step.turns.map((turn) => turn.turnId)),
      cursor: step.cursor,
      joined: [],
    };
    const attempt = await this.within(reading, REMOTE_AGENT_THREAD_REQUEST_READ_DEADLINE_MS);
    const page = this.owned(thread, attempt);
    const shared = this.rejoin(lane, reading.lease, page);
    if (this.owns(thread)) {
      thread.reading = false;
      this.readSettled(thread, step, page, shared);
    }
    this.vacate(lane, reading, attempt, REMOTE_AGENT_THREAD_REQUEST_READ_DEADLINE_MS);
  }

  private readSettled(
    thread: Tracked,
    step: RemoteAgentThreadRequestReadStep,
    page: RemoteAgentThreadRequestsPage | null,
    shared: boolean,
  ): void {
    if (page === null && step.cursor !== null && !thread.restarted) {
      thread.restarted = true;
      thread.watch.abandon();
      thread.confirmations.unbind(step.chain);
      return;
    }
    if (page === null) {
      thread.watch.abandon();
      this.readFailed(thread, step);
      return;
    }
    this.observeClosed(thread, page.message.requests);
    const settlement = thread.watch.settle(page.message, page.nextCursor);
    const kind = settlement.kind;
    switch (kind) {
      case "continues":
        break;
      case "overflowed":
        this.readFailed(thread, step);
        break;
      case "complete":
        thread.failures = 0;
        thread.restarted = false;
        thread.confirmations.confirm(step.chain, settlement.statuses);
        this.arm(thread);
        break;
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
    if (!shared) {
      this.push(thread, settlement.push);
      return;
    }
    const push = settlement.push;
    if (push === null) return;
    setTimeout(() => {
      if (this.owns(thread)) this.push(thread, push);
    }, 0);
  }

  private readFailed(thread: Tracked, step: RemoteAgentThreadRequestReadStep): void {
    thread.failures += 1;
    thread.confirmations.unbind(step.chain);
    if (!thread.reachable) return;
    const exhausted = thread.failures > MAX_REMOTE_AGENT_THREAD_REQUEST_READ_RETRIES;
    if (exhausted) thread.confirmations.abandon();
    if (exhausted && thread.watch.recheckDelay() === null) {
      thread.stalled = true;
      return;
    }
    const delay = Math.min(
      REMOTE_AGENT_THREAD_REQUEST_READ_RETRY_BASE_MS * 2 ** (thread.failures - 1),
      REMOTE_AGENT_THREAD_REQUEST_READ_RETRY_CAP_MS,
    );
    thread.retry = setTimeout(() => {
      thread.retry = undefined;
      this.pump(thread.lane);
    }, delay);
  }

  private occupy(
    lane: Lane,
    thread: Tracked,
    turns: readonly RemoteAgentThreadRequestTurn[],
    cursor: string | null,
  ): Reading {
    const { serverId, runnerId, conversationId: threadId } = thread.identity;
    const lease = {};
    lane.lease = lease;
    lane.since = this.clock();
    return { lease, call: this.started({ serverId, runnerId, threadId, turns, cursor }) };
  }

  private async started(
    request: RemoteAgentThreadRequestsRequest,
  ): Promise<RemoteAgentThreadRequestsPage> {
    return this.gateway.threadRequests(request);
  }

  private within(
    reading: Reading,
    deadlineMs: number,
  ): Promise<DeadlineAttempt<RemoteAgentThreadRequestsPage>> {
    return attemptWithinDeadline(() => reading.call, deadlineMs);
  }

  private vacate(
    lane: Lane,
    reading: Reading,
    attempt: DeadlineAttempt<RemoteAgentThreadRequestsPage>,
    deadlineMs: number,
  ): void {
    const free = (): void => this.free(lane, reading.lease);
    void reading.call.then(free, free);
    if (attempt.kind !== "timedOut" || lane.lease !== reading.lease) return;
    lane.stranded = setTimeout(free, REMOTE_AGENT_THREAD_REQUEST_READ_SETTLEMENT_MS - deadlineMs);
  }

  private free(lane: Lane, lease: object): void {
    if (lane.lease !== lease) return;
    this.vacated(lane);
    this.pump(lane);
  }

  private reclaim(lane: Lane): void {
    if (lane.lease === null) return;
    if (this.clock() - lane.since < REMOTE_AGENT_THREAD_REQUEST_READ_SETTLEMENT_MS) return;
    this.vacated(lane);
  }

  private vacated(lane: Lane): void {
    clearTimeout(lane.stranded);
    lane.stranded = undefined;
    lane.lease = null;
  }

  private owned(
    thread: Tracked,
    attempt: DeadlineAttempt<RemoteAgentThreadRequestsPage>,
  ): RemoteAgentThreadRequestsPage | null {
    if (attempt.kind !== "settled" || !this.owns(thread)) return null;
    if (!thread.watch.owns(attempt.value.message)) return null;
    return attempt.value;
  }

  private arm(thread: Tracked): void {
    if (!thread.reachable || thread.reading || thread.wake !== undefined) return;
    if (thread.watch.rechecking) return;
    const delay = thread.watch.recheckDelay();
    if (delay === null) return;
    thread.wake = setTimeout(() => {
      thread.wake = undefined;
      thread.watch.recheck();
      this.pump(thread.lane);
    }, delay);
  }

  private disarm(thread: Tracked): void {
    clearTimeout(thread.wake);
    thread.wake = undefined;
  }
}

function shared(
  page: RemoteAgentThreadRequestsPage,
  turnIds: readonly string[],
): RemoteAgentThreadRequestsPage {
  const wanted = new Set(turnIds);
  const requests = page.message.requests.filter((request) => wanted.has(request.turnId));
  return { message: { ...page.message, requests }, nextCursor: null };
}

function ignore(): void {
  return;
}

function guardKey(scopeId: string, key: string): string {
  return JSON.stringify([scopeId, key]);
}

function scopeKey(scope: AgentThreadRequestScope): string {
  return JSON.stringify([scope.rootKey, scope.ownerId, scope.threadId, scope.workspaceId]);
}

function unsynced(thread: Tracked): boolean {
  return thread.pullFailed || thread.pulls > 0;
}

function kickDue(thread: Tracked): boolean {
  return thread.kickOwed && thread.reachable && thread.pulls === 0;
}

function wantsRead(thread: Tracked): boolean {
  if (!thread.reachable || thread.reading || thread.stalled) return false;
  return thread.retry === undefined && thread.watch.pending();
}

function refused(thread: Tracked): Promise<AgentThreadRequestsPage> {
  thread.pullFailed = true;
  return Promise.reject(new Error("Remote thread requests could not be read."));
}

function deliver(handler: Handler, message: AgentThreadRequests): void {
  try {
    handler(message);
  } catch {
    return;
  }
}
