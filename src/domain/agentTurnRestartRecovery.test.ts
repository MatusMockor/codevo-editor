import { describe, expect, it } from "vitest";
import type { AgentTurn, AgentTurnEvent, AgentTurnStatus } from "./agentThread";
import { recoverAgentTurnResultStatus } from "./agentTurnRestartRecovery";
const result: AgentTurnEvent = { kind: "result", text: "Done", isError: false, usage: null };
function turn(
  events: ReadonlyArray<AgentTurnEvent>,
  status: AgentTurnStatus = { kind: "running" },
): AgentTurn {
  return {
    turnId: "agt-1-0a1b",
    prompt: "work",
    status,
    startedAtEpochMs: 1,
    endedAtEpochMs: null,
    events,
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 3,
    launch: null,
    cliVersion: null,
  };
}
describe("provider completion recovery after restart", () => {
  it.each(["pending", "running", "interrupted"] as const)(
    "recovers %s only with an explicit final result",
    (kind) => {
      expect(recoverAgentTurnResultStatus(turn([result], { kind }))).toEqual({
        kind: "exited",
        exitCode: 0,
      });
    },
  );
  it("keeps an error result failed without publishing its potentially oversized text as a status", () => {
    expect(
      recoverAgentTurnResultStatus(turn([{ ...result, isError: true, text: "x".repeat(10000) }])),
    ).toEqual({ kind: "failed", message: "The provider reported a failed turn." });
  });
  it("allows usage telemetry after a result and an evicted earlier display window", () => {
    expect(
      recoverAgentTurnResultStatus({
        ...turn([
          result,
          { kind: "contextUsage", model: "claude", inputTokens: 4, contextWindow: 100 },
        ]),
        eventsTruncated: true,
      }),
    ).toEqual({ kind: "exited", exitCode: 0 });
  });
  it.each<AgentTurnEvent>([
    { kind: "assistantText", text: "All finished." },
    { kind: "userMessage", text: "Continue" },
    { kind: "toolCall", toolId: "tool", name: "Read", inputSummary: "file" },
    { kind: "unknownLine", stream: "stdout", raw: "ambiguous", clipped: false },
  ])("rejects later activity ($kind)", (event) => {
    expect(recoverAgentTurnResultStatus(turn([result, event]))).toBeNull();
  });
  it("does not infer success from the final prose or an empty transcript", () => {
    expect(
      recoverAgentTurnResultStatus(turn([{ kind: "assistantText", text: "Done" }])),
    ).toBeNull();
    expect(recoverAgentTurnResultStatus(turn([]))).toBeNull();
  });
  it.each<AgentTurnStatus>([
    { kind: "stopped" },
    { kind: "failed", message: "failure" },
    { kind: "exited", exitCode: 9 },
  ])("preserves explicit terminal status $kind", (status) => {
    expect(recoverAgentTurnResultStatus(turn([result], status))).toBeNull();
  });
  it("does not claim interrupted background activity completed", () => {
    expect(
      recoverAgentTurnResultStatus({
        ...turn([result]),
        subagentLifecycle: {
          truncated: false,
          entries: [{ id: "task", name: "Agent", description: "work", state: "running" }],
        },
      }),
    ).toBeNull();
    expect(
      recoverAgentTurnResultStatus({
        ...turn([result]),
        subagentLifecycle: { truncated: true, entries: [] },
      }),
    ).toBeNull();
  });
});
