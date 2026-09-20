import { describe, expect, it, vi } from "vitest";
import { serializeAgentThread } from "../domain/agentThread";
import { catalogThread } from "../test/agentHistoryCatalogFixtures";
import { TauriAgentHistoryCatalogGateway } from "./tauriAgentHistoryCatalogGateway";
const thread = catalogThread();
const request = {
  rootKey: thread.owner.rootKey,
  ownerId: thread.owner.ownerId,
  beforeThreadId: null,
};
const page = {
  revisions: { [thread.threadId]: 4 },
  threads: [serializeAgentThread(thread)],
  hasEarlier: true,
  beforeThreadId: thread.threadId,
};
describe("saved conversation catalog gateway", () => {
  it("validates and forwards the bounded page", async () => {
    const invoke = vi.fn().mockResolvedValue(page);
    const gateway = new TauriAgentHistoryCatalogGateway(invoke, () => true);
    expect(await gateway.readAgentHistoryThreads(request)).toEqual({
      hasEarlier: true,
      beforeThreadId: thread.threadId,
      threads: [{ ...thread, historyRevision: 4 }],
    });
    expect(invoke).toHaveBeenCalledWith("read_agent_history_threads", { request });
  });
  it.each([
    { ...page, extra: true },
    { ...page, revisions: undefined },
    { ...page, revisions: {} },
    { ...page, revisions: { [thread.threadId]: -1 } },
    { ...page, revisions: { [thread.threadId]: 0 } },
    { ...page, revisions: { [thread.threadId]: 0.5 } },
    { ...page, revisions: { [thread.threadId]: Number.MAX_SAFE_INTEGER + 1 } },
    { ...page, revisions: { [thread.threadId]: 1, foreign: 2 } },
    { ...page, revisions: { foreign: 2 } },
    { ...page, threads: Array(33).fill(page.threads[0]) },
    { ...page, threads: [page.threads[0], page.threads[0]] },
    { ...page, beforeThreadId: "agt-2-0a1b" },
    { ...page, threads: [], beforeThreadId: null },
    {
      ...page,
      threads: [
        serializeAgentThread({ ...thread, owner: { ...thread.owner, rootKey: "/foreign" } }),
      ],
    },
  ])("rejects invalid and foreign pages", async (reply) => {
    const gateway = new TauriAgentHistoryCatalogGateway(
      vi.fn().mockResolvedValue(reply),
      () => true,
    );
    await expect(gateway.readAgentHistoryThreads(request)).rejects.toThrow();
  });
  it("rejects a cursor repeated in its own page and malformed request before IPC", async () => {
    const invoke = vi.fn().mockResolvedValue(page);
    const gateway = new TauriAgentHistoryCatalogGateway(invoke, () => true);
    await expect(
      gateway.readAgentHistoryThreads({ ...request, beforeThreadId: thread.threadId }),
    ).rejects.toThrow();
    invoke.mockClear();
    await expect(
      gateway.readAgentHistoryThreads({ ...request, beforeThreadId: "../bad" }),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("does not invoke outside Tauri", async () => {
    const invoke = vi.fn();
    expect(
      await new TauriAgentHistoryCatalogGateway(invoke, () => false).readAgentHistoryThreads(
        request,
      ),
    ).toEqual({ threads: [], hasEarlier: false, beforeThreadId: null });
    expect(invoke).not.toHaveBeenCalled();
  });
});
