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
