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
  return { taskId: TURN_ID, sequence, stream: "stdout", chunk, truncated: false, ...overrides };
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

    for (let index = 1; index <= 100; index += 1) {
      acceptAgentTurnOutput(parser, stream, outputEvent(index, String(index)));
    }

    const retainedBytes = stream.pendingEvents.reduce(
      (total, event) => total + agentTurnEventUtf8Bytes(event),
      0,
    );
    expect(retainedBytes).toBeLessThanOrEqual(MAX_AGENT_EVENT_BYTES_PER_TURN);
    expect(stream.pendingEventBytes).toBe(retainedBytes);
    expect(stream.pendingDropped).toBe(true);
    expect(stream.eventRetentionStopped).toBe(true);

    const saturated = drainAgentTurnOutput(stream, 1);
    expect(saturated?.supervisorTruncated).toBe(true);
    expect(saturated?.streamMetricsDelta).toEqual({
      receivedUtf8Bytes: new TextEncoder().encode(
        Array.from({ length: 100 }, (_, index) => String(index + 1)).join(""),
      ).byteLength,
      complete: true,
    });
    expect(stream.pendingEvents).toEqual([]);
    expect(stream.pendingEventBytes).toBe(0);

    acceptAgentTurnOutput(parser, stream, outputEvent(101, "session"));
    expect(stream.pendingEvents).toEqual([]);
    expect(stream.pendingEventBytes).toBe(0);
    expect(drainAgentTurnOutput(stream, 2)).toMatchObject({
      events: [],
      outputSequence: 2,
      sessionId: "session-0001",
      streamMetricsDelta: { receivedUtf8Bytes: 7, complete: true },
    });
  });

  it("keeps capturing the session id and result sighting while dropping events", () => {
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
    expect(drainAgentTurnOutput(stream, 1)?.sessionId).toBe("11111111-2222-3333-4444-555555555555");
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
