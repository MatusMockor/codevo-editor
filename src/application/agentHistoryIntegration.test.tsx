// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_AGENT_THREADS_PER_ROOT, type AgentThread } from "../domain/agentThread";
import {
  logProject,
  logThread,
  logTurn,
  renderLogStore,
  settleLogStore,
} from "../test/agentTurnLogStoreHarness";
import type { SaveAgentThreadRequest } from "./agentThreadPorts";

const harnesses: ReturnType<typeof renderLogStore>[] = [];

function durableStore(persisted: ReadonlyArray<AgentThread>) {
  const harness = renderLogStore({ persisted });
  Object.assign(harness.threadGateway, {
    readAgentHistoryTurns: async () => ({
      turns: [],
      hasEarlier: false,
      beforeTurnId: null,
      revision: 1,
    }),
  });
  harnesses.push(harness);
  return harness;
}

function fullWindow(): AgentThread[] {
  return Array.from({ length: MAX_AGENT_THREADS_PER_ROOT }, (_, index) =>
    logThread({ threadId: `agt-${index + 1}-0a1b`, updatedAtEpochMs: index + 1 }),
  );
}

function holdSave(harness: ReturnType<typeof renderLogStore>) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const save = vi.fn(async (request: SaveAgentThreadRequest) => {
    harness.saved.push(request);
    await gate;
  });
  harness.threadGateway.saveAgentThread = save;
  return { save, release };
}

const historical = () => logThread({ threadId: "agt-100-0a1b", title: "Older conversation" });

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.unmount();
});

