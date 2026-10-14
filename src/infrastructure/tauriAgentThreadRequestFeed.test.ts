import { describe, expect, it, vi } from "vitest";
import wire from "../../contracts/agent-runtime-request-wire.json";
import {
  AGENT_THREAD_REQUESTS_CURSOR_STALE_MESSAGE,
  AgentThreadRequestsCursorStaleError,
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
  MAX_AGENT_THREAD_REQUESTS_CURSOR_CHARS,
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

function pullMessage(requests: readonly unknown[], overrides: WireValue = {}): WireValue {
  return threadRequests(requests, { workspaceId: null, ...overrides });
}

function pullShaped(value: WireValue, patch: WireValue = {}): WireValue {
  if ("workspaceId" in patch) return value;
  return { ...value, workspaceId: null };
}

function isPullShaped(message: WireValue): boolean {
  return message.workspaceId === null && message.reset === false;
}

function numberedRequests(count: number): readonly WireValue[] {
  return Array.from({ length: count }, (_unused, index) => ({
    ...VALID_REQUESTS[0]?.value,
    id: `req-${index}`,
  }));
}

const pushedMessages: ReadonlyArray<readonly [string, WireValue]> = [
  ...VALID_THREAD_REQUESTS.map((valid) => [valid.name, valid.value] as const),
  ...VALID_REQUESTS.map((valid) => [valid.name, threadRequests([valid.value])] as const),
  ["a full message", threadRequests(numberedRequests(MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE))],
];

const pulledMessages: ReadonlyArray<readonly [string, WireValue]> = [
  ...VALID_THREAD_REQUESTS.map(
    (valid) => [valid.name, { ...pullShaped(valid.value), reset: false }] as const,
  ),
  ...VALID_REQUESTS.map((valid) => [valid.name, pullMessage([valid.value])] as const),
  ["a full message", pullMessage(numberedRequests(MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE))],
];

const pushOnlyMessages: ReadonlyArray<readonly [string, WireValue]> = [
  ...pushedMessages.filter(([, message]) => !isPullShaped(message)),
  ["a reset without a workspace", pullMessage([], { reset: true })],
  ["a workspace without a reset", threadRequests([])],
];

const invalidPulledMessages: ReadonlyArray<readonly [string, unknown]> = [
  ...INVALID_THREAD_REQUESTS.map(
    (invalid) =>
      [invalid.name, pullShaped(patched(VALID_THREAD_REQUESTS, invalid), invalid.patch)] as const,
  ),
  ...INVALID_REQUESTS.map(
    (invalid) => [invalid.name, pullMessage([patched(VALID_REQUESTS, invalid)])] as const,
  ),
  [
    "more records than one message holds",
    pullMessage(numberedRequests(MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE + 1)),
  ],
  ["a list instead of a message", [pullMessage([])]],
  ["null", null],
  ["text", "requests"],
];

const invalidPushedMessages: ReadonlyArray<readonly [string, unknown]> = [
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

function pulled(message: unknown, nextCursor: unknown = null): WireValue {
  return { message, nextCursor };
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

  it("pulls with exactly the root, owner, thread, turn identity and cursor", async () => {
    const { invoke, feed } = feedReturning(pulled(pullMessage([])));

    await expect(feed.currentThreadRequests(scope, turnIds, null)).resolves.toStrictEqual({
      message: pullMessage([]),
      nextCursor: null,
    });

    expect(invoke.mock.calls).toStrictEqual([
      [
        "get_agent_thread_requests",
        {
          request: {
            rootKey: "/repo/alpha",
            ownerId: "agent-root:00000000000000aa",
            threadId: "agt-thread-0001",
            turnIds: ["agt-turn-0001", "agt-turn-0002"],
            cursor: null,
          },
        },
      ],
    ]);
  });

  it("sends a continuation cursor back unchanged and returns the next one", async () => {
    const next = "c".repeat(MAX_AGENT_THREAD_REQUESTS_CURSOR_CHARS);
    const { invoke, feed } = feedReturning(pulled(pullMessage([]), next));

    await expect(
      feed.currentThreadRequests(scope, turnIds, "boot-0001:64_a.B"),
    ).resolves.toStrictEqual({ message: pullMessage([]), nextCursor: next });

    expect(MAX_AGENT_THREAD_REQUESTS_CURSOR_CHARS).toBe(256);
    expect(invoke.mock.calls[0]?.[1].request.cursor).toBe("boot-0001:64_a.B");
  });

  it("never forwards the workspace registration or any other scope field", async () => {
    const { invoke, feed } = feedReturning(pulled(pullMessage([])));
    const widened = { ...scope, kind: "local", repositoryRoot: "/repo/nested" };

    await feed.currentThreadRequests(widened, [], null);

    expect(invoke.mock.calls[0]?.[1]).toStrictEqual({
      request: {
        rootKey: "/repo/alpha",
        ownerId: "agent-root:00000000000000aa",
        threadId: "agt-thread-0001",
        turnIds: [],
        cursor: null,
      },
    });
  });

  it.each(pulledMessages)("accepts the pulled contract message %s", async (_label, message) => {
    const { feed } = feedReturning(pulled(message));

    await expect(
      feed.currentThreadRequests(scopeOf(message), turnIds, null),
    ).resolves.toStrictEqual({ message, nextCursor: null });
  });

  it.each(invalidPulledMessages)("rejects the pulled message with %s", async (_label, message) => {
    const { feed } = feedReturning(pulled(message));

    await expect(feed.currentThreadRequests(scope, turnIds, null)).rejects.toThrow();
  });

  it.each(pushOnlyMessages)(
    "rejects the pushed-only message %s as a pull answer",
    async (_label, message) => {
      const { feed } = feedReturning(pulled(message));

      await expect(feed.currentThreadRequests(scopeOf(message), turnIds, null)).rejects.toThrow(
        "Agent thread requests were answered with a pushed message.",
      );
    },
  );

  it("keeps pull and push cases apart", () => {
    expect(pulledMessages.every(([, message]) => isPullShaped(message))).toBe(true);
    expect(pushOnlyMessages.some(([, message]) => message.reset === true)).toBe(true);
    expect(pushOnlyMessages.some(([, message]) => message.workspaceId !== null)).toBe(true);
    expect(pushOnlyMessages.length).toBeGreaterThan(VALID_REQUESTS.length);
  });

  it.each([
    ["a bare message without the page envelope", pullMessage([])],
    ["a missing next cursor", { message: pullMessage([]) }],
    ["an undefined next cursor", { message: pullMessage([]), nextCursor: undefined }],
    ["a missing message", { nextCursor: null }],
    ["an unknown page key", { ...pulled(pullMessage([])), total: 1 }],
    ["a renamed cursor key", { message: pullMessage([]), next_cursor: null }],
    ["an empty next cursor", pulled(pullMessage([]), "")],
    ["a numeric next cursor", pulled(pullMessage([]), 64)],
    ["a next cursor with a space", pulled(pullMessage([]), "boot 64")],
    ["a next cursor with a slash", pulled(pullMessage([]), "boot/64")],
    ["a next cursor with a line break", pulled(pullMessage([]), "boot\n64")],
    [
      "an oversized next cursor",
      pulled(pullMessage([]), "c".repeat(MAX_AGENT_THREAD_REQUESTS_CURSOR_CHARS + 1)),
    ],
    ["a list instead of a page", [pulled(pullMessage([]))]],
    ["null", null],
  ])("rejects a pulled page with %s", async (_label, page) => {
    const { feed } = feedReturning(page);

    await expect(feed.currentThreadRequests(scope, turnIds, null)).rejects.toThrow();
  });

  it("rejects a pull answered for another thread", async () => {
    const { feed } = feedReturning(pulled(pullMessage([], { threadId: "agt-thread-0002" })));

    await expect(feed.currentThreadRequests(scope, turnIds, null)).rejects.toThrow(
      "Agent thread requests belong to another thread.",
    );
  });

  it.each([
    ["an empty cursor", ""],
    ["a cursor with a space", "boot 64"],
    ["a cursor with a control character", "boot\u000764"],
    ["an oversized cursor", "c".repeat(MAX_AGENT_THREAD_REQUESTS_CURSOR_CHARS + 1)],
  ])("rejects %s before reaching the transport", async (_label, cursor) => {
    const { invoke, feed } = feedReturning(pulled(pullMessage([])));

    await expect(feed.currentThreadRequests(scope, turnIds, cursor)).rejects.toThrow();

    expect(invoke).not.toHaveBeenCalled();
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
      const { invoke, feed } = feedReturning(pulled(pullMessage([])));
      const offline = new TauriAgentThreadRequestFeed(invoke, vi.fn(), unavailable);

      await expect(
        feed.currentThreadRequests(invalidScope, invalidTurnIds, null),
      ).rejects.toThrow();
      await expect(
        offline.currentThreadRequests(invalidScope, invalidTurnIds, null),
      ).rejects.toThrow();

      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("pulls the largest turn page the contract allows", async () => {
    const { invoke, feed } = feedReturning(pulled(pullMessage([])));
    const page = Array.from(
      { length: MAX_AGENT_THREAD_REQUEST_TURN_IDS_PER_PULL },
      (_unused, index) => `agt-turn-${index}`,
    );

    await feed.currentThreadRequests(scope, page, null);

    expect(MAX_AGENT_THREAD_REQUEST_TURN_IDS_PER_PULL).toBe(32);
    expect(invoke.mock.calls[0]?.[1].request.turnIds).toStrictEqual(page);
  });

  it.each([
    ["the exact text", AGENT_THREAD_REQUESTS_CURSOR_STALE_MESSAGE],
    ["an error with the exact text", new Error(AGENT_THREAD_REQUESTS_CURSOR_STALE_MESSAGE)],
  ])("maps a cursor invalidation answered as %s to the typed error", async (_label, rejection) => {
    const invoke = vi.fn<InvokeAgentThreadRequestCommand>().mockRejectedValue(rejection);
    const feed = new TauriAgentThreadRequestFeed(invoke, vi.fn(), available);

    const pull = feed.currentThreadRequests(scope, turnIds, "c2.boot-0001.64");

    await expect(pull).rejects.toBeInstanceOf(AgentThreadRequestsCursorStaleError);
    await expect(pull).rejects.toThrow(AGENT_THREAD_REQUESTS_CURSOR_STALE_MESSAGE);
    expect(AGENT_THREAD_REQUESTS_CURSOR_STALE_MESSAGE).toBe(
      "Agent thread request cursor is no longer valid.",
    );
  });

  it.each([
    ["text without the final period", "Agent thread request cursor is no longer valid"],
    ["text with a trailing space", "Agent thread request cursor is no longer valid. "],
    ["text in another case", "agent thread request cursor is no longer valid."],
    ["text with a prefix", "Error: Agent thread request cursor is no longer valid."],
    ["another error text", new Error("Agent thread request journal is not owned here.")],
    ["an object carrying the text", { message: AGENT_THREAD_REQUESTS_CURSOR_STALE_MESSAGE }],
  ])("keeps any other rejection as it is: %s", async (_label, rejection) => {
    const invoke = vi.fn<InvokeAgentThreadRequestCommand>().mockRejectedValue(rejection);
    const feed = new TauriAgentThreadRequestFeed(invoke, vi.fn(), available);

    const settled = await feed.currentThreadRequests(scope, turnIds, "c2.boot-0001.64").then(
      () => "resolved",
      (error: unknown) => error,
    );

    expect(settled).toBe(rejection);
    expect(settled).not.toBeInstanceOf(AgentThreadRequestsCursorStaleError);
  });

  it("surfaces a backend rejection instead of inventing a message", async () => {
    const invoke = vi
      .fn<InvokeAgentThreadRequestCommand>()
      .mockRejectedValue(new Error("Workspace is not registered."));
    const feed = new TauriAgentThreadRequestFeed(invoke, vi.fn(), available);

    await expect(feed.currentThreadRequests(scope, turnIds, null)).rejects.toThrow(
      "Workspace is not registered.",
    );
  });

  it("delivers every valid pushed contract message without filtering by thread", async () => {
    const bus = fakeEventBus();
    const feed = new TauriAgentThreadRequestFeed(vi.fn(), bus.listen, available);
    const received: AgentThreadRequests[] = [];

    await feed.subscribeThreadRequests((message) => received.push(message));
    pushedMessages.forEach(([, message]) => bus.emit(AGENT_THREAD_REQUESTS_EVENT, message));

    expect(bus.listen.mock.calls.map(([event]) => event)).toStrictEqual([
      "agent-thread://requests",
    ]);
    expect(received).toStrictEqual(pushedMessages.map(([, message]) => message));
    expect(new Set(received.map((message) => message.threadId)).size).toBeGreaterThan(1);
  });

  it("drops malformed pushed messages without throwing into the event loop", async () => {
    const bus = fakeEventBus();
    const feed = new TauriAgentThreadRequestFeed(vi.fn(), bus.listen, available);
    const handler = vi.fn<(message: AgentThreadRequests) => void>();

    await feed.subscribeThreadRequests(handler);
    invalidPushedMessages.forEach(([, message]) => bus.emit(AGENT_THREAD_REQUESTS_EVENT, message));
    bus.emit(AGENT_THREAD_REQUESTS_EVENT, undefined);

    expect(invalidPushedMessages.length).toBeGreaterThan(
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

    await expect(feed.currentThreadRequests(scope, turnIds, null)).rejects.toThrow(
      "Agent thread requests need the native runtime.",
    );
    await expect(feed.currentThreadRequests(scope, [], null)).rejects.toThrow(
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
