import { describe, expect, it } from "vitest";
import { agentCompactionState } from "./agentCompactionState";
import type { AgentTurn, AgentTurnEvent, AgentTurnStatus } from "./agentThread";

const started: AgentTurnEvent = {
  kind: "contextCompactionStatus",
  status: "compacting",
  message: null,
};
const idle: AgentTurnEvent = { kind: "contextCompactionStatus", status: "idle", message: null };
const completed: AgentTurnEvent = {
  kind: "contextCompaction",
  beforeTokens: 100,
  afterTokens: null,
};
const success: AgentTurnEvent = { kind: "result", text: "", isError: false, usage: null };
function turn(
  events: readonly AgentTurnEvent[] = [],
  prompt = "ordinary task",
  status: AgentTurnStatus = { kind: "running" },
): Pick<AgentTurn, "events" | "prompt" | "status"> {
  return { events, prompt, status };
}

describe("agentCompactionState", () => {
  it("indicates manual Claude compaction immediately, including custom instructions", () => {
    for (const prompt of ["/compact", " /compact ", "/compact preserve tests"]) {
      expect(agentCompactionState("claudeCode", turn([], prompt, { kind: "pending" }))).toEqual({
        kind: "compacting",
      });
      expect(agentCompactionState("codex", turn([], prompt))).toEqual({ kind: "idle" });
    }
    expect(agentCompactionState("claudeCode", turn([], "/compaction"))).toEqual({ kind: "idle" });
  });
  it("tracks repeated automatic starts and idle/completion boundaries in event order", () => {
    expect(agentCompactionState("claudeCode", turn([started]))).toEqual({ kind: "compacting" });
    expect(agentCompactionState("claudeCode", turn([started, idle]))).toEqual({ kind: "idle" });
    expect(agentCompactionState("claudeCode", turn([started, completed]))).toEqual({
      kind: "idle",
    });
    expect(agentCompactionState("claudeCode", turn([started, completed, started]))).toEqual({
      kind: "compacting",
    });
    expect(agentCompactionState("claudeCode", turn([started, idle, started]))).toEqual({
      kind: "compacting",
    });
  });
  it.each<AgentTurnEvent>([
    success,
    { ...success, isError: true },
    { kind: "error", message: "limit" },
  ])("settles on a terminal provider event without resurrecting for late status: %j", (event) => {
    expect(agentCompactionState("claudeCode", turn([started, event, started], "/compact"))).toEqual(
      { kind: "idle" },
    );
  });
  it("preserves explicit failure through settlement without claiming completion", () => {
    const failed: AgentTurnEvent = {
      kind: "contextCompactionStatus",
      status: "failed",
      message: "Too short",
    };
    expect(
      agentCompactionState(
        "claudeCode",
        turn([started, failed, success], "/compact", { kind: "exited", exitCode: 0 }),
      ),
    ).toEqual({ kind: "failed", message: "Too short" });
    expect(agentCompactionState("claudeCode", turn([started, failed, started]))).toEqual({
      kind: "compacting",
    });
  });
  it.each<AgentTurnStatus>([
    { kind: "stopped" },
    { kind: "interrupted" },
    { kind: "failed", message: "offline" },
    { kind: "exited", exitCode: 0 },
    { kind: "exited", exitCode: 1 },
  ])("terminal turn overrides stale activity: %j", (status) => {
    expect(agentCompactionState("claudeCode", turn([started], "/compact", status))).toEqual({
      kind: "idle",
    });
  });
});
