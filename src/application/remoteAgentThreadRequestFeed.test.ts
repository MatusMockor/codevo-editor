import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadRequests } from "../domain/agentRuntimeRequest";
import { agentRootOwnerId } from "../domain/agentProject";
import {
  remoteAgentThreadRequestGatewayFake,
  remoteAgentThreadRequestPending as pending,
  remoteAgentThreadRequestResolved as resolved,
  remoteAgentThreadRequestScopeOf as scopeOf,
  remoteAgentThreadRequestTurnOf as turn,
  type RemoteAgentThreadRequestGatewayFake,
} from "../test/remoteAgentThreadRequestGatewayFake";
import {
  MAX_REMOTE_AGENT_THREAD_REQUEST_READ_RETRIES as READ_RETRIES,
  MAX_REMOTE_AGENT_THREAD_REQUEST_SUBSCRIBERS as SUBSCRIBERS,
  MAX_REMOTE_AGENT_THREAD_REQUEST_TRACKED_SCOPES as TRACKED_SCOPES,
  REMOTE_AGENT_THREAD_REQUEST_PULL_DEADLINE_MS as PULL_DEADLINE,
  REMOTE_AGENT_THREAD_REQUEST_READ_DEADLINE_MS as READ_DEADLINE,
  REMOTE_AGENT_THREAD_REQUEST_READ_RETRY_BASE_MS as RETRY_BASE,
  REMOTE_AGENT_THREAD_REQUEST_READ_RETRY_CAP_MS as RETRY_CAP,
  REMOTE_AGENT_THREAD_REQUEST_READ_SETTLEMENT_MS as READ_SETTLEMENT,
  createRemoteAgentThreadRequestFeed,
  type RemoteAgentThreadRequestDescription,
  type RemoteAgentThreadRequestFeed,
} from "./remoteAgentThreadRequestFeed";
import type {
  RemoteAgentThreadRequestTurn,
  RemoteAgentThreadRequestsPage,
} from "./remoteAgentThreadRequestPorts";
import {
  MAX_REMOTE_AGENT_THREAD_REQUEST_DESCRIBED_TURNS as DESCRIBED_TURNS,
  MAX_REMOTE_AGENT_THREAD_REQUEST_OPEN_RECHECKS as OPEN_RECHECKS,
  REMOTE_AGENT_THREAD_REQUEST_LEGACY_TICK_MS as TICK,
  REMOTE_AGENT_THREAD_REQUEST_OPEN_RECHECK_BASE_MS as OPEN_BASE,
  REMOTE_AGENT_THREAD_REQUEST_OPEN_RECHECK_CAP_MS as OPEN_CAP,
} from "./remoteAgentThreadRequestWatch";

const THREAD = "0b8f0f5e-1c2d-4e3f-8a9b-000000000001";
const OTHER_THREAD = "0b8f0f5e-1c2d-4e3f-8a9b-000000000002";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const A = scopeOf("srv-a", THREAD);
const A2 = scopeOf("srv-a", OTHER_THREAD);
const B = scopeOf("srv-b", THREAD);
const TARGET_A = { serverId: "srv-a", threadId: THREAD };
const TARGET_B = { serverId: "srv-b", threadId: THREAD };

interface Harness {
  readonly gateway: RemoteAgentThreadRequestGatewayFake;
  readonly feed: RemoteAgentThreadRequestFeed;
  readonly pushes: AgentThreadRequests[];
}

function snapshot(
  turns: readonly RemoteAgentThreadRequestTurn[],
  overrides: Partial<RemoteAgentThreadRequestDescription> = {},
): RemoteAgentThreadRequestDescription {
  return { source: "snapshot", reachable: true, turns, awaiting: [], ...overrides };
}

function legacy(
  turns: readonly RemoteAgentThreadRequestTurn[],
  overrides: Partial<RemoteAgentThreadRequestDescription> = {},
): RemoteAgentThreadRequestDescription {
  return snapshot(turns, { source: "legacy", ...overrides });
}

async function harness(clock?: () => number): Promise<Harness> {
  const gateway = remoteAgentThreadRequestGatewayFake();
  const feed = createRemoteAgentThreadRequestFeed(gateway, clock);
  const pushes: AgentThreadRequests[] = [];
  await feed.subscribeThreadRequests((message) => {
    pushes.push(message);
  });
  return { gateway, feed, pushes };
}

const SLACK = 100;

async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) await vi.advanceTimersByTimeAsync(1);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settlePromise) => {
    resolve = settlePromise;
  });
  return { promise, resolve };
}

function shown(message: AgentThreadRequests | undefined): readonly string[] {
  return (message?.requests ?? []).map(
    (request) => `${request.turnId}/${request.id}@${request.version}:${request.status}`,
  );
}

