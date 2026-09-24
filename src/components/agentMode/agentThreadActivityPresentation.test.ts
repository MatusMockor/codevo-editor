import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import type {
  AgentThread,
  AgentThreadAttention,
  AgentTurn,
  AgentTurnStatus,
} from "../../domain/agentThread";
import {
  agentThreadActivityDetail,
  agentThreadActivityGroupLabel,
  agentThreadActivitySlotsTitle,
  agentThreadActivitySummary,
  agentThreadAttentionLabel,
} from "./agentThreadActivityPresentation";

describe("agent thread activity presentation", () => {
  it("counts only threads that need attention and explains failed and interrupted runs", () => {
    const summary = agentThreadActivitySummary(
      [
        threadView({
          threadId: "failed",
          attention: "attention",
          status: { kind: "failed", message: "private error" },
        }),
        threadView({
          threadId: "exited",
          attention: "attention",
          status: { kind: "exited", exitCode: 2 },
        }),
        threadView({ threadId: "stopped", attention: "attention", status: { kind: "stopped" } }),
        threadView({
          threadId: "interrupted",
          attention: "attention",
          status: { kind: "interrupted" },
        }),
        threadView({ threadId: "running", attention: "running" }),
      ],
      2,
      4,
    );

    expect(summary.live).toBe(2);
    expect(summary.capacity).toBe(4);
    expect(summary.attention).toBe(4);
    expect(summary.attentionExplanation).toContain("2 failed · 1 interrupted.");
    expect(summary.attentionExplanation).not.toContain("private error");
    expect(summary.attentionExplanation).toContain("Right-click the thread activity");
    expect(summary.attentionExplanation).not.toContain("status bar");
  });

  it("labels slots, attention and the tooltip detail", () => {
    const summary = { live: 2, capacity: 4, attention: 1, attentionExplanation: "why" };

    expect(agentThreadActivitySlotsTitle(summary)).toBe("2 of 4 thread slots in use");
    expect(agentThreadAttentionLabel(1)).toBe("1 needs attention");
    expect(agentThreadAttentionLabel(3)).toBe("3 need attention");
    expect(agentThreadActivityDetail(summary, true)).toBe("2 running · 1 needs attention");
    expect(agentThreadActivityDetail(summary, false)).toBe("2 running");
    expect(agentThreadActivityDetail({ ...summary, live: 0, attention: 0 }, true)).toBeNull();
    expect(agentThreadActivityGroupLabel({ ...summary, live: 0, attention: 0 }, true)).toBe(
      "Thread activity: idle",
    );
    expect(agentThreadActivityGroupLabel(summary, true)).toBe(
      "Thread activity: 2 running · 1 needs attention",
    );
  });

  it("never reports negative counts from a corrupt surface", () => {
    const summary = agentThreadActivitySummary([], -3, -1);

    expect(summary.live).toBe(0);
    expect(summary.capacity).toBe(0);
  });
});

const ROOT = "/workspace/app";

interface ThreadViewOptions {
  readonly threadId: string;
  readonly rootKey?: string;
  readonly attention?: AgentThreadAttention;
  readonly launch?: AgentLaunchOptions | null;
  readonly status?: AgentTurnStatus;
}

function threadView({
  attention = "settled",
  status = { kind: "exited", exitCode: 0 },
  launch = null,
  rootKey = ROOT,
  threadId,
}: ThreadViewOptions): AgentThreadView {
  const thread: AgentThread = {
    threadId,
    owner: { rootKey, ownerId: "agent-root:app", repositoryRoot: rootKey },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Refactor the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_700_000_000_000,
    updatedAtEpochMs: 1_700_000_000_000,
    turns: [{ ...turn(threadId, launch), status }],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
  };

  return {
    thread,
    lifecycle: "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention,
    unread: false,
  };
}

function turn(threadId: string, launch: AgentLaunchOptions | null): AgentTurn {
  return {
    turnId: `${threadId}-t1`,
    prompt: "Refactor the parser",
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 1_700_000_000_000,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch,
    cliVersion: null,
  };
}
