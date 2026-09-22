import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgentOutputParserState,
  type AgentOutputFeedResult,
  type AgentOutputParserState,
} from "../domain/agentOutput/agentOutputParser";
import type { AgentTaskOutputEvent } from "../domain/agentTask";
import {
  MAX_AGENT_EVENTS_PER_TURN,
  MAX_AGENT_EVENT_BYTES_PER_TURN,
  MAX_AGENT_EVENT_TEXT_BYTES,
  agentTurnEventUtf8Bytes,
  agentThreadsReducer,
  emptyAgentThreadsState,
  type AgentThread,
  type AgentThreadsState,
  type AgentTurnEvent,
} from "../domain/agentThread";
import {
  AGENT_OUTPUT_FLUSH_FALLBACK_MS,
  acceptAgentTurnOutput,
  createAgentTurnOutputStream,
  drainAgentTurnOutput,
  domainAgentOutputParser,
  finishAgentTurnOutput,
  scheduleAgentOutputFrame,
  type AgentOutputParserPort,
  type TurnEventsAppendedAction,
} from "./agentTurnOutputStream";

const THREAD_ID = "agt-t1-0001";
const TURN_ID = "agt-1-0a1b";

interface FeedScript {
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly sessionId: string | null;
}

function scriptedParser(script: (chunk: string) => FeedScript): AgentOutputParserPort {
  const empty: FeedScript = { events: [], sessionId: null };
  const result = (state: AgentOutputParserState, produced: FeedScript): AgentOutputFeedResult => ({
    state,
    events: produced.events,
    sessionId: produced.sessionId,
    accountUsage: [],
  });
  return {
    create: (kind) => createAgentOutputParserState(kind),
    feed: (state, _stream, chunk) => result(state, script(chunk)),
    finish: (state) => result(state, empty),
  };
}

function outputEvent(
  sequence: number,
  chunk: string,
  overrides: Partial<AgentTaskOutputEvent> = {},
): AgentTaskOutputEvent {
  return {
    taskId: TURN_ID,
    sequence,
    stream: "stdout",
    chunk,
    truncated: false,
    startsAtLineBoundary: true,
    ...overrides,
  };
}

function createStream(parser: AgentOutputParserPort) {
  return createAgentTurnOutputStream(parser, {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    ownerId: "ws-1",
    repositoryRoot: "/repo",
    isolation: "in-place",
    worktreePath: null,
    kind: "claudeCode",
    resumed: false,
  });
}

function stateWithRunningTurn(): AgentThreadsState {
  const thread: AgentThread = {
    threadId: THREAD_ID,
    owner: { rootKey: "/workspace", ownerId: "ws-1", repositoryRoot: "/repo" },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: null },
    title: "do the thing",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_000,
    updatedAtEpochMs: 1_000,
    turns: [
      {
        turnId: TURN_ID,
        prompt: "do the thing",
        status: { kind: "running" },
        startedAtEpochMs: 1_000,
        endedAtEpochMs: null,
        events: [],
        eventsTruncated: false,
        lastStatusSequence: 0,
        lastOutputSequence: 0,
        streamMetrics: null,
        launch: null,
        cliVersion: null,
      },
    ],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
  };
  return agentThreadsReducer(emptyAgentThreadsState(), { kind: "threadCreated", thread });
}

