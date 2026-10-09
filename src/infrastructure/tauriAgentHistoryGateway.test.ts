import { serializeAgentHistoryThread } from "../domain/agentThreadWire";
import lifecycleWire from "../../contracts/agent-subagent-lifecycle-wire.json";
import { parseAgentSubagentLifecycle } from "@codevo/agent-events";
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
        ? { threads: [], unreadable: [], evicted: 0, revisions: {}, haltRequests: {} }
        : { revision: (args.request as { expectedRevision: number }).expectedRevision + 1 },
    );
  const gateway = new TauriAgentHistoryGateway(invoke, () => true);
  const save = request();
  await gateway.saveAgentThread(save);
  await gateway.loadAgentThreads({ rootKey: "/other", ownerId: agentRootOwnerId("/other") });
  await gateway.saveAgentThread(save);
  expect(invoke.mock.calls[2][1]).toMatchObject({ request: { expectedRevision: 1 } });
});

it("keeps its acknowledged revision when an earlier load settles after the save", async () => {
  const original = request();
  let release!: (snapshot: unknown) => void;
  const invoke = vi
    .fn<InvokeAgentThreadStoreCommand>()
    .mockImplementation(async (command, args) => {
      if (command === "load_agent_history")
        return new Promise((resolve) => {
          release = resolve;
        });
      return { revision: (args.request as { expectedRevision: number }).expectedRevision + 1 };
    });
  const gateway = new TauriAgentHistoryGateway(invoke, () => true);
  const loading = gateway.loadAgentThreads(original);
  await gateway.saveAgentThread(original);
  release({
    threads: [serializeAgentHistoryThread(original.thread)],
    unreadable: [],
    evicted: 0,
    revisions: { [original.thread.threadId]: 0 },
    haltRequests: {},
  });
  await loading;
  await gateway.saveAgentThread(original);
  expect(invoke.mock.calls[2]?.[1]).toMatchObject({
    request: { expectedRevision: 1, thread: { turns: [] } },
  });
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
    expect(Object.keys(wire).sort()).toEqual([
      "expectedRevision",
      "haltRequests",
      "ownerId",
      "rootKey",
      "thread",
    ]);
    expect(wire.haltRequests).toEqual([]);
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
        haltRequests: {},
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

it("keeps every follow-up and main reply of a long turn through a save and a reload", async () => {
  const stored = new Map<string, Record<string, unknown>>();
  let document: Record<string, unknown> | null = null;
  let revision = 0;
  const invoke = vi
    .fn<InvokeAgentThreadStoreCommand>()
    .mockImplementation(async (command, args) => {
      if (command === "save_agent_history_thread") {
        const thread = (args.request as { thread: Record<string, unknown> }).thread;
        for (const turn of thread.turns as ReadonlyArray<Record<string, unknown>>) {
          stored.set(turn.turnId as string, turn);
        }
        document = thread;
        revision += 1;
        return { revision };
      }
      const threadId = (document as Record<string, unknown>).threadId as string;
      return {
        threads: [{ ...document, turns: [...stored.values()] }],
        unreadable: [],
        evicted: 0,
        revisions: { [threadId]: revision },
        haltRequests: {},
      };
    });
  const conversation = Array.from({ length: 20 }, (_, index) =>
    index % 2 === 0
      ? { kind: "userMessage" as const, text: `follow-up ${index}` }
      : { kind: "assistantText" as const, text: `main reply ${index}` },
  );
  const subagentOutput = Array.from({ length: 1_500 }, (_, index) => ({
    kind: "toolResult" as const,
    toolId: `toolu_${index}`,
    outputSummary: `subagent output ${index}`,
    isError: false,
    parentToolId: "toolu_agent",
  }));
  const gateway = new TauriAgentHistoryGateway(invoke, () => true);
  const save = request([logTurn({ events: [...conversation, ...subagentOutput] })]);

  await gateway.saveAgentThread(save);
  const loaded = await gateway.loadAgentThreads(save);

  const turn = loaded.threads[0]?.turns[0];
  expect(turn?.events.slice(0, conversation.length)).toEqual(conversation);
  expect(turn?.events.length).toBeLessThanOrEqual(512);
  expect(turn?.eventsTruncated).toBe(true);
});

describe("stop request records on the history wire", () => {
  const haltRequest = {
    source: "composerEscape",
    mode: "softInterrupt",
    requestedAtEpochMs: 1_000,
    escalation: { source: "interruptRefused", requestedAtEpochMs: 1_400 },
  } as const;

  function backend() {
    const saved: Record<string, unknown>[] = [];
    const invoke = vi
      .fn<InvokeAgentThreadStoreCommand>()
      .mockImplementation(async (_command, args) => {
        const wire = args.request as Record<string, unknown>;
        saved.push(wire);
        return { revision: (wire.expectedRevision as number) + 1 };
      });
    return { invoke, saved };
  }

  it("sends the record beside the thread and never inside the turn payload", async () => {
    const { invoke, saved } = backend();
    const gateway = new TauriAgentHistoryGateway(invoke, () => true);
    const halted = logTurn({ turnId: "halted", status: { kind: "stopped" }, haltRequest });

    await gateway.saveAgentThread(request([logTurn({ turnId: "plain" }), halted]));

    expect(saved.map((wire) => wire.haltRequests)).toEqual([
      [],
      [{ turnId: "halted", ...haltRequest }],
    ]);
    for (const wire of saved) {
      expect(JSON.stringify(wire.thread)).not.toContain("haltRequest");
    }
  });

  it("resends an acknowledged turn once a stop request is recorded on it", async () => {
    const { invoke, saved } = backend();
    const gateway = new TauriAgentHistoryGateway(invoke, () => true);
    const running = logTurn({ status: { kind: "running" }, endedAtEpochMs: null });
    await gateway.saveAgentThread(request([running]));
    await gateway.saveAgentThread(request([running]));
    expect(saved.map((wire) => wire.haltRequests)).toEqual([[], []]);

    await gateway.saveAgentThread(request([{ ...running, haltRequested: true, haltRequest }]));

    expect(saved).toHaveLength(3);
    expect(saved[2]?.haltRequests).toEqual([{ turnId: running.turnId, ...haltRequest }]);
    expect(JSON.stringify(saved[2]?.thread)).not.toContain("haltRequest");
  });

  it("restores the record on its exact turn and loads a thread whose record is unknown", async () => {
    const save = request([logTurn({ status: { kind: "stopped" } })]);
    const thread = serializeAgentHistoryThread(save.thread);
    const snapshot = (haltRequests: Record<string, unknown>) => ({
      threads: [thread],
      unreadable: [],
      evicted: 0,
      revisions: { [save.thread.threadId]: 1 },
      haltRequests,
    });
    const stored = { turnId: save.thread.turns[0]?.turnId, ...haltRequest };
    const invoke = vi
      .fn<InvokeAgentThreadStoreCommand>()
      .mockResolvedValueOnce(snapshot({ [save.thread.threadId]: [stored] }))
      .mockResolvedValueOnce(
        snapshot({ [save.thread.threadId]: [{ ...stored, source: "triggerFromANewerBuild" }] }),
      )
      .mockResolvedValueOnce(snapshot({ "another-thread": [stored] }));
    const gateway = new TauriAgentHistoryGateway(invoke, () => true);

    const restored = await gateway.loadAgentThreads(save);
    const unknown = await gateway.loadAgentThreads(save);
    const foreign = await gateway.loadAgentThreads(save);

    expect(restored.threads[0]?.turns[0]?.haltRequest).toEqual(haltRequest);
    expect(restored.threads[0]?.turns[0]?.haltRequested).toBeUndefined();
    expect(unknown.threads).toHaveLength(1);
    expect(unknown.threads[0]?.turns[0]?.haltRequest).toBeUndefined();
    expect(foreign.threads[0]?.turns[0]?.haltRequest).toBeUndefined();
  });

  it("rejects a load response without the halt request envelope", async () => {
    const save = request();
    const invoke = vi.fn<InvokeAgentThreadStoreCommand>().mockResolvedValue({
      threads: [],
      unreadable: [],
      evicted: 0,
      revisions: {},
    });
    const gateway = new TauriAgentHistoryGateway(invoke, () => true);

    await expect(gateway.loadAgentThreads(save)).rejects.toThrow(TypeError);
  });
});
