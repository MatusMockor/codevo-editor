import { vi, type Mock } from "vitest";
import wire from "../../contracts/agent-runtime-request-wire.json";
import {
  AgentThreadRequestsCursorStaleError,
  type AgentThreadRequestFeed,
  type AgentThreadRequestScope,
  type AgentThreadRequestsPage,
} from "../application/agentThreadRequestPorts";
import {
  MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE,
  parseAgentRuntimeRequest,
  type AgentRuntimeRequest,
  type AgentThreadRequests,
} from "../domain/agentRuntimeRequest";

type ThreadRequestsHandler = (message: AgentThreadRequests) => void;
type InvalidationHandler = (epoch: string) => void;
type WireValue = Readonly<Record<string, unknown>>;

interface WireCase {
  readonly name: string;
  readonly value: WireValue;
}

export interface AgentThreadRequestFeedFake extends AgentThreadRequestFeed {
  readonly currentThreadRequests: Mock<AgentThreadRequestFeed["currentThreadRequests"]>;
  readonly subscribeThreadRequests: Mock<AgentThreadRequestFeed["subscribeThreadRequests"]>;
  readonly subscribeThreadRequestInvalidations: Mock<
    (handler: InvalidationHandler) => Promise<() => void>
  >;
  readonly unsubscribed: Mock<() => void>;
  subscribers(): number;
  invalidationSubscribers(): number;
  invalidate(epoch: string): void;
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

export function agentThreadRequestsPageOf(
  message: AgentThreadRequests,
  nextCursor: string | null = null,
): AgentThreadRequestsPage {
  return { message, nextCursor };
}

export function agentThreadRequestFeedFake(): AgentThreadRequestFeedFake {
  const handlers = new Set<ThreadRequestsHandler>();
  const invalidations = new Set<InvalidationHandler>();
  const journal = new Map<string, AgentThreadRequests>();
  const unsubscribed = vi.fn<() => void>();
  const record = (message: AgentThreadRequests): void => {
    journal.set(message.threadId, journaled(journal.get(message.threadId), message));
  };
  const push = (message: AgentThreadRequests): void => {
    [...handlers].forEach((handler) => handler(message));
  };
  return {
    currentThreadRequests: vi.fn(
      (scope: AgentThreadRequestScope, turnIds: readonly string[], cursor: string | null) => {
        const recorded = journal.get(scope.threadId) ?? agentThreadRequestsOf(scope);
        const offset = cursorOffset(cursor);
        if (cursor !== agentThreadRequestsCursorOf(scope, turnIds, recorded.epoch, offset))
          return Promise.reject(new AgentThreadRequestsCursorStaleError());
        const matching = openFirst(
          recorded.requests.filter((request) => turnIds.includes(request.turnId)),
        );
        const end = offset + MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE;
        const requests = matching.slice(offset, end);
        const message = { ...recorded, requests, workspaceId: null, reset: false };
        const nextCursor =
          end < matching.length
            ? agentThreadRequestsCursorOf(scope, turnIds, recorded.epoch, end)
            : null;
        return Promise.resolve({ message, nextCursor });
      },
    ),
    subscribeThreadRequests: vi.fn((handler: ThreadRequestsHandler) => {
      handlers.add(handler);
      return Promise.resolve(() => {
        handlers.delete(handler);
        unsubscribed();
      });
    }),
    subscribeThreadRequestInvalidations: vi.fn((handler: InvalidationHandler) => {
      invalidations.add(handler);
      return Promise.resolve(() => {
        invalidations.delete(handler);
      });
    }),
    unsubscribed,
    subscribers: () => handlers.size,
    invalidationSubscribers: () => invalidations.size,
    invalidate: (epoch) => {
      [...invalidations].forEach((handler) => handler(epoch));
    },
    record,
    push,
    publish: (message) => {
      record(message);
      push(message);
    },
  };
}

export function agentThreadRequestsCursorOf(
  scope: Pick<AgentThreadRequestScope, "rootKey" | "ownerId" | "threadId">,
  turnIds: readonly string[],
  epoch: string,
  offset: number,
): string | null {
  if (offset === 0) return null;
  const bound = JSON.stringify([scope.rootKey, scope.ownerId, scope.threadId, turnIds]);
  return `${epoch}:${offset}:${checksum(bound)}`;
}

function cursorOffset(cursor: string | null): number {
  if (cursor === null) return 0;
  return Number(cursor.split(":").slice(-2)[0]);
}

function checksum(text: string): string {
  let hash = 2_166_136_261;
  for (const character of text)
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 16_777_619);
  return (hash >>> 0).toString(36);
}

function openFirst(requests: readonly AgentRuntimeRequest[]): readonly AgentRuntimeRequest[] {
  const open = requests.filter(isOpen);
  return [...open, ...requests.filter((request) => !isOpen(request))];
}

function isOpen(request: AgentRuntimeRequest): boolean {
  return request.status === "pending" || request.status === "submitting";
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
