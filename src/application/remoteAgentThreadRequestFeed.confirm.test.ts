import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  remoteAgentThreadRequestGatewayFake,
  remoteAgentThreadRequestPending as pending,
  remoteAgentThreadRequestResolved as resolved,
  remoteAgentThreadRequestScopeOf as scopeOf,
  remoteAgentThreadRequestTurnOf as turn,
} from "../test/remoteAgentThreadRequestGatewayFake";
import {
  REMOTE_AGENT_THREAD_REQUEST_RESPOND_DEADLINE_MS,
  REMOTE_AGENT_THREAD_REQUEST_RESPOND_SETTLEMENT_MS,
  createRemoteAgentThreadRequestFeed,
  type RemoteAgentThreadRequestConfirmation,
} from "./remoteAgentThreadRequestFeed";

const THREAD = "0b8f0f5e-1c2d-4e3f-8a9b-000000000001";
const T1 = "11111111-1111-4111-8111-111111111111";
const SCOPE = scopeOf("srv-a", THREAD);
const TARGET = { serverId: "srv-a", threadId: THREAD };
const ANSWER = { kind: "question", answers: [] } as const;

async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) await vi.advanceTimersByTimeAsync(1);
}

describe("remoteAgentThreadRequestFeed.confirm", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cannot confirm a request of an undescribed thread or turn", async () => {
    const feed = createRemoteAgentThreadRequestFeed(remoteAgentThreadRequestGatewayFake());

    await expect(feed.confirm(SCOPE, T1, "req-1")).resolves.toBe("unconfirmed");
    feed.describe(SCOPE, { source: "snapshot", reachable: true, turns: [], awaiting: [] });
    await expect(feed.confirm(SCOPE, T1, "req-1")).resolves.toBe("unconfirmed");
  });

  it("refuses to confirm while the send may still execute and reads the turn once it no longer can", async () => {
    const gateway = remoteAgentThreadRequestGatewayFake();
    gateway.respond.mockReturnValueOnce(new Promise(() => undefined));
    gateway.record(TARGET, [pending(T1, "req-1")]);
    const feed = createRemoteAgentThreadRequestFeed(gateway);
    feed.describe(SCOPE, {
      source: "snapshot",
      reachable: true,
      turns: [turn(T1, 1)],
      awaiting: [],
    });
    await settle();
    void feed.respond(SCOPE, T1, "req-1", ANSWER);
    await vi.advanceTimersByTimeAsync(REMOTE_AGENT_THREAD_REQUEST_RESPOND_DEADLINE_MS);
    const reads = gateway.readsOf(TARGET).length;

    await expect(feed.confirm(SCOPE, T1, "req-1")).resolves.toBe("unconfirmed");
    expect(gateway.readsOf(TARGET).length).toBe(reads);

    await vi.advanceTimersByTimeAsync(REMOTE_AGENT_THREAD_REQUEST_RESPOND_SETTLEMENT_MS);
    const stillPending: Promise<RemoteAgentThreadRequestConfirmation> = feed.confirm(
      SCOPE,
      T1,
      "req-1",
    );
    await settle();
    await expect(stillPending).resolves.toBe("pending");

    gateway.record(TARGET, [resolved(T1, "req-1")]);
    const closed = feed.confirm(SCOPE, T1, "req-1");
    await settle();
    await expect(closed).resolves.toBe("settled");
    expect(gateway.respond).toHaveBeenCalledTimes(1);
  });
});
