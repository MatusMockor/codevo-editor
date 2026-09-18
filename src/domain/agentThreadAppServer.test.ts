import { describe, expect, it } from "vitest";
import {
  agentThreadsReducer,
  agentTurnEventUtf8Bytes,
  coalesceAgentTextEvents,
  emptyAgentThreadsState,
  type AgentThread,
  type AgentTurnEvent,
} from "./agentThread";
import { parseAgentThread, serializeAgentThread } from "./agentThreadWire";

function thread(events: readonly AgentTurnEvent[]): AgentThread {
  return {
    threadId: "agt-thread-1",
    owner: { rootKey: "/repo", ownerId: "workspace-1", repositoryRoot: "/repo" },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "codex", sessionId: null },
    title: "test",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1,
    updatedAtEpochMs: 1,
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: null,
    externalOrigin: null,
    turns: [
      {
        turnId: "agt-turn-1",
        prompt: "test",
        status: { kind: "running" },
        startedAtEpochMs: 1,
        endedAtEpochMs: null,
        events,
        eventsTruncated: false,
        lastStatusSequence: 0,
        lastOutputSequence: 0,
        streamMetrics: null,
        launch: null,
        cliVersion: null,
      },
    ],
  };
}
const usage = {
  inputTokens: 10,
  outputTokens: 5,
  contextTokens: null,
  cachedInputTokens: 2,
  reasoningOutputTokens: null,
} as const;
const events: readonly AgentTurnEvent[] = [
  {
    kind: "subagentActivity",
    agentThreadId: "child-1",
    agentPath: "/root/child",
    activity: "started",
  },
  {
    kind: "subagentEvent",
    agentThreadId: "child-1",
    event: { kind: "assistantText", text: "hello" },
  },
  { kind: "subagentUsage", agentThreadId: "child-1", usage },
  { kind: "subagentTurnDone", agentThreadId: "child-1", durationMs: null, isError: false },
  { kind: "queued", threadId: "root-1", clientUserMessageId: null },
  { kind: "result", text: "done", isError: false, usage, durationMs: 12 },
];
function rawEvent(event: unknown): unknown {
  const raw = serializeAgentThread(thread([]));
  const turns = raw.turns as Record<string, unknown>[];
  turns[0].events = [event];
  return raw;
}
describe("app-server domain persistence", () => {
  it("roundtrips legacy schema 1 events without requiring new usage fields", () => {
    const original = thread([
      {
        kind: "result",
        text: "done",
        isError: false,
        usage: { inputTokens: 1, outputTokens: 2, contextTokens: null },
      },
    ]);
    expect(parseAgentThread(serializeAgentThread(original))).toEqual(original);
  });
  it("roundtrips all new events", () =>
    expect(parseAgentThread(serializeAgentThread(thread(events)))).toEqual(thread(events)));
  it.each(["reasoning", "assistantText"] as const)(
    "coalesces %s only within the same subagent",
    (kind) => {
      const a: AgentTurnEvent = {
        kind: "subagentEvent",
        agentThreadId: "child-1",
        event: { kind, text: "a" },
      };
      expect(coalesceAgentTextEvents(a, a)).toEqual({ ...a, event: { kind, text: "aa" } });
      expect(coalesceAgentTextEvents(a, { ...a, agentThreadId: "child-2" })).toBeNull();
      expect(coalesceAgentTextEvents(a, { kind, text: "b" })).toBeNull();
    },
  );
  it("accounts for all nested text and identity bytes", () => {
    expect(
      agentTurnEventUtf8Bytes({
        kind: "subagentEvent",
        agentThreadId: "child",
        event: { kind: "toolCall", toolId: "id", name: "tool", inputSummary: "é" },
      }),
    ).toBe(13);
  });
  it.each([
    {
      kind: "subagentEvent",
      agentThreadId: "child",
      event: {
        kind: "subagentEvent",
        agentThreadId: "nested",
        event: { kind: "assistantText", text: "x" },
      },
    },
    { kind: "subagentEvent", agentThreadId: "child", event: { kind: "userMessage", text: "x" } },
    { kind: "subagentActivity", agentThreadId: "child", agentPath: "/root", activity: "unknown" },
    { kind: "subagentUsage", agentThreadId: "child", usage: { ...usage, cachedInputTokens: -1 } },
    { kind: "subagentUsage", agentThreadId: "child", usage: null },
    { kind: "subagentTurnDone", agentThreadId: "child", durationMs: 0.5, isError: false },
    { kind: "queued", threadId: "root", clientUserMessageId: "bad\nvalue" },
    { ...events[0], extra: true },
  ])("rejects malformed event %#", (event) =>
    expect(() => parseAgentThread(rawEvent(event))).toThrow(),
  );
  it("bounds distinct subagents at 32 in persistence and reducer", () => {
    const many: AgentTurnEvent[] = Array.from({ length: 33 }, (_, i) => ({
      kind: "subagentTurnDone",
      agentThreadId: `child-${i}`,
      durationMs: 1,
      isError: false,
    }));
    expect(() => parseAgentThread(serializeAgentThread(thread(many)))).toThrow(/32/);
    const state = agentThreadsReducer(emptyAgentThreadsState(), {
      kind: "threadCreated",
      thread: thread(many),
    });
    expect(state.threads.get("agt-thread-1")?.turns[0].events).toHaveLength(32);
    expect(state.threads.get("agt-thread-1")?.turns[0].eventsTruncated).toBe(true);
    expect(
      parseAgentThread(serializeAgentThread(thread(Array(40).fill(many[0])))).turns[0].events,
    ).toHaveLength(40);
  });
  it("enforces the subagent cap across separately appended output batches", () => {
    const retained: AgentTurnEvent[] = Array.from({ length: 32 }, (_, i) => ({
      kind: "subagentTurnDone",
      agentThreadId: `child-${i}`,
      durationMs: 1,
      isError: false,
    }));
    const state = agentThreadsReducer(emptyAgentThreadsState(), {
      kind: "threadCreated",
      thread: thread(retained),
    });
    const updated = agentThreadsReducer(state, {
      kind: "turnEventsAppended",
      threadId: "agt-thread-1",
      turnId: "agt-turn-1",
      workspaceId: "workspace-1",
      repositoryRoot: "/repo",
      isolation: "in-place",
      worktreePath: null,
      outputSequence: 1,
      sessionId: null,
      supervisorTruncated: false,
      events: [
        { kind: "subagentUsage", agentThreadId: "child-0", usage },
        { kind: "subagentUsage", agentThreadId: "child-new", usage },
      ],
    });
    const turn = updated.threads.get("agt-thread-1")?.turns[0];
    expect(turn?.events).toHaveLength(32);
    expect(turn?.events[turn.events.length - 1]).toEqual({
      kind: "subagentUsage",
      agentThreadId: "child-new",
      usage,
    });
    expect(turn?.eventsTruncated).toBe(true);
  });
  it.each(["appServer", "exec"] as const)("roundtrips captured %s transport", (codexTransport) => {
    const original = thread([]);
    const captured = { ...original, turns: [{ ...original.turns[0], codexTransport }] };
    expect(parseAgentThread(serializeAgentThread(captured))).toEqual(captured);
    const raw = serializeAgentThread(captured);
    (raw.turns as Record<string, unknown>[])[0].codexTransport = "unknown";
    expect(() => parseAgentThread(raw)).toThrow(/codexTransport/);
  });
  it("allows unavailable subagent display paths", () => {
    const event = {
      kind: "subagentActivity",
      agentThreadId: "child-1",
      agentPath: "",
      activity: "started",
    };
    expect(parseAgentThread(rawEvent(event)).turns[0].events[0]).toEqual(event);
  });
  it("preserves complete cumulative usage snapshots", () => {
    const breakdown = {
      inputTokens: 10,
      cachedInputTokens: 2,
      cacheWriteInputTokens: 3,
      outputTokens: 5,
      reasoningOutputTokens: 4,
      totalTokens: 15,
    };
    const event: AgentTurnEvent = {
      kind: "result",
      text: "",
      isError: false,
      usage: {
        ...usage,
        scope: "thread",
        appServerUsage: { last: breakdown, total: breakdown, contextWindow: null },
      },
    };
    expect(parseAgentThread(rawEvent(event)).turns[0].events[0]).toEqual(event);
    expect(() =>
      parseAgentThread(
        rawEvent({
          ...event,
          usage: {
            ...event.usage,
            appServerUsage: {
              last: { ...breakdown, hidden: 1 },
              total: breakdown,
              contextWindow: null,
            },
          },
        }),
      ),
    ).toThrow();
  });
});

