export const AGENT_PENDING_REQUEST_POLL_MS = 1000;
export const AGENT_PENDING_REQUEST_FAILURE_NOTICE_THRESHOLD = 3;

export interface AgentPendingRequestSnapshot<Request> {
  readonly lease: object;
  readonly requests: readonly Request[];
  readonly answering: string | null;
  readonly error: string | null;
}

export type AgentPendingRequestPollOutcome<Request> =
  | { readonly kind: "listed"; readonly requests: readonly Request[] }
  | { readonly kind: "unreachable" };

export type AgentPendingRequestPollCadence = "once" | "repeating";

export type AgentPendingRequestAvailability = "available" | "unreachable";

export interface AgentPendingRequestSnapshotPolicy<Request> {
  readonly unreachableNotice: string;
  sameRequest(left: Request, right: Request): boolean;
}

export interface AgentPendingRequestPolling<Request> {
  readonly cadence: AgentPendingRequestPollCadence;
  isCurrent(): boolean;
  revision(): number;
  list(): Promise<readonly Request[]>;
  publish(outcome: AgentPendingRequestPollOutcome<Request>): void;
}

export function emptyAgentPendingRequestSnapshot<Request>(
  lease: object,
): AgentPendingRequestSnapshot<Request> {
  return { lease, requests: [], answering: null, error: null };
}

export function agentPendingRequestSnapshotAfterPoll<Request>(
  previous: AgentPendingRequestSnapshot<Request> | null,
  lease: object,
  outcome: AgentPendingRequestPollOutcome<Request>,
  policy: AgentPendingRequestSnapshotPolicy<Request>,
): AgentPendingRequestSnapshot<Request> {
  const owned =
    previous?.lease === lease ? previous : emptyAgentPendingRequestSnapshot<Request>(lease);
  switch (outcome.kind) {
    case "listed": {
      const unchanged = sameAgentPendingRequestItems(
        owned.requests,
        outcome.requests,
        policy.sameRequest,
      );
      return snapshotWith(owned, unchanged ? owned.requests : outcome.requests, null);
    }
    case "unreachable":
      return snapshotWith(owned, owned.requests, policy.unreachableNotice);
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

export function agentPendingRequestSnapshotWhileSuspended<Request>(
  previous: AgentPendingRequestSnapshot<Request> | null,
  lease: object,
  policy: AgentPendingRequestSnapshotPolicy<Request>,
): AgentPendingRequestSnapshot<Request> | null {
  if (previous?.lease !== lease || previous.error !== policy.unreachableNotice) return previous;
  return { ...previous, error: null };
}

export function sameAgentPendingRequestItems<Item>(
  left: readonly Item[],
  right: readonly Item[],
  same: (left: Item, right: Item) => boolean,
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const candidate = right[index];
    return candidate !== undefined && same(item, candidate);
  });
}

function snapshotWith<Request>(
  current: AgentPendingRequestSnapshot<Request>,
  requests: readonly Request[],
  error: string | null,
): AgentPendingRequestSnapshot<Request> {
  if (current.requests === requests && current.error === error) return current;
  return { ...current, requests, error };
}

export function agentPendingRequestFailureNoticeThreshold(
  cadence: AgentPendingRequestPollCadence,
): number {
  switch (cadence) {
    case "once":
      return 1;
    case "repeating":
      return AGENT_PENDING_REQUEST_FAILURE_NOTICE_THRESHOLD;
    default: {
      const exhaustive: never = cadence;
      return exhaustive;
    }
  }
}

export function startAgentPendingRequestPolling<Request>(
  polling: AgentPendingRequestPolling<Request>,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let consecutiveFailures = 0;
  const noticeThreshold = agentPendingRequestFailureNoticeThreshold(polling.cadence);
  const live = (): boolean => !stopped && polling.isCurrent();
  const report = (outcome: AgentPendingRequestPollOutcome<Request>): void => {
    consecutiveFailures = outcome.kind === "listed" ? 0 : consecutiveFailures + 1;
    if (outcome.kind === "unreachable" && consecutiveFailures < noticeThreshold) return;
    polling.publish(outcome);
  };
  const poll = async (): Promise<void> => {
    const revision = polling.revision();
    const outcome = await pollOutcome(polling);
    if (live() && revision === polling.revision()) report(outcome);
    if (!live() || polling.cadence === "once") return;
    timer = setTimeout(() => {
      void poll();
    }, AGENT_PENDING_REQUEST_POLL_MS);
  };
  void poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

async function pollOutcome<Request>(
  polling: AgentPendingRequestPolling<Request>,
): Promise<AgentPendingRequestPollOutcome<Request>> {
  try {
    return { kind: "listed", requests: await polling.list() };
  } catch {
    return { kind: "unreachable" };
  }
}