describe("durable agent history integration", () => {
  it("flushes a zero-turn imported header before declaring persistence complete", async () => {
    const imported = logThread({
      externalOrigin: {
        provider: "claudeCode",
        sessionId: "34fbe185-9c1d-4e6a-8b21-7f3a5d90c412",
        importedAtEpochMs: 100,
      },
    });
    const harness = durableStore([imported]);
    await settleLogStore();
    const pending = holdSave(harness);
    let complete = false;
    const flushed = harness.hook().flushThread!(imported.threadId).then((result) => {
      complete = true;
      return result;
    });
    await settleLogStore();
    expect(pending.save).toHaveBeenCalledOnce();
    expect(pending.save.mock.calls[0]?.[0].thread.externalOrigin).toEqual(imported.externalOrigin);
    expect(complete).toBe(false);
    pending.release();
    expect(await flushed).toBe(true);
  });

  it("persists the oldest settled victim before evicting only its display state", async () => {
    const threads = fullWindow();
    const harness = durableStore(threads);
    await settleLogStore();
    const pending = holdSave(harness);
    const restored = harness.hook().restoreThread!(historical());
    await settleLogStore();
    expect(pending.save.mock.calls[0]?.[0].thread.threadId).toBe(threads[0]!.threadId);
    expect(harness.hook().currentState().threads.has(threads[0]!.threadId)).toBe(true);
    expect(harness.hook().currentState().threads.has(historical().threadId)).toBe(false);
    await act(async () => {
      pending.save.mock.calls[0]?.[0].onRevision?.(2);
      pending.release();
      expect(await restored).toBe(true);
    });
    expect(harness.hook().currentState().threads.size).toBe(MAX_AGENT_THREADS_PER_ROOT);
    expect(harness.hook().currentState().threads.has(threads[0]!.threadId)).toBe(false);
    expect(harness.hook().currentState().threads.has(historical().threadId)).toBe(true);
    expect(harness.deleted).toEqual([]);
    expect(harness.saved).toHaveLength(1);
  });

  it("merges an acknowledged revision into the latest state without reverting a concurrent rename", async () => {
    const thread = logThread({ historyRevision: 1 });
    const harness = durableStore([thread]);
    await settleLogStore();
    const pending = holdSave(harness);
    const flushed = harness.hook().flushThread!(thread.threadId);
    await settleLogStore();
    act(() => harness.hook().rename(thread.threadId, "New title"));
    act(() => pending.save.mock.calls[0]?.[0].onRevision?.(2));
    expect(harness.hook().currentState().threads.get(thread.threadId)).toMatchObject({
      title: "New title",
      historyRevision: 2,
    });
    act(() => pending.save.mock.calls[0]?.[0].onRevision?.(1));
    expect(harness.hook().currentState().threads.get(thread.threadId)?.historyRevision).toBe(2);
    pending.release();
    expect(await flushed).toBe(true);
    await settleLogStore();
    expect(harness.hook().currentState().threads.get(thread.threadId)?.title).toBe("New title");
  });

  it("refuses restoration when the project generation changes during victim persistence", async () => {
    const harness = durableStore(fullWindow());
    await settleLogStore();
    const pending = holdSave(harness);
    const restored = harness.hook().restoreThread!(historical());
    await settleLogStore();
    harness.setProjects([logProject({ generation: 2 })]);
    await act(async () => {
      pending.release();
      expect(await restored).toBe(false);
    });
    expect(harness.hook().currentState().threads.has(historical().threadId)).toBe(false);
    expect(harness.deleted).toEqual([]);
  });

  it("does not evict a victim edited while its previous snapshot is being saved", async () => {
    const threads = fullWindow();
    const harness = durableStore(threads);
    await settleLogStore();
    const pending = holdSave(harness);
    const restored = harness.hook().restoreThread!(historical());
    await settleLogStore();
    act(() => harness.hook().rename(threads[0]!.threadId, "Keep my latest edit"));
    await act(async () => {
      pending.save.mock.calls[0]?.[0].onRevision?.(2);
      pending.release();
      expect(await restored).toBe(false);
    });
    expect(harness.hook().currentState().threads.get(threads[0]!.threadId)?.title).toBe(
      "Keep my latest edit",
    );
    expect(harness.hook().currentState().threads.has(historical().threadId)).toBe(false);
    expect(harness.deleted).toEqual([]);
  });

  it("retains the window when victim persistence fails", async () => {
    const harness = durableStore(fullWindow());
    await settleLogStore();
    harness.threadGateway.saveAgentThread = async () => {
      throw new Error("Disk is full");
    };
    expect(await harness.hook().restoreThread!(historical())).toBe(false);
    expect(harness.hook().currentState().threads.size).toBe(MAX_AGENT_THREADS_PER_ROOT);
    expect(harness.hook().currentState().threads.has(historical().threadId)).toBe(false);
    expect(harness.deleted).toEqual([]);
  });

  it("does not evict pinned threads", async () => {
    const harness = durableStore(fullWindow().map((thread) => ({ ...thread, pinned: true })));
    await settleLogStore();
    expect(await harness.hook().restoreThread!(historical())).toBe(false);
    expect(harness.saved).toEqual([]);
    expect(harness.hook().currentState().threads.size).toBe(MAX_AGENT_THREADS_PER_ROOT);
  });

  it.each(["pending", "running"] as const)("does not evict a %s turn", async (kind) => {
    const threads = fullWindow().map((thread, index) => ({ ...thread, pinned: index !== 0 }));
    const harness = durableStore(threads);
    await settleLogStore();
    act(() => {
      harness.hook().dispatchAction({
        kind: "turnStarted",
        threadId: threads[0]!.threadId,
        turn: logTurn({
          status: { kind },
          endedAtEpochMs: null,
        }),
      });
    });
    await settleLogStore();
    const savedBefore = harness.saved.length;
    expect(await harness.hook().restoreThread!(historical())).toBe(false);
    expect(harness.saved).toHaveLength(savedBefore);
    expect(harness.hook().currentState().threads.has(threads[0]!.threadId)).toBe(true);
  });

  it.each(["replacement", "delete"] as const)(
    "invalidates a queued save's ownership callback after %s",
    async (change) => {
      const thread = logThread();
      const harness = durableStore([thread]);
      await settleLogStore();
      const pending = holdSave(harness);
      const flushed = harness.hook().flushThread!(thread.threadId);
      await settleLogStore();
      const isCurrent = pending.save.mock.calls[0]?.[0].isCurrent;
      expect(isCurrent?.()).toBe(true);
      if (change === "replacement") harness.setProjects([logProject({ generation: 2 })]);
      else act(() => harness.hook().remove(thread.threadId));
      expect(isCurrent?.()).toBe(false);
      pending.release();
      expect(await flushed).toBe(false);
    },
  );
});
