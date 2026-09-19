import { describe, expect, it } from "vitest";
import { appendRemoteAgentTranscript, createRemoteAgentTranscript } from "./remoteAgentTranscript";
import type { RemoteRunnerEvent } from "./remoteRunner";
import { MAX_AGENT_EVENTS_PER_TURN } from "./agentThread";
const event = (sequence: number, text: string): RemoteRunnerEvent => ({
  taskId: "task",
  sequence,
  type: "task.output",
  text,
  channel: "stdout",
  createdAt: "2026-09-13T00:00:00Z",
});
const line =
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "**Hello**" }] },
  }) + "\n";
describe("remote canonical transcript", () => {
  it("retains a partial line across pages and separates runner sequence from output ordinal", () => {
    const first = appendRemoteAgentTranscript(
      createRemoteAgentTranscript("task", "claude"),
      [event(3, line.slice(0, 20))],
      { complete: false, terminal: false },
    );
    expect(first.events).toEqual([]);
    const second = appendRemoteAgentTranscript(first, [event(5, line.slice(20))], {
      complete: true,
      terminal: true,
    });
    expect(second.events).toContainEqual({ kind: "assistantText", text: "**Hello**" });
    expect(second.outputOrdinal).toBe(2);
    expect(second.lastRunnerSequence).toBe(5);
    expect(second.finished).toBe(true);
  });
  it("retains the available prefix of truncated replay", () => {
    const state = appendRemoteAgentTranscript(
      createRemoteAgentTranscript("task", "claude"),
      [event(3, line)],
      { complete: false, terminal: true, truncated: true },
    );
    expect(state.events).toContainEqual({ kind: "assistantText", text: "**Hello**" });
    expect(state.eventsTruncated).toBe(true);
    expect(state.finished).toBe(false);
  });
  it("keeps receiving after count eviction and truncated replay, including the final result", () => {
    const noise = Array.from({ length: MAX_AGENT_EVENTS_PER_TURN + 88 }, (_, i) =>
      event(i + 1, `output ${i}\n`),
    );
    const first = appendRemoteAgentTranscript(
      createRemoteAgentTranscript("task", "claude"),
      noise,
      {
        complete: false,
        terminal: false,
        truncated: true,
      },
    );
    expect(first.eventsTruncated).toBe(true);
    expect(first.events).toHaveLength(MAX_AGENT_EVENTS_PER_TURN);
    expect(first.events[0]).toMatchObject({ raw: "output 88" });
    const finalLine =
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "![Preview](preview.png)",
        is_error: false,
      }) + "\n";
    const final = appendRemoteAgentTranscript(
      first,
      [
        event(noise.length + 1, finalLine),
        {
          taskId: "task",
          sequence: noise.length + 2,
          type: "task.failed",
          error: "Late failure",
          createdAt: "2026-09-13T00:00:01Z",
        },
      ],
      { complete: true, terminal: true },
    );
    expect(final.events).toHaveLength(MAX_AGENT_EVENTS_PER_TURN);
    expect(final.events).toContainEqual(
      expect.objectContaining({ kind: "result", text: "![Preview](preview.png)" }),
    );
    expect(final.events[final.events.length - 1]).toEqual({
      kind: "error",
      message: "Late failure",
    });
    expect(final.finished).toBe(true);
    expect(final.lastRunnerSequence).toBe(noise.length + 2);
    expect(
      appendRemoteAgentTranscript(final, [event(noise.length + 3, line)], {
        complete: true,
        terminal: true,
      }),
    ).toBe(final);
  });
  it("rejects foreign and reordered events", () => {
    const initial = createRemoteAgentTranscript("task", "claude");
    expect(() =>
      appendRemoteAgentTranscript(initial, [{ ...event(1, line), taskId: "foreign" }], {
        complete: false,
        terminal: false,
      }),
    ).toThrow();
    expect(() =>
      appendRemoteAgentTranscript(initial, [event(2, line), event(1, line)], {
        complete: false,
        terminal: false,
      }),
    ).toThrow();
  });
});

it("resets a partial provider line at a gap and discards a split missing line across pages", () => {
  const first = appendRemoteAgentTranscript(
    createRemoteAgentTranscript("task", "claude"),
    [event(1, line.slice(0, 20))],
    { complete: false, terminal: false },
  );
  const gap = { throughSequence: 3, startsAtLineBoundary: false };
  const second = appendRemoteAgentTranscript(
    first,
    [{ ...event(2, ""), type: "task.running", text: undefined }, event(4, "untrusted tail")],
    { complete: false, terminal: false, gap },
  );
  expect(second.events).toEqual([]);
  const final = appendRemoteAgentTranscript(second, [event(5, " more tail\n" + line)], {
    complete: true,
    terminal: true,
    gap,
  });
  expect(final.events).toEqual([{ kind: "assistantText", text: "**Hello**" }]);
  expect(final.eventsTruncated).toBe(true);
});

