// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeRequest } from "../domain/agentRuntimeRequest";
import {
  agentRuntimeRequestOf,
  agentThreadRequestFeedFake,
  agentThreadRequestsOf,
  type AgentThreadRequestFeedFake,
} from "../test/agentThreadRequestFeedFake";
import type { AgentThreadRequestFeed, AgentThreadRequestScope } from "./agentThreadRequestPorts";
import {
  AGENT_THREAD_REQUEST_RETRY_CAP_MS,
  MAX_AGENT_THREAD_REQUEST_TURN_IDS,
} from "./agentThreadRequestStore";
import {
  NO_AGENT_THREAD_REQUEST_GAPS,
  useAgentThreadRuntimeRequests,
  type AgentThreadRuntimeRequests,
} from "./useAgentThreadRuntimeRequests";

const A: AgentThreadRequestScope = {
  rootKey: "/repo/a",
  ownerId: "agent-root:a",
  threadId: "agt-thread-a",
  workspaceId: "workspace-a",
};
const B: AgentThreadRequestScope = {
  rootKey: "/repo/b",
  ownerId: "agent-root:b",
  threadId: "agt-thread-b",
  workspaceId: "workspace-b",
};
const T1 = "agt-turn-0001";
const T2 = "agt-turn-0002";
const T3 = "agt-turn-0003";

function resolved(turnId: string, id: string, version = 2): AgentRuntimeRequest {
  return agentRuntimeRequestOf("resolvedApproval", { turnId, id, version });
}

function deferred(): { readonly promise: Promise<void>; readonly open: () => void } {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open: () => open() };
}

