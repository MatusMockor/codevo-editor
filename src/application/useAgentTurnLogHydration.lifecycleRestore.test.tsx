// @vitest-environment jsdom

import { act } from "react";
import { compactPersistedAgentSubagentLifecycle } from "../domain/agentLifecyclePersistence";
import { describe, expect, it } from "vitest";
import wire from "../../contracts/agent-subagent-lifecycle-wire.json";
import {
  parseAgentSubagentLifecycle,
  type AgentSubagentLifecycle,
} from "../domain/agentSubagentLifecycle";
import {
  agentSubagentLifecycleHasRetainedDetail,
  legacyAgentSubagentLifecycle,
} from "../domain/agentSubagentLifecycleLegacy";
import type { AgentThread, AgentTurn, AgentTurnEvent } from "../domain/agentThread";
import type { AgentTurnLogSummary } from "../domain/agentTurnLog";
import { restorableAgentTurnLifecycle } from "../domain/agentTurnLifecycleRestore";
import { validateSaveAgentThreadRequest } from "../infrastructure/tauriAgentThreadStoreIpcContract";
import {
  LOG_OWNER_ID,
  LOG_REPOSITORY_ROOT,
  LOG_THREAD_ID,
  logThread,
  logTurn,
  renderLogStore,
  sealedLogSummary,
  settleLogStore,
} from "../test/agentTurnLogStoreHarness";

const OLD_TURN_ID = "agt-1-0a1c";
const NEW_TURN_ID = "agt-1-0a1d";
const RETAINED = parseAgentSubagentLifecycle(wire.valid.retained) as AgentSubagentLifecycle;
const PERSISTED = legacyAgentSubagentLifecycle(RETAINED);

interface SavedTurnWire {
  readonly turnId: string;
  readonly subagentLifecycle?: AgentSubagentLifecycle;
}

function settledTurn(turnId: string, overrides: Partial<AgentTurn> = {}): AgentTurn {
  return logTurn({ turnId, subagentLifecycle: PERSISTED, ...overrides });
}

function threadWith(turns: ReadonlyArray<AgentTurn>): AgentThread {
  return logThread({ turns });
}

function lifecycleSummary(
  turnId: string,
  lifecycle: AgentSubagentLifecycle | null,
  overrides: Partial<AgentTurnLogSummary> = {},
): AgentTurnLogSummary {
  return sealedLogSummary(turnId, 4, { lifecycle, ...overrides });
}

function lifecycleSummarizeCount(harness: ReturnType<typeof renderLogStore>): number {
  return harness.logGateway.summarized.filter((request) => request.includeLifecycles).length;
}

function lastSavedTurns(harness: ReturnType<typeof renderLogStore>): ReadonlyArray<SavedTurnWire> {
  const request = harness.saved[harness.saved.length - 1];
  expect(request).toBeDefined();
  const written = validateSaveAgentThreadRequest(request!).thread as {
    readonly turns: ReadonlyArray<SavedTurnWire>;
  };
  return written.turns;
}

