import type { AgentInteractionSnapshot } from "../domain/agentInteractionSnapshot";
import type { AgentInteractionOwner } from "./agentInteractionPorts";
import type { AgentInteractionStore } from "./agentInteractionStore";
import {
  startAgentPendingRequestPolling,
  type AgentPendingRequestPollCadence,
  type AgentPendingRequestPollOutcome,
} from "./agentPendingRequestPolling";

export interface AgentPendingRequestItem {
  readonly id: string;
  readonly status: string;
}

export interface AgentPendingRequestSink<Request> {
  isCurrent(): boolean;
  revision(): number;
  reconcile(listed: readonly Request[]): readonly Request[];
  publish(outcome: AgentPendingRequestPollOutcome<Request>): void;
}

export interface AgentPendingRequestConfirmations<Request> {
  confirm(requestId: string, result: Request): void;
  settled(listed: readonly Request[], requestId: string, result: Request): readonly Request[];
  reconcile(listed: readonly Request[]): readonly Request[];
}

export interface AgentPendingRequestSource<Request> {
  readonly unreachableNotice: string;
  confirmations(): AgentPendingRequestConfirmations<Request>;
  start(sink: AgentPendingRequestSink<Request>): () => void;
}

export interface PolledAgentPendingRequests<Request> {
  readonly cadence: AgentPendingRequestPollCadence;
  readonly unreachableNotice: string;
  list(): Promise<readonly Request[]>;
}

export interface PushedAgentPendingRequests<Request> {
  readonly store: AgentInteractionStore;
  readonly owner: AgentInteractionOwner;
  readonly unreachableNotice: string;
  select(snapshot: AgentInteractionSnapshot): readonly Request[];
}

export function polledAgentPendingRequestSource<Request extends AgentPendingRequestItem>(
  polled: PolledAgentPendingRequests<Request>,
): AgentPendingRequestSource<Request> {
  return {
    unreachableNotice: polled.unreachableNotice,
    confirmations: () => Object.freeze(new ReplacedConfirmations<Request>()),
    start: (sink) =>
      startAgentPendingRequestPolling<Request>({
        cadence: polled.cadence,
        isCurrent: () => sink.isCurrent(),
        revision: () => sink.revision(),
        list: () => polled.list(),
        publish: (outcome) => sink.publish(outcome),
      }),
  };
}

export function pushedAgentPendingRequestSource<Request extends AgentPendingRequestItem>(
  pushed: PushedAgentPendingRequests<Request>,
): AgentPendingRequestSource<Request> {
  return {
    unreachableNotice: pushed.unreachableNotice,
    confirmations: () => new OverlaidConfirmations<Request>(),
    start: (sink) =>
      pushed.store.watch(pushed.owner, (observation) => {
        if (!sink.isCurrent()) return;
        switch (observation.kind) {
          case "pending":
            return;
          case "observed":
            sink.publish({
              kind: "listed",
              requests: sink.reconcile(pushed.select(observation.snapshot)),
            });
            return;
          case "unavailable":
            sink.publish({ kind: "unreachable" });
            return;
          default: {
            const exhaustive: never = observation;
            return exhaustive;
          }
        }
      }),
  };
}

class ReplacedConfirmations<
  Request extends AgentPendingRequestItem,
> implements AgentPendingRequestConfirmations<Request> {
  confirm(): void {
    return;
  }

  settled(listed: readonly Request[], requestId: string, result: Request): readonly Request[] {
    return listed.map((request) => (request.id === requestId ? result : request));
  }

  reconcile(listed: readonly Request[]): readonly Request[] {
    return listed;
  }
}

class OverlaidConfirmations<
  Request extends AgentPendingRequestItem,
> implements AgentPendingRequestConfirmations<Request> {
  private confirmed: ReadonlyMap<string, Request> = new Map();

  confirm(requestId: string, result: Request): void {
    this.confirmed = new Map(this.confirmed).set(requestId, result);
  }

  settled(listed: readonly Request[], requestId: string, result: Request): readonly Request[] {
    return listed.map((request) =>
      request.id === requestId && request.status === "pending" ? result : request,
    );
  }

  reconcile(listed: readonly Request[]): readonly Request[] {
    if (this.confirmed.size === 0) return listed;
    const awaited = new Map<string, Request>();
    const reconciled = listed.map((request) => {
      const settled = this.confirmed.get(request.id);
      if (settled === undefined || request.status !== "pending") return request;
      awaited.set(request.id, settled);
      return settled;
    });
    this.confirmed = awaited;
    if (awaited.size === 0) return listed;
    return reconciled;
  }
}
