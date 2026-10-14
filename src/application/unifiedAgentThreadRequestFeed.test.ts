import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentRootOwnerId } from "../domain/agentProject";
import type { AgentThreadRequests } from "../domain/agentRuntimeRequest";
import {
  remoteAgentThreadRequestIdentity,
  remoteAgentThreadRequestScope,
} from "../domain/remoteAgentThreadRequestScope";
import {
  agentRuntimeRequestOf,
  agentThreadRequestFeedFake,
  agentThreadRequestsOf,
} from "../test/agentThreadRequestFeedFake";
import {
  remoteAgentThreadRequestGatewayFake,
  remoteAgentThreadRequestPending as pending,
  remoteAgentThreadRequestScopeOf as scopeOf,
  remoteAgentThreadRequestTurnOf as turn,
} from "../test/remoteAgentThreadRequestGatewayFake";
import type { AgentThreadRequestScope } from "./agentThreadRequestPorts";
import {
  agentThreadRequestStore,
  type AgentThreadRequestObservation,
} from "./agentThreadRequestStore";
import { remoteAgentProjectKey, remoteAgentThreadKey } from "./remoteAgentProjection";
import { createRemoteAgentThreadRequestFeed } from "./remoteAgentThreadRequestFeed";
import { createUnifiedAgentThreadRequestFeed } from "./unifiedAgentThreadRequestFeed";

const CONVERSATION = "0b8f0f5e-1c2d-4e3f-8a9b-000000000001";
const T1 = "11111111-1111-4111-8111-111111111111";
const LOCAL_TURN = "agt-turn-0001";
const REMOTE = scopeOf("srv-a", CONVERSATION);
const LOCAL: AgentThreadRequestScope = {
  rootKey: "/repo/app",
  ownerId: agentRootOwnerId("/repo/app"),
  threadId: "agt-thread-0001",
  workspaceId: "workspace-1",
};

function feeds() {
  const local = agentThreadRequestFeedFake();
  const remote = agentThreadRequestFeedFake();
  return { local, remote, unified: createUnifiedAgentThreadRequestFeed({ local, remote }) };
}

function shown(observation: AgentThreadRequestObservation | undefined): readonly string[] {
  if (observation?.kind !== "observed") return [observation?.kind ?? "nothing"];
  return observation.state.requests.map((request) => `${request.turnId}/${request.id}`);
}

async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) await vi.advanceTimersByTimeAsync(1);
}

