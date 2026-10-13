import { describe, expect, it, vi } from "vitest";
import wire from "../../contracts/agent-runtime-request-wire.json";
import {
  MAX_AGENT_THREAD_REQUEST_TURN_IDS_PER_PULL,
  isAgentThreadRequestFeed,
  type AgentThreadRequestScope,
} from "../application/agentThreadRequestPorts";
import {
  MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE,
  type AgentThreadRequests,
} from "../domain/agentRuntimeRequest";
import { MAX_AGENT_TASK_PATH_BYTES, MAX_AGENT_TASK_WORKSPACE_ID_BYTES } from "../domain/agentTask";
import {
  AGENT_THREAD_REQUESTS_EVENT,
  TauriAgentThreadRequestFeed,
  type AgentThreadRequestRuntimeDetector,
  type InvokeAgentThreadRequestCommand,
  type ListenToAgentThreadRequestEvent,
} from "./tauriAgentThreadRequestFeed";

type WireValue = Readonly<Record<string, unknown>>;

interface ValidCase {
  readonly name: string;
  readonly value: WireValue;
}

interface InvalidCase {
  readonly name: string;
  readonly base: string;
  readonly patch: WireValue;
  readonly omit?: readonly string[];
}

const VALID_REQUESTS: readonly ValidCase[] = wire.requests.valid;
const INVALID_REQUESTS: readonly InvalidCase[] = wire.requests.invalid;
const VALID_THREAD_REQUESTS: readonly ValidCase[] = wire.threadRequests.valid;
const INVALID_THREAD_REQUESTS: readonly InvalidCase[] = wire.threadRequests.invalid;

const scope: AgentThreadRequestScope = {
  rootKey: "/repo/alpha",
  ownerId: "agent-root:00000000000000aa",
  threadId: "agt-thread-0001",
  workspaceId: "workspace-alpha",
};
const turnIds = ["agt-turn-0001", "agt-turn-0002"] as const;

const available: AgentThreadRequestRuntimeDetector = () => true;
const unavailable: AgentThreadRequestRuntimeDetector = () => false;

type ThreadRequestEventHandler = (event: { payload: unknown }) => void;

function patched(cases: readonly ValidCase[], invalid: InvalidCase): WireValue {
  const base = cases.find((candidate) => candidate.name === invalid.base);
  const omitted = invalid.omit ?? [];
  const value = { ...base?.value, ...invalid.patch };
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.includes(key)));
}

function threadRequests(requests: readonly unknown[], overrides: WireValue = {}): WireValue {
  return {
    workspaceId: "workspace-alpha",
    threadId: "agt-thread-0001",
    epoch: "boot-0001",
    journal: "saved",
    requests,
    truncated: false,
    unreadable: 0,
    reset: false,
    ...overrides,
  };
}

function numberedRequests(count: number): readonly WireValue[] {
  return Array.from({ length: count }, (_unused, index) => ({
    ...VALID_REQUESTS[0]?.value,
    id: `req-${index}`,
  }));
}

const validMessages: ReadonlyArray<readonly [string, WireValue]> = [
  ...VALID_THREAD_REQUESTS.map((valid) => [valid.name, valid.value] as const),
  ...VALID_REQUESTS.map((valid) => [valid.name, threadRequests([valid.value])] as const),
  ["a full message", threadRequests(numberedRequests(MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE))],
];

const invalidMessages: ReadonlyArray<readonly [string, unknown]> = [
  ...INVALID_THREAD_REQUESTS.map(
    (invalid) => [invalid.name, patched(VALID_THREAD_REQUESTS, invalid)] as const,
  ),
  ...INVALID_REQUESTS.map(
    (invalid) => [invalid.name, threadRequests([patched(VALID_REQUESTS, invalid)])] as const,
  ),
  [
    "more records than one message holds",
    threadRequests(numberedRequests(MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE + 1)),
  ],
  ["a list instead of a message", [threadRequests([])]],
  ["null", null],
  ["text", "requests"],
];

function fakeEventBus() {
  const handlers = new Map<string, Set<ThreadRequestEventHandler>>();
  const listen = vi.fn<ListenToAgentThreadRequestEvent>((event, handler) => {
    const subscribed = handlers.get(event) ?? new Set<ThreadRequestEventHandler>();
    subscribed.add(handler);
    handlers.set(event, subscribed);
    return Promise.resolve(() => {
      subscribed.delete(handler);
    });
  });
  const emit = (event: string, payload: unknown): void => {
    handlers.get(event)?.forEach((handler) => handler({ payload }));
  };
  return { listen, emit };
}

