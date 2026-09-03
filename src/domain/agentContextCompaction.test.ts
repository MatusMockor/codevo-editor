import { describe, expect, it } from "vitest";
import type { AgentThread } from "./agentThread";
import { CLAUDE_COMPACTION_IDLE_MS, agentContextCompactionOffer } from "./agentContextCompaction";

const NOW = 2_000_000_000_000;

describe("agentContextCompactionOffer", () => {
  it("offers Claude compaction only for an old, large, resumable settled session", () => {
    const thread = candidate();
    expect(agentContextCompactionOffer(thread, NOW)).toEqual({
      key: `agt-1:${thread.updatedAtEpochMs}:120000`,
      contextTokens: 120_000,
    });
    expect(agentContextCompactionOffer({ ...thread, updatedAtEpochMs: NOW }, NOW)).toBeNull();
    expect(
      agentContextCompactionOffer(
        { ...thread, provider: { kind: "codex", sessionId: "s-1" } },
        NOW,
      ),
    ).toBeNull();
  });

  it("does not repeat an offer after the provider compacted the latest context", () => {
    const thread = candidate();
    const turn = thread.turns[0];
    expect(turn).toBeDefined();
    expect(
      agentContextCompactionOffer(
        {
          ...thread,
          turns: [
            {
              ...turn!,
              events: [
                ...turn!.events,
                { kind: "contextCompaction", beforeTokens: 120_000, afterTokens: 42_000 },
              ],
            },
          ],
        },
        NOW,
      ),
    ).toBeNull();
  });
});

function candidate(): AgentThread {
  const updatedAtEpochMs = NOW - CLAUDE_COMPACTION_IDLE_MS - 1;
  return {
    threadId: "agt-1",
    owner: { rootKey: "root", ownerId: "owner", repositoryRoot: "/repo" },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: "session-1" },
    title: "Long task",
    pinned: false,
    archived: false,
    createdAtEpochMs: updatedAtEpochMs - 1_000,
    updatedAtEpochMs,
    turns: [
      {
        turnId: "turn-1",
        prompt: "work",
        status: { kind: "exited", exitCode: 0 },
        startedAtEpochMs: updatedAtEpochMs - 1_000,
        endedAtEpochMs: updatedAtEpochMs,
        events: [
          {
            kind: "result",
            text: "done",
            isError: false,
            usage: { inputTokens: 100, outputTokens: 20, contextTokens: 120_000 },
          },
        ],
        eventsTruncated: false,
        lastStatusSequence: 1,
        lastOutputSequence: 1,
        launch: null,
        cliVersion: null,
      },
    ],
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: null,
    externalOrigin: null,
  };
}
