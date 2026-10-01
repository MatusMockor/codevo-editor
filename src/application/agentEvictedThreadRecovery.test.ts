import { describe, expect, it, vi } from "vitest";
import type { AgentHistoryTurnPage, ReadAgentHistoryTurnsRequest } from "../domain/agentHistory";
import type {
  AgentHistoryThreadPage,
  ReadAgentHistoryThreadsRequest,
} from "../domain/agentHistoryCatalog";
import { agentRootOwnerId } from "../domain/agentProject";
import type { AgentThread, AgentTurn } from "../domain/agentThread";
import { surfaceThreadView } from "../components/agentMode/agentSurfaceTestFixtures";
import {
  MAX_AGENT_RECOVERY_CATALOG_PAGES,
  recoverEvictedAgentThread,
  type AgentEvictedThreadRecoveryPorts,
  type AgentRecoveryProject,
} from "./agentEvictedThreadRecovery";
import type { AgentHistoryCatalogGateway } from "./useAgentHistoryCatalog";

const ROOT_KEY = "/workspace/app";
const WORKSPACE_ID = "ws-live-1";
const THREAD_ID = "agt-9-0b0e";

function savedThread(threadId: string, overrides: Partial<AgentThread> = {}): AgentThread {
  const base = surfaceThreadView().thread;
  return {
    ...base,
    threadId,
    title: `Saved ${threadId}`,
    owner: { ...base.owner, rootKey: ROOT_KEY, ownerId: agentRootOwnerId(ROOT_KEY) },
    provider: { kind: "claudeCode", sessionId: "sess-fixture-0001" },
    turns: [],
    historyRevision: 4,
    ...overrides,
  };
}

const latestTurns: ReadonlyArray<AgentTurn> = surfaceThreadView().thread.turns;

function catalog(pages: ReadonlyArray<ReadonlyArray<AgentThread>>, revision = 4) {
  const threadRequests: ReadAgentHistoryThreadsRequest[] = [];
  const turnRequests: ReadAgentHistoryTurnsRequest[] = [];
  const gateway: AgentHistoryCatalogGateway = {
    readAgentHistoryThreads: vi.fn(
      async (request: ReadAgentHistoryThreadsRequest): Promise<AgentHistoryThreadPage> => {
        threadRequests.push(request);
        const index = request.beforeThreadId === null ? 0 : Number(request.beforeThreadId);
        return {
          threads: pages[index] ?? [],
          hasEarlier: index + 1 < pages.length,
          beforeThreadId: String(index + 1),
        };
      },
    ),
    readAgentHistoryTurns: vi.fn(
      async (request: ReadAgentHistoryTurnsRequest): Promise<AgentHistoryTurnPage> => {
        turnRequests.push(request);
        return { revision, turns: latestTurns, hasEarlier: true, beforeTurnId: null };
      },
    ),
  };
  return { gateway, threadRequests, turnRequests };
}

function ports(
  gateway: AgentHistoryCatalogGateway | undefined,
  overrides: Partial<AgentEvictedThreadRecoveryPorts> = {},
) {
  const project: AgentRecoveryProject = {
    rootKey: ROOT_KEY,
    ownerId: WORKSPACE_ID,
    generation: 3,
  };
  const restored: AgentThread[] = [];
  const reportError = vi.fn();
  const value: AgentEvictedThreadRecoveryPorts = {
    catalog: gateway,
    project: (workspaceId) => (workspaceId === WORKSPACE_ID ? project : undefined),
    restoreThread: async (thread) => {
      restored.push(thread);
      return true;
    },
    reportError,
    ...overrides,
  };
  return { value, restored, reportError };
}

