import { describe, expect, it } from "vitest";
import { appendRemoteAgentTranscript, createRemoteAgentTranscript } from "./remoteAgentTranscript";
import type { RemoteRunnerEvent } from "./remoteRunner";
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
    const noise = Array.from({ length: 600 }, (_, i) => event(i + 1, `output ${i}\n`));
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
    expect(first.events).toHaveLength(512);
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
        event(601, finalLine),
        {
          taskId: "task",
          sequence: 602,
          type: "task.failed",
          error: "Late failure",
          createdAt: "2026-09-13T00:00:01Z",
        },
      ],
      { complete: true, terminal: true },
    );
    expect(final.events).toHaveLength(512);
    expect(final.events).toContainEqual(
      expect.objectContaining({ kind: "result", text: "![Preview](preview.png)" }),
    );
    expect(final.events[final.events.length - 1]).toEqual({
      kind: "error",
      message: "Late failure",
    });
    expect(final.finished).toBe(true);
    expect(final.lastRunnerSequence).toBe(602);
    expect(
      appendRemoteAgentTranscript(final, [event(603, line)], { complete: true, terminal: true }),
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
