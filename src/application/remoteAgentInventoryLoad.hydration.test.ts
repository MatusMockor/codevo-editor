import { describe, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../domain/remoteRunner";
import { emptyRemoteInventory, loadRemoteAgentInventory } from "./remoteAgentInventoryLoad";
import { remoteAgentThreadKey } from "./remoteAgentProjection";

const CANONICAL_PARTS = [{ type: "text" as const, text: "The complete prompt of the turn." }];
const LISTED_PARTS = [{ type: "text" as const, text: "The complete prompt" }];

const listedTask = (change: Partial<RemoteRunnerTask> = {}): RemoteRunnerTask => ({
  id: "root",
  sequence: 1,
  runnerId: "runner",
  provider: "claude",
  status: "running",
  parts: LISTED_PARTS,
  createdAt: "2026-09-13T00:00:00Z",
  ...change,
});

const detailOf = (
  listed: RemoteRunnerTask,
  change: Partial<RemoteRunnerTask> = {},
): RemoteRunnerTask => {
  const { interactionSequence: _sequence, awaiting: _awaiting, ...record } = listed;
  return { ...record, parts: CANONICAL_PARTS, ...change };
};

function gatewayOf(listed: RemoteRunnerTask, detail: RemoteRunnerTask) {
  return {
    getRunner: vi.fn().mockResolvedValue({
      runnerId: "runner",
      capabilities: {
        taskExecution: true,
        eventReplay: true,
        taskContinuation: true,
        runtimeRequests: true,
      },
    }),
    listProjects: vi.fn().mockResolvedValue({ items: [] }),
    listTasks: vi.fn().mockResolvedValue({ items: [listed], nextCursor: null }),
    getTask: vi.fn().mockResolvedValue(detail),
    listEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
  };
}

const SELECTED = remoteAgentThreadKey("server", "runner", "root");

function load(listed: RemoteRunnerTask, detail: RemoteRunnerTask) {
  const gateway = gatewayOf(listed, detail);
  const loaded = loadRemoteAgentInventory(
    gateway as unknown as RemoteRunnerGateway,
    emptyRemoteInventory("server", true),
    SELECTED,
    () => true,
  );
  return { gateway, loaded };
}

async function hydrated(listed: RemoteRunnerTask, detail: RemoteRunnerTask) {
  const { loaded } = load(listed, detail);
  const snapshot = await loaded;
  expect(snapshot.tasks).toHaveLength(1);
  expect(snapshot.detailedTaskIds?.has("root")).toBe(true);
  return snapshot.tasks[0] ?? listed;
}

describe("remote inventory hydration with interaction facts", () => {
  it("hydrates a listed sequence from a detail that reports none and keeps the sequence", async () => {
    const listed = listedTask({ interactionSequence: 4, awaiting: "approval" });

    const task = await hydrated(listed, detailOf(listed));

    expect(task.parts).toEqual(CANONICAL_PARTS);
    expect(task.interactionSequence).toBe(4);
    expect(task.awaiting).toBe("approval");
    expect(task.status).toBe("running");
  });

  it("takes the facts of a detail with a higher sequence", async () => {
    const listed = listedTask({ interactionSequence: 4, awaiting: "approval" });

    const task = await hydrated(listed, detailOf(listed, { interactionSequence: 5 }));

    expect(task.parts).toEqual(CANONICAL_PARTS);
    expect(task.interactionSequence).toBe(5);
    expect(task.awaiting).toBeUndefined();
  });

  it("takes the facts of a detail at the same sequence", async () => {
    const listed = listedTask({ interactionSequence: 4 });

    const task = await hydrated(
      listed,
      detailOf(listed, { interactionSequence: 4, awaiting: "approval" }),
    );

    expect(task.interactionSequence).toBe(4);
    expect(task.awaiting).toBe("approval");
  });

  it("hydrates the content of a detail with a lower sequence and keeps the listed facts", async () => {
    const listed = listedTask({ interactionSequence: 4, awaiting: "approval" });

    const task = await hydrated(listed, detailOf(listed, { interactionSequence: 3 }));

    expect(task.parts).toEqual(CANONICAL_PARTS);
    expect(task.interactionSequence).toBe(4);
    expect(task.awaiting).toBe("approval");
  });

  it("gives a listed record without a sequence the one its detail reports", async () => {
    const listed = listedTask();

    const task = await hydrated(listed, detailOf(listed, { interactionSequence: 2 }));

    expect(task.interactionSequence).toBe(2);
  });

  it("hydrates an old runner's turn exactly from its detail", async () => {
    const listed = listedTask();
    const detail = detailOf(listed);

    expect(await hydrated(listed, detail)).toBe(detail);
  });

  it("keeps the listed sequence but not the awaited approval when the detail has ended", async () => {
    const listed = listedTask({ interactionSequence: 4, awaiting: "approval" });

    const task = await hydrated(listed, detailOf(listed, { status: "succeeded" }));

    expect(task.status).toBe("succeeded");
    expect(task.parts).toEqual(CANONICAL_PARTS);
    expect(task.interactionSequence).toBe(4);
    expect("awaiting" in task).toBe(false);
  });

  it("keeps the sequence of a finished turn whose detail reports none", async () => {
    const listed = listedTask({ status: "succeeded", interactionSequence: 6 });

    const task = await hydrated(listed, detailOf(listed));

    expect(task.parts).toEqual(CANONICAL_PARTS);
    expect(task.interactionSequence).toBe(6);
  });

  it.each([
    ["another provider", { provider: "codex" as const }],
    ["another creation time", { createdAt: "2026-09-14T00:00:00Z" }],
    ["another task sequence", { sequence: 2 }],
    ["another project", { projectId: "other" }],
    ["another checkout isolation", { isolation: "in-place" as const }],
  ])("still rejects a detail of %s even with a higher sequence", async (_label, change) => {
    const listed = listedTask({ status: "succeeded", interactionSequence: 4 });
    const { gateway, loaded } = load(
      listed,
      detailOf(listed, { ...change, interactionSequence: 9 }),
    );

    await expect(loaded).rejects.toThrow("The runner returned a different conversation turn.");

    expect(gateway.listEvents).not.toHaveBeenCalled();
  });

  it("still rejects a running turn whose detail regressed its status with a higher sequence", async () => {
    const listed = listedTask({ interactionSequence: 4 });
    const { gateway, loaded } = load(
      listed,
      detailOf(listed, { status: "queued", interactionSequence: 9 }),
    );

    await expect(loaded).rejects.toThrow("The runner returned a different conversation turn.");

    expect(gateway.listEvents).not.toHaveBeenCalled();
  });

  it("names the different turn when only the hydration detail differs", async () => {
    const listed = listedTask({ status: "succeeded", interactionSequence: 4 });
    const { gateway, loaded } = load(
      listed,
      detailOf(listed, { provider: "codex", interactionSequence: 9 }),
    );

    await expect(loaded).rejects.toThrow("The runner returned a different conversation turn.");

    expect(gateway.getTask).toHaveBeenCalledTimes(1);
    expect(gateway.listEvents).not.toHaveBeenCalled();
  });

  it("rejects a finished turn whose detail reports another terminal status", async () => {
    const listed = listedTask({ status: "succeeded", interactionSequence: 4 });
    const { loaded } = load(listed, detailOf(listed, { status: "failed", interactionSequence: 9 }));

    await expect(loaded).rejects.toThrow("The runner returned a different conversation turn.");
  });
});
