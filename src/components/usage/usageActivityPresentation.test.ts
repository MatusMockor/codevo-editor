import { describe, expect, it } from "vitest";
import type { AgentThread, AgentTurn, AgentTurnEvent } from "../../domain/agentThread";
import { aggregateAgentUsage } from "../../domain/agentUsage";
import {
  localActivityNote,
  localSpendSummary,
  usageCostCell,
  usageDurationCell,
  usageProjectRows,
  usageProviderRows,
  usageTokensCell,
} from "./usageActivityPresentation";

const NOW = new Date(2026, 9, 1, 12, 0, 0, 0).getTime();
const EXITED: AgentTurn["status"] = { kind: "exited", exitCode: 0 };

describe("local activity presentation", () => {
  it("counts header turns from the same population as the provider and project rows", () => {
    const usage = aggregateAgentUsage(
      [
        thread("claudeCode", "/work/editor", [
          turn("ok", NOW - 9_000, { kind: "exited", exitCode: 0 }, 0.5),
          turn("stopped", NOW - 8_000, { kind: "stopped" }),
          {
            ...turn("continued", NOW - 7_000, { kind: "exited", exitCode: 0 }, 0.25),
            origin: "background",
          },
        ]),
        thread("codex", "/work/api", [turn("codex", NOW - 6_000, { kind: "exited", exitCode: 1 })]),
      ],
      "today",
      NOW,
    );

    const summary = localSpendSummary(usage.providers);
    const providerRows = usageProviderRows(usage.providers);
    const projectRows = usageProjectRows(usage.providers, (rootKey) => rootKey);

    expect(summary.turns).toBe(3);
    expect(providerRows.reduce((sum, row) => sum + row.turns, 0)).toBe(summary.turns);
    expect(projectRows.reduce((sum, row) => sum + row.turns, 0)).toBe(summary.turns);
    expect(summary).toMatchObject({
      backgroundTurns: 1,
      costUsd: 0.75,
      costMeasuredRuns: 2,
      costEligibleRuns: 2,
      costInferredRuns: 0,
      costProviders: ["claudeCode"],
      costlessProviders: ["codex"],
    });
  });

  it("describes background continuations, missing and inferred cost and evicted history", () => {
    const usage = aggregateAgentUsage(
      [
        {
          ...thread("claudeCode", "/work/editor", [
            turn("first-retained", NOW - 50_000, EXITED, 40),
            turn("delta", NOW - 40_000, EXITED, 2),
            { ...turn("continued", NOW - 30_000, EXITED, 3), origin: "background" as const },
            turn("no-cost", NOW - 25_000, EXITED),
          ]),
          turnsTruncated: true,
        },
        thread("claudeCode", "/work/api", [
          turn("fresh", NOW - 20_000, EXITED, 0.5),
          turn("respawned", NOW - 10_000, EXITED, 0.8),
        ]),
        thread("codex", "/work/api", [turn("codex", NOW - 6_000, EXITED)]),
      ],
      "today",
      NOW,
    );

    expect(localActivityNote(localSpendSummary(usage.providers), true)).toBe(
      "Saved threads on this device, not subscription billing. Cost is the provider-reported API equivalent; tokens include cached input. Totals also include 1 background continuation, which is not counted as a turn. Cost is unavailable for 2 of 6 finished Claude Code turns and continuations. The cost of 1 turn or continuation is inferred from Claude Code's running session total. Codex does not report cost. Saved history is incomplete because older turns were evicted.",
    );
  });

  it("keeps the note short when every cost is reported directly", () => {
    const usage = aggregateAgentUsage(
      [
        thread("claudeCode", "/work/editor", [
          turn("first", NOW - 20_000, EXITED, 0.5),
          turn("second", NOW - 10_000, EXITED, 0.25),
        ]),
      ],
      "today",
      NOW,
    );

    expect(localActivityNote(localSpendSummary(usage.providers), false)).toBe(
      "Saved threads on this device, not subscription billing. Cost is the provider-reported API equivalent; tokens include cached input.",
    );
  });

  it("explains a missing cost total even when some turns reported cost", () => {
    const note = localActivityNote(
      {
        costUsd: null,
        tokens: 10,
        turns: 2,
        backgroundTurns: 0,
        costMeasuredRuns: 2,
        costEligibleRuns: 2,
        costInferredRuns: 0,
        costProviders: ["claudeCode"],
        costlessProviders: [],
      },
      false,
    );

    expect(note).toBe(
      "Saved threads on this device, not subscription billing. Cost is the provider-reported API equivalent; tokens include cached input. The cost total is unavailable because a provider's reported costs could not be added up.",
    );
  });

  it("keeps a project whose only activity in the period was a background continuation", () => {
    const usage = aggregateAgentUsage(
      [
        thread("claudeCode", "/work/editor", [
          turn("yesterday", NOW - 2 * 86_400_000, EXITED, 1),
          { ...turn("after-midnight", NOW - 5_000, EXITED, 0.5), origin: "background" as const },
        ]),
      ],
      "today",
      NOW,
    );

    const rows = usageProjectRows(usage.providers, (rootKey) => rootKey);

    expect(rows).toEqual([expect.objectContaining({ label: "/work/editor", turns: 0 })]);
    expect(localSpendSummary(usage.providers).backgroundTurns).toBe(1);
  });

  it("renders empty and zero cells as a dash instead of a misleading zero", () => {
    expect(usageDurationCell(0)).toBe("—");
    expect(usageDurationCell(null)).toBe("—");
    expect(usageDurationCell(850)).toBe("850 ms");
    expect(usageDurationCell((4 * 60 + 23) * 60_000)).toBe("4 h 23 min");
    expect(usageTokensCell(null)).toBe("—");
    expect(usageTokensCell(57_488_305)).toBe(new Intl.NumberFormat().format(57_488_305));
    expect(usageCostCell(null)).toBe("—");
    expect(usageCostCell(10_264.35)).toContain("10,264.35");
  });

  it("keeps an idle provider row with no invented duration or cost", () => {
    const usage = aggregateAgentUsage([], "today", NOW);

    expect(usageProviderRows(usage.providers)).toEqual([
      expect.objectContaining({ provider: "claudeCode", label: "Claude Code", turns: 0 }),
      expect.objectContaining({ provider: "codex", label: "Codex", turns: 0 }),
    ]);
    expect(
      usageProviderRows(usage.providers).map((row) => usageDurationCell(row.wallTimeMs)),
    ).toEqual(["—", "—"]);
    expect(usageProviderRows(usage.providers).map((row) => row.costUsd)).toEqual([null, null]);
  });
});

function thread(
  provider: AgentThread["provider"]["kind"],
  rootKey: string,
  turns: ReadonlyArray<AgentTurn>,
): AgentThread {
  return {
    threadId: `agt-${provider}-${rootKey}`.replace(/[^a-z0-9-]/giu, "-").toLowerCase(),
    owner: { rootKey, ownerId: `owner-${rootKey}`, repositoryRoot: rootKey },
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
  status: AgentTurn["status"],
  costUsd?: number,
): AgentTurn {
  const events: AgentTurnEvent[] =
    costUsd === undefined
      ? []
      : [
          {
            kind: "result",
            text: "",
            isError: false,
            usage: { inputTokens: 4, outputTokens: 2, contextTokens: 4, costUsd },
          },
        ];
  return {
    turnId,
    prompt: turnId,
    status,
    startedAtEpochMs,
    endedAtEpochMs: startedAtEpochMs + 500,
    events,
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 1,
    launch: null,
    cliVersion: null,
  };
}