describe("recoverEvictedAgentThread", () => {
  it("reopens a saved thread found on an older catalog page with its latest turns", async () => {
    const { gateway, threadRequests, turnRequests } = catalog([
      [savedThread("agt-1-0001")],
      [savedThread("agt-1-0002"), savedThread(THREAD_ID, { title: "Nightly build" })],
    ]);
    const recovery = ports(gateway);

    await expect(
      recoverEvictedAgentThread(recovery.value, THREAD_ID, WORKSPACE_ID),
    ).resolves.toEqual({ kind: "restored" });

    expect(threadRequests).toEqual([
      { rootKey: ROOT_KEY, ownerId: agentRootOwnerId(ROOT_KEY), beforeThreadId: null },
      { rootKey: ROOT_KEY, ownerId: agentRootOwnerId(ROOT_KEY), beforeThreadId: "1" },
    ]);
    expect(turnRequests).toEqual([
      {
        rootKey: ROOT_KEY,
        ownerId: agentRootOwnerId(ROOT_KEY),
        threadId: THREAD_ID,
        beforeTurnId: null,
      },
    ]);
    expect(recovery.restored).toHaveLength(1);
    expect(recovery.restored[0]).toMatchObject({
      threadId: THREAD_ID,
      title: "Nightly build",
      turns: latestTurns,
      historyRevision: 4,
      turnsTruncated: true,
      owner: { rootKey: ROOT_KEY, ownerId: WORKSPACE_ID },
    });
  });

  it("treats an event from a workspace this window does not own as foreign without reading history", async () => {
    const { gateway } = catalog([[savedThread(THREAD_ID)]]);
    const recovery = ports(gateway);

    await expect(recoverEvictedAgentThread(recovery.value, THREAD_ID, "ws-other")).resolves.toEqual(
      {
        kind: "foreign",
      },
    );
    expect(gateway.readAgentHistoryThreads).not.toHaveBeenCalled();
  });

  it("stops after a bounded number of catalog pages when the thread is not saved", async () => {
    const pages = Array.from({ length: MAX_AGENT_RECOVERY_CATALOG_PAGES + 5 }, (_, index) => [
      savedThread(`agt-1-${String(index).padStart(4, "0")}`),
    ]);
    const { gateway } = catalog(pages);
    const recovery = ports(gateway);

    await expect(
      recoverEvictedAgentThread(recovery.value, THREAD_ID, WORKSPACE_ID),
    ).resolves.toEqual({ kind: "notRestored", title: null });
    expect(gateway.readAgentHistoryThreads).toHaveBeenCalledTimes(MAX_AGENT_RECOVERY_CATALOG_PAGES);
    expect(recovery.restored).toEqual([]);
  });

  it("names the saved thread when it cannot be reopened", async () => {
    const { gateway } = catalog([[savedThread(THREAD_ID, { title: "Nightly build" })]]);
    const refused = ports(gateway, { restoreThread: async () => false });
    await expect(
      recoverEvictedAgentThread(refused.value, THREAD_ID, WORKSPACE_ID),
    ).resolves.toEqual({
      kind: "notRestored",
      title: "Nightly build",
    });

    const advanced = catalog([[savedThread(THREAD_ID, { title: "Nightly build" })]], 5);
    const changed = ports(advanced.gateway);
    await expect(
      recoverEvictedAgentThread(changed.value, THREAD_ID, WORKSPACE_ID),
    ).resolves.toEqual({
      kind: "notRestored",
      title: "Nightly build",
    });
    expect(changed.restored).toEqual([]);

    const codex = catalog([
      [savedThread(THREAD_ID, { title: "Codex", provider: { kind: "codex", sessionId: null } })],
    ]);
    const wrongProvider = ports(codex.gateway);
    await expect(
      recoverEvictedAgentThread(wrongProvider.value, THREAD_ID, WORKSPACE_ID),
    ).resolves.toEqual({ kind: "notRestored", title: "Codex" });
    expect(wrongProvider.restored).toEqual([]);
  });

  it("names an archived saved thread without reopening it", async () => {
    const { gateway } = catalog([
      [savedThread(THREAD_ID, { title: "Nightly build", archived: true })],
    ]);
    const recovery = ports(gateway);

    await expect(
      recoverEvictedAgentThread(recovery.value, THREAD_ID, WORKSPACE_ID),
    ).resolves.toEqual({ kind: "notRestored", title: "Nightly build" });
    expect(gateway.readAgentHistoryTurns).not.toHaveBeenCalled();
    expect(recovery.restored).toEqual([]);
  });

  it("does not reopen anything when the project registration changed while history was read", async () => {
    const { gateway } = catalog([[savedThread(THREAD_ID)]]);
    let generation = 3;
    const recovery = ports(gateway, {
      project: (workspaceId) =>
        workspaceId === WORKSPACE_ID
          ? { rootKey: ROOT_KEY, ownerId: WORKSPACE_ID, generation: generation++ }
          : undefined,
    });

    await expect(
      recoverEvictedAgentThread(recovery.value, THREAD_ID, WORKSPACE_ID),
    ).resolves.toEqual({ kind: "foreign" });
    expect(recovery.restored).toEqual([]);
  });

  it("reports a history failure and still lets the caller name the reply truthfully", async () => {
    const failing: AgentHistoryCatalogGateway = {
      readAgentHistoryThreads: vi.fn(async () => Promise.reject(new Error("database is locked"))),
      readAgentHistoryTurns: vi.fn(),
    };
    const recovery = ports(failing);

    await expect(
      recoverEvictedAgentThread(recovery.value, THREAD_ID, WORKSPACE_ID),
    ).resolves.toEqual({ kind: "notRestored", title: null });
    expect(recovery.reportError).toHaveBeenCalledWith("Agents", expect.any(Error));

    const unavailable = ports(undefined);
    await expect(
      recoverEvictedAgentThread(unavailable.value, THREAD_ID, WORKSPACE_ID),
    ).resolves.toEqual({ kind: "notRestored", title: null });
  });
});
