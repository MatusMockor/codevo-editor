import { describe, expect, it } from "vitest";
import type { AgentThread, AgentTurn, AgentTurnEvent, AgentTurnStatus } from "./agentThread";
import { aggregateAgentUsage, agentUsagePeriodStart } from "./agentUsage";

const NOW = new Date(2026, 7, 28, 12, 0, 0, 0).getTime();

describe("aggregateAgentUsage", () => {
  it("groups truthful turn outcomes, duration, and CLI result usage by provider and project", () => {
    const threads = [
      thread("claudeCode", "project-a", [
        turn("success", NOW - 10_000, { kind: "exited", exitCode: 0 }, NOW - 4_000, usage(5, 7)),
        turn("exit-failure", NOW - 20_000, { kind: "exited", exitCode: 2 }, NOW - 17_000),
        turn("spawn-failure", NOW - 30_000, { kind: "failed", message: "nope" }, NOW - 29_000),
        turn("stopped", NOW - 40_000, { kind: "stopped" }, NOW - 38_000),
        turn("interrupted", NOW - 50_000, { kind: "interrupted" }, NOW - 49_000),
        turn("running", NOW - 60_000, { kind: "running" }, null),
        turn("pending", NOW - 70_000, { kind: "pending" }, null),
      ]),
      thread("codex", "project-b", [
        turn(
          "codex-success",
          NOW - 8_000,
          { kind: "exited", exitCode: 0 },
          NOW - 3_000,
          usage(11, 13),
        ),
      ]),
    ];

    const result = aggregateAgentUsage(threads, "today", NOW);

    expect(result.providers.claudeCode.total).toMatchObject({
      turnsStarted: 7,
      turnsCompleted: 1,
      turnsFailed: 2,
      turnsStoppedOrInterrupted: 2,
      turnsActive: 2,
      wallTime: { totalMs: 13_000, measuredTurns: 5, eligibleTurns: 5 },
      cliUsage: {
        inputTokens: 5,
        outputTokens: 7,
        measuredTurns: 1,
        eligibleTurns: 2,
        source: "claudeStreamJsonResult",
      },
    });
    expect(result.providers.claudeCode.projects[0]?.rootKey).toBe("project-a");
    expect(result.providers.codex.total.cliUsage).toMatchObject({
      inputTokens: 11,
      outputTokens: 13,
      source: "codexJsonlTurnCompleted",
    });
  });

  it("counts provider cache tokens in processed input instead of under-reporting Claude usage", () => {
    const cachedUsage: AgentTurnEvent = {
      kind: "result",
      text: "",
      isError: false,
      usage: { inputTokens: 2, outputTokens: 4, contextTokens: 32_591 },
    };
    const result = aggregateAgentUsage(
      [
        thread("claudeCode", "project-a", [
          turn("cached", NOW - 2_000, { kind: "exited", exitCode: 0 }, NOW - 1_000, cachedUsage),
        ]),
      ],
      "today",
      NOW,
    );

    expect(result.providers.claudeCode.total.cliUsage).toMatchObject({
      inputTokens: 32_591,
      outputTokens: 4,
    });
  });

  it("uses local calendar boundaries for today, 7 days, and 30 days", () => {
    const today = agentUsagePeriodStart("today", NOW);
    const sevenDays = agentUsagePeriodStart("7days", NOW);
    const thirtyDays = agentUsagePeriodStart("30days", NOW);

    expect(new Date(today).getHours()).toBe(0);
    expect(new Date(sevenDays).getDate()).toBe(new Date(2026, 7, 22).getDate());
    expect(new Date(thirtyDays).getDate()).toBe(new Date(2026, 6, 30).getDate());

    const result = aggregateAgentUsage(
      [
        thread("claudeCode", "project-a", [
          turn("inside", sevenDays, { kind: "exited", exitCode: 0 }, sevenDays + 1),
          turn("outside", sevenDays - 1, { kind: "exited", exitCode: 0 }, sevenDays),
          turn("future", NOW + 1, { kind: "pending" }, null),
        ]),
      ],
      "7days",
      NOW,
    );

    expect(result.providers.claudeCode.total.turnsStarted).toBe(1);
  });

  it("preserves local midnight across timezone offset transitions", () => {
    const afterSpringTransition = new Date(2026, 2, 30, 12, 0, 0, 0).getTime();
    const start = agentUsagePeriodStart("7days", afterSpringTransition);
    const local = new Date(start);
    const elapsedWithoutOffsetChange = 156 * 60 * 60 * 1_000;
    const offsetChangeMs =
      (new Date(afterSpringTransition).getTimezoneOffset() - local.getTimezoneOffset()) *
      60 *
      1_000;

    expect([local.getFullYear(), local.getMonth(), local.getDate(), local.getHours()]).toEqual([
      2026, 2, 24, 0,
    ]);
    expect(afterSpringTransition - start).toBe(elapsedWithoutOffsetChange + offsetChangeMs);
  });

  it("omits wall time ending in the future and usage from non-exited turns", () => {
    const result = aggregateAgentUsage(
      [
        thread("claudeCode", "project-a", [
          turn("future-end", NOW - 1_000, { kind: "exited", exitCode: 0 }, NOW + 1, usage(2, 3)),
          turn("active-result", NOW - 2_000, { kind: "running" }, null, usage(5, 7)),
          turn(
            "failed-result",
            NOW - 3_000,
            { kind: "failed", message: "failed" },
            NOW - 1_000,
            usage(11, 13),
          ),
        ]),
      ],
      "today",
      NOW,
    );

    expect(result.providers.claudeCode.total.wallTime).toEqual({
      totalMs: 2_000,
      measuredTurns: 1,
      eligibleTurns: 2,
    });
    expect(result.providers.claudeCode.total.cliUsage).toMatchObject({
      inputTokens: 2,
      outputTokens: 3,
      measuredTurns: 1,
      eligibleTurns: 1,
    });
  });

  it("fails closed for invalid durations, ambiguous usage, and unsafe aggregate sums", () => {
    const ambiguous = [usage(1, 2), usage(3, 4)];
    const result = aggregateAgentUsage(
      [
        thread("claudeCode", "project-a", [
          turn(
            "bad-duration",
            NOW - 2_000,
            { kind: "exited", exitCode: 0 },
            NOW - 3_000,
            ambiguous,
          ),
          turn(
            "overflow-one",
            NOW - 4_000,
            { kind: "exited", exitCode: 0 },
            NOW - 3_000,
            usage(Number.MAX_SAFE_INTEGER, 1),
          ),
          turn(
            "overflow-two",
            NOW - 6_000,
            { kind: "exited", exitCode: 0 },
            NOW - 5_000,
            usage(1, Number.MAX_SAFE_INTEGER),
          ),
        ]),
      ],
      "today",
      NOW,
    );

    expect(result.providers.claudeCode.total.wallTime).toEqual({
      totalMs: 2_000,
      measuredTurns: 2,
      eligibleTurns: 3,
    });
    expect(result.providers.claudeCode.total.cliUsage).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      measuredTurns: 2,
      eligibleTurns: 3,
      incomplete: true,
    });
  });

  it("marks retained saved history and truncated usage evidence as incomplete", () => {
    const truncatedTurn = turn(
      "truncated",
      NOW - 2_000,
      { kind: "exited", exitCode: 0 },
      NOW - 1_000,
    );
    const result = aggregateAgentUsage(
      [
        {
          ...thread("claudeCode", "project-a", [{ ...truncatedTurn, eventsTruncated: true }]),
          turnsTruncated: true,
        },
      ],
      "today",
      NOW,
    );

    expect(result.savedHistoryIncomplete).toBe(true);
    expect(result.providers.claudeCode.total.cliUsage.incomplete).toBe(true);
  });

  it("aggregates measured stream bytes with complete, partial, legacy, provider, and project coverage", () => {
    const result = aggregateAgentUsage(
      [
        thread("claudeCode", "project-a", [
          {
            ...turn("complete", NOW - 10, { kind: "exited", exitCode: 0 }, NOW - 9),
            streamMetrics: { receivedUtf8Bytes: 10, complete: true },
          },
          {
            ...turn("partial", NOW - 8, { kind: "exited", exitCode: 0 }, NOW - 7),
            streamMetrics: { receivedUtf8Bytes: 5, complete: false },
          },
          {
            ...turn("legacy", NOW - 6, { kind: "exited", exitCode: 0 }, NOW - 5),
            streamMetrics: null,
          },
        ]),
        thread("claudeCode", "project-b", [
          {
            ...turn("other-project", NOW - 4, { kind: "exited", exitCode: 0 }, NOW - 3),
            streamMetrics: { receivedUtf8Bytes: 20, complete: true },
          },
        ]),
        thread("codex", "project-a", [
          {
            ...turn("codex", NOW - 2, { kind: "exited", exitCode: 0 }, NOW - 1),
            streamMetrics: { receivedUtf8Bytes: 30, complete: true },
          },
        ]),
      ],
      "today",
      NOW,
    );

    expect(result.providers.claudeCode.total.streamOutput).toEqual({
      receivedUtf8Bytes: 35,
      measuredTurns: 3,
      completeTurns: 2,
      eligibleTurns: 4,
      incomplete: true,
    });
    expect(result.providers.claudeCode.projects[0]?.metrics.streamOutput).toEqual({
      receivedUtf8Bytes: 15,
      measuredTurns: 2,
      completeTurns: 1,
      eligibleTurns: 3,
      incomplete: true,
    });
    expect(result.providers.codex.total.streamOutput.receivedUtf8Bytes).toBe(30);
  });

  it("counts active stream bytes as measured but never as complete coverage", () => {
    const result = aggregateAgentUsage(
      [
        thread("claudeCode", "project-a", [
          {
            ...turn("settled", NOW - 4, { kind: "exited", exitCode: 0 }, NOW - 3),
            streamMetrics: { receivedUtf8Bytes: 10, complete: true },
          },
          {
            ...turn("active", NOW - 2, { kind: "running" }, null),
            streamMetrics: { receivedUtf8Bytes: 5, complete: true },
          },
        ]),
      ],
      "today",
      NOW,
    );

    expect(result.providers.claudeCode.total.streamOutput).toEqual({
      receivedUtf8Bytes: 15,
      measuredTurns: 2,
      completeTurns: 1,
      eligibleTurns: 2,
      incomplete: true,
    });
  });

  it("keeps legacy-only stream bytes unavailable and fails closed on sum overflow", () => {
    const legacy = aggregateAgentUsage(
      [
        thread("claudeCode", "project-a", [
          {
            ...turn("legacy", NOW - 2, { kind: "exited", exitCode: 0 }, NOW - 1),
            streamMetrics: null,
          },
        ]),
      ],
      "today",
      NOW,
    );
    expect(legacy.providers.claudeCode.total.streamOutput).toEqual({
      receivedUtf8Bytes: null,
      measuredTurns: 0,
      completeTurns: 0,
      eligibleTurns: 1,
      incomplete: true,
    });

    const overflow = aggregateAgentUsage(
      [
        thread("codex", "project-b", [
          {
            ...turn("maximum", NOW - 4, { kind: "exited", exitCode: 0 }, NOW - 3),
            streamMetrics: { receivedUtf8Bytes: Number.MAX_SAFE_INTEGER, complete: true },
          },
          {
            ...turn("overflow", NOW - 2, { kind: "exited", exitCode: 0 }, NOW - 1),
            streamMetrics: { receivedUtf8Bytes: 1, complete: true },
          },
        ]),
      ],
      "today",
      NOW,
    );
    expect(overflow.providers.codex.total.streamOutput).toMatchObject({
      receivedUtf8Bytes: null,
      measuredTurns: 2,
      completeTurns: 2,
      incomplete: true,
    });
  });

  it("does not emit empty project rows outside the selected period", () => {
    const result = aggregateAgentUsage(
      [thread("claudeCode", "old-project", [turn("old", 1, { kind: "exited", exitCode: 0 }, 2)])],
      "today",
      NOW,
    );

    expect(result.providers.claudeCode.projects).toEqual([]);
  });
});

