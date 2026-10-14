import { vi, type Mock } from "vitest";
import type {
  RemoteAgentThreadRequestGateway,
  RemoteAgentThreadRequestTurn,
  RemoteAgentThreadRequestsPage,
  RemoteAgentThreadRequestsRequest,
  RemoteAgentThreadRespondRequest,
  RemoteAgentThreadRespondResult,
} from "../application/remoteAgentThreadRequestPorts";
import {
  MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE,
  type AgentRuntimeRequest,
  type AgentThreadRequests,
} from "../domain/agentRuntimeRequest";
import type { RemoteAgentThreadRequestScope } from "../domain/remoteAgentThreadRequestScope";
import { agentRuntimeRequestOf } from "./agentThreadRequestFeedFake";

export const REMOTE_AGENT_THREAD_REQUEST_FAKE_EPOCH = "rr1-snapshot";

export type RemoteAgentThreadRequestFakeTarget = Pick<
  RemoteAgentThreadRequestsRequest,
  "serverId" | "threadId"
>;

export type RemoteAgentThreadRequestFakeEnvelope = Pick<
  AgentThreadRequests,
  "epoch" | "journal" | "truncated" | "unreadable"
>;

export interface RemoteAgentThreadRequestGatewayFake extends RemoteAgentThreadRequestGateway {
  readonly threadRequests: Mock<RemoteAgentThreadRequestGateway["threadRequests"]>;
  readonly respond: Mock<RemoteAgentThreadRequestGateway["respond"]>;
  record(
    target: RemoteAgentThreadRequestFakeTarget,
    requests: readonly AgentRuntimeRequest[],
  ): void;
  stamp(
    target: RemoteAgentThreadRequestFakeTarget,
    envelope: Partial<RemoteAgentThreadRequestFakeEnvelope>,
  ): void;
  disconnect(): void;
  connect(): void;
  holdReads(): () => void;
  readsInFlight(serverId: string): number;
  peakReadsInFlight(serverId: string): number;
  readsOf(target: RemoteAgentThreadRequestFakeTarget): readonly RemoteAgentThreadRequestsRequest[];
}

interface Journal {
  readonly envelope: RemoteAgentThreadRequestFakeEnvelope;
  readonly requests: ReadonlyMap<string, AgentRuntimeRequest>;
}

const CURSOR_PREFIX = "t:";
const BLANK: Journal = {
  envelope: {
    epoch: REMOTE_AGENT_THREAD_REQUEST_FAKE_EPOCH,
    journal: "saved",
    truncated: false,
    unreadable: 0,
  },
  requests: new Map(),
};

export function remoteAgentThreadRequestGatewayFake(): RemoteAgentThreadRequestGatewayFake {
  const journals = new Map<string, Journal>();
  const inFlight = new Map<string, number>();
  const peaks = new Map<string, number>();
  let connected = true;
  let gate: Promise<void> = Promise.resolve();

  const journalOf = (target: RemoteAgentThreadRequestFakeTarget): Journal =>
    journals.get(targetKey(target)) ?? BLANK;

  const entered = (serverId: string): void => {
    const count = (inFlight.get(serverId) ?? 0) + 1;
    inFlight.set(serverId, count);
    peaks.set(serverId, Math.max(peaks.get(serverId) ?? 0, count));
  };

  const left = (serverId: string): void => {
    inFlight.set(serverId, (inFlight.get(serverId) ?? 1) - 1);
  };

  const pageOf = (request: RemoteAgentThreadRequestsRequest): RemoteAgentThreadRequestsPage => {
    const journal = journalOf(request);
    const turnIds = new Set(request.turns.map((turn) => turn.turnId));
    const matching = [...journal.requests.values()].filter((item) => turnIds.has(item.turnId));
    const offset = request.cursor === null ? 0 : Number(request.cursor.slice(CURSOR_PREFIX.length));
    const end = offset + MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE;
    return {
      message: {
        ...journal.envelope,
        workspaceId: request.serverId,
        threadId: request.threadId,
        requests: matching.slice(offset, end),
        reset: false,
      },
      nextCursor: end < matching.length ? `${CURSOR_PREFIX}${end}` : null,
    };
  };

  const read = async (
    request: RemoteAgentThreadRequestsRequest,
  ): Promise<RemoteAgentThreadRequestsPage> => {
    entered(request.serverId);
    await gate;
    left(request.serverId);
    if (!connected) return Promise.reject(new Error("Server is not connected"));
    return pageOf(request);
  };

  const respond = (
    request: RemoteAgentThreadRespondRequest,
  ): Promise<RemoteAgentThreadRespondResult> => {
    if (!connected) return Promise.reject(new Error("Server is not connected"));
    const page = pageOf({ ...request, turns: [request.turn], cursor: null });
    return Promise.resolve({ outcome: "answered", message: page.message });
  };

  const threadRequests = vi.fn(read);

  return {
    threadRequests,
    respond: vi.fn(respond),
    record: (target, requests) => {
      const journal = journalOf(target);
      const merged = new Map(journal.requests);
      for (const request of requests) merged.set(`${request.turnId}/${request.id}`, request);
      journals.set(targetKey(target), { envelope: journal.envelope, requests: merged });
    },
    stamp: (target, envelope) => {
      const journal = journalOf(target);
      journals.set(targetKey(target), {
        envelope: { ...journal.envelope, ...envelope },
        requests: journal.requests,
      });
    },
    disconnect: () => {
      connected = false;
    },
    connect: () => {
      connected = true;
    },
    holdReads: () => {
      let open: () => void = () => undefined;
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      return () => {
        gate = Promise.resolve();
        open();
      };
    },
    readsInFlight: (serverId) => inFlight.get(serverId) ?? 0,
    peakReadsInFlight: (serverId) => peaks.get(serverId) ?? 0,
    readsOf: (target) =>
      threadRequests.mock.calls
        .map(([request]) => request)
        .filter((request) => targetKey(request) === targetKey(target)),
  };
}

function targetKey(target: RemoteAgentThreadRequestFakeTarget): string {
  return JSON.stringify([target.serverId, target.threadId]);
}

export function remoteAgentThreadRequestScopeOf(
  serverId: string,
  conversationId: string,
  runnerId = "runner-1",
): RemoteAgentThreadRequestScope {
  const projectKey = `remote:${serverId}:${runnerId}:project-1`;
  return {
    rootKey: projectKey,
    ownerId: projectKey,
    threadId: conversationId,
    workspaceId: serverId,
  };
}

export function remoteAgentThreadRequestTurnOf(
  turnId: string,
  interactionSequence: number | null,
  terminal = false,
): RemoteAgentThreadRequestTurn {
  return { turnId, startedAtEpochMs: 1_760_000_000_000, interactionSequence, terminal };
}

export function remoteAgentThreadRequestPending(
  turnId: string,
  id: string,
  version = 1,
): AgentRuntimeRequest {
  return agentRuntimeRequestOf("pendingApproval", {
    turnId,
    id,
    version,
    createdAtEpochMs: 1_760_000_000_000,
    order: 0,
  });
}

export function remoteAgentThreadRequestResolved(
  turnId: string,
  id: string,
  version = 3,
): AgentRuntimeRequest {
  return agentRuntimeRequestOf("resolvedApproval", {
    turnId,
    id,
    version,
    createdAtEpochMs: 1_760_000_000_000,
    resolvedAtEpochMs: 1_760_000_000_001,
    order: 0,
  });
}
