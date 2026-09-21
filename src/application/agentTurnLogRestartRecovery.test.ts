import { describe, expect, it, vi } from "vitest";
import type { AgentThread, AgentTurnEvent } from "../domain/agentThread";
import type { AgentTurnLogPage, AgentTurnLogSummary } from "../domain/agentTurnLog";
import { interruptedTurnLogLosses } from "./agentTurnLogRestartRecovery";
const result: AgentTurnEvent = { kind: "result", text: "Done", isError: false, usage: null };
const thread: AgentThread = {
  threadId: "agt-1-0001",
  owner: { rootKey: "/a", ownerId: "owner", repositoryRoot: "/a" },
  target: { isolation: "in-place", worktreePath: null },
  provider: { kind: "claudeCode", sessionId: null },
  title: "Task",
  pinned: false,
  archived: false,
  createdAtEpochMs: 1,
  updatedAtEpochMs: 1,
  viewedAtEpochMs: null,
  externalOrigin: null,
  integration: null,
  turnsTruncated: false,
  turns: [
    {
      turnId: "agt-1-0002",
      prompt: "work",
      status: { kind: "running" },
      startedAtEpochMs: 1,
      endedAtEpochMs: null,
      events: [result],
      eventsTruncated: true,
      lastStatusSequence: 1,
      lastOutputSequence: 5,
      launch: null,
      cliVersion: null,
    },
  ],
};
const summary: AgentTurnLogSummary = {
  turnId: "agt-1-0002",
  eventCount: 999,
  bytes: 999999,
  loss: { kind: "none" },
  sealed: false,
  digest: null,
  prompt: null,
  promptOmitted: false,
  lifecycle: null,
  lifecycleOmitted: false,
};
const page: AgentTurnLogPage = {
  entries: [{ seq: 999, event: result }],
  firstSeq: 999,
  lastSeq: 999,
  hasEarlier: true,
  hasLater: false,
  loss: { kind: "none" },
  clipped: false,
};
const owns = () => true;
describe("durable restart tail evidence", () => {
  it("does not turn a paged display window into data loss when matching completion is durable", async () => {
    const readPage = vi.fn(async () => page);
    expect(await interruptedTurnLogLosses({ readPage }, thread, [summary], owns)).toEqual(
      new Map([[summary.turnId, { kind: "none" }]]),
    );
    expect(readPage).toHaveBeenCalledWith(
      expect.objectContaining({ anchor: { at: "tail" }, maxEvents: 200, maxBytes: 524288 }),
    );
  });
  it.each([
    { ...page, hasLater: true },
    { ...page, clipped: true },
    { ...page, loss: { kind: "supervisorGap" } as const },
    { ...page, entries: [] },
    { ...page, entries: [{ seq: 999, event: { ...result, text: "Different result" } }] },
  ])("preserves uncertainty when completion cannot be proven", async (value) => {
    expect(
      (
        await interruptedTurnLogLosses({ readPage: async () => value }, thread, [summary], owns)
      ).get(summary.turnId),
    ).toEqual({ kind: "supervisorGap" });
  });
  it("preserves a more specific loss discovered while reading the tail", async () => {
    const loss = { kind: "diskBudget", atEpochMs: 4 } as const;
    expect(
      (
        await interruptedTurnLogLosses(
          { readPage: async () => ({ ...page, loss }) },
          thread,
          [summary],
          owns,
        )
      ).get(summary.turnId),
    ).toEqual(loss);
  });
  it("never clears a recorded real loss or rereads a sealed transcript", async () => {
    const readPage = vi.fn(async () => page);
    const loss = { kind: "diskBudget", atEpochMs: 4 } as const;
    expect(
      (await interruptedTurnLogLosses({ readPage }, thread, [{ ...summary, loss }], owns)).get(
        summary.turnId,
      ),
    ).toEqual(loss);
    expect(
      await interruptedTurnLogLosses({ readPage }, thread, [{ ...summary, sealed: true }], owns),
    ).toEqual(new Map());
    expect(readPage).not.toHaveBeenCalled();
  });
  it("refuses stale evidence after a workspace generation changes", async () => {
    let current = true;
    const readPage = async () => {
      current = false;
      return page;
    };
    expect(await interruptedTurnLogLosses({ readPage }, thread, [summary], () => current)).toEqual(
      new Map(),
    );
  });
  it("preserves uncertainty on a failed read", async () => {
    const readPage = async (): Promise<AgentTurnLogPage> => {
      throw new Error("unavailable");
    };
    expect(
      (await interruptedTurnLogLosses({ readPage }, thread, [summary], owns)).get(summary.turnId),
    ).toEqual({ kind: "supervisorGap" });
  });
});