describe("background lifecycle persistence", () => {
  it("round trips bounded task telemetry and child text ownership", () => {
    const events: AgentTurnEvent[] = [
      {
        kind: "backgroundTask",
        taskId: "task-1",
        taskType: "shell",
        status: "starting",
        description: "Watch pipeline",
      },
      { kind: "assistantText", text: "Child update", parentToolId: "tool-parent" },
      { kind: "backgroundTask", taskId: "task-1", taskType: "other", status: "stopped" },
    ];
    expect(parseAgentThread(serializeAgentThread(thread(events)))).toEqual(thread(events));
    expect(agentTurnEventUtf8Bytes(events[1]!)).toBe(23);
  });
  it("does not coalesce different child owners or child and root text", () => {
    const child: AgentTurnEvent = { kind: "assistantText", text: "a", parentToolId: "child-1" };
    expect(coalesceAgentTextEvents(child, { kind: "assistantText", text: "b" })).toBeNull();
    expect(coalesceAgentTextEvents(child, { ...child, parentToolId: "child-2" })).toBeNull();
    expect(coalesceAgentTextEvents(child, { ...child, text: "b" })).toEqual({
      ...child,
      text: "ab",
    });
  });
  it.each([
    { status: "invented" },
    { taskType: "invented" },
    { taskId: "" },
    { taskId: "x".repeat(257) },
    { description: "x".repeat(513) },
    { extra: true },
  ])("rejects malformed persisted background events %j", (override) => {
    expect(() =>
      parseAgentThread(
        rawEvent({
          kind: "backgroundTask",
          taskId: "task-1",
          taskType: "shell",
          status: "starting",
          ...override,
        }),
      ),
    ).toThrow();
  });
});