describe("unifiedAgentThreadRequestFeed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a remote scope to the remote feed only", async () => {
    const { local, remote, unified } = feeds();
    const answer = { message: agentThreadRequestsOf(REMOTE), nextCursor: "t:16" };
    remote.currentThreadRequests.mockResolvedValueOnce(answer);

    const page = await unified.currentThreadRequests(REMOTE, [T1], "t:8");

    expect(page).toBe(answer);
    expect(remote.currentThreadRequests).toHaveBeenCalledTimes(1);
    expect(remote.currentThreadRequests).toHaveBeenCalledWith(REMOTE, [T1], "t:8");
    expect(local.currentThreadRequests).not.toHaveBeenCalled();
  });

  it("sends a local scope to the local feed only", async () => {
    const { local, remote, unified } = feeds();

    const page = await unified.currentThreadRequests(LOCAL, [LOCAL_TURN], null);

    expect(page.message.threadId).toBe(LOCAL.threadId);
    expect(local.currentThreadRequests).toHaveBeenCalledTimes(1);
    expect(local.currentThreadRequests).toHaveBeenCalledWith(LOCAL, [LOCAL_TURN], null);
    expect(remote.currentThreadRequests).not.toHaveBeenCalled();
  });

  it.each([
    ["a remote owner on a local root", { ...REMOTE, rootKey: "/repo/app" }],
    ["a local owner on a remote root", { ...REMOTE, ownerId: agentRootOwnerId(REMOTE.rootKey) }],
    ["a remote scope without a workspace", { ...REMOTE, workspaceId: null }],
    ["a remote scope for another server", { ...REMOTE, workspaceId: "srv-b" }],
    ["a malformed remote key", { ...REMOTE, rootKey: "remote:broken", ownerId: "remote:broken" }],
    [
      "the thread key of a remote view",
      { ...LOCAL, threadId: remoteAgentThreadKey("srv-a", "runner-1", CONVERSATION) },
    ],
  ])("never lets %s reach the local feed", async (_name, scope) => {
    const local = agentThreadRequestFeedFake();
    const remote = createRemoteAgentThreadRequestFeed(remoteAgentThreadRequestGatewayFake());
    const unified = createUnifiedAgentThreadRequestFeed({ local, remote });

    await expect(unified.currentThreadRequests(scope, [T1], null)).rejects.toThrow();

    expect(local.currentThreadRequests).not.toHaveBeenCalled();
  });

  it("builds remote scopes on the project key of the remote projection", () => {
    const execution = {
      serverId: "srv-a",
      runnerId: "runner one/β",
      projectId: "team:app",
      conversationId: CONVERSATION,
    };

    const scope = remoteAgentThreadRequestScope(execution);

    const projectKey = remoteAgentProjectKey("srv-a", "runner one/β", "team:app");
    expect(scope).toEqual({
      rootKey: projectKey,
      ownerId: projectKey,
      threadId: CONVERSATION,
      workspaceId: "srv-a",
    });
    expect(scope === null ? null : remoteAgentThreadRequestIdentity(scope)).toEqual(execution);
  });

  it("fans the pushes of both feeds into one subscription", async () => {
    const { local, remote, unified } = feeds();
    const received: AgentThreadRequests[] = [];

    const release = await unified.subscribeThreadRequests((message) => {
      received.push(message);
    });
    local.push(agentThreadRequestsOf(LOCAL));
    remote.push(agentThreadRequestsOf(REMOTE));

    expect(local.subscribeThreadRequests).toHaveBeenCalledTimes(1);
    expect(remote.subscribeThreadRequests).toHaveBeenCalledTimes(1);
    expect(received.map((message) => message.threadId)).toEqual([LOCAL.threadId, CONVERSATION]);

    release();
    release();
    local.push(agentThreadRequestsOf(LOCAL));
    remote.push(agentThreadRequestsOf(REMOTE));

    expect(local.unsubscribed).toHaveBeenCalledTimes(1);
    expect(remote.unsubscribed).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(2);
  });

  it.each(["local", "remote"] as const)(
    "releases the other feed and rejects when the %s feed cannot subscribe",
    async (broken) => {
      const { local, remote, unified } = feeds();
      const failing = broken === "local" ? local : remote;
      const working = broken === "local" ? remote : local;
      failing.subscribeThreadRequests.mockRejectedValueOnce(new Error("no runtime"));

      await expect(unified.subscribeThreadRequests(() => undefined)).rejects.toThrow("unavailable");

      expect(working.unsubscribed).toHaveBeenCalledTimes(1);
      expect(working.subscribers()).toBe(0);
    },
  );

  it("serves local and remote threads to one store without crossing them", async () => {
    const gateway = remoteAgentThreadRequestGatewayFake();
    const remote = createRemoteAgentThreadRequestFeed(gateway);
    const local = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(createUnifiedAgentThreadRequestFeed({ local, remote }));
    const onLocal: AgentThreadRequestObservation[] = [];
    const onRemote: AgentThreadRequestObservation[] = [];
    local.record(
      agentThreadRequestsOf(LOCAL, [
        agentRuntimeRequestOf("pendingApproval", { turnId: LOCAL_TURN, id: "req-local" }),
      ]),
    );
    gateway.record({ serverId: "srv-a", threadId: CONVERSATION }, [pending(T1, "req-remote")]);

    remote.describe(REMOTE, {
      source: "snapshot",
      reachable: true,
      turns: [turn(T1, 1)],
      awaiting: [],
    });
    store.watch(LOCAL, [LOCAL_TURN], (observation) => onLocal.push(observation));
    store.watch(REMOTE, [T1], (observation) => onRemote.push(observation));
    await settle();

    expect(shown(onLocal[onLocal.length - 1])).toEqual([`${LOCAL_TURN}/req-local`]);
    expect(shown(onRemote[onRemote.length - 1])).toEqual([`${T1}/req-remote`]);
    expect(local.subscribeThreadRequests).toHaveBeenCalledTimes(1);
    expect(local.currentThreadRequests.mock.calls.map(([scope]) => scope)).toEqual([LOCAL]);
    expect(gateway.threadRequests.mock.calls.map(([request]) => request.threadId)).toEqual([
      CONVERSATION,
      CONVERSATION,
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
