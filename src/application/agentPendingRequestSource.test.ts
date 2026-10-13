import { describe, expect, it, vi } from "vitest";
import { agentInteractionFeedFake } from "../test/agentInteractionFeedFake";
import { agentInteractionStore } from "./agentInteractionStore";
import {
  polledAgentPendingRequestSource,
  pushedAgentPendingRequestSource,
  type AgentPendingRequestItem,
} from "./agentPendingRequestSource";

interface Item extends AgentPendingRequestItem {
  readonly note?: string;
}

function pending(id: string): Item {
  return { id, status: "pending" };
}

function settledItem(id: string): Item {
  return { id, status: "answered", note: "receipt" };
}

function polled() {
  return polledAgentPendingRequestSource<Item>({
    cadence: "repeating",
    unreachableNotice: "Reconnecting…",
    list: vi.fn(),
  });
}

function pushed() {
  return pushedAgentPendingRequestSource<Item>({
    store: agentInteractionStore(agentInteractionFeedFake()),
    owner: { workspaceId: "workspace", taskId: "task" },
    unreachableNotice: "Unavailable.",
    select: () => [],
  });
}

describe("polled pending request confirmations", () => {
  it("retain nothing however many answers are confirmed", () => {
    const confirmations = polled().confirmations();
    const listed = Array.from({ length: 32 }, (_unused, index) => pending(`request-${index}`));
    for (let index = 0; index < 1000; index += 1)
      confirmations.confirm(`request-${index}`, settledItem(`request-${index}`));
    expect(Object.isFrozen(confirmations)).toBe(true);
    expect(Object.getOwnPropertyNames(confirmations)).toEqual([]);
    expect(confirmations.reconcile(listed)).toBe(listed);
  });

  it("replace the answered request in place whatever its listed status", () => {
    const confirmations = polled().confirmations();
    const receipt = settledItem("a");
    expect(confirmations.settled([pending("a"), pending("b")], "a", receipt)).toEqual([
      receipt,
      pending("b"),
    ]);
    expect(confirmations.settled([{ id: "a", status: "cancelled" }], "a", receipt)).toEqual([
      receipt,
    ]);
  });
});

describe("pushed pending request confirmations", () => {
  it("overlay a confirmed answer only while the push still lists it as pending", () => {
    const confirmations = pushed().confirmations();
    const receipt = settledItem("a");
    confirmations.confirm("a", receipt);
    expect(confirmations.reconcile([pending("a"), pending("b")])).toEqual([receipt, pending("b")]);
    const real: Item = { id: "a", status: "expired" };
    expect(confirmations.reconcile([real, pending("b")])).toEqual([real, pending("b")]);
    const relisted = [pending("a"), pending("b")];
    expect(confirmations.reconcile(relisted)).toBe(relisted);
  });

  it("forget confirmations of requests the push no longer lists", () => {
    const confirmations = pushed().confirmations();
    for (let index = 0; index < 100; index += 1)
      confirmations.confirm(`request-${index}`, settledItem(`request-${index}`));
    expect(confirmations.reconcile([pending("request-7")])).toEqual([settledItem("request-7")]);
    const relisted = [pending("request-3"), pending("request-99")];
    expect(confirmations.reconcile(relisted)).toBe(relisted);
    const afterwards = [pending("request-7")];
    expect(confirmations.reconcile(afterwards)).toBe(afterwards);
  });

  it("apply the receipt only to a request that is still pending", () => {
    const confirmations = pushed().confirmations();
    const receipt = settledItem("a");
    const cancelled: Item = { id: "a", status: "cancelled" };
    expect(confirmations.settled([pending("a"), pending("b")], "a", receipt)).toEqual([
      receipt,
      pending("b"),
    ]);
    expect(confirmations.settled([cancelled], "a", receipt)).toEqual([cancelled]);
  });

  it("keep each scope's confirmations apart", () => {
    const source = pushed();
    const first = source.confirmations();
    const second = source.confirmations();
    first.confirm("a", settledItem("a"));
    const listed = [pending("a")];
    expect(second.reconcile(listed)).toBe(listed);
    expect(first.reconcile(listed)).toEqual([settledItem("a")]);
  });
});
