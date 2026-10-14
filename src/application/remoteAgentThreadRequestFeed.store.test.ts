import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadRequests } from "../domain/agentRuntimeRequest";
import {
  remoteAgentThreadRequestGatewayFake,
  remoteAgentThreadRequestPending as pending,
  remoteAgentThreadRequestResolved as resolved,
  remoteAgentThreadRequestScopeOf as scopeOf,
  remoteAgentThreadRequestTurnOf as turn,
  type RemoteAgentThreadRequestGatewayFake,
} from "../test/remoteAgentThreadRequestGatewayFake";
import {
  AGENT_THREAD_REQUEST_FAILURE_NOTICE_THRESHOLD as FAILURE_THRESHOLD,
  AGENT_THREAD_REQUEST_MAX_RETRIES as STORE_RETRIES,
  AGENT_THREAD_REQUEST_RETRY_BASE_MS as STORE_RETRY_BASE,
  AGENT_THREAD_REQUEST_RETRY_CAP_MS as STORE_RETRY_CAP,
  agentThreadRequestStore,
  type AgentThreadRequestObservation,
  type AgentThreadRequestStore,
} from "./agentThreadRequestStore";
import {
  createRemoteAgentThreadRequestFeed,
  type RemoteAgentThreadRequestDescription,
  type RemoteAgentThreadRequestFeed,
} from "./remoteAgentThreadRequestFeed";
import type { RemoteAgentThreadRequestTurn } from "./remoteAgentThreadRequestPorts";

const THREAD = "0b8f0f5e-1c2d-4e3f-8a9b-000000000001";
const OTHER_THREAD = "0b8f0f5e-1c2d-4e3f-8a9b-000000000002";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const A = scopeOf("srv-a", THREAD);
const A2 = scopeOf("srv-a", OTHER_THREAD);
const B = scopeOf("srv-b", THREAD);
const TARGET_A = { serverId: "srv-a", threadId: THREAD };
const TARGET_A2 = { serverId: "srv-a", threadId: OTHER_THREAD };
const TARGET_B = { serverId: "srv-b", threadId: THREAD };
const EXHAUSTED_MS = (STORE_RETRIES + 2) * STORE_RETRY_CAP;

interface Harness {
  readonly gateway: RemoteAgentThreadRequestGatewayFake;
  readonly feed: RemoteAgentThreadRequestFeed;
  readonly store: AgentThreadRequestStore;
  readonly pushes: AgentThreadRequests[];
}

type View = readonly string[] | "pending" | "unavailable";

function snapshot(
  turns: readonly RemoteAgentThreadRequestTurn[],
  overrides: Partial<RemoteAgentThreadRequestDescription> = {},
): RemoteAgentThreadRequestDescription {
  return { source: "snapshot", reachable: true, turns, awaiting: [], ...overrides };
}

async function harness(): Promise<Harness> {
  const gateway = remoteAgentThreadRequestGatewayFake();
  const feed = createRemoteAgentThreadRequestFeed(gateway);
  const pushes: AgentThreadRequests[] = [];
  await feed.subscribeThreadRequests((message) => {
    pushes.push(message);
  });
  return { gateway, feed, store: agentThreadRequestStore(feed), pushes };
}

async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) await vi.advanceTimersByTimeAsync(1);
}

function shown(observation: AgentThreadRequestObservation): View {
  if (observation.kind !== "observed") return observation.kind;
  return observation.state.requests.map(
    (request) => `${request.turnId}/${request.id}@${request.version}:${request.status}`,
  );
}

function recorder() {
  const seen: AgentThreadRequestObservation[] = [];
  return {
    views: (): readonly View[] => seen.map(shown),
    last: (): View | "nothing" => {
      const latest = seen[seen.length - 1];
      return latest === undefined ? "nothing" : shown(latest);
    },
    uncovered: (): readonly string[] => {
      const latest = seen[seen.length - 1];
      return latest?.kind === "observed" ? latest.pendingTurnIds : ["not observed"];
    },
    listener: (observation: AgentThreadRequestObservation): void => {
      seen.push(observation);
    },
  };
}

function pushesFor(pushes: readonly AgentThreadRequests[], threadId: string): number {
  return pushes.filter((message) => message.threadId === threadId).length;
}

