import type { AgentThreadRequestsPage } from "./agentThreadRequestPorts";
import {
  MAX_REMOTE_AGENT_THREAD_REQUEST_QUEUED_PULLS,
  MAX_REMOTE_AGENT_THREAD_REQUEST_TURNS_PER_PULL,
  REMOTE_AGENT_THREAD_REQUEST_PULL_DEADLINE_MS,
} from "./remoteAgentThreadRequestPolicy";
import type { RemoteAgentThreadRequestsPage } from "./remoteAgentThreadRequestPorts";
import type { RemoteAgentThreadRequestSendGuards } from "./remoteAgentThreadRequestSendGuards";
import type {
  RemoteAgentThreadRequestLane as Lane,
  RemoteAgentThreadRequestPullJob as PullJob,
  RemoteAgentThreadRequestTracked as Tracked,
} from "./remoteAgentThreadRequestTracking";

export class RemoteAgentThreadRequestPullQueue {
  constructor(
    private readonly guards: RemoteAgentThreadRequestSendGuards,
    private readonly pump: (lane: Lane) => void,
  ) {}

  request(
    thread: Tracked,
    turnIds: readonly string[],
    cursor: string | null,
  ): Promise<AgentThreadRequestsPage> {
    if (!thread.reachable || !serves(thread, turnIds)) return refused(thread);
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
        this.settle(job, null);
        this.pump(lane);
      }, REMOTE_AGENT_THREAD_REQUEST_PULL_DEADLINE_MS);
      thread.pulls += 1;
      if (join(lane, job)) return;
      lane.pulls.push(job);
      this.pump(lane);
    });
  }

  settle(job: PullJob, page: RemoteAgentThreadRequestsPage | null): void {
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
    this.guards.forgetClosed(thread.key, page.message.requests);
    job.resolve(page);
  }

  rejoin(lane: Lane, lease: object, page: RemoteAgentThreadRequestsPage | null): boolean {
    const current = lane.current;
    if (current === null || current.lease !== lease) return false;
    lane.current = null;
    const waiting = current.joined.filter((job) => !job.done);
    if (page === null || page.nextCursor !== null) {
      lane.pulls.unshift(...waiting);
      return false;
    }
    for (const job of waiting) this.settle(job, shared(page, job.turnIds));
    return waiting.length > 0;
  }

  drop(thread: Tracked): void {
    const joined = thread.lane.current?.joined ?? [];
    for (const job of [...thread.lane.pulls, ...joined].filter(
      (queued) => queued.thread === thread,
    ))
      this.settle(job, null);
  }
}

function serves(thread: Tracked, turnIds: readonly string[]): boolean {
  if (turnIds.length > MAX_REMOTE_AGENT_THREAD_REQUEST_TURNS_PER_PULL) return false;
  if (new Set(turnIds).size !== turnIds.length) return false;
  return turnIds.every((turnId) => thread.watch.turn(turnId) !== null);
}

function join(lane: Lane, job: PullJob): boolean {
  const current = lane.current;
  if (current === null || current.thread !== job.thread) return false;
  if (current.cursor !== null || job.cursor !== null) return false;
  if (!job.turnIds.every((turnId) => current.turnIds.has(turnId))) return false;
  current.joined.push(job);
  return true;
}

function shared(
  page: RemoteAgentThreadRequestsPage,
  turnIds: readonly string[],
): RemoteAgentThreadRequestsPage {
  const wanted = new Set(turnIds);
  const requests = page.message.requests.filter((request) => wanted.has(request.turnId));
  return { message: { ...page.message, requests }, nextCursor: null };
}

function refused(thread: Tracked): Promise<AgentThreadRequestsPage> {
  thread.pullFailed = true;
  return Promise.reject(new Error("Remote thread requests could not be read."));
}
