import { describe, expect, it } from "vitest";
import { logThread } from "../test/agentTurnLogStoreHarness";
import type { AgentThreadsState } from "./agentThread";
import { reconcileAgentThreadLoad } from "./agentThreadLoadReconciliation";

describe("agent thread load reconciliation", () => {
  it("keeps local mutations at their own revision even if another writer saved a newer snapshot", () => {
    const original = logThread({ historyRevision: 4 });
    const local = { ...original, title: "Local edit" };
    const foreign = { ...original, title: "Other writer", historyRevision: 5 };
    const before: AgentThreadsState = { threads: new Map([[original.threadId, original]]) };
    const current: AgentThreadsState = { threads: new Map([[local.threadId, local]]) };
    const result = reconcileAgentThreadLoad(before, current, original.owner, [foreign]);
    expect(result.retainedThreadIds.has(local.threadId)).toBe(true);
    expect(current.threads.get(local.threadId)?.historyRevision).toBe(4);
    expect(result.threads[0]?.historyRevision).toBe(5);
  });

  it("only retains mutations belonging to the loaded root", () => {
    const original = logThread();
    const other = logThread({
      threadId: "agt-2-0a1b",
      owner: { ...original.owner, rootKey: "/other" },
    });
    const before: AgentThreadsState = { threads: new Map([[original.threadId, original]]) };
    const current: AgentThreadsState = {
      threads: new Map([
        [original.threadId, original],
        [other.threadId, other],
      ]),
    };
    const result = reconcileAgentThreadLoad(before, current, original.owner, [original]);
    expect(result.retainedThreadIds.size).toBe(0);
    expect(result.threads).toEqual([original]);
  });
});
