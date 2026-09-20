import { describe, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../domain/remoteRunner";
import {
  emptyRemoteInventory,
  loadRemoteAgentInventory,
  RemoteInventoryRevoked,
} from "./remoteAgentInventoryLoad";
import { RemoteAgentProjection, remoteAgentThreadKey } from "./remoteAgentProjection";
const task = (id = "root", sequence = 1): RemoteRunnerTask => ({
  id,
  sequence,
  runnerId: "runner",
  provider: "claude",
  status: "succeeded",
  parts: [],
  createdAt: "2026-09-13T00:00:00Z",
});
const fixture = () => ({
  getRunner: vi.fn().mockResolvedValue({
    runnerId: "runner",
    capabilities: { taskExecution: true, eventReplay: true, taskContinuation: true },
  }),
  listProjects: vi.fn().mockResolvedValue({ items: [] }),
  listTasks: vi.fn().mockResolvedValue({ items: [task()], nextCursor: null }),
  getTask: vi
    .fn()
    .mockImplementation(async ({ taskId }: { taskId: string }) =>
      taskId === "child"
        ? { ...task("child", 2), conversationId: "root", parentTaskId: "root" }
        : task(taskId),
    ),
  listEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
});
const initial = () => emptyRemoteInventory("server", true);
const key = remoteAgentThreadKey("server", "runner", "root");
const load = (
  gw: ReturnType<typeof fixture>,
  previous = initial(),
  selected: string | null = key,
  valid = () => true,
) => loadRemoteAgentInventory(gw as unknown as RemoteRunnerGateway, previous, selected, valid);
describe("remote inventory loading", () => {
  it("rejects a canonical detail with changed checkout isolation", async () => {
    const gw = fixture();
    gw.getTask.mockResolvedValue({ ...task(), isolation: "in-place" });
    await expect(load(gw)).rejects.toThrow("different conversation turn");
  });
  it("retains explicit direct checkout from listing through hydration", async () => {
    const gw = fixture();
    const direct = { ...task(), isolation: "in-place" as const };
    gw.listTasks.mockResolvedValue({ items: [direct], nextCursor: null });
    gw.getTask.mockResolvedValue(direct);
    expect((await load(gw)).tasks[0]?.isolation).toBe("in-place");
  });
  it("hydrates every settled ancestor from canonical detail without losing unrelated conversations", async () => {
    const gw = fixture();
    const firstPrompt = "Root instructions. ".repeat(90) + "Exact root ending.";
    const secondPrompt = "Continue with all requirements. ".repeat(80) + "Exact child ending.";
    const full = [
      { ...task(), parts: [{ type: "text" as const, text: firstPrompt }] },
      {
        ...task("child", 2),
        conversationId: "root",
        parentTaskId: "root",
        parts: [{ type: "text" as const, text: secondPrompt }],
      },
      { ...task("other", 3), parts: [{ type: "text" as const, text: "Another conversation" }] },
    ];
    const summaries = full.map((entry) => ({
      ...entry,
      parts: entry.parts.map((part) => ({ ...part, text: part.text.slice(0, 500) })),
    }));
    gw.listTasks.mockResolvedValue({ items: summaries, nextCursor: null });
    gw.getTask.mockImplementation(async ({ taskId }: { taskId: string }) =>
      full.find((entry) => entry.id === taskId)!,
    );
    const projector = new RemoteAgentProjection();
    const listed = await load(gw, initial(), null);
    expect(projector.project({ ...listed, runnerId: "runner" })).toHaveLength(2);
    gw.listTasks.mockResolvedValue({ items: [], nextCursor: null });
    const hydrated = await load(gw, listed);
    const views = projector.project({ ...hydrated, runnerId: "runner" });
    expect(views).toHaveLength(2);
    expect(
      views.find((view) => view.thread.threadId === key)?.thread.turns.map((turn) => turn.prompt),
    ).toEqual([firstPrompt, secondPrompt]);
    expect(gw.getTask.mock.calls.map(([request]) => request.taskId).sort()).toEqual([
      "child",
      "root",
    ]);
    gw.getTask.mockClear();
    await load(gw, hydrated);
    expect(gw.getTask).not.toHaveBeenCalled();
  });
  it("rejects foreign canonical turn detail and revoked hydration without replaying it", async () => {
    const gw = fixture();
    gw.getTask.mockResolvedValue({ ...task(), provider: "codex" });
    await expect(load(gw)).rejects.toThrow("different conversation turn");
    expect(gw.listEvents).not.toHaveBeenCalled();
    let valid = true;
    gw.getTask.mockImplementation(async () => {
      valid = false;
      return task();
    });
    await expect(load(gw, initial(), key, () => valid)).rejects.toBeInstanceOf(
      RemoteInventoryRevoked,
    );
    expect(gw.listEvents).not.toHaveBeenCalled();
  });
  it("rejects stale hydration that would regress an already running turn", async () => {
    const gw = fixture();
    const running = { ...task(), status: "running" as const };
    gw.listTasks.mockResolvedValue({ items: [running], nextCursor: null });
    gw.getTask
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce({ ...running, status: "queued" });
    await expect(load(gw)).rejects.toThrow("different conversation turn");
    expect(gw.listEvents).not.toHaveBeenCalled();
  });
  it("resumes a bounded catch-up snapshot instead of failing for lifetime history", async () => {
    const gw = fixture();
    const result = await load(gw, { ...initial(), inventoryTruncated: true });
    expect(result.connected).toBe(true);
    expect(result.inventoryTruncated).toBe(false);
  });
  it("loads every page and all selected conversation turns", async () => {
    const gw = fixture();
    gw.listTasks.mockResolvedValueOnce({ items: [task()], nextCursor: 1 }).mockResolvedValueOnce({
      items: [{ ...task("child", 2), conversationId: "root", parentTaskId: "root" }],
      nextCursor: null,
    });
    const result = await load(gw);
    expect(result.tasks).toHaveLength(2);
    expect([...result.replayComplete]).toEqual(["child", "root"]);
    expect(gw.listTasks.mock.calls[1]![0]).toEqual({ serverId: "server", after: 1 });
  });
  it("recovers missing parents without accepting foreign lineage", async () => {
    const gw = fixture();
    gw.listTasks.mockResolvedValue({
      items: [{ ...task("child", 2), conversationId: "root", parentTaskId: "root" }],
      nextCursor: null,
    });
    expect((await load(gw)).tasks).toHaveLength(2);
    gw.getTask.mockResolvedValue({ ...task("root"), runnerId: "foreign" });
    await expect(load(gw)).rejects.toThrow("ancestry");
  });
  it("revokes authority before making the next external read", async () => {
    const gw = fixture();
    await expect(load(gw, initial(), key, () => false)).rejects.toBeInstanceOf(
      RemoteInventoryRevoked,
    );
    expect(gw.listProjects).not.toHaveBeenCalled();
  });
  it("rejects stalled task page cursors", async () => {
    const gw = fixture();
    gw.listTasks.mockResolvedValue({ items: [task()], nextCursor: 0 });
    await expect(load(gw)).rejects.toThrow("cursor");
  });
  it("keeps committed publications from advancing the listing cursor", async () => {
    const gw = fixture();
    gw.listTasks.mockResolvedValue({ items: [task("middle", 2)], nextCursor: null });
    const result = await load(
      gw,
      { ...initial(), listingCursor: 1, tasks: [task("published", 3)] },
      null,
    );
    expect(gw.listTasks).toHaveBeenCalledWith({ serverId: "server", after: 1 });
    expect(result.tasks.map((t) => t.id)).toEqual(["published", "middle"]);
  });
  it("marks evicted output incomplete while independently finishing the fetch cursor", async () => {
    const gw = fixture();
    gw.listEvents.mockResolvedValue({
      items: [{ taskId: "root", sequence: 1, text: "x".repeat(1_500_001) }],
      nextCursor: null,
    });
    const result = await load(gw);
    expect(result.replayTruncated.has("root")).toBe(true);
    expect(result.replayComplete.has("root")).toBe(true);
    expect(result.error).toContain("incomplete");
  });
  it("uses completed cached replay without reading output again", async () => {
    const gw = fixture();
    const first = await load(gw);
    gw.listTasks.mockResolvedValue({ items: [], nextCursor: null });
    gw.listEvents.mockClear();
    await load(gw, first);
    expect(gw.listEvents).not.toHaveBeenCalled();
  });
  it("rejects foreign output and runner identity replacement", async () => {
    const gw = fixture();
    gw.listEvents.mockResolvedValue({
      items: [{ taskId: "foreign", sequence: 1 }],
      nextCursor: null,
    });
    await expect(load(gw)).rejects.toThrow("ordering");
    gw.getRunner.mockResolvedValue({
      runnerId: "replacement",
      capabilities: { taskExecution: true, eventReplay: true },
    });
    await expect(
      load(gw, {
        ...initial(),
        descriptor: {
          runnerId: "runner",
          name: "Runner",
          protocolVersion: 1,
          capabilities: { taskExecution: true, eventReplay: true },
        },
      }),
    ).rejects.toThrow("identity changed");
  });
});

it("loads durable pending messages only when advertised, rejecting foreign conversations", async () => {
  const gw = { ...fixture(), listPendingMessages: vi.fn().mockResolvedValue({ items: [] }) };
  await load(gw);
  expect(gw.listPendingMessages).not.toHaveBeenCalled();
  gw.getRunner.mockResolvedValue({
    runnerId: "runner",
    capabilities: { taskExecution: true, eventReplay: true, pendingMessages: true },
  });
  const item = {
    id: "pending",
    conversationId: "root",
    status: "paused",
    parts: [],
    createdAt: "2026-09-15T00:00:00Z",
    taskId: null,
  };
  gw.listPendingMessages.mockResolvedValue({ items: [item] });
  const snapshot = await load(gw);
  expect(snapshot.pendingMessages?.get(key)).toEqual([item]);
  gw.listPendingMessages.mockResolvedValue({ items: [{ ...item, conversationId: "other" }] });
  await expect(load(gw)).rejects.toThrow("invalid pending message queue");
});

it("keeps fetching across display and page limits and shows the final result on reconnect", async () => {
  const gw = fixture();
  const tasks = [task(), { ...task("child", 2), conversationId: "root", parentTaskId: "root" }];
  gw.listTasks.mockResolvedValue({ items: tasks, nextCursor: null });
  const output = Array.from({ length: 120 }, (_, index) => ({
    sequence: index + 1,
    type: "task.output" as const,
    channel: "stdout" as const,
    text: `${"x".repeat(32_000)}\n`,
    createdAt: "2026-09-13T00:00:00Z",
  }));
  output.push({
    sequence: 121,
    type: "task.output",
    channel: "stdout",
    text:
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "Final visible",
        is_error: false,
      }) + "\n",
    createdAt: "2026-09-13T00:00:01Z",
  });
  gw.listEvents.mockImplementation(async ({ taskId, after }: { taskId: string; after: number }) => {
    const items = output
      .filter((entry) => entry.sequence > after)
      .slice(0, 4)
      .map((entry) => ({ ...entry, taskId }));
    return {
      items,
      nextCursor:
        items[items.length - 1]!.sequence < 121 ? items[items.length - 1]!.sequence : null,
    };
  });
  const first = await load(gw);
  expect(first.replayComplete.size).toBe(0);
  expect(first.replayCursors?.get("root")).toBe(96);
  expect(first.replayTruncated.size).toBe(2);
  gw.listTasks.mockResolvedValue({ items: [], nextCursor: null });
  const second = await load(gw, first);
  expect(second.replayComplete.size).toBe(2);
  expect(second.replayCursors?.get("root")).toBe(121);
  const retainedBytes = [...second.replays.values()]
    .flat()
    .reduce((sum, entry) => sum + (entry.text?.length ?? 0) * 2, 0);
  expect(retainedBytes).toBeLessThanOrEqual(6_000_000);
  const view = new RemoteAgentProjection().project({ ...second, runnerId: "runner" })[0]!;
  for (const turn of view.thread.turns) {
    expect(turn.events).toContainEqual(
      expect.objectContaining({ kind: "result", text: "Final visible" }),
    );
    expect(turn.eventsTruncated).toBe(true);
  }
});