describe("remoteAgentThreadRequestFeed under the thread request store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves the store its first pull before the feed reads on its own", async () => {
    const { gateway, feed, store } = await harness();
    gateway.record(TARGET_A, [pending(T1, "req-1")]);
    const seen = recorder();

    feed.describe(A, snapshot([turn(T1, 1), turn(T2, 0)]));
    store.watch(A, [T1, T2], seen.listener);
    await settle();

    expect(seen.views()).toEqual(["pending", [`${T1}/req-1@1:pending`]]);
    expect(seen.uncovered()).toEqual([]);
    expect(
      gateway.threadRequests.mock.calls.map(([request]) =>
        request.turns.map((described) => described.turnId),
      ),
    ).toEqual([[T1, T2], [T1]]);
    expect(gateway.peakReadsInFlight("srv-a")).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("syncs a store from a slow read without a second gateway read", async () => {
    const { gateway, feed, store } = await harness();
    gateway.record(TARGET_A, [pending(T1, "req-1")]);
    const answer = gateway.threadRequests.getMockImplementation();
    gateway.threadRequests.mockImplementationOnce(
      (request) =>
        new Promise((resolve, reject) => {
          setTimeout(() => {
            if (answer === undefined) return reject(new Error("no reader"));
            answer(request).then(resolve, reject);
          }, 4_000);
        }),
    );
    const seen = recorder();
    feed.describe(A, snapshot([turn(T1, 1)]));
    await settle();

    store.watch(A, [T1], seen.listener);
    await vi.advanceTimersByTimeAsync(4_000);
    await settle();

    expect(seen.views()).toEqual(["pending", [`${T1}/req-1@1:pending`]]);
    expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rebuilds the thread in the new epoch after an answer that came back without records", async () => {
    const { gateway, feed, store } = await harness();
    gateway.record(TARGET_A, [pending(T1, "req-1"), pending(T2, "req-2")]);
    const epochs: string[] = [];
    const seen = recorder();
    feed.describe(A, snapshot([turn(T1, 1), turn(T2, 1)]));
    store.watch(A, [T1, T2], (observation) => {
      if (observation.kind === "observed") epochs.push(observation.state.epoch);
      seen.listener(observation);
    });
    await settle();
    expect(seen.last()).toEqual([`${T1}/req-1@1:pending`, `${T2}/req-2@1:pending`]);
    const before = gateway.threadRequests.mock.calls.length;
    const shownBefore = seen.views().length;

    gateway.stamp(TARGET_A, { epoch: "rr1-snapshot-2-1" });
    gateway.record(TARGET_A, [resolved(T1, "req-1")]);
    gateway.respond.mockResolvedValueOnce({ outcome: "answered", message: null });
    const outcome = await feed.respond(A, T1, "req-1", { kind: "approval", decision: "allowOnce" });
    await settle();

    expect(outcome).toEqual({ kind: "answered" });
    const reads = gateway.threadRequests.mock.calls.slice(before).map(([request]) => ({
      turns: request.turns.map((described) => described.turnId),
      cursor: request.cursor,
    }));
    expect(reads).toEqual([
      { turns: [T1], cursor: null },
      { turns: [T1, T2], cursor: null },
    ]);
    expect(seen.last()).toEqual([`${T1}/req-1@3:resolved`, `${T2}/req-2@1:pending`]);
    expect(epochs[epochs.length - 1]).toBe("rr1-snapshot-2-1");
    const after = seen.views().slice(shownBefore).flat();
    expect(after).not.toContain(`${T1}/req-1@1:pending`);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows a moved sequence through one read and one push without a new pull", async () => {
    const { gateway, feed, store, pushes } = await harness();
    gateway.record(TARGET_A, [pending(T1, "req-1")]);
    const seen = recorder();
    feed.describe(A, snapshot([turn(T1, 1)]));
    store.watch(A, [T1], seen.listener);
    await settle();
    const calls = gateway.threadRequests.mock.calls.length;
    const pushed = pushes.length;

    gateway.record(TARGET_A, [resolved(T1, "req-1")]);
    feed.describe(A, snapshot([turn(T1, 2)]));
    await settle();

    expect(seen.last()).toEqual([`${T1}/req-1@3:resolved`]);
    expect(gateway.threadRequests).toHaveBeenCalledTimes(calls + 1);
    expect(pushes).toHaveLength(pushed + 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is unavailable for a thread that was not described and recovers once it is", async () => {
    const { gateway, feed, store } = await harness();
    gateway.record(TARGET_A, [pending(T1, "req-1")]);
    const seen = recorder();

    store.watch(A, [T1], seen.listener);
    await settle();
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
      await vi.advanceTimersByTimeAsync(STORE_RETRY_BASE * 2 ** (failure - 1));
    await settle();
    expect(seen.views()).toEqual(["pending", "unavailable"]);
    expect(gateway.threadRequests).not.toHaveBeenCalled();

    feed.describe(A, snapshot([turn(T1, 1)]));
    await vi.advanceTimersByTimeAsync(STORE_RETRY_CAP);
    await settle();

    expect(seen.last()).toEqual([`${T1}/req-1@1:pending`]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("wakes a store that gave up on an undescribed thread once it is described", async () => {
    const { gateway, feed, store, pushes } = await harness();
    gateway.record(TARGET_A, [pending(T1, "req-1")]);
    const seen = recorder();
    store.watch(A, [T1], seen.listener);
    await vi.advanceTimersByTimeAsync(EXHAUSTED_MS);
    await settle();
    expect(seen.last()).toBe("unavailable");
    expect(vi.getTimerCount()).toBe(0);

    feed.describe(A, snapshot([turn(T1, 0)]));
    await settle();

    expect(seen.last()).toEqual([`${T1}/req-1@1:pending`]);
    expect(pushes).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("wakes a store that exhausted its retries during an outage with one push", async () => {
    const { gateway, feed, store, pushes } = await harness();
    gateway.record(TARGET_A, [pending(T1, "req-1")]);
    gateway.record(TARGET_A2, [pending(T1, "req-2")]);
    const healthy = recorder();
    feed.describe(A2, snapshot([turn(T1, 0)]));
    store.watch(A2, [T1], healthy.listener);
    await settle();
    expect(healthy.last()).toEqual([`${T1}/req-2@1:pending`]);

    gateway.disconnect();
    const failed = recorder();
    feed.describe(A, snapshot([turn(T1, 0)]));
    store.watch(A, [T1], failed.listener);
    await vi.advanceTimersByTimeAsync(EXHAUSTED_MS);
    await settle();
    expect(failed.last()).toBe("unavailable");
    expect(vi.getTimerCount()).toBe(0);
    const callsBefore = gateway.readsOf(TARGET_A2).length;

    gateway.connect();
    feed.reconnected("srv-a");
    await settle();

    expect(failed.last()).toEqual([`${T1}/req-1@1:pending`]);
    expect(pushesFor(pushes, THREAD)).toBe(1);
    expect(pushesFor(pushes, OTHER_THREAD)).toBe(0);
    expect(gateway.readsOf(TARGET_A2)).toHaveLength(callsBefore);
    expect(healthy.last()).toEqual([`${T1}/req-2@1:pending`]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("wakes a store that already knows the thread with one empty push", async () => {
    const { gateway, feed, store, pushes } = await harness();
    gateway.record(TARGET_A, [pending(T1, "req-1"), pending(T2, "req-2")]);
    const first = recorder();
    feed.describe(A, snapshot([turn(T1, 0), turn(T2, 0)]));
    store.watch(A, [T1], first.listener);
    await settle();
    expect(first.last()).toEqual([`${T1}/req-1@1:pending`]);

    gateway.disconnect();
    const second = recorder();
    store.watch(A, [T1, T2], second.listener);
    await vi.advanceTimersByTimeAsync(EXHAUSTED_MS);
    await settle();
    expect(second.uncovered()).toEqual([T2]);
    const calls = gateway.threadRequests.mock.calls.length;

    gateway.connect();
    feed.reconnected("srv-a");
    await settle();

    expect(pushes.map((message) => message.requests.length)).toEqual([0]);
    expect(pushes[0]).toMatchObject({ epoch: "rr1-snapshot", reset: false, workspaceId: "srv-a" });
    expect(second.uncovered()).toEqual([]);
    expect(second.last()).toEqual([`${T1}/req-1@1:pending`, `${T2}/req-2@1:pending`]);
    expect(gateway.threadRequests).toHaveBeenCalledTimes(calls + 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("wakes a store that watched a turn before the turn was described", async () => {
    const { gateway, feed, store, pushes } = await harness();
    gateway.record(TARGET_A, [pending(T1, "req-1"), pending(T2, "req-2")]);
    const seen = recorder();
    feed.describe(A, snapshot([turn(T1, 0)]));
    store.watch(A, [T1, T2], seen.listener);
    await vi.advanceTimersByTimeAsync(EXHAUSTED_MS);
    await settle();
    expect(seen.last()).toBe("unavailable");
    expect(gateway.threadRequests).not.toHaveBeenCalled();

    feed.describe(A, snapshot([turn(T1, 0), turn(T2, 0)]));
    await settle();

    expect(seen.last()).toEqual([`${T1}/req-1@1:pending`, `${T2}/req-2@1:pending`]);
    expect(pushes).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pushes nothing on reconnect when every store pull succeeded", async () => {
    const { gateway, feed, store, pushes } = await harness();
    gateway.record(TARGET_A, [pending(T1, "req-1")]);
    const seen = recorder();
    feed.describe(A, snapshot([turn(T1, 0)]));
    store.watch(A, [T1], seen.listener);
    await settle();
    const calls = gateway.threadRequests.mock.calls.length;

    feed.reconnected("srv-a");
    feed.reconnected("srv-a");
    feed.reconnected("srv-unknown");
    await settle();

    expect(pushes).toEqual([]);
    expect(gateway.threadRequests).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers a store whose pulls failed while the server was described as unreachable", async () => {
    const { gateway, feed, store } = await harness();
    gateway.record(TARGET_A, [pending(T1, "req-1")]);
    const seen = recorder();
    feed.describe(A, snapshot([turn(T1, 1)], { reachable: false }));
    store.watch(A, [T1], seen.listener);
    await vi.advanceTimersByTimeAsync(EXHAUSTED_MS);
    await settle();
    expect(seen.last()).toBe("unavailable");
    expect(gateway.threadRequests).not.toHaveBeenCalled();

    feed.describe(A, snapshot([turn(T1, 1)]));
    await settle();

    expect(seen.last()).toEqual([`${T1}/req-1@1:pending`]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the last observed state through an outage", async () => {
    const { gateway, feed, store } = await harness();
    gateway.record(TARGET_A, [pending(T1, "req-1")]);
    const seen = recorder();
    feed.describe(A, snapshot([turn(T1, 1)]));
    store.watch(A, [T1], seen.listener);
    await settle();

    gateway.disconnect();
    feed.describe(A, snapshot([turn(T1, 2)], { reachable: false }));
    await vi.advanceTimersByTimeAsync(EXHAUSTED_MS);
    await settle();
    expect(seen.last()).toEqual([`${T1}/req-1@1:pending`]);

    gateway.connect();
    gateway.record(TARGET_A, [resolved(T1, "req-1")]);
    feed.describe(A, snapshot([turn(T1, 2)]));
    await settle();

    expect(seen.last()).toEqual([`${T1}/req-1@3:resolved`]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never shows the records of server B on server A across A, B and A again", async () => {
    const { gateway, feed, store } = await harness();
    gateway.record(TARGET_A, [pending(T1, "req-a")]);
    gateway.record(TARGET_B, [pending(T1, "req-b")]);
    const onA = recorder();
    const onB = recorder();
    const again = recorder();

    feed.describe(A, snapshot([turn(T1, 1)]));
    const leaveA = store.watch(A, [T1], onA.listener);
    await settle();
    leaveA();
    feed.release(A);

    const release = gateway.holdReads();
    feed.describe(B, snapshot([turn(T1, 1)]));
    const leaveB = store.watch(B, [T1], onB.listener);
    await settle();
    leaveB();
    feed.release(B);

    feed.describe(A, snapshot([turn(T1, 1)]));
    store.watch(A, [T1], again.listener);
    release();
    await settle();

    expect(onA.last()).toEqual([`${T1}/req-a@1:pending`]);
    expect(onB.views()).toEqual(["pending"]);
    expect(again.last()).toEqual([`${T1}/req-a@1:pending`]);
    expect(again.views().flat()).not.toContain(`${T1}/req-b@1:pending`);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes the card of an ended turn without any change in the description", async () => {
    const { gateway, feed, store } = await harness();
    gateway.record(TARGET_A, [pending(T1, "req-1")]);
    const seen = recorder();
    feed.describe(A, snapshot([turn(T1, 2, true)]));
    store.watch(A, [T1], seen.listener);
    await settle();
    expect(seen.last()).toEqual([`${T1}/req-1@1:pending`]);

    gateway.record(TARGET_A, [resolved(T1, "req-1")]);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();

    expect(seen.last()).toEqual([`${T1}/req-1@3:resolved`]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
