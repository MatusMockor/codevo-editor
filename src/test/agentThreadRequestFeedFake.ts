import { vi, type Mock } from "vitest";
import wire from "../../contracts/agent-runtime-request-wire.json";
import type {
  AgentThreadRequestFeed,
  AgentThreadRequestScope,
} from "../application/agentThreadRequestPorts";
import {
  parseAgentRuntimeRequest,
  type AgentRuntimeRequest,
  type AgentThreadRequests,
} from "../domain/agentRuntimeRequest";

type ThreadRequestsHandler = (message: AgentThreadRequests) => void;
type WireValue = Readonly<Record<string, unknown>>;

interface WireCase {
  readonly name: string;
  readonly value: WireValue;
}

export interface AgentThreadRequestFeedFake extends AgentThreadRequestFeed {
  readonly currentThreadRequests: Mock<AgentThreadRequestFeed["currentThreadRequests"]>;
  readonly subscribeThreadRequests: Mock<AgentThreadRequestFeed["subscribeThreadRequests"]>;
  readonly unsubscribed: Mock<() => void>;
  subscribers(): number;
  record(message: AgentThreadRequests): void;
  push(message: AgentThreadRequests): void;
  publish(message: AgentThreadRequests): void;
}

const WIRE_REQUESTS: readonly WireCase[] = wire.requests.valid;

export function agentRuntimeRequestOf(
  name: string,
  overrides: WireValue = {},
): AgentRuntimeRequest {
  const base = WIRE_REQUESTS.find((candidate) => candidate.name === name);
  return parseAgentRuntimeRequest({ ...base?.value, ...overrides });
}

export function agentThreadRequestsOf(
  scope: Pick<AgentThreadRequestScope, "threadId" | "workspaceId">,
  requests: readonly AgentRuntimeRequest[] = [],
  overrides: Partial<AgentThreadRequests> = {},
): AgentThreadRequests {
  return {
    workspaceId: scope.workspaceId,
    threadId: scope.threadId,
    epoch: "boot-0001",
    journal: "saved",
    requests,
    truncated: false,
    unreadable: 0,
    reset: false,
    ...overrides,
  };
}

export function agentThreadRequestFeedFake(): AgentThreadRequestFeedFake {
  const handlers = new Set<ThreadRequestsHandler>();
  const journal = new Map<string, AgentThreadRequests>();
  const unsubscribed = vi.fn<() => void>();
  const record = (message: AgentThreadRequests): void => {
    journal.set(message.threadId, journaled(journal.get(message.threadId), message));
  };
  const push = (message: AgentThreadRequests): void => {
    [...handlers].forEach((handler) => handler(message));
  };
  return {
    currentThreadRequests: vi.fn((scope: AgentThreadRequestScope, turnIds: readonly string[]) => {
      const recorded = journal.get(scope.threadId) ?? agentThreadRequestsOf(scope);
      const requests = recorded.requests.filter((request) => turnIds.includes(request.turnId));
      return Promise.resolve({ ...recorded, requests, reset: false });
    }),
    subscribeThreadRequests: vi.fn((handler: ThreadRequestsHandler) => {
      handlers.add(handler);
      return Promise.resolve(() => {
        handlers.delete(handler);
        unsubscribed();
      });
    }),
    unsubscribed,
    subscribers: () => handlers.size,
    record,
    push,
    publish: (message) => {
      record(message);
      push(message);
    },
  };
}

function journaled(
  recorded: AgentThreadRequests | undefined,
  message: AgentThreadRequests,
): AgentThreadRequests {
  if (recorded === undefined || message.reset || recorded.epoch !== message.epoch) return message;
  const byKey = new Map(recorded.requests.map((request) => [requestKey(request), request]));
  for (const request of message.requests) {
    const known = byKey.get(requestKey(request));
    if (known === undefined || known.version < request.version)
      byKey.set(requestKey(request), request);
  }
  return { ...message, requests: [...byKey.values()] };
}

function requestKey(request: AgentRuntimeRequest): string {
  return `${request.turnId}/${request.id}`;
}