describe("restoring the retained subagent lifecycle from the turn log", () => {
  it("gives task titles and frozen batches back on thread open without saving the thread", async () => {
    const harness = renderLogStore({
      persisted: [threadWith([settledTurn(OLD_TURN_ID)])],
      summaries: [lifecycleSummary(OLD_TURN_ID, RETAINED)],
    });
    await settleLogStore();
    const savesBefore = harness.saved.length;

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    expect(harness.turnOf(LOG_THREAD_ID, OLD_TURN_ID)?.subagentLifecycle).toEqual(RETAINED);
    expect(harness.saved).toHaveLength(savesBefore);
    expect(harness.logGateway.appends).toEqual([]);
    expect(lifecycleSummarizeCount(harness)).toBe(1);

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();
    expect(lifecycleSummarizeCount(harness)).toBe(1);
    await harness.unmount();
  });

  it("restores every subagent from a compact legacy projection without rewriting it on open", async () => {
    const full = {
      entries: [
        PERSISTED.entries[0]!,
        { ...PERSISTED.entries[0]!, id: "tool:last", toolId: "last", taskId: "last-task" },
      ],
      truncated: false,
    };
    const harness = renderLogStore({
      persisted: [
        threadWith([
          settledTurn(OLD_TURN_ID, {
            subagentLifecycle: compactPersistedAgentSubagentLifecycle(full),
          }),
        ]),
      ],
      summaries: [lifecycleSummary(OLD_TURN_ID, full)],
    });
    await settleLogStore();
    const savesBefore = harness.saved.length;
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();
    expect(harness.turnOf(LOG_THREAD_ID, OLD_TURN_ID)?.subagentLifecycle).toEqual(full);
    expect(harness.saved).toHaveLength(savesBefore);
    expect(harness.logGateway.appends).toEqual([]);
    await harness.unmount();
  });

  it("falls back to the legacy lifecycle when the log holds none, omits it or describes another state", async () => {
    const other = parseAgentSubagentLifecycle(wire.valid.legacy) as AgentSubagentLifecycle;
    const harness = renderLogStore({
      persisted: [
        threadWith([
          settledTurn(OLD_TURN_ID),
          settledTurn(NEW_TURN_ID, { subagentLifecycle: other }),
          settledTurn("agt-1-0a1e"),
        ]),
      ],
      summaries: [
        lifecycleSummary(OLD_TURN_ID, null),
        lifecycleSummary(NEW_TURN_ID, RETAINED),
        lifecycleSummary("agt-1-0a1e", null, { lifecycleOmitted: true }),
      ],
    });
    await settleLogStore();

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    expect(harness.turnOf(LOG_THREAD_ID, OLD_TURN_ID)?.subagentLifecycle).toEqual(PERSISTED);
    expect(harness.turnOf(LOG_THREAD_ID, NEW_TURN_ID)?.subagentLifecycle).toEqual(other);
    expect(harness.turnOf(LOG_THREAD_ID, "agt-1-0a1e")?.subagentLifecycle).toEqual(PERSISTED);
    expect(harness.logGateway.opens).toEqual([]);
    expect(harness.logGateway.appends).toEqual([]);
    await harness.unmount();
  });

  it("never touches a running turn while it restores the settled ones", async () => {
    const harness = renderLogStore({
      summaries: [
        lifecycleSummary(OLD_TURN_ID, RETAINED),
        lifecycleSummary(NEW_TURN_ID, RETAINED, { sealed: false }),
      ],
    });
    await settleLogStore();
    act(() => {
      harness.hook().dispatchAction({
        kind: "threadCreated",
        thread: threadWith([settledTurn(OLD_TURN_ID)]),
      });
      harness.hook().dispatchAction({
        kind: "turnStarted",
        threadId: LOG_THREAD_ID,
        turn: settledTurn(NEW_TURN_ID, { status: { kind: "running" }, endedAtEpochMs: null }),
      });
    });
    await settleLogStore();
    const savesBefore = harness.saved.length;

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    expect(harness.turnOf(LOG_THREAD_ID, OLD_TURN_ID)?.subagentLifecycle).toEqual(RETAINED);
    expect(harness.turnOf(LOG_THREAD_ID, NEW_TURN_ID)?.subagentLifecycle).toEqual(PERSISTED);
    expect(harness.saved).toHaveLength(savesBefore);
    await harness.unmount();
  });

  it("drops a lifecycle response that settles after the workspace was replaced", async () => {
    const harness = renderLogStore({
      persisted: [threadWith([settledTurn(OLD_TURN_ID)])],
      summaries: [lifecycleSummary(OLD_TURN_ID, RETAINED)],
    });
    await settleLogStore();
    act(() =>
      harness.turnLog.facts.publishSummaries(LOG_THREAD_ID, [
        lifecycleSummary(OLD_TURN_ID, RETAINED),
      ]),
    );

    harness.logGateway.holdSummaries = true;
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();
    expect(lifecycleSummarizeCount(harness)).toBe(1);

    harness.setProjects([]);
    await settleLogStore();
    harness.logGateway.holdSummaries = false;
    harness.logGateway.releaseSummaries();
    await settleLogStore();

    expect(harness.turnOf(LOG_THREAD_ID, OLD_TURN_ID)?.subagentLifecycle).toEqual(PERSISTED);
    await harness.unmount();
  });
});