function thread(
  provider: AgentThread["provider"]["kind"],
  rootKey: string,
  turns: ReadonlyArray<AgentTurn>,
): AgentThread {
  return {
    threadId: `agt-${provider}-${rootKey}`.toLowerCase(),
    owner: { rootKey, ownerId: `owner-${rootKey}`, repositoryRoot: `/repo/${rootKey}` },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: provider, sessionId: null },
    title: rootKey,
    pinned: false,
    archived: false,
    createdAtEpochMs: NOW - 100_000,
    updatedAtEpochMs: NOW,
    turns,
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: null,
    externalOrigin: null,
  };
}

function turn(
  turnId: string,
  startedAtEpochMs: number,
  status: AgentTurnStatus,
  endedAtEpochMs: number | null,
  events: AgentTurnEvent | ReadonlyArray<AgentTurnEvent> = [],
): AgentTurn {
  return {
    turnId,
    prompt: turnId,
    status,
    startedAtEpochMs,
    endedAtEpochMs,
    events: Array.isArray(events) ? events : [events],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 1,
    launch: null,
    cliVersion: null,
  };
}

function usage(inputTokens: number, outputTokens: number): AgentTurnEvent {
  return {
    kind: "result",
    text: "",
    isError: false,
    usage: { inputTokens, outputTokens, contextTokens: inputTokens },
  };
}