it("propagates the runner's gap while retaining lifecycle rows preceding it", async () => {
  const gw = fixture();
  const text =
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Recovered" }] },
    }) + "\n";
  gw.listEvents.mockResolvedValue({
    items: [
      { taskId: "root", sequence: 1, type: "task.running", createdAt: "2026-09-13T00:00:00Z" },
      {
        taskId: "root",
        sequence: 7,
        type: "task.output",
        channel: "stdout",
        text: "partial tail\n" + text,
        createdAt: "2026-09-13T00:00:00Z",
      },
    ],
    nextCursor: null,
    outputTruncatedBeforeSequence: 6,
    outputStartsAtLineBoundary: false,
  });
  const snapshot = await load(gw);
  expect(snapshot.replayGaps?.get("root")).toEqual({
    throughSequence: 6,
    startsAtLineBoundary: false,
  });
  const turn = new RemoteAgentProjection().project({ ...snapshot, runnerId: "runner" })[0]!.thread
    .turns[0]!;
  expect(turn.events).toEqual([{ kind: "assistantText", text: "Recovered" }]);
  expect(turn.eventsTruncated).toBe(true);
});
it("retains the authoritative lifecycle snapshot across completed replay refreshes", async () => {
  const gw = fixture();
  const lifecycle = {
    entries: [
      {
        id: "tool:spawn",
        toolId: "spawn",
        name: "Agent",
        description: "Review",
        state: "completed",
      },
    ],
    truncated: false,
  };
  gw.listEvents.mockResolvedValue({ items: [], nextCursor: null, subagentLifecycle: lifecycle });
  const first = await load(gw);
  expect(first.subagentLifecycles?.get("root")).toEqual(lifecycle);
  gw.listTasks.mockResolvedValue({ items: [], nextCursor: null });
  const second = await load(gw, first);
  expect(second.subagentLifecycles?.get("root")).toEqual(lifecycle);
  expect(gw.listEvents).toHaveBeenCalledTimes(1);
});

