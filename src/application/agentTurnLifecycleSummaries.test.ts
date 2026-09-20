import { describe, expect, it, vi } from "vitest";
import { completeAgentLifecycleSummaries } from "./agentTurnLifecycleSummaries";
import type { AgentTurnLogSummary, SummarizeAgentTurnLogsRequest } from "../domain/agentTurnLog";

const request: SummarizeAgentTurnLogsRequest = {
  rootKey: "/workspace",
  ownerId: "owner",
  threadId: "agt-1-0a1b",
  includePrompts: false,
  includeLifecycles: true,
};
function summary(turnId: string): AgentTurnLogSummary {
  return {
    turnId,
    eventCount: 0,
    bytes: 0,
    loss: { kind: "none" },
    sealed: true,
    digest: null,
    prompt: "saved prompt",
    promptOmitted: false,
    lifecycle: null,
    lifecycleOmitted: true,
  };
}

describe("bounded lifecycle detail reads", () => {
  it("keeps omitted evidence retryable after a failed read or foreign turn response", async () => {
    const rows = [summary("agt-1-0001"), summary("agt-1-0002")];
    const summarizeTurnLogs = vi
      .fn()
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValueOnce([summary("agt-1-ffff")]);
    expect(
      await completeAgentLifecycleSummaries({ summarizeTurnLogs }, request, rows, () => true),
    ).toEqual(rows);
    expect(summarizeTurnLogs).toHaveBeenCalledTimes(2);
  });
  it("discards a detail response after workspace authority changes and stops further reads", async () => {
    let owned = true;
    const summarizeTurnLogs = vi.fn(async () => {
      owned = false;
      return [summary("agt-1-0001")];
    });
    expect(
      await completeAgentLifecycleSummaries(
        { summarizeTurnLogs },
        request,
        [summary("agt-1-0001"), summary("agt-1-0002")],
        () => owned,
      ),
    ).toEqual([]);
    expect(summarizeTurnLogs).toHaveBeenCalledTimes(1);
  });
  it("bounds requests to 64 turns", async () => {
    const summarizeTurnLogs = vi.fn(async () => []);
    const rows = Array.from({ length: 100 }, (_, index) =>
      summary(`agt-1-${index.toString(16).padStart(4, "0")}`),
    );
    expect(
      await completeAgentLifecycleSummaries({ summarizeTurnLogs }, request, rows, () => true),
    ).toHaveLength(64);
    expect(summarizeTurnLogs).toHaveBeenCalledTimes(64);
  });
});