it("does not reset a continuous live parser for an already observed eviction watermark", () => {
  const first = appendRemoteAgentTranscript(
    createRemoteAgentTranscript("task", "claude"),
    [event(3, line.slice(0, 20))],
    { complete: false, terminal: false },
  );
  const final = appendRemoteAgentTranscript(first, [event(4, line.slice(20))], {
    complete: true,
    terminal: true,
    gap: { throughSequence: 2, startsAtLineBoundary: false },
  });
  expect(final.events).toEqual([{ kind: "assistantText", text: "**Hello**" }]);
  expect(final.eventsTruncated).toBe(false);
});

it.each([true, false])(
  "resets at the gap after retained older chunks (boundary %s)",
  (startsAtLineBoundary) => {
    const final = appendRemoteAgentTranscript(
      createRemoteAgentTranscript("task", "claude"),
      [
        event(1, line + line.slice(0, 20)),
        event(7, (startsAtLineBoundary ? "" : "torn tail\n") + line),
      ],
      { complete: true, terminal: true, gap: { throughSequence: 6, startsAtLineBoundary } },
    );
    expect(final.events).toEqual([{ kind: "assistantText", text: "**Hello****Hello**" }]);
    expect(final.eventsTruncated).toBe(true);
  },
);
it("projects durable accepted inputs once and keeps them through output eviction", () => {
  const input: RemoteRunnerEvent = {
    taskId: "task",
    sequence: 1,
    createdAt: "2026-09-13T00:00:00Z",
    type: "task.input",
    messageId: "message-1",
    parts: [{ type: "text", text: "Look here" }],
  };
  const transcript = appendRemoteAgentTranscript(
    createRemoteAgentTranscript("task", "claude"),
    [
      input,
      { ...input, sequence: 2 },
      ...Array.from({ length: 600 }, (_, i) => event(i + 3, `noise ${i}\n`)),
    ],
    { complete: false, terminal: false },
  );
  expect(transcript.events.filter((event) => event.kind === "userMessage")).toEqual([
    { kind: "userMessage", remoteMessageId: "message-1", text: "Look here" },
  ]);
});
it("keeps observed subagent lifecycle after its raw display event is evicted", () => {
  const spawn =
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "spawn-1", name: "Agent", input: { description: "Review" } },
        ],
      },
    }) + "\n";
  const transcript = appendRemoteAgentTranscript(
    createRemoteAgentTranscript("task", "claude"),
    [
      event(1, spawn),
      ...Array.from({ length: MAX_AGENT_EVENTS_PER_TURN + 8 }, (_, i) =>
        event(i + 2, `noise ${i}\n`),
      ),
    ],
    { complete: false, terminal: false },
  );
  expect(transcript.events.some((event) => event.kind === "toolCall")).toBe(false);
  expect(transcript.subagentLifecycle?.entries).toContainEqual(
    expect.objectContaining({ toolId: "spawn-1", state: "running" }),
  );
});
it("retains all 32 maximum-size accepted inputs independently of the output byte budget", () => {
  const inputs: RemoteRunnerEvent[] = Array.from({ length: 32 }, (_, i) => ({
    type: "task.input",
    taskId: "task",
    sequence: i + 1,
    createdAt: "2026-09-13T00:00:00Z",
    messageId: `message-${i}`,
    parts: [{ type: "text", text: "x".repeat(48_000) }],
  }));
  const first = appendRemoteAgentTranscript(createRemoteAgentTranscript("task", "claude"), inputs, {
    complete: false,
    terminal: false,
  });
  const second = appendRemoteAgentTranscript(
    first,
    Array.from({ length: MAX_AGENT_EVENTS_PER_TURN + 8 }, (_, i) => event(i + 33, `noise ${i}\n`)),
    { complete: false, terminal: false },
  );
  const messages = second.events.filter((item) => item.kind === "userMessage");
  expect(messages).toHaveLength(32);
  expect(messages[31]).toMatchObject({ remoteMessageId: "message-31", text: "x".repeat(48_000) });
  expect(messages.every((item) => item.text.length === 48_000)).toBe(true);
  expect(second.eventsTruncated).toBe(true);
});
it("rejects a server exceeding its accepted-input contract instead of silently omitting a message", () => {
  const inputs: RemoteRunnerEvent[] = Array.from({ length: 33 }, (_, i) => ({
    type: "task.input",
    taskId: "task",
    sequence: i + 1,
    createdAt: "2026-09-13T00:00:00Z",
    messageId: `message-${i}`,
    parts: [{ type: "text", text: "message" }],
  }));
  expect(() =>
    appendRemoteAgentTranscript(createRemoteAgentTranscript("task", "claude"), inputs, {
      complete: false,
      terminal: false,
    }),
  ).toThrow("accepted message limit");
});
