import { describe, expect, it } from "vitest";
import {
  AGENT_THREAD_BULK_CONFIRM_DELAY_MS,
  AGENT_THREAD_BULK_LIMIT,
  agentThreadBulkConfirmLabel,
  agentThreadBulkConfirmReady,
  agentThreadBulkPlan,
  agentThreadBulkReport,
  threadCountLabel,
  type AgentThreadBulkAction,
  type AgentThreadBulkCandidate,
  type AgentThreadBulkRequest,
} from "./agentThreadBulkAction";

const OWNER = "/workspace/app";

function candidate(
  threadId: string,
  overrides: Partial<AgentThreadBulkCandidate> = {},
): AgentThreadBulkCandidate {
  return { threadId, ownerKey: OWNER, running: false, archived: false, ...overrides };
}

function request(
  overrides: Partial<Omit<AgentThreadBulkRequest, "ownerKeys">> & {
    readonly ownerKeys?: ReadonlyMap<string, string>;
  } = {},
): AgentThreadBulkRequest {
  const threadIds = overrides.threadIds ?? [];
  return {
    action: "archive",
    missingIds: [],
    ...overrides,
    threadIds,
    ownerKeys: overrides.ownerKeys ?? new Map(threadIds.map((id) => [id, OWNER])),
  };
}