describe("migrating retained lifecycle detail that an existing thread file still carries", () => {
  it("keeps it in memory, stores it in the log once and rewrites the file in the v1 shape without losing anything", async () => {
    const harness = renderLogStore({
      persisted: [threadWith([settledTurn(OLD_TURN_ID, { subagentLifecycle: RETAINED })])],
      summaries: [lifecycleSummary(OLD_TURN_ID, null)],
    });
    await settleLogStore();
    expect(harness.turnOf(LOG_THREAD_ID, OLD_TURN_ID)?.subagentLifecycle).toEqual(RETAINED);

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    expect(harness.logGateway.opens.map((request) => request.scope.turnId)).toEqual([OLD_TURN_ID]);
    expect(harness.logGateway.opens[0]).toMatchObject({
      priorLoss: { kind: "none" },
      prompt: null,
    });
    expect(harness.logGateway.appends).toHaveLength(1);
    expect(harness.logGateway.appends[0]).toMatchObject({
      ops: [],
      seal: false,
      digest: null,
      loss: { kind: "none" },
      lifecycle: RETAINED,
    });

    act(() => harness.hook().rename(LOG_THREAD_ID, "Renamed"));
    await settleLogStore();

    const written = lastSavedTurns(harness)[0]?.subagentLifecycle;
    expect(written).toEqual(PERSISTED);
    expect(agentSubagentLifecycleHasRetainedDetail(written!)).toBe(false);
    expect(
      restorableAgentTurnLifecycle(written, harness.logGateway.appends[0]!.lifecycle!),
    ).toEqual(RETAINED);
    expect(harness.turnOf(LOG_THREAD_ID, OLD_TURN_ID)?.subagentLifecycle).toEqual(RETAINED);
    await harness.unmount();
  });

  it("stores a fully recorded turn without a log row as recorded, not as lost history", async () => {
    const harness = renderLogStore({
      persisted: [threadWith([settledTurn(OLD_TURN_ID, { subagentLifecycle: RETAINED })])],
      summaries: [],
    });
    await settleLogStore();

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    expect(harness.logGateway.opens).toHaveLength(1);
    expect(harness.logGateway.opens[0]?.priorLoss).toEqual({ kind: "none" });
    expect(harness.logGateway.appends[0]).toMatchObject({ seal: false, lifecycle: RETAINED });
    expect(harness.turnLog.facts.factsOf(OLD_TURN_ID)).toMatchObject({
      loss: { kind: "none" },
      sealed: false,
    });
    await harness.unmount();
  });

  it("marks a truncated turn without a log row as pre-log history", async () => {
    const harness = renderLogStore({
      persisted: [
        threadWith([
          settledTurn(OLD_TURN_ID, { subagentLifecycle: RETAINED, eventsTruncated: true }),
        ]),
      ],
      summaries: [],
    });
    await settleLogStore();

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    expect(harness.logGateway.opens[0]?.priorLoss).toEqual({ kind: "legacyWindow" });
    expect(harness.logGateway.appends[0]).toMatchObject({ seal: true, lifecycle: RETAINED });
    expect(harness.turnLog.facts.factsOf(OLD_TURN_ID)).toMatchObject({
      loss: { kind: "legacyWindow" },
      sealed: true,
    });
    await harness.unmount();
  });

  it("still rewrites the file in the v1 shape when the log refuses the migration", async () => {
    const harness = renderLogStore({
      persisted: [threadWith([settledTurn(OLD_TURN_ID, { subagentLifecycle: RETAINED })])],
      summaries: [lifecycleSummary(OLD_TURN_ID, null)],
    });
    harness.logGateway.appendTurnLog = () => Promise.reject(new Error("unreadable"));
    await settleLogStore();

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();
    act(() => harness.hook().rename(LOG_THREAD_ID, "Renamed"));
    await settleLogStore();

    expect(lastSavedTurns(harness)[0]?.subagentLifecycle).toEqual(PERSISTED);
    expect(harness.reportError).not.toHaveBeenCalled();

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();
    expect(lifecycleSummarizeCount(harness)).toBe(2);
    await harness.unmount();
  });

  it("writes the v1 shape even before any log was consulted", async () => {
    const harness = renderLogStore({
      persisted: [threadWith([settledTurn(OLD_TURN_ID, { subagentLifecycle: RETAINED })])],
    });
    await settleLogStore();

    act(() => harness.hook().rename(LOG_THREAD_ID, "Renamed"));
    await settleLogStore();

    expect(lastSavedTurns(harness)[0]?.subagentLifecycle).toEqual(PERSISTED);
    await harness.unmount();
  });
});

