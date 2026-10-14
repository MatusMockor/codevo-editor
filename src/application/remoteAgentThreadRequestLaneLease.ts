import type { DeadlineAttempt, MonotonicClock } from "./boundedRetry";
import { REMOTE_AGENT_THREAD_REQUEST_READ_SETTLEMENT_MS } from "./remoteAgentThreadRequestPolicy";
import type { RemoteAgentThreadRequestsPage } from "./remoteAgentThreadRequestPorts";
import type { RemoteAgentThreadRequestLane as Lane } from "./remoteAgentThreadRequestTracking";

export interface RemoteAgentThreadRequestReading {
  readonly lease: object;
  readonly call: Promise<RemoteAgentThreadRequestsPage>;
}

export function occupyLane(
  lane: Lane,
  clock: MonotonicClock,
  start: () => Promise<RemoteAgentThreadRequestsPage>,
): RemoteAgentThreadRequestReading {
  const lease = {};
  lane.lease = lease;
  lane.since = clock();
  return { lease, call: start() };
}

export function vacateLane(
  lane: Lane,
  reading: RemoteAgentThreadRequestReading,
  attempt: DeadlineAttempt<RemoteAgentThreadRequestsPage>,
  deadlineMs: number,
  freed: (lane: Lane) => void,
): void {
  const free = (): void => {
    if (lane.lease !== reading.lease) return;
    vacated(lane);
    freed(lane);
  };
  void reading.call.then(free, free);
  if (attempt.kind !== "timedOut" || lane.lease !== reading.lease) return;
  lane.stranded = setTimeout(free, REMOTE_AGENT_THREAD_REQUEST_READ_SETTLEMENT_MS - deadlineMs);
}

export function reclaimLane(lane: Lane, clock: MonotonicClock): void {
  if (lane.lease === null) return;
  if (clock() - lane.since < REMOTE_AGENT_THREAD_REQUEST_READ_SETTLEMENT_MS) return;
  vacated(lane);
}

function vacated(lane: Lane): void {
  clearTimeout(lane.stranded);
  lane.stranded = undefined;
  lane.lease = null;
}