describe("agent thread bulk plan", () => {
  it("archives only what it legitimately can and reports every skip with a reason", () => {
    const plan = agentThreadBulkPlan(
      request({ action: "archive", threadIds: ["run", "done", "plain"] }),
      [
        candidate("run", { running: true }),
        candidate("done", { archived: true }),
        candidate("plain"),
      ],
    );

    expect(plan.applyIds).toEqual(["plain"]);
    expect(plan.skipped).toEqual([
      { threadId: "run", reason: "running" },
      { threadId: "done", reason: "alreadyArchived" },
    ]);
    expect(agentThreadBulkReport(plan)).toBe(
      "Archived 1 thread. Skipped 2: 1 still running, 1 already archived.",
    );
  });

  it("deletes archived threads but never a running one, because the surface refuses it", () => {
    const plan = agentThreadBulkPlan(
      request({ action: "delete", threadIds: ["run", "done", "plain"] }),
      [
        candidate("run", { running: true }),
        candidate("done", { archived: true }),
        candidate("plain"),
      ],
    );

    expect(plan.applyIds).toEqual(["done", "plain"]);
    expect(plan.skipped).toEqual([{ threadId: "run", reason: "running" }]);
    expect(agentThreadBulkReport(plan)).toBe("Deleted 2 threads. Skipped 1: 1 still running.");
  });

  it("stops at the real batch limit and reports the overflow", () => {
    const threadIds = Array.from({ length: AGENT_THREAD_BULK_LIMIT + 1 }, (_, at) => `t${at}`);
    const plan = agentThreadBulkPlan(
      request({ action: "delete", threadIds }),
      threadIds.map((threadId) => candidate(threadId)),
    );

    expect(plan.applyIds).toHaveLength(AGENT_THREAD_BULK_LIMIT);
    expect(plan.applyIds[AGENT_THREAD_BULK_LIMIT - 1]).toBe(`t${AGENT_THREAD_BULK_LIMIT - 1}`);
    expect(plan.skipped).toEqual([
      { threadId: `t${AGENT_THREAD_BULK_LIMIT}`, reason: "overLimit" },
    ]);
    expect(agentThreadBulkReport(plan)).toBe(
      "Deleted 200 threads. Skipped 1: 1 beyond the batch limit.",
    );
  });

  it("fails closed on ids that vanished and on ids owned by another project", () => {
    const plan = agentThreadBulkPlan(
      request({
        action: "delete",
        threadIds: ["gone", "foreign", "plain"],
        missingIds: ["dropped"],
        ownerKeys: new Map([
          ["gone", OWNER],
          ["foreign", OWNER],
          ["plain", OWNER],
        ]),
      }),
      [candidate("foreign", { ownerKey: "/workspace/api" }), candidate("plain")],
    );

    expect(plan.applyIds).toEqual(["plain"]);
    expect(plan.skipped).toEqual([
      { threadId: "dropped", reason: "missing" },
      { threadId: "gone", reason: "missing" },
      { threadId: "foreign", reason: "foreignOwner" },
    ]);
    expect(agentThreadBulkReport(plan)).toBe(
      "Deleted 1 thread. Skipped 3: 2 no longer in this list, 1 owned by another project.",
    );
  });

  it("applies across projects but skips a thread whose owner changed after marking", () => {
    const plan = agentThreadBulkPlan(
      request({
        threadIds: ["a", "b"],
        ownerKeys: new Map([
          ["a", "/orders"],
          ["b", "/web"],
        ]),
      }),
      [candidate("a", { ownerKey: "/orders" }), candidate("b", { ownerKey: "/elsewhere" })],
    );
    expect(plan.applyIds).toEqual(["a"]);
    expect(plan.skipped).toEqual([{ threadId: "b", reason: "foreignOwner" }]);
  });

  it("treats a thread with no captured owner as foreign", () => {
    const plan = agentThreadBulkPlan(request({ threadIds: ["a"], ownerKeys: new Map() }), [
      candidate("a"),
    ]);
    expect(plan.skipped).toEqual([{ threadId: "a", reason: "foreignOwner" }]);
  });

  it("bounds the batch and reports the overflow instead of dropping it", () => {
    const threadIds = ["t1", "t2", "t3"];
    const plan = agentThreadBulkPlan(
      request({ action: "delete", threadIds }),
      threadIds.map((threadId) => candidate(threadId)),
      2,
    );

    expect(plan.applyIds).toEqual(["t1", "t2"]);
    expect(plan.skipped).toEqual([{ threadId: "t3", reason: "overLimit" }]);
    expect(agentThreadBulkReport(plan)).toBe(
      "Deleted 2 threads. Skipped 1: 1 beyond the batch limit.",
    );
  });

  it("never presents an empty application as a completed batch", () => {
    const plan = agentThreadBulkPlan(request({ action: "archive", threadIds: ["run"] }), [
      candidate("run", { running: true }),
    ]);

    expect(plan.applyIds).toEqual([]);
    expect(agentThreadBulkReport(plan)).toBe("Archived 0 threads. Skipped 1: 1 still running.");
  });

  it("names the exact count in the destructive confirmation", () => {
    expect(agentThreadBulkConfirmLabel("delete", 3)).toBe("Confirm delete of 3 threads");
    expect(agentThreadBulkConfirmLabel("archive", 1)).toBe("Confirm archive of 1 thread");
    expect(threadCountLabel(0)).toBe("0 threads");
  });

  it("never promises more than the batch limit will honour", () => {
    expect(agentThreadBulkConfirmLabel("delete", AGENT_THREAD_BULK_LIMIT)).toBe(
      "Confirm delete of 200 threads",
    );
    expect(agentThreadBulkConfirmLabel("delete", 500)).toBe("Confirm delete of 200 threads of 500");
    expect(agentThreadBulkConfirmLabel("archive", 3, 1)).toBe("Confirm archive of 1 thread of 3");
  });

  it("refuses a confirmation that lands inside the double-click window", () => {
    expect(agentThreadBulkConfirmReady(1_000, 1_000)).toBe(false);
    expect(agentThreadBulkConfirmReady(1_000, 1_000 + AGENT_THREAD_BULK_CONFIRM_DELAY_MS - 1)).toBe(
      false,
    );
    expect(agentThreadBulkConfirmReady(1_000, 1_000 + AGENT_THREAD_BULK_CONFIRM_DELAY_MS)).toBe(
      true,
    );
  });

  it("offers only archive and delete as bulk actions", () => {
    const actions: ReadonlyArray<AgentThreadBulkAction> = ["archive", "delete"];
    expect(actions.map((action) => agentThreadBulkConfirmLabel(action, 2))).toEqual([
      "Confirm archive of 2 threads",
      "Confirm delete of 2 threads",
    ]);
  });
});
