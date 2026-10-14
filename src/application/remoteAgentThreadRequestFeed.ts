import type { AgentThreadRequests } from "../domain/agentRuntimeRequest";
import { remoteAgentThreadRequestIdentity } from "../domain/remoteAgentThreadRequestScope";
import type {
  AgentThreadRequestFeed,
  AgentThreadRequestScope,
  AgentThreadRequestsPage,
} from "./agentThreadRequestPorts";
import type { MonotonicClock } from "./boundedRetry";
import { RemoteAgentThreadRequestBroadcast } from "./remoteAgentThreadRequestBroadcast";
import type { RemoteAgentThreadRequestConfirmation } from "./remoteAgentThreadRequestConfirmations";
import { RemoteAgentThreadRequestLaneScheduler } from "./remoteAgentThreadRequestLaneScheduler";
import type {
  RemoteAgentThreadRequestGateway,
  RemoteAgentThreadRequestResponse,
} from "./remoteAgentThreadRequestPorts";
import { RemoteAgentThreadRequestPullQueue } from "./remoteAgentThreadRequestPullQueue";
import { RemoteAgentThreadRequestRegistry } from "./remoteAgentThreadRequestRegistry";
import {
  RemoteAgentThreadRequestResponder,
  type RemoteAgentThreadRequestRespondOutcome,
} from "./remoteAgentThreadRequestResponder";
import { RemoteAgentThreadRequestSendGuards } from "./remoteAgentThreadRequestSendGuards";
import {
  armThread,
  createRemoteAgentThreadRequestTracked,
  disarmThread,
  recoverThread,
  remoteAgentThreadRequestScopeKey as scopeKey,
  resumeThread,
  suspendThread,
  unsynced,
  type RemoteAgentThreadRequestLane as Lane,
  type RemoteAgentThreadRequestTracked as Tracked,
} from "./remoteAgentThreadRequestTracking";
import {
  RemoteAgentThreadRequestWatch,
  isRemoteAgentThreadRequestDescription,
  type RemoteAgentThreadRequestDescription,
} from "./remoteAgentThreadRequestWatch";

export {
  MAX_REMOTE_AGENT_THREAD_REQUEST_GUARDED_RESPONSES,
  MAX_REMOTE_AGENT_THREAD_REQUEST_LIVE_RESPONSES,
  MAX_REMOTE_AGENT_THREAD_REQUEST_QUEUED_PULLS,
  MAX_REMOTE_AGENT_THREAD_REQUEST_READ_RETRIES,
  MAX_REMOTE_AGENT_THREAD_REQUEST_SUBSCRIBERS,
  MAX_REMOTE_AGENT_THREAD_REQUEST_TRACKED_SCOPES,
  MAX_REMOTE_AGENT_THREAD_REQUEST_UNDESCRIBED_PULLS,
  REMOTE_AGENT_THREAD_REQUEST_PULL_DEADLINE_MS,
  REMOTE_AGENT_THREAD_REQUEST_READ_DEADLINE_MS,
  REMOTE_AGENT_THREAD_REQUEST_READ_RETRY_BASE_MS,
  REMOTE_AGENT_THREAD_REQUEST_READ_RETRY_CAP_MS,
  REMOTE_AGENT_THREAD_REQUEST_READ_SETTLEMENT_MS,
  REMOTE_AGENT_THREAD_REQUEST_RESPOND_DEADLINE_MS,
  REMOTE_AGENT_THREAD_REQUEST_RESPOND_SETTLEMENT_MS,
} from "./remoteAgentThreadRequestPolicy";
export type { RemoteAgentThreadRequestConfirmation } from "./remoteAgentThreadRequestConfirmations";
export type { RemoteAgentThreadRequestRespondOutcome } from "./remoteAgentThreadRequestResponder";
export type {
  RemoteAgentThreadRequestDescription,
  RemoteAgentThreadRequestSource,
} from "./remoteAgentThreadRequestWatch";

export type RemoteAgentThreadRequestDescribeOutcome =
  | { readonly kind: "tracked" }
  | { readonly kind: "refused"; readonly reason: "notRemote" | "invalid" | "capacity" };

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
  confirm(
    scope: AgentThreadRequestScope,
    turnId: string,
    requestId: string,
  ): Promise<RemoteAgentThreadRequestConfirmation>;
}

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

const monotonicNow: MonotonicClock = () => performance.now();

export function createRemoteAgentThreadRequestFeed(
  gateway: RemoteAgentThreadRequestGateway,
  clock: MonotonicClock = monotonicNow,
): RemoteAgentThreadRequestFeed {
  return new GatewayRemoteAgentThreadRequestFeed(gateway, clock);
}

