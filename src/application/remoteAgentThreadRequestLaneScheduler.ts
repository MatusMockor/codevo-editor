import { attemptWithinDeadline, type DeadlineAttempt, type MonotonicClock } from "./boundedRetry";
import type { RemoteAgentThreadRequestBroadcast } from "./remoteAgentThreadRequestBroadcast";
import {
  occupyLane,
  reclaimLane,
  vacateLane,
  type RemoteAgentThreadRequestReading as Reading,
} from "./remoteAgentThreadRequestLaneLease";
import {
  MAX_REMOTE_AGENT_THREAD_REQUEST_READ_RETRIES,
  REMOTE_AGENT_THREAD_REQUEST_PULL_DEADLINE_MS,
  REMOTE_AGENT_THREAD_REQUEST_READ_DEADLINE_MS,
  remoteAgentThreadRequestReadRetryDelay,
} from "./remoteAgentThreadRequestPolicy";
import type {
  RemoteAgentThreadRequestGateway,
  RemoteAgentThreadRequestTurn,
  RemoteAgentThreadRequestsPage,
  RemoteAgentThreadRequestsRequest,
} from "./remoteAgentThreadRequestPorts";
import type { RemoteAgentThreadRequestPullQueue } from "./remoteAgentThreadRequestPullQueue";
import type { RemoteAgentThreadRequestRegistry } from "./remoteAgentThreadRequestRegistry";
import type { RemoteAgentThreadRequestSendGuards } from "./remoteAgentThreadRequestSendGuards";
import {
  armThread,
  kickDue,
  wantsRead,
  type RemoteAgentThreadRequestLane as Lane,
  type RemoteAgentThreadRequestPullJob as PullJob,
  type RemoteAgentThreadRequestTracked as Tracked,
} from "./remoteAgentThreadRequestTracking";
import type { RemoteAgentThreadRequestReadStep } from "./remoteAgentThreadRequestWatch";

export class RemoteAgentThreadRequestLaneScheduler {
  private readonly pumpLane = (lane: Lane): void => this.pump(lane);

  constructor(
    private readonly gateway: RemoteAgentThreadRequestGateway,
    private readonly clock: MonotonicClock,
    private readonly registry: RemoteAgentThreadRequestRegistry,
    private readonly broadcast: RemoteAgentThreadRequestBroadcast,
    private readonly guards: RemoteAgentThreadRequestSendGuards,
    private readonly pulls: RemoteAgentThreadRequestPullQueue,
  ) {}

  pump(lane: Lane): void {
    reclaimLane(lane, this.clock);
    if (lane.lease !== null) return;
    for (let job = lane.pulls.shift(); job !== undefined; job = lane.pulls.shift()) {
      const turns = this.pullTurns(job);
      if (turns !== null) {
        void this.pull(lane, job, turns);
        return;
      }
      this.pulls.settle(job, null);
    }
    if (lane.threads.size === 0) {
      this.registry.retire(lane);
      return;
    }
    if (lane.timer !== undefined || !hasWork(lane)) return;
    lane.timer = setTimeout(() => {
      lane.timer = undefined;
      this.work(lane);
    }, 0);
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
    if (!this.registry.owns(thread) || !kickDue(thread)) return;
    thread.kickOwed = false;
    if (!thread.pullFailed) return;
    const message = thread.watch.kick();
    if (message === null) {
      thread.watch.prime();
      return;
    }
    this.broadcast.push(thread, message);
  }

  private pullTurns(job: PullJob): readonly RemoteAgentThreadRequestTurn[] | null {
    if (job.done || !this.registry.owns(job.thread) || !job.thread.reachable) return null;
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
    const attempt = await within(reading, REMOTE_AGENT_THREAD_REQUEST_PULL_DEADLINE_MS);
    const page = this.owned(job.thread, attempt);
    if (job.done && page !== null) this.broadcast.announce(job.thread, page.message);
    this.pulls.settle(job, page);
    if (attempt.kind === "timedOut")
      void reading.call.then((late) => this.broadcast.announce(job.thread, late.message), ignore);
    vacateLane(lane, reading, attempt, REMOTE_AGENT_THREAD_REQUEST_PULL_DEADLINE_MS, this.pumpLane);
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
    const attempt = await within(reading, REMOTE_AGENT_THREAD_REQUEST_READ_DEADLINE_MS);
    const page = this.owned(thread, attempt);
    const shared = this.pulls.rejoin(lane, reading.lease, page);
    if (this.registry.owns(thread)) {
      thread.reading = false;
      this.readSettled(thread, step, page, shared);
    }
    vacateLane(lane, reading, attempt, REMOTE_AGENT_THREAD_REQUEST_READ_DEADLINE_MS, this.pumpLane);
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
    this.guards.forgetClosed(thread.key, page.message.requests);
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
        armThread(thread, this.pumpLane);
        break;
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
    if (!shared) {
      this.broadcast.push(thread, settlement.push);
      return;
    }
    const push = settlement.push;
    if (push === null) return;
    setTimeout(() => {
      if (this.registry.owns(thread)) this.broadcast.push(thread, push);
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
    thread.retry = setTimeout(() => {
      thread.retry = undefined;
      this.pump(thread.lane);
    }, remoteAgentThreadRequestReadRetryDelay(thread.failures));
  }

  private occupy(
    lane: Lane,
    thread: Tracked,
    turns: readonly RemoteAgentThreadRequestTurn[],
    cursor: string | null,
  ): Reading {
    const { serverId, runnerId, conversationId: threadId } = thread.identity;
    return occupyLane(lane, this.clock, () =>
      this.started({ serverId, runnerId, threadId, turns, cursor }),
    );
  }

  private async started(
    request: RemoteAgentThreadRequestsRequest,
  ): Promise<RemoteAgentThreadRequestsPage> {
    return this.gateway.threadRequests(request);
  }

  private owned(
    thread: Tracked,
    attempt: DeadlineAttempt<RemoteAgentThreadRequestsPage>,
  ): RemoteAgentThreadRequestsPage | null {
    if (attempt.kind !== "settled" || !this.registry.owns(thread)) return null;
    if (!thread.watch.owns(attempt.value.message)) return null;
    return attempt.value;
  }
}

function hasWork(lane: Lane): boolean {
  return [...lane.threads].some((thread) => kickDue(thread) || wantsRead(thread));
}

function within(
  reading: Reading,
  deadlineMs: number,
): Promise<DeadlineAttempt<RemoteAgentThreadRequestsPage>> {
  return attemptWithinDeadline(() => reading.call, deadlineMs);
}

function ignore(): void {
  return;
}
