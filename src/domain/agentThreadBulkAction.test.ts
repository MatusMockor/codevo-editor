import { describe, expect, it } from "vitest";
import {
  AGENT_THREAD_BULK_CONFIRM_DELAY_MS,
  AGENT_THREAD_BULK_LIMIT,
  agentThreadBulkConfirmLabel,
  agentThreadBulkConfirmReady,
  agentThreadBulkPlan,
  agentThreadBulkReport,
  threadCountLabel,
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

function request(overrides: Partial<AgentThreadBulkRequest> = {}): AgentThreadBulkRequest {
  return { action: "archive", ownerKey: OWNER, threadIds: [], missingIds: [], ...overrides };
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
});