class GatewayRemoteAgentThreadRequestFeed implements RemoteAgentThreadRequestFeed {
  private readonly registry = new RemoteAgentThreadRequestRegistry();
  private readonly broadcast: RemoteAgentThreadRequestBroadcast;
  private readonly pulls: RemoteAgentThreadRequestPullQueue;
  private readonly scheduler: RemoteAgentThreadRequestLaneScheduler;
  private readonly responder: RemoteAgentThreadRequestResponder;
  private readonly pump = (lane: Lane): void => this.scheduler.pump(lane);

  constructor(gateway: RemoteAgentThreadRequestGateway, clock: MonotonicClock) {
    const guards = new RemoteAgentThreadRequestSendGuards(clock);
    this.broadcast = new RemoteAgentThreadRequestBroadcast(this.registry, guards);
    this.pulls = new RemoteAgentThreadRequestPullQueue(guards, this.pump);
    this.scheduler = new RemoteAgentThreadRequestLaneScheduler(
      gateway,
      clock,
      this.registry,
      this.broadcast,
      guards,
      this.pulls,
    );
    this.responder = new RemoteAgentThreadRequestResponder(
      gateway,
      guards,
      this.registry,
      this.broadcast,
      this.pump,
    );
  }

  describe(
    scope: AgentThreadRequestScope,
    description: RemoteAgentThreadRequestDescription,
  ): RemoteAgentThreadRequestDescribeOutcome {
    const identity = remoteAgentThreadRequestIdentity(scope);
    if (identity === null) return NOT_REMOTE;
    if (!isRemoteAgentThreadRequestDescription(description)) return INVALID;
    const key = scopeKey(scope);
    const known = this.registry.thread(key);
    if (known !== undefined && known.watch.source === description.source) {
      this.redescribe(known, description);
      return TRACKED;
    }
    if (known === undefined && !this.registry.admits(identity.serverId)) return CAPACITY;
    const owed = known === undefined ? this.registry.forgetUndescribed(key) : unsynced(known);
    if (known !== undefined) this.drop(known);
    const lane = this.registry.laneOf(identity.serverId);
    const watch = new RemoteAgentThreadRequestWatch(identity, description.source);
    watch.describe(description.turns, description.awaiting);
    const thread = createRemoteAgentThreadRequestTracked({
      key,
      identity,
      watch,
      lane,
      reachable: description.reachable,
      owed,
    });
    this.registry.track(thread);
    armThread(thread, this.pump);
    this.pump(lane);
    return TRACKED;
  }

  release(scope: AgentThreadRequestScope): void {
    const key = scopeKey(scope);
    this.registry.forgetUndescribed(key);
    const thread = this.registry.thread(key);
    if (thread === undefined) return;
    this.drop(thread);
    this.pump(thread.lane);
  }

  reconnected(serverId: string): void {
    const lane = this.registry.lane(serverId);
    if (lane === undefined) return;
    for (const thread of [...lane.threads]) {
      thread.reachable = true;
      recoverThread(thread);
    }
    this.pump(lane);
  }

  currentThreadRequests(
    scope: AgentThreadRequestScope,
    turnIds: readonly string[],
    cursor: string | null,
  ): Promise<AgentThreadRequestsPage> {
    const key = scopeKey(scope);
    const thread = this.registry.thread(key);
    if (thread === undefined) {
      this.registry.remember(scope, key);
      return Promise.reject(new Error("The remote thread is not described."));
    }
    return this.pulls.request(thread, turnIds, cursor);
  }

  subscribeThreadRequests(handler: (message: AgentThreadRequests) => void): Promise<() => void> {
    return this.broadcast.subscribe(handler);
  }

  respond(
    scope: AgentThreadRequestScope,
    turnId: string,
    requestId: string,
    response: RemoteAgentThreadRequestResponse,
  ): Promise<RemoteAgentThreadRequestRespondOutcome> {
    const thread = this.registry.thread(scopeKey(scope));
    return this.responder.respond(thread, turnId, requestId, response);
  }

  confirm(
    scope: AgentThreadRequestScope,
    turnId: string,
    requestId: string,
  ): Promise<RemoteAgentThreadRequestConfirmation> {
    return this.responder.confirm(this.registry.thread(scopeKey(scope)), turnId, requestId);
  }

  private redescribe(thread: Tracked, description: RemoteAgentThreadRequestDescription): void {
    const wasReachable = thread.reachable;
    const change = thread.watch.describe(description.turns, description.awaiting);
    thread.confirmations.prune(new Set(description.turns.map((turn) => turn.turnId)));
    thread.reachable = description.reachable;
    if (!description.reachable) {
      suspendThread(thread);
      return;
    }
    if (!wasReachable) recoverThread(thread);
    if (change.added && thread.pullFailed) thread.kickOwed = true;
    if (change.moved) resumeThread(thread);
    if (thread.watch.recheckDelay() === null) disarmThread(thread);
    armThread(thread, this.pump);
    this.pump(thread.lane);
  }

  private drop(thread: Tracked): void {
    this.registry.untrack(thread);
    suspendThread(thread);
    this.pulls.drop(thread);
  }
}
