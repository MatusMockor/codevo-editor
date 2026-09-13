import { describe, expect, it } from "vitest";
import type { RemoteRunnerEvent } from "../../domain/remoteRunner";
import { remoteRunnerOutput } from "./remoteRunnerOutput";
function output(text: string, sequence = 1): RemoteRunnerEvent {
  return {
    sequence,
    taskId: "task",
    type: "task.output",
    channel: "stdout",
    text,
    createdAt: "2026-09-13T00:00:00Z",
  };
}
describe("remoteRunnerOutput", () => {
  it("joins split Codex protocol records and renders assistant text", () => {
    const text =
      JSON.stringify({
        type: "item.completed",
        item: { id: "msg", type: "agent_message", text: "Tests passed" },
      }) + "\n";
    expect(
      remoteRunnerOutput([output(text.slice(0, 20)), output(text.slice(20), 2)], "codex").text,
    ).toBe("Tests passed");
  });
  it("renders Claude assistant records without exposing protocol metadata", () => {
    const text =
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Fixed it" }] },
      }) + "\n";
    expect(remoteRunnerOutput([output(text)], "claude").text).toBe("Fixed it");
  });
  it("bounds large readable output and marks truncation", () => {
    const events = Array.from({ length: 100 }, (_, index) =>
      output("a".repeat(1000) + "\n", index),
    );
    const result = remoteRunnerOutput(events, "codex");
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(64000);
  });
  it("marks a line clipped by the provider parser even below the display cap", () => {
    expect(remoteRunnerOutput([output("a".repeat(20000) + "\n")], "codex").truncated).toBe(true);
  });
});