describe("a live turn keeps its retained lifecycle in the log and the v1 shape in the file", () => {
  it("sends the lifecycle when it changes and only then", async () => {
    const harness = renderLogStore();
    await settleLogStore();
    const worktreePath = `${LOG_REPOSITORY_ROOT}/.worktrees/one`;
    const appended = (outputSequence: number, event: AgentTurnEvent) => ({
      kind: "turnEventsAppended" as const,
      threadId: LOG_THREAD_ID,
      turnId: OLD_TURN_ID,
      workspaceId: LOG_OWNER_ID,
      repositoryRoot: LOG_REPOSITORY_ROOT,
      isolation: "worktree" as const,
      worktreePath,
      outputSequence,
      events: [event],
      sessionId: null,
      supervisorTruncated: false,
    });
    const spawn: AgentTurnEvent = {
      kind: "toolCall",
      toolId: "toolu_spawn",
      name: "Agent",
      inputSummary: "in",
      description: "Scout the repo",
    };
    const inner: AgentTurnEvent = {
      kind: "toolCall",
      toolId: "toolu_inner",
      name: "Read",
      inputSummary: "file",
      parentToolId: "toolu_spawn",
    };
    act(() => {
      harness.hook().dispatchAction({ kind: "threadCreated", thread: threadWith([]) });
      harness.hook().dispatchAction({
        kind: "turnStarted",
        threadId: LOG_THREAD_ID,
        turn: logTurn({
          turnId: OLD_TURN_ID,
          status: { kind: "running" },
          endedAtEpochMs: null,
          lastOutputSequence: 0,
        }),
      });
    });
    await settleLogStore();

    act(() => harness.hook().dispatchAction(appended(1, spawn)));
    await settleLogStore();
    harness.clock.advance(1_000);
    await settleLogStore();
    act(() => harness.hook().dispatchAction(appended(2, inner)));
    await settleLogStore();
    harness.clock.advance(1_000);
    await settleLogStore();

    act(() => harness.hook().saveRunningThreadsNow());
    await settleLogStore();

    const lifecycles = harness.logGateway.appends.map((request) => request.lifecycle);
    const stored = lifecycles.filter((lifecycle) => lifecycle !== null);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.entries[0]).toMatchObject({
      taskTitle: "Scout the repo",
      batchKey: "spawn:toolu_spawn",
    });
    const written = lastSavedTurns(harness)[0]?.subagentLifecycle;
    expect(written).toBeDefined();
    expect(agentSubagentLifecycleHasRetainedDetail(written!)).toBe(false);
    expect(
      harness.turnOf(LOG_THREAD_ID, OLD_TURN_ID)?.subagentLifecycle?.entries[0]?.taskTitle,
    ).toBe("Scout the repo");
    await harness.unmount();
  });
});
