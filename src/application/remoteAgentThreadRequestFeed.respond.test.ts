import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeRequest, AgentThreadRequests } from "../domain/agentRuntimeRequest";
import {
  remoteAgentThreadRequestGatewayFake,
  remoteAgentThreadRequestPending as pending,
  remoteAgentThreadRequestResolved as resolved,
  remoteAgentThreadRequestScopeOf as scopeOf,
  remoteAgentThreadRequestTurnOf as turn,
  type RemoteAgentThreadRequestGatewayFake,
} from "../test/remoteAgentThreadRequestGatewayFake";
import {
  MAX_REMOTE_AGENT_THREAD_REQUEST_LIVE_RESPONSES as LIVE_RESPONSES,
  MAX_REMOTE_AGENT_THREAD_REQUEST_READ_RETRIES as READ_RETRIES,
  REMOTE_AGENT_THREAD_REQUEST_RESPOND_SETTLEMENT_MS as RESPOND_SETTLEMENT,
  REMOTE_AGENT_THREAD_REQUEST_READ_RETRY_BASE_MS as RETRY_BASE,
  REMOTE_AGENT_THREAD_REQUEST_READ_RETRY_CAP_MS as RETRY_CAP,
  REMOTE_AGENT_THREAD_REQUEST_RESPOND_DEADLINE_MS as RESPOND_DEADLINE,
  createRemoteAgentThreadRequestFeed,
  type RemoteAgentThreadRequestConfirmation,
  type RemoteAgentThreadRequestDescription,
  type RemoteAgentThreadRequestFeed,
  type RemoteAgentThreadRequestRespondOutcome,
} from "./remoteAgentThreadRequestFeed";
import { REMOTE_AGENT_THREAD_REQUEST_CONFIRMATION_LIFETIME_MS as CONFIRMATION_LIFETIME } from "./remoteAgentThreadRequestConfirmations";
import {
  RemoteAgentThreadRequestNotSentError,
  type RemoteAgentThreadRequestResponse,
  type RemoteAgentThreadRequestTurn,
  type RemoteAgentThreadRespondResult,
} from "./remoteAgentThreadRequestPorts";

const THREAD = "0b8f0f5e-1c2d-4e3f-8a9b-000000000001";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const A = scopeOf("srv-a", THREAD);
const TARGET = { serverId: "srv-a", threadId: THREAD };
const ALLOW: RemoteAgentThreadRequestResponse = { kind: "approval", decision: "allowOnce" };

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

async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) await vi.advanceTimersByTimeAsync(1);
}

async function asked(clock?: () => number): Promise<Harness> {
  const gateway = remoteAgentThreadRequestGatewayFake();
  const feed = createRemoteAgentThreadRequestFeed(gateway, clock);
  const pushes: AgentThreadRequests[] = [];
  await feed.subscribeThreadRequests((message) => {
    pushes.push(message);
  });
  gateway.record(TARGET, [pending(T1, "req-1")]);
  feed.describe(A, snapshot([turn(T1, 1)]));
  await settle();
  return { gateway, feed, pushes };
}

function shown(message: AgentThreadRequests | undefined): readonly string[] {
  return (message?.requests ?? []).map(
    (request) => `${request.turnId}/${request.id}@${request.version}:${request.status}`,
  );
}

function confirmationOf(
  outcome: RemoteAgentThreadRequestRespondOutcome,
): Promise<RemoteAgentThreadRequestConfirmation | "not uncertain"> {
  if (outcome.kind !== "deliveryUncertain") return Promise.resolve("not uncertain");
  return outcome.confirmation;
}

function watched<T>(promise: Promise<T>): { readonly settled: () => T | "waiting" } {
  let value: T | "waiting" = "waiting";
  void promise.then((result) => {
    value = result;
  });
  return { settled: () => value };
}

function hanging(): Promise<RemoteAgentThreadRespondResult> {
  return new Promise(() => undefined);
}

