import { serializeAgentHistoryThread } from "../domain/agentThreadWire";
import lifecycleWire from "../../contracts/agent-subagent-lifecycle-wire.json";
import { parseAgentSubagentLifecycle } from "../domain/agentSubagentLifecycle";
import { describe, expect, it, vi } from "vitest";
import { agentRootOwnerId } from "../domain/agentProject";
import { logThread, logTurn } from "../test/agentTurnLogStoreHarness";
import { TauriAgentHistoryGateway } from "./tauriAgentHistoryGateway";
import type { InvokeAgentThreadStoreCommand } from "./tauriAgentThreadStoreIpcContract";

function request(turns = [logTurn()]) {
  const thread = logThread({ turns });
  const ownerId = agentRootOwnerId(thread.owner.rootKey);
  return {
    rootKey: thread.owner.rootKey,
    ownerId,
    thread: { ...thread, owner: { ...thread.owner, ownerId } },
    loggedPromptTurnIds: [],
  };
}
describe("SQLite agent history adapter", () => {
  it("sends independent full prompts over the old aggregate limit and acknowledges unchanged turns", async () => {
    const invoke = vi
      .fn<InvokeAgentThreadStoreCommand>()
      .mockImplementation(async (_command, args) => ({
        revision: (args.request as { expectedRevision: number }).expectedRevision + 1,
      }));
    const gateway = new TauriAgentHistoryGateway(invoke, () => true);
    const save = request(
      Array.from({ length: 64 }, (_, index) =>
        logTurn({ turnId: `turn-${index}`, prompt: "x".repeat(20_000) }),
      ),
    );
    await gateway.saveAgentThread(save);
    expect(invoke).toHaveBeenCalledTimes(64);
    for (const [command, args] of invoke.mock.calls) {
      expect(command).toBe("save_agent_history_thread");
      expect(args).toMatchObject({
        request: { thread: { turns: [{ prompt: "x".repeat(20_000) }] } },
      });
    }
    await gateway.saveAgentThread(save);
    expect(invoke.mock.calls[invoke.mock.calls.length - 1]?.[1]).toMatchObject({
      request: { thread: { turns: [] } },
    });
  });
  it("retries every snapshot after a partially failed batch", async () => {
    const invoke = vi
      .fn<InvokeAgentThreadStoreCommand>()
      .mockResolvedValueOnce({ revision: 1 })
      .mockRejectedValueOnce(new Error("disk full"))
      .mockImplementation(async (_command, args) => ({
        revision: (args.request as { expectedRevision: number }).expectedRevision + 1,
      }));
    const gateway = new TauriAgentHistoryGateway(invoke, () => true);
    const save = request([logTurn({ turnId: "one" }), logTurn({ turnId: "two" })]);
    await expect(gateway.saveAgentThread(save)).rejects.toThrow("disk full");
    await gateway.saveAgentThread(save);
    expect(invoke).toHaveBeenCalledTimes(5);
    expect(invoke.mock.calls[3][1]).toMatchObject({
      request: { thread: { turns: [{ turnId: "one" }] } },
    });
  });
  it("rejects foreign owners before IPC and preserves a truthful bounded event projection", async () => {
    const invoke = vi
      .fn<InvokeAgentThreadStoreCommand>()
      .mockImplementation(async (_command, args) => ({
        revision: (args.request as { expectedRevision: number }).expectedRevision + 1,
      }));
    const gateway = new TauriAgentHistoryGateway(invoke, () => true);
    const save = request([
      logTurn({
        events: Array.from({ length: 600 }, (_, index) => ({
          kind: "assistantText" as const,
          text: `${index}`,
        })),
      }),
    ]);
    await gateway.saveAgentThread(save);
    const args = invoke.mock.calls[0][1] as {
      request: { thread: { turns: { events: unknown[]; eventsTruncated: boolean }[] } };
    };
    expect(args.request.thread.turns[0].events).toHaveLength(512);
    expect(args.request.thread.turns[0].eventsTruncated).toBe(true);
    await expect(gateway.saveAgentThread({ ...save, ownerId: "foreign" })).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

it("carries acknowledged revisions through partial failures and never refreshes conflicts", async () => {
  const invoke = vi
    .fn<InvokeAgentThreadStoreCommand>()
    .mockResolvedValueOnce({ revision: 8 })
    .mockRejectedValueOnce(new Error("conflict"))
    .mockResolvedValueOnce({ revision: 9 })
    .mockResolvedValueOnce({ revision: 10 })
    .mockResolvedValueOnce({ revision: 11 });
  const gateway = new TauriAgentHistoryGateway(invoke, () => true);
  const initial = request([logTurn({ turnId: "first" }), logTurn({ turnId: "last" })]);
  const save = { ...initial, thread: { ...initial.thread, historyRevision: 7 } };
  await expect(gateway.saveAgentThread(save)).rejects.toThrow("conflict");
  await gateway.saveAgentThread(save);
  expect(
    invoke.mock.calls.map(
      ([, args]) => (args.request as { expectedRevision: number }).expectedRevision,
    ),
  ).toEqual([7, 8, 8, 9, 10]);
  expect(invoke.mock.calls.every(([command]) => command === "save_agent_history_thread")).toBe(
    true,
  );
});

it("stops a multi-turn write when its owner expires during an awaited save", async () => {
  let current = true;
  const invoke = vi.fn<InvokeAgentThreadStoreCommand>().mockImplementation(async () => {
    current = false;
    return { revision: 1 };
  });
  const gateway = new TauriAgentHistoryGateway(invoke, () => true);
  await expect(
    gateway.saveAgentThread({
      ...request([logTurn({ turnId: "first" }), logTurn({ turnId: "second" })]),
      isCurrent: () => current,
    }),
  ).rejects.toThrow("owner expired");
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("bounds escaped event bytes while preserving full prompt and lifecycle", async () => {
  const invoke = vi.fn<InvokeAgentThreadStoreCommand>().mockResolvedValue({ revision: 1 });
  const gateway = new TauriAgentHistoryGateway(invoke, () => true);
  const save = request([
    logTurn({
      prompt: "full prompt",
      subagentLifecycle: parseAgentSubagentLifecycle(lifecycleWire.valid.retained),
      events: Array.from({ length: 64 }, () => ({
        kind: "assistantText" as const,
        text: "\u0001".repeat(16_384),
      })),
    }),
  ]);
  await gateway.saveAgentThread(save);
  const args = invoke.mock.calls[0][1] as {
    request: {
      thread: { turns: { prompt: string; events: unknown[]; eventsTruncated: boolean }[] };
    };
  };
  expect(new TextEncoder().encode(JSON.stringify(args)).length).toBeLessThan(600_000);
  expect(args.request.thread.turns[0].prompt).toBe("full prompt");
  expect(args.request.thread.turns[0]).toHaveProperty(
    "subagentLifecycle",
    lifecycleWire.valid.retained,
  );
  expect(args.request.thread.turns[0].eventsTruncated).toBe(true);
});

it("preserves one workspace revision when another workspace loads", async () => {
  const invoke = vi
    .fn<InvokeAgentThreadStoreCommand>()
    .mockImplementation(async (command, args) =>
      command === "load_agent_history"
        ? { threads: [], unreadable: [], evicted: 0, revisions: {} }
        : { revision: (args.request as { expectedRevision: number }).expectedRevision + 1 },
    );
  const gateway = new TauriAgentHistoryGateway(invoke, () => true);
  const save = request();
  await gateway.saveAgentThread(save);
  await gateway.loadAgentThreads({ rootKey: "/other", ownerId: agentRootOwnerId("/other") });
  await gateway.saveAgentThread(save);
  expect(invoke.mock.calls[2][1]).toMatchObject({ request: { expectedRevision: 1 } });
});

it("publishes every acknowledged revision without putting internal authority on the wire", async () => {
  const invoke = vi
    .fn<InvokeAgentThreadStoreCommand>()
    .mockImplementation(async (_command, args) => ({
      revision: (args.request as { expectedRevision: number }).expectedRevision + 1,
    }));
  const onRevision = vi.fn();
  const gateway = new TauriAgentHistoryGateway(invoke, () => true);
  const initial = request([logTurn({ turnId: "first" }), logTurn({ turnId: "last" })]);
  await gateway.saveAgentThread({
    ...initial,
    thread: { ...initial.thread, historyRevision: 3 },
    onRevision,
    isCurrent: () => true,
  });
  expect(onRevision.mock.calls).toEqual([[4], [5]]);
  for (const [, args] of invoke.mock.calls) {
    const wire = args.request as Record<string, unknown>;
    expect(Object.keys(wire).sort()).toEqual(["expectedRevision", "ownerId", "rootKey", "thread"]);
    expect(wire.thread).not.toHaveProperty("historyRevision");
  }
});

it("replays an uncertain exact write before saving newer state after a lost receipt", async () => {
  let first: unknown;
  let calls = 0;
  const invoke = vi
    .fn<InvokeAgentThreadStoreCommand>()
    .mockImplementation(async (_command, args) => {
      calls += 1;
      if (calls === 1) {
        first = args;
        throw new Error("receipt lost after commit");
      }
      if (calls === 2) {
        expect(args).toEqual(first);
        return { revision: 1 };
      }
      expect(args).toMatchObject({
        request: { expectedRevision: 1, thread: { title: "New title" } },
      });
      return { revision: 2 };
    });
  const gateway = new TauriAgentHistoryGateway(invoke, () => true);
  const original = request();
  await expect(gateway.saveAgentThread(original)).rejects.toThrow("receipt lost");
  const onRevision = vi.fn();
  await gateway.saveAgentThread({
    ...original,
    thread: { ...original.thread, title: "New title" },
    onRevision,
  });
  expect(onRevision.mock.calls).toEqual([[1], [2]]);
  expect(invoke).toHaveBeenCalledTimes(3);
});

it("refuses new unresolved writes at capacity without discarding an earlier replay", async () => {
  const invoke = vi.fn<InvokeAgentThreadStoreCommand>().mockRejectedValue(new Error("unavailable"));
  const gateway = new TauriAgentHistoryGateway(invoke, () => true);
  const base = request();
  for (let index = 0; index < 64; index += 1) {
    await expect(
      gateway.saveAgentThread({
        ...base,
        thread: { ...base.thread, threadId: `pending-${index}` },
      }),
    ).rejects.toThrow("unavailable");
  }
  await expect(
    gateway.saveAgentThread({ ...base, thread: { ...base.thread, threadId: "overflow" } }),
  ).rejects.toThrow("memory limit");
  expect(invoke).toHaveBeenCalledTimes(64);
  invoke.mockImplementation(async (_command, args) => ({
    revision: (args.request as { expectedRevision: number }).expectedRevision + 1,
  }));
  await gateway.saveAgentThread({ ...base, thread: { ...base.thread, threadId: "pending-0" } });
  expect(invoke.mock.calls[64][1]).toEqual(invoke.mock.calls[0][1]);
  await gateway.saveAgentThread({ ...base, thread: { ...base.thread, threadId: "overflow" } });
});

it.each(["lost transport", "The saved thread update is stale; reload its current revision."])(
  "reconciles a superseded write after loading a newer revision: %s",
  async (message) => {
    const initial = request();
    const stored = { ...initial.thread, historyRevision: 5 };
    const invoke = vi
      .fn<InvokeAgentThreadStoreCommand>()
      .mockRejectedValueOnce(new Error(message))
      .mockResolvedValueOnce({
        threads: [serializeAgentHistoryThread(stored)],
        unreadable: [],
        evicted: 0,
        revisions: { [stored.threadId]: 5 },
      })
      .mockResolvedValueOnce({ revision: 6 });
    const gateway = new TauriAgentHistoryGateway(invoke, () => true);
    await expect(
      gateway.saveAgentThread({ ...initial, thread: { ...initial.thread, historyRevision: 3 } }),
    ).rejects.toThrow(message);
    const loaded = await gateway.loadAgentThreads(initial);
    await gateway.saveAgentThread({ ...initial, thread: loaded.threads[0], onRevision: vi.fn() });
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke.mock.calls[2][1]).toMatchObject({ request: { expectedRevision: 5 } });
  },
);

it.each(["Agent thread save batch exceeds 4 MiB."])(
  "does not replay a definitively rejected request: %s",
  async (message) => {
    const invoke = vi
      .fn<InvokeAgentThreadStoreCommand>()
      .mockRejectedValueOnce(message)
      .mockResolvedValueOnce({ revision: 1 });
    const gateway = new TauriAgentHistoryGateway(invoke, () => true);
    const initial = request();
    await expect(gateway.saveAgentThread(initial)).rejects.toBe(message);
    await gateway.saveAgentThread({
      ...initial,
      thread: { ...initial.thread, title: "Corrected smaller request" },
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][1]).toMatchObject({
      request: { thread: { title: "Corrected smaller request" } },
    });
  },
);

it("does not let an old owner's rejection clear a newer owner's pending write", async () => {
  let rejectOld!: (error: unknown) => void;
  let rejectNew!: (error: unknown) => void;
  let oldCurrent = true;
  let revision = 0;
  let calls = 0;
  const invoke = vi
    .fn<InvokeAgentThreadStoreCommand>()
    .mockImplementation(async (_command, args) => {
      calls += 1;
      if (calls === 1)
        return new Promise((_resolve, reject) => {
          rejectOld = reject;
        });
      if (calls === 2) return { revision: 1 };
      if (calls === 3)
        return new Promise((_resolve, reject) => {
          rejectNew = reject;
        });
      return { revision: (args.request as { expectedRevision: number }).expectedRevision + 1 };
    });
  const gateway = new TauriAgentHistoryGateway(invoke, () => true);
  const initial = request();
  const old = gateway.saveAgentThread({ ...initial, isCurrent: () => oldCurrent });
  const oldRejected = expect(old).rejects.toBe(
    "The saved thread update is stale; reload its current revision.",
  );
  oldCurrent = false;
  const newer = {
    ...initial,
    thread: { ...initial.thread, title: "New owner" },
    isCurrent: () => true,
    onRevision: (next: number) => {
      revision = next;
    },
  };
  const pending = gateway.saveAgentThread(newer);
  const newRejected = expect(pending).rejects.toThrow("lost receipt");
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
  rejectOld("The saved thread update is stale; reload its current revision.");
  await oldRejected;
  rejectNew(new Error("lost receipt"));
  await newRejected;
  await gateway.saveAgentThread({
    ...newer,
    thread: { ...newer.thread, historyRevision: revision },
  });
  expect(invoke.mock.calls[3][1]).toEqual(invoke.mock.calls[2][1]);
  expect(invoke).toHaveBeenCalledTimes(5);
});