it("advances across more than 4096 retained tasks without dropping active or selected authority", async () => {
  const gw = fixture();
  const all = Array.from({ length: 5000 }, (_, i) => task(`task-${i + 1}`, i + 1));
  all[0] = { ...all[0]!, status: "running" };
  gw.listTasks.mockImplementation(async ({ after }: { after: number }) => {
    const items = all.filter((item) => item.sequence > after).slice(0, 50);
    const last = items[items.length - 1]?.sequence ?? after;
    return { items, nextCursor: last < all.length ? last : null };
  });
  gw.getTask.mockImplementation(async ({ taskId }: { taskId: string }) =>
    all.find((item) => item.id === taskId)!,
  );
  const selected = remoteAgentThreadKey("server", "runner", "task-2");
  const first = await load(gw, initial(), selected);
  expect(first.listingCursor).toBe(3200);
  expect(first.connected).toBe(false);
  expect(first.inventoryTruncated).toBe(true);
  expect(first.resumes.size).toBe(0);
  const second = await load(gw, first, selected);
  expect(second.listingCursor).toBe(5000);
  expect(second.connected).toBe(true);
  expect(second.tasks).toHaveLength(4096);
  expect(second.tasks.some((item) => item.id === "task-1")).toBe(true);
  expect(second.tasks.some((item) => item.id === "task-2")).toBe(true);
  expect(second.tasks[0]?.sequence).toBe(5000);
  expect(second.historyWindowed).toBe(true);
});
it("loads only latest64 turns without failing a longer conversation", async () => {
  const gw = fixture();
  const all = Array.from({ length: 150 }, (_, i) => ({
    ...task(i === 0 ? "root" : `child-${i}`, i + 1),
    conversationId: "root",
    ...(i > 0 ? { parentTaskId: i === 1 ? "root" : `child-${i - 1}` } : {}),
  }));
  gw.listTasks.mockImplementation(async ({ after }: { after: number }) => {
    const items = all.filter((item) => item.sequence > after).slice(0, 50);
    return {
      items,
      nextCursor:
        items[items.length - 1]!.sequence < 150 ? items[items.length - 1]!.sequence : null,
    };
  });
  gw.getTask.mockImplementation(async ({ taskId }: { taskId: string }) =>
    all.find((item) => item.id === taskId)!,
  );
  const result = await load(gw);
  expect(result.replays.size).toBe(64);
  expect(result.resumes.has("child-149")).toBe(true);
  expect(gw.getTask).toHaveBeenCalledTimes(64);
  expect(
    new RemoteAgentProjection().project({ ...result, runnerId: "runner" })[0]?.thread
      .turnsTruncated,
  ).toBe(true);
});

it("keeps the inventory bound when hydrating ancestors into a full cache", async () => {
  const gw = fixture();
  const latest = { ...task("child-64", 6000), conversationId: "root", parentTaskId: "child-63" };
  const tasks = [latest, ...Array.from({ length: 4095 }, (_, i) => task(`other-${i}`, i + 1000))];
  gw.listTasks.mockResolvedValue({ items: [], nextCursor: null });
  gw.getTask.mockImplementation(async ({ taskId }: { taskId: string }) => {
    if (taskId === latest.id) return latest;
    const ordinal = Number(taskId.slice(6));
    return {
      ...task(taskId, ordinal),
      conversationId: "root",
      parentTaskId: ordinal === 1 ? "root" : `child-${ordinal - 1}`,
    };
  });
  const result = await load(gw, { ...initial(), tasks, listingCursor: 6000 });
  expect(result.tasks).toHaveLength(4096);
  expect(result.tasks.filter((item) => item.conversationId === "root")).toHaveLength(64);
  expect(result.detailedTaskIds?.size).toBe(64);
  expect(result.resumes.has(latest.id)).toBe(true);
});
