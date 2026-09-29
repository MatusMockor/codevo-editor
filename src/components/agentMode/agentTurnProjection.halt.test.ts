import { describe, expect, it } from "vitest";
import type { AgentTurnEvent } from "../../domain/agentThread";
import { agentTurnProjection } from "./agentTurnProjection";

const REJECTION =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file).";

function rejectedCommand(outputSummary: string): ReadonlyArray<AgentTurnEvent> {
  return [
    { kind: "toolCall", toolId: "t-1", name: "Bash", inputSummary: "npm test" },
    { kind: "toolResult", toolId: "t-1", outputSummary, isError: true },
  ];
}

describe("agentTurnProjection halt", () => {
  it.each([
    { halt: "stopping", settlement: "running", status: "stopped", label: "Stopped npm test" },
    { halt: "stopped", settlement: "stopped", status: "stopped", label: "Stopped npm test" },
    {
      halt: "interrupted",
      settlement: "interrupted",
      status: "interrupted",
      label: "Interrupted npm test",
    },
  ] as const)("settles a $halt rejected tool neutrally", ({ halt, settlement, status, label }) => {
    const [item] = agentTurnProjection(
      rejectedCommand(REJECTION),
      null,
      null,
      settlement,
      0,
      undefined,
      undefined,
      halt,
    ).items;

    expect(item).toMatchObject({ kind: "tool", status, label, output: REJECTION });
  });

  it("keeps the rejection failed without a halt", () => {
    const [item] = agentTurnProjection(rejectedCommand(REJECTION), null, null, "running").items;

    expect(item).toMatchObject({ kind: "tool", status: "error", label: "Ran npm test" });
  });

  it("keeps a genuine tool error of a halted turn failed", () => {
    const [item] = agentTurnProjection(
      rejectedCommand("Exit code 1\nThe user doesn't want to proceed with this tool use."),
      null,
      null,
      "stopped",
      0,
      undefined,
      undefined,
      "stopped",
    ).items;

    expect(item).toMatchObject({ kind: "tool", status: "error", label: "Ran npm test" });
  });

  it("keeps a successful result that repeats the rejection text ok", () => {
    const events: ReadonlyArray<AgentTurnEvent> = [
      { kind: "toolCall", toolId: "t-1", name: "Bash", inputSummary: "npm test" },
      { kind: "toolResult", toolId: "t-1", outputSummary: REJECTION, isError: false },
    ];
    const [item] = agentTurnProjection(
      events,
      null,
      null,
      "stopped",
      0,
      undefined,
      undefined,
      "stopped",
    ).items;

    expect(item).toMatchObject({ kind: "tool", status: "ok" });
  });
});
