import type { RemoteAgentThreadRequestIdentity } from "../domain/remoteAgentThreadRequestScope";
import type { AgentThreadRequestScope, AgentThreadRequestsPage } from "./agentThreadRequestPorts";
import { RemoteAgentThreadRequestConfirmations } from "./remoteAgentThreadRequestConfirmations";
import type { RemoteAgentThreadRequestWatch } from "./remoteAgentThreadRequestWatch";

export type RemoteAgentThreadRequestTimer = ReturnType<typeof setTimeout>;

export interface RemoteAgentThreadRequestLaneRead {
  readonly lease: object;
  readonly thread: RemoteAgentThreadRequestTracked;
  readonly turnIds: ReadonlySet<string>;
  readonly cursor: string | null;
  readonly joined: RemoteAgentThreadRequestPullJob[];
}

export interface RemoteAgentThreadRequestLane {
  readonly serverId: string;
  readonly threads: Set<RemoteAgentThreadRequestTracked>;
  readonly pulls: RemoteAgentThreadRequestPullJob[];
  current: RemoteAgentThreadRequestLaneRead | null;
  lease: object | null;
  since: number;
  stranded: RemoteAgentThreadRequestTimer | undefined;
  timer: RemoteAgentThreadRequestTimer | undefined;
}

export interface RemoteAgentThreadRequestTracked {
  readonly key: string;
  readonly identity: RemoteAgentThreadRequestIdentity;
  readonly watch: RemoteAgentThreadRequestWatch;
  readonly lane: RemoteAgentThreadRequestLane;
  readonly confirmations: RemoteAgentThreadRequestConfirmations;
  reachable: boolean;
  reading: boolean;
  failures: number;
  stalled: boolean;
  retry: RemoteAgentThreadRequestTimer | undefined;
  wake: RemoteAgentThreadRequestTimer | undefined;
  pulls: number;
  pullFailed: boolean;
  kickOwed: boolean;
  restarted: boolean;
}

export interface RemoteAgentThreadRequestPullJob {
  readonly thread: RemoteAgentThreadRequestTracked;
  readonly turnIds: readonly string[];
  readonly cursor: string | null;
  readonly resolve: (page: AgentThreadRequestsPage) => void;
  readonly reject: (reason: Error) => void;
  timer: RemoteAgentThreadRequestTimer | undefined;
  done: boolean;
}

export interface RemoteAgentThreadRequestTrackedSeed {
  readonly key: string;
  readonly identity: RemoteAgentThreadRequestIdentity;
  readonly watch: RemoteAgentThreadRequestWatch;
  readonly lane: RemoteAgentThreadRequestLane;
  readonly reachable: boolean;
  readonly owed: boolean;
}

export function remoteAgentThreadRequestScopeKey(scope: AgentThreadRequestScope): string {
  return JSON.stringify([scope.rootKey, scope.ownerId, scope.threadId, scope.workspaceId]);
}

export function createRemoteAgentThreadRequestLane(serverId: string): RemoteAgentThreadRequestLane {
  return {
    serverId,
    threads: new Set(),
    pulls: [],
    current: null,
    lease: null,
    since: 0,
    stranded: undefined,
    timer: undefined,
  };
}

export function createRemoteAgentThreadRequestTracked(
  seed: RemoteAgentThreadRequestTrackedSeed,
): RemoteAgentThreadRequestTracked {
  return {
    key: seed.key,
    identity: seed.identity,
    watch: seed.watch,
    lane: seed.lane,
    confirmations: new RemoteAgentThreadRequestConfirmations(),
    reachable: seed.reachable,
    reading: false,
    failures: 0,
    stalled: false,
    retry: undefined,
    wake: undefined,
    pulls: 0,
    pullFailed: seed.owed,
    kickOwed: seed.owed,
    restarted: false,
  };
}

export function unsynced(thread: RemoteAgentThreadRequestTracked): boolean {
  return thread.pullFailed || thread.pulls > 0;
}

export function kickDue(thread: RemoteAgentThreadRequestTracked): boolean {
  return thread.kickOwed && thread.reachable && thread.pulls === 0;
}

export function wantsRead(thread: RemoteAgentThreadRequestTracked): boolean {
  if (!thread.reachable || thread.reading || thread.stalled) return false;
  return thread.retry === undefined && thread.watch.pending();
}

export function resumeThread(thread: RemoteAgentThreadRequestTracked): void {
  clearTimeout(thread.retry);
  thread.retry = undefined;
  thread.failures = 0;
  thread.stalled = false;
}

export function disarmThread(thread: RemoteAgentThreadRequestTracked): void {
  clearTimeout(thread.wake);
  thread.wake = undefined;
}

export function suspendThread(thread: RemoteAgentThreadRequestTracked): void {
  disarmThread(thread);
  clearTimeout(thread.retry);
  thread.retry = undefined;
  thread.confirmations.abandon();
}

export function recoverThread(thread: RemoteAgentThreadRequestTracked): void {
  resumeThread(thread);
  disarmThread(thread);
  thread.kickOwed = unsynced(thread);
  thread.watch.revive();
}

export function armThread(
  thread: RemoteAgentThreadRequestTracked,
  pump: (lane: RemoteAgentThreadRequestLane) => void,
): void {
  if (!thread.reachable || thread.reading || thread.wake !== undefined) return;
  if (thread.watch.rechecking) return;
  const delay = thread.watch.recheckDelay();
  if (delay === null) return;
  thread.wake = setTimeout(() => {
    thread.wake = undefined;
    thread.watch.recheck();
    pump(thread.lane);
  }, delay);
}
