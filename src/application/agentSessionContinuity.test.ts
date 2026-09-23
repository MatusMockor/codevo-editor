import { describe, expect, it } from "vitest";
import type { AgentThread } from "../domain/agentThread";
import { createAgentSessionContinuity } from "./agentSessionContinuity";

function thread(sessionId: string | null): AgentThread {
  return {
    threadId: "agt-1-0a1b",
    owner: { rootKey: "/repo", ownerId: "owner", repositoryRoot: "/repo" },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId },
    title: "Thread",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1,
    updatedAtEpochMs: 1,
    turns: [],
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: null,
    externalOrigin: null,
  };
}

describe("agent session continuity", () => {
  it("keeps reporting a lost session after the dead id was cleared from the thread", () => {
    const continuity = createAgentSessionContinuity();
    continuity.noteLoss(thread("session-dead-0001"), "session-dead-0001");

    expect(continuity.resumePlan(thread(null))).toEqual({ kind: "fresh", reason: "sessionLost" });
  });

  it("reports no session for a thread that never had one and resumes a live one", () => {
    const continuity = createAgentSessionContinuity();

    expect(continuity.resumePlan(thread(null))).toEqual({ kind: "fresh", reason: "noSession" });
    expect(continuity.resumePlan(thread("session-live-0002"))).toEqual({
      kind: "resume",
      sessionId: "session-live-0002",
    });
  });

  it("forgets the lost marker once a new session was reported", () => {
    const continuity = createAgentSessionContinuity();
    continuity.noteLoss(thread("session-dead-0001"), "session-dead-0001");
    continuity.noteReport(thread(null), {
      provider: "claudeCode",
      resumedSessionId: null,
      reportedSessionId: "session-new-0003",
    });

    expect(continuity.resumePlan(thread(null))).toEqual({ kind: "fresh", reason: "noSession" });
  });
});
