import { describe, expect, it } from "vitest";
import {
  agentPendingRequestSnapshotAfterPoll,
  agentPendingRequestSnapshotWhileSuspended,
  sameAgentPendingRequestItems,
  type AgentPendingRequestSnapshot,
  type AgentPendingRequestSnapshotPolicy,
} from "./agentPendingRequestPolling";

interface Item {
  readonly id: string;
  readonly status: string;
}

const NOTICE = "Items could not be refreshed. Reconnecting…";
const POLICY: AgentPendingRequestSnapshotPolicy<Item> = {
  unreachableNotice: NOTICE,
  sameRequest: (left, right) => left.id === right.id && left.status === right.status,
};
const LEASE = {};

function snapshot(
  overrides: Partial<AgentPendingRequestSnapshot<Item>> = {},
): AgentPendingRequestSnapshot<Item> {
  return {
    lease: LEASE,
    requests: [{ id: "a", status: "pending" }],
    answering: null,
    error: null,
    ...overrides,
  };
}

describe("agentPendingRequestSnapshotAfterPoll", () => {
  it("keeps the snapshot when the poll lists requests equal in meaning", () => {
    const previous = snapshot({ answering: "a" });
    const next = agentPendingRequestSnapshotAfterPoll(
      previous,
      LEASE,
      { kind: "listed", requests: [{ id: "a", status: "pending" }] },
      POLICY,
    );
    expect(next).toBe(previous);
  });

  it.each<{ readonly name: string; readonly listed: readonly Item[] }>([
    { name: "a changed status", listed: [{ id: "a", status: "answered" }] },
    { name: "another request", listed: [{ id: "b", status: "pending" }] },
    {
      name: "an added request",
      listed: [
        { id: "a", status: "pending" },
        { id: "b", status: "pending" },
      ],
    },
    { name: "no request", listed: [] },
  ])("publishes the listed requests for $name and keeps the answer in flight", ({ listed }) => {
    const previous = snapshot({ answering: "a" });
    const next = agentPendingRequestSnapshotAfterPoll(
      previous,
      LEASE,
      { kind: "listed", requests: listed },
      POLICY,
    );
    expect(next).toEqual({ lease: LEASE, requests: listed, answering: "a", error: null });
    expect(next.requests).toBe(listed);
  });

  it("clears the notice without replacing unchanged requests", () => {
    const previous = snapshot({ error: NOTICE });
    const next = agentPendingRequestSnapshotAfterPoll(
      previous,
      LEASE,
      { kind: "listed", requests: [{ id: "a", status: "pending" }] },
      POLICY,
    );
    expect(next.error).toBeNull();
    expect(next.requests).toBe(previous.requests);
  });

  it("publishes the notice once and keeps the snapshot while polls keep failing", () => {
    const previous = snapshot();
    const noticed = agentPendingRequestSnapshotAfterPoll(
      previous,
      LEASE,
      { kind: "unreachable" },
      POLICY,
    );
    const repeated = agentPendingRequestSnapshotAfterPoll(
      noticed,
      LEASE,
      { kind: "unreachable" },
      POLICY,
    );
    expect(noticed.error).toBe(NOTICE);
    expect(noticed.requests).toBe(previous.requests);
    expect(repeated).toBe(noticed);
  });

  it("starts from an empty snapshot when the previous one belongs to another lease", () => {
    const foreign = snapshot({ lease: {}, answering: "a", error: NOTICE });
    const listed = [{ id: "a", status: "pending" }];
    expect(
      agentPendingRequestSnapshotAfterPoll(
        foreign,
        LEASE,
        { kind: "listed", requests: listed },
        POLICY,
      ),
    ).toEqual({ lease: LEASE, requests: listed, answering: null, error: null });
    expect(
      agentPendingRequestSnapshotAfterPoll(null, LEASE, { kind: "unreachable" }, POLICY),
    ).toEqual({ lease: LEASE, requests: [], answering: null, error: NOTICE });
  });
});

describe("agentPendingRequestSnapshotWhileSuspended", () => {
  it("hides the reconnecting notice and keeps the listed requests", () => {
    const previous = snapshot({ error: NOTICE, answering: "a" });
    const next = agentPendingRequestSnapshotWhileSuspended(previous, LEASE, POLICY);
    expect(next).toEqual({ ...previous, error: null });
    expect(next?.requests).toBe(previous.requests);
  });

  it.each<{ readonly name: string; readonly previous: AgentPendingRequestSnapshot<Item> | null }>([
    { name: "no notice", previous: snapshot() },
    { name: "an answer failure", previous: snapshot({ error: "The answer was not confirmed." }) },
    { name: "a foreign lease", previous: snapshot({ lease: {}, error: NOTICE }) },
    { name: "no snapshot", previous: null },
  ])("keeps the snapshot untouched for $name", ({ previous }) => {
    expect(agentPendingRequestSnapshotWhileSuspended(previous, LEASE, POLICY)).toBe(previous);
  });
});

describe("sameAgentPendingRequestItems", () => {
  const same = (left: string, right: string) => left === right;

  it("compares ordered items pairwise", () => {
    expect(sameAgentPendingRequestItems(["a", "b"], ["a", "b"], same)).toBe(true);
    expect(sameAgentPendingRequestItems([], [], same)).toBe(true);
    expect(sameAgentPendingRequestItems(["a", "b"], ["b", "a"], same)).toBe(false);
    expect(sameAgentPendingRequestItems(["a"], ["a", "b"], same)).toBe(false);
    expect(sameAgentPendingRequestItems(["a", "b"], ["a"], same)).toBe(false);
  });
});
