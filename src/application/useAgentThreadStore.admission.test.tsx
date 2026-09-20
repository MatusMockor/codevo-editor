// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_AGENT_THREADS_PER_ROOT } from "../domain/agentThread";
import {
  logProject,
  logThread,
  renderLogStore,
  settleLogStore,
} from "../test/agentTurnLogStoreHarness";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function fullStore() {
  const persisted = Array.from({ length: MAX_AGENT_THREADS_PER_ROOT }, (_, index) =>
    logThread({
      threadId: `agt-${index + 1}-abcd`,
      updatedAtEpochMs: index + 1,
    }),
  );
  const harness = renderLogStore({ persisted });
  Object.assign(harness.threadGateway, {
    readAgentHistoryTurns: async () => ({
      turns: [],
      hasEarlier: false,
      beforeTurnId: null,
      revision: 1,
    }),
  });
  cleanups.push(harness.unmount);
  await settleLogStore();
  return { ...harness, oldest: persisted[0]! };
}

describe("durable thread slot admission", () => {
  it("saves before display eviction and holds the empty slot against concurrent imports/restores", async () => {
    const harness = await fullStore();
    const incoming = logThread({ threadId: "agt-100-abcd" });
    let release: (() => void) | null | undefined;
    await act(async () => {
      release = await harness.hook().reserveThreadSlot?.(incoming.threadId, incoming.owner);
    });
    expect(release).toBeTypeOf("function");
    expect(
      harness.saved.some((request) => request.thread.threadId === harness.oldest.threadId),
    ).toBe(true);
    expect(harness.hook().currentState().threads.has(harness.oldest.threadId)).toBe(false);
    expect(harness.deleted).toEqual([]);
    const competitor = logThread({ threadId: "agt-101-abcd" });
    await act(async () => {
      expect(await harness.hook().reserveThreadSlot?.(competitor.threadId, competitor.owner)).toBe(
        null,
      );
      expect(await harness.hook().restoreThread?.(competitor)).toBe(false);
      harness.hook().dispatchAction({ kind: "threadCreated", thread: competitor });
      harness.hook().dispatchAction({ kind: "threadCreated", thread: incoming });
      release?.();
    });
    expect(harness.hook().currentState().threads.has(competitor.threadId)).toBe(false);
    expect(harness.hook().currentState().threads.has(incoming.threadId)).toBe(true);
    expect(harness.hook().currentState().threads.size).toBe(MAX_AGENT_THREADS_PER_ROOT);
  });

  it("keeps every thread when persistence fails and rejects unreserved overflow", async () => {
    const harness = await fullStore();
    harness.threadGateway.saveAgentThread = async () => {
      throw new Error("Unable to save history.");
    };
    const incoming = logThread({ threadId: "agt-100-abcd" });
    await act(async () => {
      expect(await harness.hook().reserveThreadSlot?.(incoming.threadId, incoming.owner)).toBe(
        null,
      );
      harness.hook().dispatchAction({ kind: "threadCreated", thread: incoming });
    });
    expect(harness.hook().currentState().threads.size).toBe(MAX_AGENT_THREADS_PER_ROOT);
    expect(harness.hook().currentState().threads.has(harness.oldest.threadId)).toBe(true);
    expect(harness.hook().currentState().threads.has(incoming.threadId)).toBe(false);
  });

  it("does not evict a victim changed while its save was pending", async () => {
    const harness = await fullStore();
    const incoming = logThread({ threadId: "agt-100-abcd" });
    let finish: () => void = () => undefined;
    harness.threadGateway.saveAgentThread = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    let pending: Promise<(() => void) | null> | undefined;
    act(() => {
      pending = harness.hook().reserveThreadSlot?.(incoming.threadId, incoming.owner);
    });
    act(() => harness.hook().togglePin(harness.oldest.threadId));
    await act(async () => {
      finish();
      expect(await pending).toBe(null);
    });
    expect(harness.hook().currentState().threads.get(harness.oldest.threadId)?.pinned).toBe(true);
    expect(harness.deleted).toEqual([]);
  });

  it("releases a cancelled reservation and rejects a changed owner during the save", async () => {
    const harness = await fullStore();
    const incoming = logThread({ threadId: "agt-100-abcd" });
    let finish: () => void = () => undefined;
    harness.threadGateway.saveAgentThread = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    let pending: Promise<(() => void) | null> | undefined;
    act(() => {
      pending = harness.hook().reserveThreadSlot?.(incoming.threadId, incoming.owner);
    });
    harness.setProjects([logProject({ generation: 2 })]);
    await act(async () => {
      finish();
      expect(await pending).toBe(null);
    });
    expect(harness.hook().currentState().threads.has(harness.oldest.threadId)).toBe(true);
    harness.threadGateway.saveAgentThread = async () => undefined;
    await act(async () => {
      const release = await harness.hook().reserveThreadSlot?.(incoming.threadId, incoming.owner);
      expect(release).toBeTypeOf("function");
      release?.();
      const retry = await harness.hook().reserveThreadSlot?.("agt-101-abcd", incoming.owner);
      expect(retry).toBeTypeOf("function");
      retry?.();
    });
  });
});