function confirmationAfter(responding: {
  readonly settled: () => RemoteAgentThreadRequestRespondOutcome | "waiting";
}): Promise<RemoteAgentThreadRequestConfirmation | "not uncertain"> {
  const outcome = responding.settled();
  if (outcome === "waiting") return Promise.resolve("not uncertain");
  return confirmationOf(outcome);
}

function heldAnswer(gateway: RemoteAgentThreadRequestGatewayFake) {
  let finish: (result: RemoteAgentThreadRespondResult) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  gateway.respond.mockImplementationOnce(
    () =>
      new Promise<RemoteAgentThreadRespondResult>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
  );
  return {
    finish: (result: RemoteAgentThreadRespondResult): void => finish(result),
    fail: (error: Error): void => fail(error),
  };
}

function recordsOf(requests: readonly AgentRuntimeRequest[]): AgentThreadRequests {
  return {
    workspaceId: "srv-a",
    threadId: THREAD,
    epoch: "rr1-snapshot",
    journal: "saved",
    requests,
    truncated: false,
    unreadable: 0,
    reset: false,
  };
}

describe("remoteAgentThreadRequestFeed respond", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the answer once and pushes the records the runner returned", async () => {
    const { gateway, feed, pushes } = await asked();
    gateway.record(TARGET, [resolved(T1, "req-1")]);

    const outcome = await feed.respond(A, T1, "req-1", ALLOW);
    await settle();

    expect(outcome).toEqual({ kind: "answered" });
    expect(gateway.respond).toHaveBeenCalledTimes(1);
    expect(gateway.respond).toHaveBeenCalledWith({
      serverId: "srv-a",
      runnerId: "runner-1",
      threadId: THREAD,
      turn: turn(T1, 1),
      requestId: "req-1",
      response: ALLOW,
    });
    expect(pushes.map(shown)).toEqual([[`${T1}/req-1@1:pending`], [`${T1}/req-1@3:resolved`]]);
    expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reads the turn again when the runner refused the answer without records", async () => {
    const { gateway, feed, pushes } = await asked();
    gateway.respond.mockResolvedValueOnce({ outcome: "notAnswerable", message: null });
    gateway.record(TARGET, [resolved(T1, "req-1")]);

    const outcome = await feed.respond(A, T1, "req-1", ALLOW);
    await settle();

    expect(outcome).toEqual({ kind: "notAnswerable" });
    expect(gateway.threadRequests).toHaveBeenCalledTimes(2);
    expect(shown(pushes[1])).toEqual([`${T1}/req-1@3:resolved`]);
    expect(gateway.respond).toHaveBeenCalledTimes(1);
  });

  it("pushes the records of a refused answer without reading again", async () => {
    const { gateway, feed, pushes } = await asked();
    const page = await gateway.threadRequests({
      serverId: "srv-a",
      runnerId: "runner-1",
      threadId: THREAD,
      turns: [turn(T1, 1)],
      cursor: null,
    });
    gateway.threadRequests.mockClear();
    gateway.respond.mockResolvedValueOnce({
      outcome: "notAnswerable",
      message: { ...page.message, requests: [resolved(T1, "req-1")] },
    });

    const outcome = await feed.respond(A, T1, "req-1", ALLOW);
    await settle();

    expect(outcome).toEqual({ kind: "notAnswerable" });
    expect(gateway.threadRequests).not.toHaveBeenCalled();
    expect(shown(pushes[1])).toEqual([`${T1}/req-1@3:resolved`]);
  });

  it("confirms an uncertain delivery with one read and reports a still pending request", async () => {
    const { gateway, feed, pushes } = await asked();
    gateway.respond.mockResolvedValueOnce({ outcome: "deliveryUncertain", message: null });

    const outcome = await feed.respond(A, T1, "req-1", ALLOW);
    const confirmation = watched(confirmationOf(outcome));
    expect(outcome.kind).toBe("deliveryUncertain");
    expect(confirmation.settled()).toBe("waiting");
    await settle();

    expect(confirmation.settled()).toBe("pending");
    expect(gateway.threadRequests).toHaveBeenCalledTimes(2);
    expect(pushes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(gateway.respond).toHaveBeenCalledTimes(1);
    expect(gateway.threadRequests).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a closed request after an uncertain delivery and pushes it", async () => {
    const { gateway, feed, pushes } = await asked();
    gateway.respond.mockResolvedValueOnce({ outcome: "deliveryUncertain", message: null });
    gateway.record(TARGET, [resolved(T1, "req-1")]);

    const outcome = await feed.respond(A, T1, "req-1", ALLOW);
    const confirmation = watched(confirmationOf(outcome));
    await settle();

    expect(confirmation.settled()).toBe("settled");
    expect(shown(pushes[1])).toEqual([`${T1}/req-1@3:resolved`]);
    expect(gateway.respond).toHaveBeenCalledTimes(1);
  });

  it("does not let a read that started before the answer confirm it", async () => {
    const { gateway, feed } = await asked();
    const release = gateway.holdReads();
    feed.describe(A, snapshot([turn(T1, 2)]));
    await settle();
    gateway.respond.mockResolvedValueOnce({ outcome: "deliveryUncertain", message: null });

    const outcome = await feed.respond(A, T1, "req-1", ALLOW);
    const confirmation = watched(confirmationOf(outcome));
    await settle();
    expect(gateway.threadRequests).toHaveBeenCalledTimes(2);
    expect(confirmation.settled()).toBe("waiting");

    gateway.record(TARGET, [resolved(T1, "req-1")]);
    release();
    await settle();

    expect(gateway.threadRequests).toHaveBeenCalledTimes(3);
    expect(confirmation.settled()).toBe("settled");
  });

  it("does not let the later pages of an earlier read confirm the answer", async () => {
    const { gateway, feed } = await asked();
    gateway.record(
      TARGET,
      Array.from({ length: 70 }, (_unused, index) => pending(T1, `req-more-${index}`)),
    );
    const cursors = (): readonly (string | null)[] =>
      gateway.threadRequests.mock.calls.map(([request]) => request.cursor);
    const releaseFirstPage = gateway.holdReads();
    feed.describe(A, snapshot([turn(T1, 2)]));
    await settle();
    const pulled = watched(feed.currentThreadRequests(A, [], null));
    releaseFirstPage();
    const releasePull = gateway.holdReads();
    await settle();
    expect(cursors()).toEqual([null, null, null]);
    gateway.respond.mockResolvedValueOnce({ outcome: "deliveryUncertain", message: null });

    const outcome = await feed.respond(A, T1, "req-1", ALLOW);
    const confirmation = watched(confirmationOf(outcome));
    releasePull();
    const releaseSecondPage = gateway.holdReads();
    await settle();
    expect(pulled.settled()).not.toBe("waiting");
    expect(cursors()).toEqual([null, null, null, "t:64"]);
    releaseSecondPage();
    const releaseConfirmingRead = gateway.holdReads();
    await settle();
    expect(cursors()).toEqual([null, null, null, "t:64", null]);
    expect(confirmation.settled()).toBe("waiting");

    releaseConfirmingRead();
    await settle();

    expect(confirmation.settled()).toBe("pending");
    expect(gateway.respond).toHaveBeenCalledTimes(1);
  });

  it("retries the confirming read and never the answer", async () => {
    const { gateway, feed } = await asked();
    gateway.respond.mockResolvedValueOnce({ outcome: "deliveryUncertain", message: null });
    gateway.threadRequests.mockRejectedValueOnce(new Error("busy"));

    const outcome = await feed.respond(A, T1, "req-1", ALLOW);
    const confirmation = watched(confirmationOf(outcome));
    await settle();
    expect(confirmation.settled()).toBe("waiting");
    await vi.advanceTimersByTimeAsync(RETRY_BASE);
    await settle();

    expect(confirmation.settled()).toBe("pending");
    expect(gateway.respond).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves the delivery unconfirmed when the confirming read keeps failing", async () => {
    const { gateway, feed } = await asked();
    gateway.respond.mockResolvedValueOnce({ outcome: "deliveryUncertain", message: null });
    gateway.threadRequests.mockRejectedValue(new Error("busy"));

    const outcome = await feed.respond(A, T1, "req-1", ALLOW);
    const confirmation = watched(confirmationOf(outcome));
    await vi.advanceTimersByTimeAsync((READ_RETRIES + 1) * RETRY_CAP);
    await settle();

    expect(confirmation.settled()).toBe("unconfirmed");
    expect(gateway.respond).toHaveBeenCalledTimes(1);
    expect(gateway.threadRequests).toHaveBeenCalledTimes(READ_RETRIES + 2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves the delivery unconfirmed when the scope is released first", async () => {
    const { gateway, feed } = await asked();
    gateway.respond.mockResolvedValueOnce({ outcome: "deliveryUncertain", message: null });
    const release = gateway.holdReads();

    const outcome = await feed.respond(A, T1, "req-1", ALLOW);
    const confirmation = watched(confirmationOf(outcome));
    await settle();
    feed.release(A);
    await settle();

    expect(confirmation.settled()).toBe("unconfirmed");
    release();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves the delivery unconfirmed when the server becomes unreachable", async () => {
    const { gateway, feed } = await asked();
    gateway.respond.mockResolvedValueOnce({ outcome: "deliveryUncertain", message: null });
    const release = gateway.holdReads();

    const outcome = await feed.respond(A, T1, "req-1", ALLOW);
    const confirmation = watched(confirmationOf(outcome));
    await settle();
    feed.describe(A, snapshot([turn(T1, 1)], { reachable: false }));
    await settle();

    expect(confirmation.settled()).toBe("unconfirmed");
    release();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps an answer that outlives its deadline guarded and unconfirmed while it is live", async () => {
    const { gateway, feed, pushes } = await asked();
    const answer = heldAnswer(gateway);

    const responding = watched(feed.respond(A, T1, "req-1", ALLOW));
    await vi.advanceTimersByTimeAsync(RESPOND_DEADLINE - 1);
    expect(responding.settled()).toBe("waiting");
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(responding.settled()).toMatchObject({ kind: "deliveryUncertain" });
    const confirmation = watched(confirmationAfter(responding));
    await settle();
    expect(confirmation.settled()).toBe("waiting");
    expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
    expect(await feed.respond(A, T1, "req-1", ALLOW)).toEqual({
      kind: "notSent",
      reason: "alreadySending",
    });
    expect(gateway.respond).toHaveBeenCalledTimes(1);

    answer.finish({ outcome: "answered", message: recordsOf([resolved(T1, "req-1")]) });
    await settle();

    expect(confirmation.settled()).toBe("settled");
    expect(shown(pushes[pushes.length - 1])).toEqual([`${T1}/req-1@3:resolved`]);
    expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(await feed.respond(A, T1, "req-1", ALLOW)).toEqual({ kind: "answered" });
    expect(gateway.respond).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["reports an uncertain delivery", "uncertain"],
    ["fails after it was sent", "failed"],
    ["turns out to have never been sent", "refused"],
  ] as const)("confirms with a read only once a late answer %s", async (_name, ending) => {
    const { gateway, feed } = await asked();
    const answer = heldAnswer(gateway);
    const responding = watched(feed.respond(A, T1, "req-1", ALLOW));
    await vi.advanceTimersByTimeAsync(RESPOND_DEADLINE);
    await settle();
    const confirmation = watched(confirmationAfter(responding));
    await settle();
    expect(gateway.threadRequests).toHaveBeenCalledTimes(1);

    if (ending === "uncertain") answer.finish({ outcome: "deliveryUncertain", message: null });
    if (ending === "failed") answer.fail(new Error("Invalid response"));
    if (ending === "refused") answer.fail(new RemoteAgentThreadRequestNotSentError("not sent"));
    await settle();

    expect(confirmation.settled()).toBe("pending");
    expect(gateway.threadRequests).toHaveBeenCalledTimes(2);
    expect(gateway.respond).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports an answer that never settles as unconfirmed and keeps it guarded", async () => {
    const { gateway, feed } = await asked();
    heldAnswer(gateway);
    const responding = watched(feed.respond(A, T1, "req-1", ALLOW));
    await vi.advanceTimersByTimeAsync(RESPOND_DEADLINE);
    await settle();
    const confirmation = watched(confirmationAfter(responding));

    await vi.advanceTimersByTimeAsync(CONFIRMATION_LIFETIME - 100);
    expect(confirmation.settled()).toBe("waiting");
    await vi.advanceTimersByTimeAsync(100);
    await settle();

    expect(confirmation.settled()).toBe("unconfirmed");
    expect(await feed.respond(A, T1, "req-1", ALLOW)).toEqual({
      kind: "notSent",
      reason: "alreadySending",
    });
    expect(gateway.respond).toHaveBeenCalledTimes(1);
    expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a live answer guarded across a release and a new description", async () => {
    const { gateway, feed } = await asked();
    const answer = heldAnswer(gateway);
    const responding = watched(feed.respond(A, T1, "req-1", ALLOW));

    feed.release(A);
    feed.describe(A, snapshot([turn(T1, 1)]));
    await settle();
    expect(await feed.respond(A, T1, "req-1", ALLOW)).toEqual({
      kind: "notSent",
      reason: "alreadySending",
    });
    expect(gateway.respond).toHaveBeenCalledTimes(1);

    answer.finish({ outcome: "notAnswerable", message: null });
    await settle();
    expect(responding.settled()).toEqual({ kind: "notAnswerable" });
    expect(await feed.respond(A, T1, "req-1", ALLOW)).toEqual({ kind: "answered" });
  });

  it("treats a failure after the answer was sent as an uncertain delivery", async () => {
    const { gateway, feed } = await asked();
    gateway.respond.mockRejectedValueOnce(new Error("Invalid response"));

    const outcome = await feed.respond(A, T1, "req-1", ALLOW);
    const confirmation = watched(confirmationOf(outcome));
    await settle();

    expect(outcome.kind).toBe("deliveryUncertain");
    expect(confirmation.settled()).toBe("pending");
    expect(gateway.threadRequests).toHaveBeenCalledTimes(2);
    expect(gateway.respond).toHaveBeenCalledTimes(1);
  });

  it("reports an answer the gateway proved it never sent without reading", async () => {
    const { gateway, feed } = await asked();
    gateway.respond.mockRejectedValueOnce(new RemoteAgentThreadRequestNotSentError("not sent"));

    const outcome = await feed.respond(A, T1, "req-1", ALLOW);
    await settle();

    expect(outcome).toEqual({ kind: "notSent", reason: "refused" });
    expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
    expect(gateway.respond).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not wait for a confirmation of a turn that is no longer described", async () => {
    const { gateway, feed } = await asked();
    const answer = heldAnswer(gateway);
    const responding = watched(feed.respond(A, T1, "req-1", ALLOW));

    feed.describe(A, snapshot([turn(T2, 0)]));
    answer.finish({ outcome: "deliveryUncertain", message: null });
    await settle();

    expect(responding.settled()).toMatchObject({ kind: "deliveryUncertain" });
    expect(await confirmationAfter(responding)).toBe("unconfirmed");
    expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives up a confirmation whose turn disappears from the description", async () => {
    const { gateway, feed } = await asked();
    gateway.respond.mockResolvedValueOnce({ outcome: "deliveryUncertain", message: null });
    const release = gateway.holdReads();
    const outcome = await feed.respond(A, T1, "req-1", ALLOW);
    const confirmation = watched(confirmationOf(outcome));
    await settle();
    expect(confirmation.settled()).toBe("waiting");

    feed.describe(A, snapshot([turn(T2, 0)]));
    await settle();

    expect(confirmation.settled()).toBe("unconfirmed");
    release();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives up a confirmation whose read never returns", async () => {
    const { gateway, feed } = await asked();
    gateway.respond.mockResolvedValueOnce({ outcome: "deliveryUncertain", message: null });
    const release = gateway.holdReads();
    const outcome = await feed.respond(A, T1, "req-1", ALLOW);
    const confirmation = watched(confirmationOf(outcome));

    await vi.advanceTimersByTimeAsync(CONFIRMATION_LIFETIME - 1);
    expect(confirmation.settled()).toBe("waiting");
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(confirmation.settled()).toBe("unconfirmed");
    expect(gateway.respond).toHaveBeenCalledTimes(1);
    feed.release(A);
    release();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not send an answer for a thread or turn that is not described", async () => {
    const { gateway, feed } = await asked();
    const notDescribed = { kind: "notSent", reason: "notDescribed" };

    expect(await feed.respond(scopeOf("srv-b", THREAD), T1, "req-1", ALLOW)).toEqual(notDescribed);
    expect(await feed.respond(A, T2, "req-1", ALLOW)).toEqual(notDescribed);
    feed.release(A);
    expect(await feed.respond(A, T1, "req-1", ALLOW)).toEqual(notDescribed);

    expect(gateway.respond).not.toHaveBeenCalled();
  });

  it("does not send an answer while the server is unreachable", async () => {
    const { gateway, feed } = await asked();
    feed.describe(A, snapshot([turn(T1, 1)], { reachable: false }));

    expect(await feed.respond(A, T1, "req-1", ALLOW)).toEqual({
      kind: "notSent",
      reason: "unreachable",
    });
    expect(gateway.respond).not.toHaveBeenCalled();
  });

  it("does not send the same answer twice at the same time", async () => {
    const { gateway, feed } = await asked();
    gateway.respond.mockImplementationOnce(hanging);

    const first = watched(feed.respond(A, T1, "req-1", ALLOW));
    const second = await feed.respond(A, T1, "req-1", ALLOW);

    expect(second).toEqual({ kind: "notSent", reason: "alreadySending" });
    expect(first.settled()).toBe("waiting");
    expect(gateway.respond).toHaveBeenCalledTimes(1);
  });

  it("refuses new answers while too many are still live", async () => {
    const { gateway, feed } = await asked();
    gateway.respond.mockImplementation(hanging);
    for (let live = 0; live < LIVE_RESPONSES; live += 1)
      void feed.respond(A, T1, `req-live-${live}`, ALLOW);

    expect(await feed.respond(A, T1, "req-1", ALLOW)).toEqual({ kind: "notSent", reason: "busy" });
    expect(gateway.respond).toHaveBeenCalledTimes(LIVE_RESPONSES);
  });

  it("never sends a hung answer twice but stops counting it against other servers", async () => {
    let now = 0;
    const { gateway, feed } = await asked(() => now);
    const onB = scopeOf("srv-b", THREAD);
    feed.describe(onB, snapshot([turn(T1, 1)]));
    await settle();
    gateway.respond.mockImplementation(hanging);
    for (let live = 0; live < LIVE_RESPONSES; live += 1)
      void feed.respond(A, T1, `req-live-${live}`, ALLOW);
    expect(await feed.respond(onB, T1, "req-1", ALLOW)).toEqual({
      kind: "notSent",
      reason: "busy",
    });

    now = RESPOND_SETTLEMENT - 1;
    expect(await feed.respond(onB, T1, "req-1", ALLOW)).toEqual({
      kind: "notSent",
      reason: "busy",
    });
    now = RESPOND_SETTLEMENT;
    gateway.respond.mockReset();
    gateway.respond.mockResolvedValue({ outcome: "notAnswerable", message: null });

    expect(await feed.respond(onB, T1, "req-1", ALLOW)).toEqual({ kind: "notAnswerable" });
    expect(await feed.respond(A, T1, "req-live-0", ALLOW)).toEqual({
      kind: "notSent",
      reason: "alreadySending",
    });
    expect(gateway.respond).toHaveBeenCalledTimes(1);
    expect(gateway.respond.mock.calls[0]?.[0].serverId).toBe("srv-b");
  });

  it("releases the guard of a hung answer once a read shows the request closed", async () => {
    const { gateway, feed } = await asked();
    gateway.respond.mockImplementationOnce(hanging);
    void feed.respond(A, T1, "req-1", ALLOW);
    await settle();
    expect(await feed.respond(A, T1, "req-1", ALLOW)).toEqual({
      kind: "notSent",
      reason: "alreadySending",
    });

    gateway.record(TARGET, [resolved(T1, "req-1")]);
    feed.describe(A, snapshot([turn(T1, 2)]));
    await settle();

    expect(await feed.respond(A, T1, "req-1", ALLOW)).toEqual({ kind: "answered" });
    expect(gateway.respond).toHaveBeenCalledTimes(2);
  });

  it("keeps one lifetime when a late answer reports an uncertain delivery", async () => {
    const { gateway, feed } = await asked();
    const answer = heldAnswer(gateway);
    const responding = watched(feed.respond(A, T1, "req-1", ALLOW));
    await vi.advanceTimersByTimeAsync(RESPOND_DEADLINE);
    const confirmation = watched(confirmationAfter(responding));
    await vi.advanceTimersByTimeAsync(CONFIRMATION_LIFETIME - 1_000);
    const release = gateway.holdReads();

    answer.finish({ outcome: "deliveryUncertain", message: null });
    await vi.advanceTimersByTimeAsync(900);
    expect(confirmation.settled()).toBe("waiting");
    expect(gateway.threadRequests).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100);

    expect(confirmation.settled()).toBe("unconfirmed");
    release();
    await settle();
    expect(confirmation.settled()).toBe("unconfirmed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves the confirmation of a live answer when its scope is released", async () => {
    const { gateway, feed } = await asked();
    const answer = heldAnswer(gateway);
    const responding = watched(feed.respond(A, T1, "req-1", ALLOW));
    await vi.advanceTimersByTimeAsync(RESPOND_DEADLINE);
    const confirmation = watched(confirmationAfter(responding));
    await settle();
    expect(confirmation.settled()).toBe("waiting");

    feed.release(A);
    await settle();
    expect(confirmation.settled()).toBe("unconfirmed");

    answer.finish({ outcome: "answered", message: recordsOf([resolved(T1, "req-1")]) });
    await settle();
    expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves the confirmation of a live answer when its turn disappears", async () => {
    const { gateway, feed } = await asked();
    const answer = heldAnswer(gateway);
    const responding = watched(feed.respond(A, T1, "req-1", ALLOW));
    await vi.advanceTimersByTimeAsync(RESPOND_DEADLINE);
    const confirmation = watched(confirmationAfter(responding));
    await settle();

    feed.describe(A, snapshot([turn(T2, 0)]));
    await settle();
    expect(confirmation.settled()).toBe("unconfirmed");

    answer.finish({ outcome: "deliveryUncertain", message: null });
    await settle();
    expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the truthful outcome of an answer whose scope was released meanwhile", async () => {
    const { gateway, feed, pushes } = await asked();
    const answer = heldAnswer(gateway);
    const responding = watched(feed.respond(A, T1, "req-1", ALLOW));

    feed.release(A);
    answer.finish({ outcome: "deliveryUncertain", message: null });
    await settle();

    expect(responding.settled()).toMatchObject({ kind: "deliveryUncertain" });
    expect(await confirmationAfter(responding)).toBe("unconfirmed");
    expect(pushes).toHaveLength(1);
    expect(gateway.threadRequests).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