function applyAction(action: TurnEventsAppendedAction): AgentThreadsState {
  return agentThreadsReducer(stateWithRunningTurn(), action);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("agent turn output pending bounds", () => {
  it("caps pending events per turn and reports truncation when frames never run", () => {
    const parser = scriptedParser((chunk) => ({
      events: [{ kind: "toolCall", toolId: chunk, name: "Bash", inputSummary: chunk }],
      sessionId: null,
    }));
    const stream = createStream(parser);

    for (let index = 0; index < 5_000; index += 1) {
      acceptAgentTurnOutput(parser, stream, outputEvent(index + 1, `tool-${index}`));
    }

    expect(stream.pendingEvents.length).toBe(MAX_AGENT_EVENTS_PER_TURN);
    expect(stream.pendingDropped).toBe(true);
    expect(stream.pendingEvents[0]).toMatchObject({
      toolId: `tool-${5_000 - MAX_AGENT_EVENTS_PER_TURN}`,
    });
    expect(stream.pendingEvents[stream.pendingEvents.length - 1]).toMatchObject({
      toolId: "tool-4999",
    });

    const action = drainAgentTurnOutput(stream, 1);
    expect(action).not.toBeNull();
    expect(action).toMatchObject({
      threadId: THREAD_ID,
      turnId: TURN_ID,
      workspaceId: "ws-1",
      repositoryRoot: "/repo",
      isolation: "in-place",
      worktreePath: null,
    });
    expect(action?.supervisorTruncated).toBe(true);
    expect(stream.pendingDropped).toBe(false);

    const turn = applyAction(action as TurnEventsAppendedAction).threads.get(THREAD_ID)?.turns[0];
    expect(turn?.eventsTruncated).toBe(true);
    expect(turn?.events).toHaveLength(MAX_AGENT_EVENTS_PER_TURN);
  });

  it("coalesces consecutive assistant text up to the text byte cap", () => {
    const parser = scriptedParser((chunk) => ({
      events: [{ kind: "assistantText", text: chunk }],
      sessionId: null,
    }));
    const stream = createStream(parser);
    const half = "x".repeat(MAX_AGENT_EVENT_TEXT_BYTES / 2);

    acceptAgentTurnOutput(parser, stream, outputEvent(1, half));
    expect(stream.pendingEvents).toHaveLength(1);

    acceptAgentTurnOutput(parser, stream, outputEvent(2, half));
    expect(stream.pendingEvents).toHaveLength(1);
    expect(stream.pendingEvents[0]).toEqual({
      kind: "assistantText",
      text: "x".repeat(MAX_AGENT_EVENT_TEXT_BYTES),
    });

    acceptAgentTurnOutput(parser, stream, outputEvent(3, half));
    expect(stream.pendingEvents).toHaveLength(2);
    expect(stream.pendingEvents[1]).toEqual({ kind: "assistantText", text: half });
    expect(stream.pendingDropped).toBe(false);
  });

  it("caps pending aggregate UTF-8 bytes and resets its accounting after each drain", () => {
    const wideText = "€".repeat(Math.floor(MAX_AGENT_EVENT_TEXT_BYTES / 3));
    const parser = scriptedParser((chunk) => ({
      events: [
        chunk === "session"
          ? { kind: "assistantText", text: "x" }
          : Number(chunk) % 2 === 0
            ? { kind: "reasoning", text: wideText }
            : { kind: "assistantText", text: wideText },
      ],
      sessionId: chunk === "session" ? "session-0001" : null,
    }));
    const stream = createStream(parser);
    const drains = Math.ceil(MAX_AGENT_EVENT_BYTES_PER_TURN / MAX_AGENT_EVENT_TEXT_BYTES) + 8;

    for (let index = 1; index <= drains; index += 1) {
      acceptAgentTurnOutput(parser, stream, outputEvent(index, String(index)));
    }

    const retainedBytes = stream.pendingEvents.reduce(
      (total, event) => total + agentTurnEventUtf8Bytes(event),
      0,
    );
    expect(retainedBytes).toBeLessThanOrEqual(MAX_AGENT_EVENT_BYTES_PER_TURN);
    expect(stream.pendingEventBytes).toBe(retainedBytes);
    expect(stream.pendingDropped).toBe(true);

    const saturated = drainAgentTurnOutput(stream, 1);
    expect(saturated?.supervisorTruncated).toBe(true);
    expect(saturated?.streamMetricsDelta).toEqual({
      receivedUtf8Bytes: new TextEncoder().encode(
        Array.from({ length: drains }, (_, index) => String(index + 1)).join(""),
      ).byteLength,
      complete: true,
    });
    expect(stream.pendingEvents).toEqual([]);
    expect(stream.pendingEventBytes).toBe(0);

    acceptAgentTurnOutput(parser, stream, outputEvent(drains + 1, "session"));
    expect(stream.pendingEvents).toEqual([{ kind: "assistantText", text: "x" }]);
    expect(stream.pendingEventBytes).toBe(1);
    expect(drainAgentTurnOutput(stream, 2)).toMatchObject({
      events: [{ kind: "assistantText", text: "x" }],
      supervisorTruncated: false,
      outputSequence: 2,
      sessionId: "session-0001",
      streamMetricsDelta: { receivedUtf8Bytes: 7, complete: true },
    });
  });

  it("retains the final result and session metadata after evicting older events", () => {
    const parser = scriptedParser((chunk) => ({
      events: [
        chunk === "final"
          ? { kind: "result", text: "done", isError: false, usage: null }
          : { kind: "toolCall", toolId: chunk, name: "Bash", inputSummary: chunk },
      ],
      sessionId: chunk === "final" ? "11111111-2222-3333-4444-555555555555" : null,
    }));
    const stream = createStream(parser);

    for (let index = 0; index < MAX_AGENT_EVENTS_PER_TURN + 10; index += 1) {
      acceptAgentTurnOutput(parser, stream, outputEvent(index + 1, `tool-${index}`));
    }
    acceptAgentTurnOutput(parser, stream, outputEvent(10_000, "final"));

    expect(stream.pendingEvents.length).toBe(MAX_AGENT_EVENTS_PER_TURN);
    expect(stream.pendingSessionId).toBe("11111111-2222-3333-4444-555555555555");
    expect(stream.sawSessionId).toBe(true);
    expect(stream.sawResult).toBe(true);
    expect(stream.pendingEvents[stream.pendingEvents.length - 1]).toMatchObject({
      kind: "result",
      text: "done",
    });
    expect(drainAgentTurnOutput(stream, 1)?.sessionId).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("retains a final response after a saturated buffer has been drained", () => {
    const parser = scriptedParser((chunk) => ({
      events:
        chunk === "burst"
          ? Array.from({ length: MAX_AGENT_EVENTS_PER_TURN + 1 }, (_, index) => ({
              kind: "toolCall" as const,
              toolId: String(index),
              name: "Bash",
              inputSummary: "run",
            }))
          : [{ kind: "result", text: "Final answer", isError: false, usage: null }],
      sessionId: null,
    }));
    const stream = createStream(parser);
    acceptAgentTurnOutput(parser, stream, outputEvent(1, "burst"));
    const first = drainAgentTurnOutput(stream, 1);
    expect(first?.supervisorTruncated).toBe(true);
    acceptAgentTurnOutput(parser, stream, outputEvent(2, "final"));
    const second = drainAgentTurnOutput(stream, 2);
    expect(second?.events).toEqual([
      { kind: "result", text: "Final answer", isError: false, usage: null },
    ]);
    expect(second?.supervisorTruncated).toBe(false);
  });

  it("continues parsed output and final parser flush after an upstream truncation marker", () => {
    const base = scriptedParser((chunk) => ({
      events: [{ kind: "assistantText", text: chunk }],
      sessionId: null,
    }));
    const parser: AgentOutputParserPort = {
      ...base,
      finish: (state) => ({
        state,
        events: [{ kind: "result", text: "Finished", isError: false, usage: null }],
        sessionId: null,
        accountUsage: [],
      }),
    };
    const stream = createStream(parser);
    acceptAgentTurnOutput(parser, stream, outputEvent(1, "Before", { truncated: true }));
    expect(drainAgentTurnOutput(stream, 1)?.supervisorTruncated).toBe(true);
    acceptAgentTurnOutput(parser, stream, outputEvent(2, "After"));
    const final = finishAgentTurnOutput(parser, stream);
    expect(final?.events).toEqual([
      { kind: "assistantText", text: "After" },
      { kind: "result", text: "Finished", isError: false, usage: null },
    ]);
    expect(final?.streamMetricsDelta).toMatchObject({ complete: false });
  });

  it("resets an old partial JSON line at a gap without losing a boundary-aligned final", () => {
    const stream = createStream(domainAgentOutputParser);
    acceptAgentTurnOutput(
      domainAgentOutputParser,
      stream,
      outputEvent(1, '{"type":"assistant","message":'),
    );
    acceptAgentTurnOutput(
      domainAgentOutputParser,
      stream,
      outputEvent(3, '{"type":"result","subtype":"success","result":"Final answer"}\n'),
    );
    const action = drainAgentTurnOutput(stream, 3);
    expect(action?.events).toContainEqual(
      expect.objectContaining({ kind: "result", text: "Final answer" }),
    );
    expect(action?.supervisorTruncated).toBe(true);
    expect(action?.streamMetricsDelta?.complete).toBe(false);
  });

  it("discards a partial retained line after a gap and resumes at its next newline", () => {
    const stream = createStream(domainAgentOutputParser);
    acceptAgentTurnOutput(domainAgentOutputParser, stream, outputEvent(1, '{"type":'));
    acceptAgentTurnOutput(
      domainAgentOutputParser,
      stream,
      outputEvent(3, '"result","result":"spliced"}', { startsAtLineBoundary: false }),
    );
    acceptAgentTurnOutput(
      domainAgentOutputParser,
      stream,
      outputEvent(4, '\n{"type":"result","subtype":"success","result":"Real final"}\n', {
        startsAtLineBoundary: false,
      }),
    );
    const action = drainAgentTurnOutput(stream, 4);
    expect(action?.events).toEqual([
      expect.objectContaining({ kind: "result", text: "Real final" }),
    ]);
    expect(action?.supervisorTruncated).toBe(true);
  });

  it("fails closed for a legacy gap without boundary metadata and preserves parser identity", () => {
    const stream = createStream(domainAgentOutputParser);
    const tools = new Set(["existing-tool"]);
    stream.parser = { ...stream.parser, sessionId: "original-session", emittedToolIds: tools };
    const legacy: AgentTaskOutputEvent = {
      taskId: TURN_ID,
      sequence: 2,
      stream: "stdout",
      truncated: false,
      chunk:
        '{"type":"result","result":"Unattested first line"}\n' +
        '{"type":"result","subtype":"success","result":"After boundary"}\n',
    };
    acceptAgentTurnOutput(domainAgentOutputParser, stream, legacy);
    expect(stream.parser.sessionId).toBe("original-session");
    expect(stream.parser.emittedToolIds).toBe(tools);
    expect(drainAgentTurnOutput(stream, 2)?.events).toEqual([
      expect.objectContaining({ kind: "result", text: "After boundary" }),
    ]);
  });

  it("resynchronizes both streams independently after a global sequence gap", () => {
    const stream = createStream(domainAgentOutputParser);
    acceptAgentTurnOutput(
      domainAgentOutputParser,
      stream,
      outputEvent(1, "old stderr", { stream: "stderr" }),
    );
    acceptAgentTurnOutput(
      domainAgentOutputParser,
      stream,
      outputEvent(3, '{"type":"result","subtype":"success","result":"Final"}\n'),
    );
    acceptAgentTurnOutput(
      domainAgentOutputParser,
      stream,
      outputEvent(4, "lost suffix\nfresh stderr\n", {
        stream: "stderr",
        startsAtLineBoundary: false,
      }),
    );
    const action = drainAgentTurnOutput(stream, 4);
    expect(action?.events).toEqual([
      expect.objectContaining({ kind: "result", text: "Final" }),
      expect.objectContaining({ kind: "unknownLine", raw: "fresh stderr", stream: "stderr" }),
    ]);
  });

  it("counts accepted raw UTF-8 chunks exactly once across drains and ignores foreign order", () => {
    const parser = scriptedParser(() => ({ events: [], sessionId: null }));
    const stream = createStream(parser);

    expect(acceptAgentTurnOutput(parser, stream, outputEvent(1, "€"))).toBe(true);
    expect(acceptAgentTurnOutput(parser, stream, outputEvent(1, "duplicate"))).toBe(false);
    expect(acceptAgentTurnOutput(parser, stream, outputEvent(0, "reordered"))).toBe(false);
    expect(
      acceptAgentTurnOutput(
        parser,
        stream,
        outputEvent(2, "foreign", { taskId: "agt-foreign-0001" }),
      ),
    ).toBe(false);
    expect(drainAgentTurnOutput(stream, 1)?.streamMetricsDelta).toEqual({
      receivedUtf8Bytes: 3,
      complete: true,
    });

    expect(acceptAgentTurnOutput(parser, stream, outputEvent(2, "😀"))).toBe(true);
    expect(drainAgentTurnOutput(stream, 2)?.streamMetricsDelta).toEqual({
      receivedUtf8Bytes: 4,
      complete: true,
    });
  });

  it("marks a first-sequence gap incomplete while still counting the accepted chunk", () => {
    const parser = scriptedParser(() => ({ events: [], sessionId: null }));
    const stream = createStream(parser);

    expect(acceptAgentTurnOutput(parser, stream, outputEvent(2, "€"))).toBe(true);
    expect(drainAgentTurnOutput(stream, 2)?.streamMetricsDelta).toEqual({
      receivedUtf8Bytes: 3,
      complete: false,
    });
  });

  it("keeps a post-drain sequence gap incomplete while counting later chunks", () => {
    const parser = scriptedParser(() => ({ events: [], sessionId: null }));
    const stream = createStream(parser);

    expect(acceptAgentTurnOutput(parser, stream, outputEvent(1, "a"))).toBe(true);
    expect(drainAgentTurnOutput(stream, 1)?.streamMetricsDelta).toEqual({
      receivedUtf8Bytes: 1,
      complete: true,
    });

    expect(acceptAgentTurnOutput(parser, stream, outputEvent(3, "€"))).toBe(true);
    expect(drainAgentTurnOutput(stream, 3)?.streamMetricsDelta).toEqual({
      receivedUtf8Bytes: 3,
      complete: false,
    });
    expect(acceptAgentTurnOutput(parser, stream, outputEvent(4, "x"))).toBe(true);
    expect(drainAgentTurnOutput(stream, 4)?.streamMetricsDelta).toEqual({
      receivedUtf8Bytes: 1,
      complete: false,
    });
  });

  it("marks raw stream metrics incomplete only for upstream truncation", () => {
    const parser = scriptedParser((chunk) => ({
      events: [{ kind: "assistantText", text: chunk }],
      sessionId: null,
    }));
    const stream = createStream(parser);

    acceptAgentTurnOutput(parser, stream, outputEvent(1, "€", { truncated: true }));
    const action = drainAgentTurnOutput(stream, 1);
    expect(action?.streamMetricsDelta).toEqual({ receivedUtf8Bytes: 3, complete: false });
    expect(action?.supervisorTruncated).toBe(true);
  });

  it("fails closed when pending raw byte accounting exceeds a safe integer", () => {
    const parser = scriptedParser(() => ({ events: [], sessionId: null }));
    const stream = createStream(parser);
    stream.pendingReceivedUtf8Bytes = Number.MAX_SAFE_INTEGER;

    expect(acceptAgentTurnOutput(parser, stream, outputEvent(1, "x"))).toBe(true);
    expect(drainAgentTurnOutput(stream, 1)?.streamMetricsDelta).toEqual({
      receivedUtf8Bytes: Number.MAX_SAFE_INTEGER,
      complete: false,
    });

    expect(acceptAgentTurnOutput(parser, stream, outputEvent(2, "y"))).toBe(true);
    expect(drainAgentTurnOutput(stream, 2)?.streamMetricsDelta).toEqual({
      receivedUtf8Bytes: 1,
      complete: false,
    });
  });
});

describe("agent output frame scheduling", () => {
  it("falls back to a timer when the frame callback never runs", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const callback = vi.fn();

    scheduleAgentOutputFrame(callback);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(AGENT_OUTPUT_FLUSH_FALLBACK_MS);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("runs the callback once when the frame wins the race", () => {
    vi.useFakeTimers();
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (frame: () => void) => frames.push(frame));
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const callback = vi.fn();

    scheduleAgentOutputFrame(callback);
    frames[0]();
    expect(callback).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(AGENT_OUTPUT_FLUSH_FALLBACK_MS * 10);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("cancels both the frame and the timer", () => {
    vi.useFakeTimers();
    const frames: Array<() => void> = [];
    const cancelled: number[] = [];
    vi.stubGlobal("requestAnimationFrame", (frame: () => void) => frames.push(frame));
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => cancelled.push(handle));
    const callback = vi.fn();

    scheduleAgentOutputFrame(callback)();
    expect(cancelled).toHaveLength(1);

    frames[0]();
    vi.advanceTimersByTime(AGENT_OUTPUT_FLUSH_FALLBACK_MS * 10);
    expect(callback).not.toHaveBeenCalled();
  });

  it("uses the timer alone when frames are unavailable", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", undefined);
    const callback = vi.fn();

    scheduleAgentOutputFrame(callback);
    vi.advanceTimersByTime(AGENT_OUTPUT_FLUSH_FALLBACK_MS);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe("output transport snapshot", () => {
  it.each(["appServer", "exec"] as const)(
    "parses %s with the captured transport",
    (codexTransport) => {
      const stream = createAgentTurnOutputStream(domainAgentOutputParser, {
        threadId: THREAD_ID,
        turnId: TURN_ID,
        ownerId: "ws-1",
        repositoryRoot: "/repo",
        isolation: "in-place",
        worktreePath: null,
        kind: "codex",
        resumed: false,
        codexTransport,
      });
      expect(stream.parser.transport).toBe(codexTransport);
      acceptAgentTurnOutput(
        domainAgentOutputParser,
        stream,
        outputEvent(1, '{"v":1,"t":"text","role":"assistant","text":"hello","clipped":false}\n'),
      );
      if (codexTransport === "appServer")
        expect(stream.pendingEvents).toContainEqual({ kind: "assistantText", text: "hello" });
      if (codexTransport === "exec")
        expect(stream.pendingEvents).not.toContainEqual({ kind: "assistantText", text: "hello" });
    },
  );
});

it("timestamps accepted occupancy once and preserves it across duplicate output", () => {
  const parser = scriptedParser(() => ({
    events: [{ kind: "contextUsage", model: "main", inputTokens: 123, contextWindow: 1000 }],
    sessionId: null,
  }));
  const stream = createStream(parser);
  expect(acceptAgentTurnOutput(parser, stream, outputEvent(1, "usage"), 1234)).toBe(true);
  expect(acceptAgentTurnOutput(parser, stream, outputEvent(1, "usage"), 9999)).toBe(false);
  expect(drainAgentTurnOutput(stream, 1)?.events).toEqual([
    {
      kind: "contextUsage",
      model: "main",
      inputTokens: 123,
      contextWindow: 1000,
      observedAtEpochMs: 1234,
    },
  ]);
});
