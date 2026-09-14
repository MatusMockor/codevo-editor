import { describe, expect, it } from "vitest";
import {
  appendRemoteAgentTranscript,
  createRemoteAgentTranscript,
} from "../../domain/remoteAgentTranscript";
import { agentTurnProjection, agentTurnWorkFold } from "./agentModePresentation";

describe("completed remote Codex work", () => {
  it("keeps the final answer outside collapsed work after the empty completion event", () => {
    const transcript = appendRemoteAgentTranscript(
      createRemoteAgentTranscript("remote-task", "codex"),
      [
        {
          taskId: "remote-task",
          sequence: 1,
          type: "task.output",
          channel: "stdout",
          createdAt: "2026-09-14T20:26:58Z",
          text: [
            {
              type: "item.completed",
              item: {
                id: "item_1",
                type: "command_execution",
                command: "hostname",
                aggregated_output: "linux",
                exit_code: 0,
                status: "completed",
              },
            },
            {
              type: "item.completed",
              item: {
                id: "item_2",
                type: "agent_message",
                text: "Created and verified the file on Linux.",
              },
            },
            { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } },
          ]
            .map((value) => JSON.stringify(value) + "\n")
            .join(""),
        },
      ],
      { complete: true, terminal: true },
    );
    const fold = agentTurnWorkFold(agentTurnProjection(transcript.events).items, false);
    expect(fold).not.toBeNull();
    expect(fold?.workItems.some((item) => item.kind === "tool")).toBe(true);
    expect(fold?.visibleItems).toContainEqual(
      expect.objectContaining({
        kind: "assistantText",
        text: "Created and verified the file on Linux.",
      }),
    );
  });

  it.each(["", " \n "])("does not fold an answer into an empty result %j", (text) => {
    const projection = agentTurnProjection([
      { kind: "toolCall", toolId: "t1", name: "Bash", inputSummary: "hostname" },
      { kind: "assistantText", text: "Done." },
      { kind: "result", text, isError: false, usage: null },
    ]);
    expect(agentTurnWorkFold(projection.items, false)?.visibleItems[0]).toMatchObject({
      kind: "assistantText",
      text: "Done.",
    });
  });
});