function feedReturning(payload: unknown) {
  const invoke = vi.fn<InvokeAgentThreadRequestCommand>().mockResolvedValue(payload);
  return { invoke, feed: new TauriAgentThreadRequestFeed(invoke, vi.fn(), available) };
}

function scopeOf(message: WireValue): AgentThreadRequestScope {
  return { ...scope, threadId: String(message.threadId) };
}

describe("TauriAgentThreadRequestFeed", () => {
  it("satisfies the thread request feed port", () => {
    expect(
      isAgentThreadRequestFeed(new TauriAgentThreadRequestFeed(vi.fn(), vi.fn(), available)),
    ).toBe(true);
    expect(isAgentThreadRequestFeed({ currentThreadRequests: vi.fn() })).toBe(false);
    expect(isAgentThreadRequestFeed(null)).toBe(false);
  });

  it("pulls with exactly the root, owner, thread and turn identity", async () => {
    const { invoke, feed } = feedReturning(threadRequests([]));

    await expect(feed.currentThreadRequests(scope, turnIds)).resolves.toStrictEqual(
      threadRequests([]),
    );

    expect(invoke.mock.calls).toStrictEqual([
      [
        "get_agent_thread_requests",
        {
          request: {
            rootKey: "/repo/alpha",
            ownerId: "agent-root:00000000000000aa",
            threadId: "agt-thread-0001",
            turnIds: ["agt-turn-0001", "agt-turn-0002"],
          },
        },
      ],
    ]);
  });

  it("never forwards the workspace registration or any other scope field", async () => {
    const { invoke, feed } = feedReturning(threadRequests([]));
    const widened = { ...scope, kind: "local", repositoryRoot: "/repo/nested" };

    await feed.currentThreadRequests(widened, []);

    expect(invoke.mock.calls[0]?.[1]).toStrictEqual({
      request: {
        rootKey: "/repo/alpha",
        ownerId: "agent-root:00000000000000aa",
        threadId: "agt-thread-0001",
        turnIds: [],
      },
    });
  });

  it.each(validMessages)("accepts the pulled contract message %s", async (_label, message) => {
    const { feed } = feedReturning(message);

    await expect(feed.currentThreadRequests(scopeOf(message), turnIds)).resolves.toStrictEqual(
      message,
    );
  });

  it.each(invalidMessages)("rejects the pulled message with %s", async (_label, message) => {
    const { feed } = feedReturning(message);

    await expect(feed.currentThreadRequests(scope, turnIds)).rejects.toThrow();
  });

  it("rejects a pull answered for another thread", async () => {
    const { feed } = feedReturning(threadRequests([], { threadId: "agt-thread-0002" }));

    await expect(feed.currentThreadRequests(scope, turnIds)).rejects.toThrow(
      "Agent thread requests belong to another thread.",
    );
  });

  it.each([
    ["a blank root key", { ...scope, rootKey: "" }, turnIds],
    ["a root key with a control character", { ...scope, rootKey: "/repo\u0007" }, turnIds],
    [
      "an oversized root key",
      { ...scope, rootKey: "r".repeat(MAX_AGENT_TASK_PATH_BYTES + 1) },
      turnIds,
    ],
    ["a blank owner", { ...scope, ownerId: "" }, turnIds],
    [
      "an oversized owner",
      { ...scope, ownerId: "o".repeat(MAX_AGENT_TASK_WORKSPACE_ID_BYTES + 1) },
      turnIds,
    ],
    ["a blank thread", { ...scope, threadId: "" }, turnIds],
    ["a path-like thread", { ...scope, threadId: "../thread" }, turnIds],
    ["an oversized thread", { ...scope, threadId: "t".repeat(129) }, turnIds],
    ["a blank turn", scope, [""]],
    ["a malformed turn", scope, ["agt turn"]],
    ["a repeated turn", scope, ["agt-turn-0001", "agt-turn-0001"]],
    [
      "more turns than one pull holds",
      scope,
      Array.from(
        { length: MAX_AGENT_THREAD_REQUEST_TURN_IDS_PER_PULL + 1 },
        (_unused, index) => `agt-turn-${index}`,
      ),
    ],
  ])(
    "rejects %s before reaching the transport, with and without the native runtime",
    async (_label, invalidScope, invalidTurnIds) => {
      const { invoke, feed } = feedReturning(threadRequests([]));
      const offline = new TauriAgentThreadRequestFeed(invoke, vi.fn(), unavailable);

      await expect(feed.currentThreadRequests(invalidScope, invalidTurnIds)).rejects.toThrow();
      await expect(offline.currentThreadRequests(invalidScope, invalidTurnIds)).rejects.toThrow();

      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("pulls the largest turn page the contract allows", async () => {
    const { invoke, feed } = feedReturning(threadRequests([]));
    const page = Array.from(
      { length: MAX_AGENT_THREAD_REQUEST_TURN_IDS_PER_PULL },
      (_unused, index) => `agt-turn-${index}`,
    );

    await feed.currentThreadRequests(scope, page);

    expect(MAX_AGENT_THREAD_REQUEST_TURN_IDS_PER_PULL).toBe(32);
    expect(invoke.mock.calls[0]?.[1].request.turnIds).toStrictEqual(page);
  });

  it("surfaces a backend rejection instead of inventing a message", async () => {
    const invoke = vi
      .fn<InvokeAgentThreadRequestCommand>()
      .mockRejectedValue(new Error("Workspace is not registered."));
    const feed = new TauriAgentThreadRequestFeed(invoke, vi.fn(), available);

    await expect(feed.currentThreadRequests(scope, turnIds)).rejects.toThrow(
      "Workspace is not registered.",
    );
  });

  it("delivers every valid pushed contract message without filtering by thread", async () => {
    const bus = fakeEventBus();
    const feed = new TauriAgentThreadRequestFeed(vi.fn(), bus.listen, available);
    const received: AgentThreadRequests[] = [];

    await feed.subscribeThreadRequests((message) => received.push(message));
    validMessages.forEach(([, message]) => bus.emit(AGENT_THREAD_REQUESTS_EVENT, message));

    expect(bus.listen.mock.calls.map(([event]) => event)).toStrictEqual([
      "agent-thread://requests",
    ]);
    expect(received).toStrictEqual(validMessages.map(([, message]) => message));
    expect(new Set(received.map((message) => message.threadId)).size).toBeGreaterThan(1);
  });

  it("drops malformed pushed messages without throwing into the event loop", async () => {
    const bus = fakeEventBus();
    const feed = new TauriAgentThreadRequestFeed(vi.fn(), bus.listen, available);
    const handler = vi.fn<(message: AgentThreadRequests) => void>();

    await feed.subscribeThreadRequests(handler);
    invalidMessages.forEach(([, message]) => bus.emit(AGENT_THREAD_REQUESTS_EVENT, message));
    bus.emit(AGENT_THREAD_REQUESTS_EVENT, undefined);

    expect(invalidMessages.length).toBeGreaterThan(
      INVALID_THREAD_REQUESTS.length + INVALID_REQUESTS.length,
    );
    expect(handler).not.toHaveBeenCalled();

    bus.emit(AGENT_THREAD_REQUESTS_EVENT, threadRequests([]));

    expect(handler.mock.calls).toStrictEqual([[threadRequests([])]]);
  });

  it("ignores events published on other channels", async () => {
    const bus = fakeEventBus();
    const feed = new TauriAgentThreadRequestFeed(vi.fn(), bus.listen, available);
    const handler = vi.fn<(message: AgentThreadRequests) => void>();

    await feed.subscribeThreadRequests(handler);
    bus.emit("agent-task://interactions", threadRequests([]));

    expect(handler).not.toHaveBeenCalled();
  });

  it("stops delivering after unsubscribe while other subscribers keep receiving", async () => {
    const bus = fakeEventBus();
    const feed = new TauriAgentThreadRequestFeed(vi.fn(), bus.listen, available);
    const first = vi.fn<(message: AgentThreadRequests) => void>();
    const second = vi.fn<(message: AgentThreadRequests) => void>();
    const later = threadRequests([], { unreadable: 1 });

    const unsubscribeFirst = await feed.subscribeThreadRequests(first);
    await feed.subscribeThreadRequests(second);
    bus.emit(AGENT_THREAD_REQUESTS_EVENT, threadRequests([]));
    unsubscribeFirst();
    bus.emit(AGENT_THREAD_REQUESTS_EVENT, later);

    expect(first.mock.calls).toStrictEqual([[threadRequests([])]]);
    expect(second.mock.calls).toStrictEqual([[threadRequests([])], [later]]);
  });

  it("rejects the pull and the subscription without the native runtime instead of inventing data", async () => {
    const invoke = vi.fn<InvokeAgentThreadRequestCommand>();
    const listen = vi.fn<ListenToAgentThreadRequestEvent>();
    const feed = new TauriAgentThreadRequestFeed(invoke, listen, unavailable);
    const handler = vi.fn<(message: AgentThreadRequests) => void>();

    await expect(feed.currentThreadRequests(scope, turnIds)).rejects.toThrow(
      "Agent thread requests need the native runtime.",
    );
    await expect(feed.currentThreadRequests(scope, [])).rejects.toThrow(
      "Agent thread requests need the native runtime.",
    );
    await expect(feed.subscribeThreadRequests(handler)).rejects.toThrow(
      "Agent thread requests need the native runtime.",
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