describe("useAgentThreadRuntimeRequests", () => {
  let host: HTMLDivElement;
  let root: Root;
  let renders: AgentThreadRuntimeRequests[];

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    renders = [];
  });

  afterEach(async () => {
    act(() => root.unmount());
    await settle();
    host.remove();
    vi.useRealTimers();
  });

  function Probe({
    feed,
    scope,
    turnIds,
  }: {
    readonly feed: AgentThreadRequestFeed | null;
    readonly scope: AgentThreadRequestScope | null;
    readonly turnIds: readonly string[];
  }) {
    renders.push(useAgentThreadRuntimeRequests(feed, scope, turnIds));
    return null;
  }

  function show(
    feed: AgentThreadRequestFeed | null,
    scope: AgentThreadRequestScope | null,
    turnIds: readonly string[],
  ): void {
    act(() => root.render(<Probe feed={feed} scope={scope} turnIds={turnIds} />));
  }

  async function settle(ms = 0): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  function latest(): AgentThreadRuntimeRequests {
    const last = renders[renders.length - 1];
    expect(last).toBeDefined();
    return (
      last ?? {
        byTurn: new Map(),
        uncoveredTurnIds: new Set(),
        gaps: NO_AGENT_THREAD_REQUEST_GAPS,
        open: [],
      }
    );
  }

  function exposed(): Readonly<Record<string, readonly string[]>> {
    return Object.fromEntries(
      [...latest().byTurn].map(([turnId, requests]) => [
        turnId,
        requests.map((request) => `${request.id}@${request.version}`),
      ]),
    );
  }

  function uncovered(): readonly string[] {
    return [...latest().uncoveredTurnIds];
  }

  function gated(feed: AgentThreadRequestFeedFake, turnId: string): () => void {
    const pull = feed.currentThreadRequests.getMockImplementation();
    const gate = deferred();
    expect(pull).toBeDefined();
    feed.currentThreadRequests.mockImplementation(async (scope, turnIds, cursor) => {
      if (turnIds.includes(turnId)) await gate.promise;
      return (pull ?? feed.currentThreadRequests)(scope, turnIds, cursor);
    });
    return gate.open;
  }

  it("exposes nothing while the first observation is pending and records per turn once observed", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, [resolved(T1, "req-1"), resolved(T2, "req-2")]));

    show(feed, A, [T1, T2]);
    expect(exposed()).toEqual({});
    expect(uncovered()).toEqual([T1, T2]);

    await settle();
    expect(exposed()).toEqual({ [T1]: ["req-1@2"], [T2]: ["req-2@2"] });
    expect(uncovered()).toEqual([]);
  });

  it("exposes a newly shown turn only after that turn is covered", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, [resolved(T1, "req-1"), resolved(T2, "req-2")]));
    show(feed, A, [T1]);
    await settle();
    const first = latest().byTurn.get(T1);
    const open = gated(feed, T2);

    show(feed, A, [T1, T2]);
    await settle();
    expect(exposed()).toEqual({ [T1]: ["req-1@2"] });
    expect(uncovered()).toEqual([T2]);
    expect(latest().byTurn.get(T1)).toBe(first);

    open();
    await settle();
    expect(exposed()).toEqual({ [T1]: ["req-1@2"], [T2]: ["req-2@2"] });
    expect(uncovered()).toEqual([]);
    expect(latest().byTurn.get(T1)).toBe(first);
  });

  it("exposes nothing when the feed keeps failing", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, [resolved(T1, "req-1")]));
    feed.currentThreadRequests.mockRejectedValue(new Error("offline"));

    show(feed, A, [T1]);
    await settle();
    expect(exposed()).toEqual({});
    await settle(AGENT_THREAD_REQUEST_RETRY_CAP_MS * 4);
    expect(feed.currentThreadRequests.mock.calls.length).toBeGreaterThan(2);
    expect(exposed()).toEqual({});
    expect(uncovered()).toEqual([T1]);
  });

  it("exposes nothing when the subscription cannot be opened", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, [resolved(T1, "req-1")]));
    feed.subscribeThreadRequests.mockRejectedValue(new Error("no runtime"));

    show(feed, A, [T1]);
    await settle(AGENT_THREAD_REQUEST_RETRY_CAP_MS * 4);
    expect(feed.currentThreadRequests).not.toHaveBeenCalled();
    expect(exposed()).toEqual({});
    expect(uncovered()).toEqual([T1]);
  });

  it("never shows the previous thread's records after a thread switch, also on the way back", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, [resolved(T1, "req-a")]));
    feed.record(agentThreadRequestsOf(B, [resolved(T2, "req-b")]));
    show(feed, A, [T1]);
    await settle();
    expect(exposed()).toEqual({ [T1]: ["req-a@2"] });
    const open = gated(feed, T2);
    const before = renders.length;

    show(feed, B, [T2]);
    expect(renders.slice(before).map((view) => view.byTurn.size)).toEqual(
      renders.slice(before).map(() => 0),
    );
    await settle();
    feed.publish(agentThreadRequestsOf(A, [resolved(T1, "req-a2")]));
    await settle();
    expect(exposed()).toEqual({});
    expect(uncovered()).toEqual([T2]);

    open();
    await settle();
    expect(exposed()).toEqual({ [T2]: ["req-b@2"] });

    const again = renders.length;
    show(feed, A, [T1]);
    expect(renders.slice(again).map((view) => view.byTurn.has(T2))).toEqual(
      renders.slice(again).map(() => false),
    );
    expect(renders[again]?.byTurn.size).toBe(0);
    await settle();
    expect(exposed()).toEqual({ [T1]: ["req-a@2", "req-a2@2"] });
  });

  it("starts over when the same thread is owned by another runtime workspace", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, [resolved(T1, "req-a")]));
    show(feed, A, [T1]);
    await settle();
    expect(exposed()).toEqual({ [T1]: ["req-a@2"] });
    const open = gated(feed, T1);
    const before = renders.length;

    show(feed, { ...A, workspaceId: "workspace-a2" }, [T1]);
    expect(renders.slice(before).map((view) => view.byTurn.size)).toEqual(
      renders.slice(before).map(() => 0),
    );
    await settle();
    expect(exposed()).toEqual({});

    open();
    await settle();
    expect(exposed()).toEqual({ [T1]: ["req-a@2"] });
  });

  it("stays inert for a thread without a local scope and without a feed", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, [resolved(T1, "req-a")]));

    show(feed, null, [T1]);
    await settle();
    expect(exposed()).toEqual({});
    expect(uncovered()).toEqual([T1]);
    expect(feed.subscribeThreadRequests).not.toHaveBeenCalled();
    expect(feed.currentThreadRequests).not.toHaveBeenCalled();

    show(null, A, [T1]);
    await settle();
    expect(exposed()).toEqual({});
    expect(feed.subscribeThreadRequests).not.toHaveBeenCalled();
  });

  it("stops watching a thread that turns remote and when it unmounts", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, [resolved(T1, "req-a")]));
    show(feed, A, [T1]);
    await settle();
    expect(feed.subscribers()).toBe(1);

    show(feed, null, [T1]);
    expect(exposed()).toEqual({});
    await settle();
    expect(feed.subscribers()).toBe(0);
    expect(feed.unsubscribed).toHaveBeenCalledTimes(1);

    show(feed, A, [T1]);
    await settle();
    expect(exposed()).toEqual({ [T1]: ["req-a@2"] });
    act(() => root.render(null));
    await settle();
    expect(feed.subscribers()).toBe(0);
    expect(feed.unsubscribed).toHaveBeenCalledTimes(2);
  });

  it("keeps identities and does not re-render when nothing changed", async () => {
    const feed = agentThreadRequestFeedFake();
    const first = resolved(T1, "req-1");
    feed.record(agentThreadRequestsOf(A, [first, resolved(T2, "req-2")]));
    show(feed, A, [T1, T2]);
    await settle();
    const settled = renders.length;
    const view = latest();

    act(() => feed.push(agentThreadRequestsOf(A, [first])));
    await settle();
    expect(renders.length).toBe(settled);

    act(() => feed.publish(agentThreadRequestsOf(A, [resolved(T2, "req-3")])));
    await settle();
    expect(exposed()).toEqual({ [T1]: ["req-1@2"], [T2]: ["req-2@2", "req-3@2"] });
    expect(latest().byTurn).not.toBe(view.byTurn);
    expect(latest().byTurn.get(T1)).toBe(view.byTurn.get(T1));
    expect(latest().byTurn.get(T2)).not.toBe(view.byTurn.get(T2));
    expect(latest().uncoveredTurnIds).toBe(view.uncoveredTurnIds);

    const turnIds = [T1, T2];
    const again = renders.length;
    show(feed, { ...A }, [...turnIds]);
    await settle();
    expect(renders.length).toBe(again + 1);
    expect(latest()).toBe(renders[again - 1]);
  });

  it("exposes the open requests of the watched turns with stable identity and nothing while pending", async () => {
    const feed = agentThreadRequestFeedFake();
    const release = gated(feed, T2);
    const pending = agentRuntimeRequestOf("pendingQuestion", { turnId: T2, id: "req-open" });
    const submitting = agentRuntimeRequestOf("submittingApprovalWithoutResolution", {
      turnId: T2,
      id: "req-sending",
    });
    feed.record(
      agentThreadRequestsOf(A, [
        resolved(T1, "req-1"),
        pending,
        submitting,
        agentRuntimeRequestOf("pendingQuestion", { turnId: T3, id: "req-unwatched" }),
      ]),
    );
    show(feed, A, [T1, T2]);
    await settle();
    expect(latest().open).toEqual([]);

    release();
    await settle();
    expect(latest().open.map((request) => request.id)).toEqual(["req-open", "req-sending"]);
    const open = latest().open;

    act(() => feed.push(agentThreadRequestsOf(A, [resolved(T1, "req-1", 3)])));
    await settle();
    expect(latest().open).toBe(open);

    act(() => feed.publish(agentThreadRequestsOf(A, [resolved(T2, "req-open", 3)])));
    await settle();
    expect(latest().open.map((request) => request.id)).toEqual(["req-sending"]);

    show(feed, B, [T1, T2]);
    expect(latest().open).toEqual([]);
  });

  it("drops a turn's records when the turn is no longer shown and keeps the rest", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, [resolved(T1, "req-1"), resolved(T2, "req-2")]));
    show(feed, A, [T1, T2]);
    await settle();
    const second = latest().byTurn.get(T2);

    show(feed, A, [T2, T3]);
    await settle();
    expect(exposed()).toEqual({ [T2]: ["req-2@2"] });
    expect(uncovered()).toEqual([]);
    expect(latest().byTurn.get(T2)).toBe(second);
  });

  it("reports what the observed history is missing and nothing while it is not observed", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, [resolved(T1, "req-1")]));
    show(feed, A, [T1]);
    expect(latest().gaps).toBe(NO_AGENT_THREAD_REQUEST_GAPS);
    await settle();
    expect(latest().gaps).toBe(NO_AGENT_THREAD_REQUEST_GAPS);
    const clean = renders.length;

    act(() => feed.publish(agentThreadRequestsOf(A, [], { unreadable: 2 })));
    await settle();
    expect(latest().gaps).toEqual({ incomplete: true, unsaved: false });
    const partial = latest();
    expect(renders.length).toBe(clean + 1);

    act(() => feed.publish(agentThreadRequestsOf(A, [], { unreadable: 3 })));
    await settle();
    expect(latest()).toBe(partial);

    act(() => feed.publish(agentThreadRequestsOf(A, [], { unreadable: 3, journal: "degraded" })));
    await settle();
    expect(latest().gaps).toEqual({ incomplete: true, unsaved: true });

    act(() => feed.publish(agentThreadRequestsOf(A, [], { journal: "degraded" })));
    await settle();
    expect(latest().gaps).toEqual({ incomplete: false, unsaved: true });

    show(feed, B, [T2]);
    expect(latest().gaps).toBe(NO_AGENT_THREAD_REQUEST_GAPS);
    show(feed, null, [T1]);
    expect(latest().gaps).toBe(NO_AGENT_THREAD_REQUEST_GAPS);
  });

  it("reports nothing as missing while the feed keeps failing", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, [resolved(T1, "req-1")], { journal: "degraded" }));
    feed.currentThreadRequests.mockRejectedValue(new Error("offline"));

    show(feed, A, [T1]);
    await settle(AGENT_THREAD_REQUEST_RETRY_CAP_MS * 4);

    expect(latest().gaps).toBe(NO_AGENT_THREAD_REQUEST_GAPS);
  });

  it("watches the newest turns up to the store's cap and reports the older ones as uncovered", async () => {
    const feed = agentThreadRequestFeedFake();
    const turnIds = Array.from(
      { length: MAX_AGENT_THREAD_REQUEST_TURN_IDS + 3 },
      (_unused, index) => `agt-turn-${String(index).padStart(4, "0")}`,
    );
    const newest = turnIds[turnIds.length - 1] ?? "";
    const oldest = turnIds[0] ?? "";
    feed.record(
      agentThreadRequestsOf(A, [resolved(oldest, "req-old"), resolved(newest, "req-new")]),
    );

    show(feed, A, turnIds);
    await settle();

    const asked = new Set(feed.currentThreadRequests.mock.calls.flatMap(([, ids]) => ids));
    expect(asked.size).toBe(MAX_AGENT_THREAD_REQUEST_TURN_IDS);
    expect(asked.has(oldest)).toBe(false);
    expect(exposed()).toEqual({ [newest]: ["req-new@2"] });
    expect(uncovered()).toEqual(turnIds.slice(0, 3));
  });
});