function readTurns(gateway: RemoteAgentThreadRequestGatewayFake): readonly (readonly string[])[] {
  return gateway.threadRequests.mock.calls.map(([request]) =>
    request.turns.map((described) => described.turnId),
  );
}

describe("remoteAgentThreadRequestFeed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("describe", () => {
    it("reads a turn whose sequence moved once and pushes the result once", async () => {
      const { gateway, feed, pushes } = await harness();
      gateway.record(TARGET_A, [pending(T1, "req-1")]);

      expect(feed.describe(A, snapshot([turn(T1, 1)]))).toEqual({ kind: "tracked" });
      await settle();

      expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
      expect(gateway.threadRequests).toHaveBeenLastCalledWith({
        serverId: "srv-a",
        runnerId: "runner-1",
        threadId: THREAD,
        turns: [turn(T1, 1)],
        cursor: null,
      });
      expect(pushes).toHaveLength(1);
      expect(pushes[0]).toMatchObject({ workspaceId: "srv-a", threadId: THREAD, reset: false });
      expect(shown(pushes[0])).toEqual([`${T1}/req-1@1:pending`]);

      gateway.record(TARGET_A, [resolved(T1, "req-1")]);
      feed.describe(A, snapshot([turn(T1, 2)]));
      await settle();

      expect(gateway.threadRequests).toHaveBeenCalledTimes(2);
      expect(pushes).toHaveLength(2);
      expect(shown(pushes[1])).toEqual([`${T1}/req-1@3:resolved`]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("does nothing when the description did not change", async () => {
      const { gateway, feed, pushes } = await harness();
      gateway.record(TARGET_A, [pending(T1, "req-1")]);
      feed.describe(A, snapshot([turn(T1, 1), turn(T2, 0)]));
      await settle();

      feed.describe(A, snapshot([turn(T1, 1), turn(T2, 0)]));
      feed.describe(A, snapshot([turn(T1, 1), turn(T2, 0)]));
      await settle();

      expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
      expect(pushes).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("does not read a turn at sequence zero and holds no timer for it", async () => {
      const { gateway, feed, pushes } = await harness();

      feed.describe(A, snapshot([turn(T1, 0), turn(T2, 0, true)]));
      await settle();

      expect(gateway.threadRequests).not.toHaveBeenCalled();
      expect(pushes).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("reads a moved sequence without pushing when the records did not change", async () => {
      const { gateway, feed, pushes } = await harness();
      gateway.record(TARGET_A, [pending(T1, "req-1")]);
      feed.describe(A, snapshot([turn(T1, 1)]));
      await settle();

      feed.describe(A, snapshot([turn(T1, 2)]));
      await settle();

      expect(gateway.threadRequests).toHaveBeenCalledTimes(2);
      expect(pushes).toHaveLength(1);
    });

    it("reads a turn of unknown sequence once and again when it ends", async () => {
      const { gateway, feed } = await harness();

      feed.describe(A, snapshot([turn(T1, null)]));
      await settle();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);

      feed.describe(A, snapshot([turn(T1, null, true)]));
      await settle();
      expect(gateway.threadRequests).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("reads a turn again when it starts awaiting an approval at the same sequence", async () => {
      const { gateway, feed } = await harness();
      feed.describe(A, snapshot([turn(T1, 4)]));
      await settle();

      feed.describe(A, snapshot([turn(T1, 4)], { awaiting: [T1] }));
      await settle();
      feed.describe(A, snapshot([turn(T1, 4)], { awaiting: [T1] }));
      await settle();

      expect(readTurns(gateway)).toEqual([[T1], [T1]]);
    });

    it("keeps one read per thread in flight and reads again when it moved meanwhile", async () => {
      const { gateway, feed, pushes } = await harness();
      gateway.record(TARGET_A, [pending(T1, "req-1")]);
      const release = gateway.holdReads();

      feed.describe(A, snapshot([turn(T1, 1)]));
      await settle();
      feed.describe(A, snapshot([turn(T1, 2)]));
      feed.describe(A, snapshot([turn(T1, 3)]));
      await settle();
      expect(gateway.threadRequests).toHaveBeenCalledTimes(1);

      release();
      await settle();

      expect(gateway.threadRequests).toHaveBeenCalledTimes(2);
      expect(gateway.threadRequests.mock.calls[1]?.[0].turns).toEqual([turn(T1, 3)]);
      expect(pushes).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps one gateway read per server in flight across threads", async () => {
      const { gateway, feed } = await harness();
      const release = gateway.holdReads();

      feed.describe(A, snapshot([turn(T1, 1)]));
      feed.describe(A2, snapshot([turn(T2, 1)]));
      feed.describe(B, snapshot([turn(T1, 1)]));
      const pull = feed.currentThreadRequests(A, [T1], null);
      await settle();

      expect(gateway.readsInFlight("srv-a")).toBe(1);
      expect(gateway.readsInFlight("srv-b")).toBe(1);

      release();
      await settle();
      await expect(pull).resolves.toMatchObject({ nextCursor: null });

      expect(gateway.peakReadsInFlight("srv-a")).toBe(1);
      expect(gateway.peakReadsInFlight("srv-b")).toBe(1);
      expect(gateway.readsOf(TARGET_A)).toHaveLength(2);
      expect(gateway.readsOf({ serverId: "srv-a", threadId: OTHER_THREAD })).toHaveLength(1);
      expect(gateway.readsOf(TARGET_B)).toHaveLength(1);
    });

    it("reads more than one page of turns in bounded batches", async () => {
      const { gateway, feed } = await harness();
      const turns = Array.from({ length: DESCRIBED_TURNS }, (_unused, index) =>
        turn(`33333333-3333-4333-8333-${String(index).padStart(12, "0")}`, 1),
      );

      feed.describe(A, snapshot(turns));
      await settle();

      expect(readTurns(gateway).map((batch) => batch.length)).toEqual([32, 32]);
      expect(new Set(readTurns(gateway).flat()).size).toBe(DESCRIBED_TURNS);
    });

    it("follows the cursor of a paged read and pushes each page that changed", async () => {
      const { gateway, feed, pushes } = await harness();
      gateway.record(
        TARGET_A,
        Array.from({ length: 70 }, (_unused, index) => pending(T1, `req-${index}`)),
      );

      feed.describe(A, snapshot([turn(T1, 1)]));
      await settle();

      expect(gateway.threadRequests.mock.calls.map(([request]) => request.cursor)).toEqual([
        null,
        "t:64",
      ]);
      expect(pushes.map((message) => message.requests.length)).toEqual([64, 6]);
    });

    it("never pushes a record again at a version it already pushed", async () => {
      const { gateway, feed, pushes } = await harness();
      const held = deferred<RemoteAgentThreadRequestsPage>();
      const pageOf = (
        requests: AgentThreadRequests["requests"],
      ): RemoteAgentThreadRequestsPage => ({
        message: {
          workspaceId: "srv-a",
          threadId: THREAD,
          epoch: "rr1-snapshot",
          journal: "saved",
          requests,
          truncated: false,
          unreadable: 0,
          reset: false,
        },
        nextCursor: null,
      });
      gateway.record(TARGET_A, [pending(T1, "req-a")]);
      feed.describe(A, snapshot([turn(T1, 1)]));
      await settle();
      gateway.threadRequests.mockImplementationOnce(() => held.promise);
      feed.describe(A, snapshot([turn(T1, 2)]));
      await settle();
      gateway.respond.mockResolvedValueOnce({
        outcome: "answered",
        message: pageOf([resolved(T1, "req-a")]).message,
      });
      await feed.respond(A, T1, "req-a", { kind: "approval", decision: "allowOnce" });

      held.resolve(pageOf([pending(T1, "req-a"), pending(T1, "req-b")]));
      await settle();

      expect(pushes.map(shown)).toEqual([
        [`${T1}/req-a@1:pending`],
        [`${T1}/req-a@3:resolved`],
        [`${T1}/req-b@1:pending`],
      ]);
    });

    it("pushes only the envelope when the envelope is all that changed", async () => {
      const { gateway, feed, pushes } = await harness();
      gateway.record(TARGET_A, [pending(T1, "req-1")]);
      feed.describe(A, snapshot([turn(T1, 1)]));
      await settle();

      gateway.stamp(TARGET_A, { journal: "degraded" });
      feed.describe(A, snapshot([turn(T1, 2)]));
      await settle();

      expect(pushes.map(shown)).toEqual([[`${T1}/req-1@1:pending`], []]);
      expect(pushes[1]).toMatchObject({ journal: "degraded", reset: false });
    });

    it("refuses scopes that are not remote and descriptions that are not valid", async () => {
      const { feed } = await harness();
      const local = {
        rootKey: "/repo",
        ownerId: agentRootOwnerId("/repo"),
        threadId: "agt-thread-1",
        workspaceId: "workspace-1",
      };
      const tooMany = Array.from({ length: DESCRIBED_TURNS + 1 }, (_unused, index) =>
        turn(`turn-${index}`, 0),
      );

      expect(feed.describe(local, snapshot([]))).toEqual({ kind: "refused", reason: "notRemote" });
      expect(feed.describe({ ...A, workspaceId: "srv-b" }, snapshot([]))).toEqual({
        kind: "refused",
        reason: "notRemote",
      });
      expect(feed.describe(A, snapshot([turn(T1, 0), turn(T1, 1)]))).toEqual({
        kind: "refused",
        reason: "invalid",
      });
      expect(feed.describe(A, snapshot(tooMany))).toEqual({ kind: "refused", reason: "invalid" });
      expect(feed.describe(A, snapshot([turn("bad id", 0)]))).toEqual({
        kind: "refused",
        reason: "invalid",
      });
      expect(feed.describe(A, snapshot([turn(T1, -1)]))).toEqual({
        kind: "refused",
        reason: "invalid",
      });
      expect(feed.describe(A, snapshot([turn(T1, 1)], { awaiting: ["bad id"] }))).toEqual({
        kind: "refused",
        reason: "invalid",
      });
      await expect(feed.currentThreadRequests(A, [], null)).rejects.toThrow("not described");
    });

    it("refuses a scope beyond the tracked cap until one is released", async () => {
      const { gateway, feed } = await harness();
      const scopes = Array.from({ length: TRACKED_SCOPES + 1 }, (_unused, index) =>
        scopeOf("srv-a", `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`),
      );
      const [first, ...rest] = scopes;
      const beyond = rest[rest.length - 1] ?? A;

      for (const scope of scopes.slice(0, TRACKED_SCOPES))
        expect(feed.describe(scope, snapshot([turn(T1, 0)]))).toEqual({ kind: "tracked" });
      expect(feed.describe(beyond, snapshot([turn(T1, 0)]))).toEqual({
        kind: "refused",
        reason: "capacity",
      });
      expect(feed.describe(first ?? A, snapshot([turn(T1, 0)]))).toEqual({ kind: "tracked" });

      feed.release(first ?? A);
      expect(feed.describe(beyond, snapshot([turn(T1, 0)]))).toEqual({ kind: "tracked" });
      await settle();
      expect(gateway.threadRequests).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("subscriptions", () => {
    it("delivers a push to every subscriber until it unsubscribes", async () => {
      const { gateway, feed, pushes } = await harness();
      const second: AgentThreadRequests[] = [];
      const failing = vi
        .fn<(message: AgentThreadRequests) => void>()
        .mockThrow(new Error("subscriber failed"));
      await feed.subscribeThreadRequests(failing);
      const release = await feed.subscribeThreadRequests((message) => {
        second.push(message);
      });
      gateway.record(TARGET_A, [pending(T1, "req-1")]);
      feed.describe(A, snapshot([turn(T1, 1)]));
      await settle();
      expect(pushes).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(failing).toHaveBeenCalledTimes(1);

      release();
      gateway.record(TARGET_A, [resolved(T1, "req-1")]);
      feed.describe(A, snapshot([turn(T1, 2)]));
      await settle();

      expect(pushes).toHaveLength(2);
      expect(second).toHaveLength(1);
    });

    it("refuses subscribers beyond its cap", async () => {
      const { feed } = await harness();
      for (let extra = 1; extra < SUBSCRIBERS; extra += 1)
        await feed.subscribeThreadRequests(() => undefined);

      await expect(feed.subscribeThreadRequests(() => undefined)).rejects.toThrow("Too many");
    });
  });

  describe("pulls", () => {
    it("rejects a pull for a thread that was not described", async () => {
      const { gateway, feed } = await harness();

      await expect(feed.currentThreadRequests(A, [T1], null)).rejects.toThrow("not described");

      expect(gateway.threadRequests).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("serves a pull with the described turns and never pushes it", async () => {
      const { gateway, feed, pushes } = await harness();
      gateway.record(TARGET_A, [pending(T1, "req-1")]);
      feed.describe(A, snapshot([turn(T1, 0), turn(T2, 0, true)]));

      const page = await feed.currentThreadRequests(A, [T2, T1], null);

      expect(shown(page.message)).toEqual([`${T1}/req-1@1:pending`]);
      expect(gateway.threadRequests).toHaveBeenCalledWith({
        serverId: "srv-a",
        runnerId: "runner-1",
        threadId: THREAD,
        turns: [turn(T2, 0, true), turn(T1, 0)],
        cursor: null,
      });
      await settle();
      expect(pushes).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("rejects a pull for a turn that was not described or for too many turns", async () => {
      const { gateway, feed } = await harness();
      feed.describe(A, snapshot([turn(T1, 0)]));
      const many = Array.from({ length: 33 }, (_unused, index) => `turn-${index}`);

      await expect(feed.currentThreadRequests(A, [T1, T2], null)).rejects.toThrow();
      await expect(feed.currentThreadRequests(A, [T1, T1], null)).rejects.toThrow();
      await expect(feed.currentThreadRequests(A, many, null)).rejects.toThrow();

      expect(gateway.threadRequests).not.toHaveBeenCalled();
    });

    it("rejects a pull without a gateway call while the server is unreachable", async () => {
      const { gateway, feed } = await harness();
      feed.describe(A, snapshot([turn(T1, 3)], { reachable: false }));
      await settle();

      await expect(feed.currentThreadRequests(A, [T1], null)).rejects.toThrow();

      expect(gateway.threadRequests).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("rejects pulls that outlive their deadline and keeps the server to one read", async () => {
      const { gateway, feed, pushes } = await harness();
      gateway.record(TARGET_A, [pending(T1, "req-1")]);
      feed.describe(A, snapshot([turn(T1, 0)]));
      const release = gateway.holdReads();
      const outcomes: string[] = [];
      const pull = (name: string): void => {
        void feed.currentThreadRequests(A, [T1], null).then(
          () => outcomes.push(`${name} resolved`),
          () => outcomes.push(`${name} rejected`),
        );
      };
      pull("in flight");
      pull("queued");

      await vi.advanceTimersByTimeAsync(PULL_DEADLINE - 1);
      expect(outcomes).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      await settle();
      expect(outcomes).toEqual(["in flight rejected", "queued rejected"]);

      feed.describe(A, snapshot([turn(T1, 1)]));
      pull("behind the outstanding read");
      await vi.advanceTimersByTimeAsync(READ_DEADLINE + RETRY_BASE);
      await settle();
      expect(outcomes).toEqual([
        "in flight rejected",
        "queued rejected",
        "behind the outstanding read rejected",
      ]);
      expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
      expect(gateway.readsInFlight("srv-a")).toBe(1);

      release();
      await settle();

      expect(gateway.threadRequests).toHaveBeenCalledTimes(2);
      expect(gateway.peakReadsInFlight("srv-a")).toBe(1);
      expect(pushes.map(shown)).toEqual([[`${T1}/req-1@1:pending`]]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("does not start a queued pull after its thread became unreachable", async () => {
      const { gateway, feed } = await harness();
      feed.describe(A, snapshot([turn(T1, 0)]));
      feed.describe(A2, snapshot([turn(T1, 0)]));
      const release = gateway.holdReads();
      const blocker = feed.currentThreadRequests(A2, [T1], null);
      const queued = feed.currentThreadRequests(A, [T1], null);
      const settled = Promise.allSettled([blocker, queued]);

      feed.describe(A, snapshot([turn(T1, 0)], { reachable: false }));
      release();
      await settle();

      expect((await settled).map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
      expect(gateway.readsOf(TARGET_A)).toHaveLength(0);
      expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("rejects a pull whose result belongs to another thread or server", async () => {
      const { gateway, feed, pushes } = await harness();
      feed.describe(A, snapshot([turn(T1, 0)]));
      const page = await feed.currentThreadRequests(A, [T1], null);
      gateway.threadRequests
        .mockResolvedValueOnce({ ...page, message: { ...page.message, threadId: OTHER_THREAD } })
        .mockResolvedValueOnce({ ...page, message: { ...page.message, workspaceId: "srv-b" } });

      await expect(feed.currentThreadRequests(A, [T1], null)).rejects.toThrow();
      await expect(feed.currentThreadRequests(A, [T1], null)).rejects.toThrow();
      await settle();

      expect(pushes).toEqual([]);
    });
  });

  describe("ownership", () => {
    it("drops a read that settles after the scope was released and retains nothing", async () => {
      const { gateway, feed, pushes } = await harness();
      gateway.record(TARGET_A, [pending(T1, "req-1")]);
      const release = gateway.holdReads();
      feed.describe(A, snapshot([turn(T1, 1)]));
      await settle();

      feed.release(A);
      release();
      await settle();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(pushes).toEqual([]);
      expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      await expect(feed.currentThreadRequests(A, [T1], null)).rejects.toThrow("not described");
    });

    it("rejects a pull that was queued or in flight when the scope was released", async () => {
      const { gateway, feed } = await harness();
      const release = gateway.holdReads();
      feed.describe(A, snapshot([turn(T1, 0)]));
      const inFlight = feed.currentThreadRequests(A, [T1], null);
      const queued = feed.currentThreadRequests(A, [T1], null);
      const settled = Promise.allSettled([inFlight, queued]);

      feed.release(A);
      release();
      await settle();

      expect((await settled).map((result) => result.status)).toEqual(["rejected", "rejected"]);
      expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("drops a read result that belongs to another thread or another server", async () => {
      const { gateway, feed, pushes } = await harness();
      const foreign = (overrides: Partial<AgentThreadRequests>): RemoteAgentThreadRequestsPage => ({
        message: {
          workspaceId: "srv-a",
          threadId: THREAD,
          epoch: "rr1-snapshot",
          journal: "saved",
          requests: [pending(T1, "req-foreign")],
          truncated: false,
          unreadable: 0,
          reset: false,
          ...overrides,
        },
        nextCursor: null,
      });
      gateway.threadRequests
        .mockResolvedValueOnce(foreign({ threadId: OTHER_THREAD }))
        .mockResolvedValueOnce(foreign({ workspaceId: "srv-b" }));
      gateway.record(TARGET_A, [pending(T1, "req-1")]);

      feed.describe(A, snapshot([turn(T1, 1)]));
      await settle();
      expect(pushes).toEqual([]);
      await vi.advanceTimersByTimeAsync(RETRY_BASE);
      await settle();
      expect(pushes).toEqual([]);
      await vi.advanceTimersByTimeAsync(RETRY_BASE * 2);
      await settle();

      expect(pushes.map(shown)).toEqual([[`${T1}/req-1@1:pending`]]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("drops the results of an earlier generation across server A, B and A again", async () => {
      const { gateway, feed, pushes } = await harness();
      const stale = deferred<RemoteAgentThreadRequestsPage>();
      const staleOnB = deferred<RemoteAgentThreadRequestsPage>();
      gateway.record(TARGET_A, [pending(T1, "req-current")]);
      gateway.threadRequests
        .mockImplementationOnce(() => stale.promise)
        .mockImplementationOnce(() => staleOnB.promise);
      const pageOf = (serverId: string, id: string): RemoteAgentThreadRequestsPage => ({
        message: {
          workspaceId: serverId,
          threadId: THREAD,
          epoch: "rr1-snapshot",
          journal: "saved",
          requests: [pending(T1, id)],
          truncated: false,
          unreadable: 0,
          reset: false,
        },
        nextCursor: null,
      });

      feed.describe(A, snapshot([turn(T1, 1)]));
      await settle();
      feed.release(A);
      feed.describe(B, snapshot([turn(T1, 1)]));
      await settle();
      feed.release(B);
      feed.describe(A, snapshot([turn(T1, 1)]));
      await settle();
      expect(gateway.readsInFlight("srv-a")).toBe(0);
      expect(gateway.threadRequests).toHaveBeenCalledTimes(2);

      stale.resolve(pageOf("srv-a", "req-stale"));
      staleOnB.resolve(pageOf("srv-b", "req-stale-b"));
      await settle();

      expect(pushes.map(shown)).toEqual([[`${T1}/req-current@1:pending`]]);
      expect(pushes[0]?.workspaceId).toBe("srv-a");
      expect(gateway.threadRequests).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("starts over when the runner switches between legacy and snapshot", async () => {
      const { gateway, feed, pushes } = await harness();
      const stale = deferred<RemoteAgentThreadRequestsPage>();
      gateway.threadRequests.mockImplementationOnce(() => stale.promise);
      feed.describe(A, legacy([turn(T1, null)]));
      await settle();

      gateway.record(TARGET_A, [pending(T1, "req-1")]);
      feed.describe(A, snapshot([turn(T1, 1)]));
      stale.resolve({
        message: {
          workspaceId: "srv-a",
          threadId: THREAD,
          epoch: "rr1-legacy-1",
          journal: "saved",
          requests: [pending(T1, "req-legacy")],
          truncated: false,
          unreadable: 0,
          reset: false,
        },
        nextCursor: null,
      });
      await settle();
      await vi.advanceTimersByTimeAsync(10 * TICK);

      expect(pushes.map(shown)).toEqual([[`${T1}/req-1@1:pending`]]);
      expect(gateway.threadRequests).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("failures", () => {
    it("retries a failed read with backoff, stalls, and resumes on reconnect", async () => {
      const { gateway, feed, pushes } = await harness();
      gateway.record(TARGET_A, [pending(T1, "req-1")]);
      gateway.disconnect();

      feed.describe(A, snapshot([turn(T1, 1)]));
      await settle();
      for (let retry = 0; retry < READ_RETRIES; retry += 1) {
        expect(gateway.threadRequests).toHaveBeenCalledTimes(retry + 1);
        await vi.advanceTimersByTimeAsync(RETRY_BASE * 2 ** retry - SLACK);
        expect(gateway.threadRequests).toHaveBeenCalledTimes(retry + 1);
        await vi.advanceTimersByTimeAsync(SLACK);
        await settle();
      }
      expect(gateway.threadRequests).toHaveBeenCalledTimes(READ_RETRIES + 1);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(gateway.threadRequests).toHaveBeenCalledTimes(READ_RETRIES + 1);
      expect(vi.getTimerCount()).toBe(0);

      gateway.connect();
      feed.reconnected("srv-a");
      await settle();

      expect(gateway.threadRequests).toHaveBeenCalledTimes(READ_RETRIES + 2);
      expect(pushes.map(shown)).toEqual([[`${T1}/req-1@1:pending`]]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("gives up on a read that outlives its deadline but holds the server until it settles", async () => {
      const { gateway, feed, pushes } = await harness();
      const outstanding = deferred<RemoteAgentThreadRequestsPage>();
      gateway.record(TARGET_A, [pending(T1, "req-1")]);
      gateway.threadRequests.mockImplementationOnce(() => outstanding.promise);

      feed.describe(A, snapshot([turn(T1, 1)]));
      feed.describe(A2, snapshot([turn(T2, 1)]));
      await settle();
      await vi.advanceTimersByTimeAsync(READ_DEADLINE + 10 * RETRY_BASE);
      await settle();
      expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
      expect(pushes).toEqual([]);

      outstanding.resolve({
        message: {
          workspaceId: "srv-a",
          threadId: THREAD,
          epoch: "rr1-snapshot",
          journal: "saved",
          requests: [pending(T1, "req-late")],
          truncated: false,
          unreadable: 0,
          reset: false,
        },
        nextCursor: null,
      });
      await settle();

      expect(gateway.threadRequests).toHaveBeenCalledTimes(3);
      expect(pushes.map(shown)).toEqual([[], [`${T1}/req-1@1:pending`]]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("frees the server after a read that never settles and reads again", async () => {
      const { gateway, feed, pushes } = await harness();
      gateway.record(TARGET_A, [pending(T1, "req-1")]);
      gateway.threadRequests.mockImplementationOnce(
        () => deferred<RemoteAgentThreadRequestsPage>().promise,
      );
      feed.describe(A, snapshot([turn(T1, 1)]));
      await settle();

      await vi.advanceTimersByTimeAsync(READ_SETTLEMENT - 100);
      await settle();
      expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(100);
      await settle();

      expect(gateway.threadRequests).toHaveBeenCalledTimes(2);
      expect(pushes.map(shown)).toEqual([[`${T1}/req-1@1:pending`]]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("retires the server of a read that never settles once every scope is released", async () => {
      const { gateway, feed } = await harness();
      gateway.threadRequests.mockImplementationOnce(
        () => deferred<RemoteAgentThreadRequestsPage>().promise,
      );
      feed.describe(A, snapshot([turn(T1, 1)]));
      await settle();
      feed.release(A);

      await vi.advanceTimersByTimeAsync(READ_SETTLEMENT);
      await settle();
      expect(vi.getTimerCount()).toBe(0);

      feed.describe(A, snapshot([turn(T1, 1)]));
      await settle();
      expect(gateway.threadRequests).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("lets a reconnect free a server held by a read older than the bound", async () => {
      let now = 0;
      const { gateway, feed } = await harness(() => now);
      gateway.threadRequests.mockImplementationOnce(
        () => deferred<RemoteAgentThreadRequestsPage>().promise,
      );
      feed.describe(A, snapshot([turn(T1, 1)]));
      await settle();
      await vi.advanceTimersByTimeAsync(READ_DEADLINE + RETRY_BASE);
      await settle();

      now = READ_SETTLEMENT - 1;
      feed.reconnected("srv-a");
      await settle();
      expect(gateway.threadRequests).toHaveBeenCalledTimes(1);

      now = READ_SETTLEMENT;
      feed.reconnected("srv-a");
      await settle();
      expect(gateway.threadRequests).toHaveBeenCalledTimes(2);
    });

    it("stops reading while the server is unreachable and resumes when it returns", async () => {
      const { gateway, feed, pushes } = await harness();
      gateway.record(TARGET_A, [pending(T1, "req-1")]);

      feed.describe(A, snapshot([turn(T1, 1)], { reachable: false }));
      await settle();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(gateway.threadRequests).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);

      feed.describe(A, snapshot([turn(T1, 1)]));
      await settle();

      expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
      expect(pushes).toHaveLength(1);
    });
  });

  describe("legacy runner", () => {
    it("re-reads the running turn every tick and pushes only changes", async () => {
      const { gateway, feed, pushes } = await harness();

      feed.describe(A, legacy([turn(T1, null, true), turn(T2, null)]));
      await settle();
      expect(readTurns(gateway)).toEqual([[T2]]);
      expect(pushes).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(TICK);
      await settle();
      await vi.advanceTimersByTimeAsync(TICK);
      await settle();
      expect(readTurns(gateway)).toEqual([[T2], [T2], [T2]]);
      expect(pushes).toHaveLength(1);

      gateway.record(TARGET_A, [pending(T2, "req-1")]);
      await vi.advanceTimersByTimeAsync(TICK);
      await settle();
      await vi.advanceTimersByTimeAsync(TICK);
      await settle();

      expect(gateway.threadRequests).toHaveBeenCalledTimes(5);
      expect(pushes.map(shown)).toEqual([[], [`${T2}/req-1@1:pending`]]);
    });

    it("reads only the latest turn when every turn ended and does not tick", async () => {
      const { gateway, feed } = await harness();

      feed.describe(A, legacy([turn(T1, null, true), turn(T2, null, true)]));
      await settle();
      await vi.advanceTimersByTimeAsync(10 * TICK);

      expect(readTurns(gateway)).toEqual([[T2]]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("stops ticking after one last read when the turn ends", async () => {
      const { gateway, feed } = await harness();
      feed.describe(A, legacy([turn(T1, null)]));
      await settle();
      await vi.advanceTimersByTimeAsync(TICK);
      await settle();
      expect(gateway.threadRequests).toHaveBeenCalledTimes(2);

      feed.describe(A, legacy([turn(T1, null, true)]));
      await settle();
      await vi.advanceTimersByTimeAsync(10 * TICK);

      expect(gateway.threadRequests).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("stops ticking on release", async () => {
      const { gateway, feed } = await harness();
      feed.describe(A, legacy([turn(T1, null)]));
      await settle();

      feed.release(A);
      await vi.advanceTimersByTimeAsync(10 * TICK);

      expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("stops ticking while the server is unreachable and resumes after it", async () => {
      const { gateway, feed } = await harness();
      feed.describe(A, legacy([turn(T1, null)]));
      await settle();

      feed.describe(A, legacy([turn(T1, null)], { reachable: false }));
      await vi.advanceTimersByTimeAsync(10 * TICK);
      expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);

      feed.reconnected("srv-a");
      await settle();
      expect(gateway.threadRequests).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(TICK);
      await settle();
      expect(gateway.threadRequests).toHaveBeenCalledTimes(3);
    });

    it("never ticks on a snapshot runner", async () => {
      const { gateway, feed } = await harness();

      feed.describe(A, snapshot([turn(T1, 2), turn(T2, null)]));
      await settle();
      await vi.advanceTimersByTimeAsync(60 * TICK);

      expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("ended turn with an open record", () => {
    it("re-reads with growing pauses until the record closes", async () => {
      const { gateway, feed, pushes } = await harness();
      gateway.record(TARGET_A, [pending(T1, "req-1")]);

      feed.describe(A, snapshot([turn(T1, 2, true)]));
      await settle();
      expect(gateway.threadRequests).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(OPEN_BASE - SLACK);
      expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(SLACK);
      await settle();
      expect(gateway.threadRequests).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(2 * OPEN_BASE - SLACK);
      expect(gateway.threadRequests).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(SLACK);
      await settle();
      expect(gateway.threadRequests).toHaveBeenCalledTimes(3);
      expect(pushes).toHaveLength(1);

      gateway.record(TARGET_A, [resolved(T1, "req-1")]);
      await vi.advanceTimersByTimeAsync(4 * OPEN_BASE);
      await settle();
      expect(gateway.threadRequests).toHaveBeenCalledTimes(4);
      expect(pushes.map(shown)).toEqual([[`${T1}/req-1@1:pending`], [`${T1}/req-1@3:resolved`]]);

      await vi.advanceTimersByTimeAsync(10 * OPEN_CAP);
      expect(gateway.threadRequests).toHaveBeenCalledTimes(4);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("does not re-read an open record of a turn that is still running", async () => {
      const { gateway, feed } = await harness();
      gateway.record(TARGET_A, [pending(T1, "req-1")]);

      feed.describe(A, snapshot([turn(T1, 2)]));
      await settle();
      await vi.advanceTimersByTimeAsync(10 * OPEN_CAP);

      expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("stops re-reading when every re-read fails", async () => {
      const { gateway, feed } = await harness();
      gateway.record(TARGET_A, [pending(T1, "req-1")]);
      feed.describe(A, snapshot([turn(T1, 2, true)]));
      await settle();
      expect(gateway.threadRequests).toHaveBeenCalledTimes(1);

      gateway.disconnect();
      await vi.advanceTimersByTimeAsync((OPEN_RECHECKS + 10) * RETRY_CAP);
      await settle();

      expect(gateway.threadRequests).toHaveBeenCalledTimes(OPEN_RECHECKS + 1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("stops re-reading on release and after a bounded number of attempts", async () => {
      const { gateway, feed } = await harness();
      gateway.record(TARGET_A, [pending(T1, "req-1")]);
      gateway.record(TARGET_B, [pending(T1, "req-1")]);
      feed.describe(A, snapshot([turn(T1, 2, true)]));
      feed.describe(B, snapshot([turn(T1, 2, true)]));
      await settle();

      feed.release(A);
      await vi.advanceTimersByTimeAsync((OPEN_RECHECKS + 10) * OPEN_CAP);
      await settle();

      expect(gateway.readsOf(TARGET_A)).toHaveLength(1);
      expect(gateway.readsOf(TARGET_B)).toHaveLength(OPEN_RECHECKS + 1);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
