import { describe, expect, it, vi } from "vitest";
import { agentRootOwnerId } from "../domain/agentProject";
import { serializeAgentThread, type AgentThread, type AgentTurn } from "../domain/agentThread";
import {
  TauriAgentThreadStoreGateway,
  type AgentThreadStoreRuntimeDetector,
} from "./tauriAgentThreadStoreGateway";
import type { InvokeAgentThreadStoreCommand } from "./tauriAgentThreadStoreIpcContract";

const ROOT_KEY = "/workspace/app";
const OWNER_ID = agentRootOwnerId(ROOT_KEY);

const THREAD: AgentThread = {
  threadId: "agt-1-0a1b",
  owner: { rootKey: ROOT_KEY, ownerId: OWNER_ID, repositoryRoot: "/workspace/app" },
  target: { isolation: "in-place", worktreePath: null },
  provider: { kind: "codex", sessionId: null },
  title: "Fix the parser",
  pinned: true,
  archived: false,
  createdAtEpochMs: 1_000,
  updatedAtEpochMs: 2_000,
  turns: [],
  turnsTruncated: false,
  viewedAtEpochMs: null,
  externalOrigin: null,
  integration: null,
};

const available: AgentThreadStoreRuntimeDetector = () => true;
const unavailable: AgentThreadStoreRuntimeDetector = () => false;

describe("TauriAgentThreadStoreGateway", () => {
  it("forwards the typed store commands in order", async () => {
    const invokeCommand = vi
      .fn<InvokeAgentThreadStoreCommand>()
      .mockResolvedValueOnce({
        threads: [serializeAgentThread(THREAD)],
        unreadable: [],
        evicted: 0,
      })
      .mockResolvedValue(null);
    const gateway = new TauriAgentThreadStoreGateway(invokeCommand, available);

    const snapshot = await gateway.loadAgentThreads({ rootKey: ROOT_KEY, ownerId: OWNER_ID });
    await gateway.saveAgentThread({ rootKey: ROOT_KEY, ownerId: OWNER_ID, thread: THREAD });
    await gateway.deleteAgentThread({
      rootKey: ROOT_KEY,
      ownerId: OWNER_ID,
      threadId: THREAD.threadId,
    });

    expect(snapshot.threads).toEqual([THREAD]);
    expect(invokeCommand.mock.calls.map(([command]) => command)).toEqual([
      "load_agent_threads",
      "save_agent_thread",
      "delete_agent_thread",
    ]);
  });

  it("returns an empty snapshot and skips writes without the native runtime", async () => {
    const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>();
    const gateway = new TauriAgentThreadStoreGateway(invokeCommand, unavailable);

    const snapshot = await gateway.loadAgentThreads({ rootKey: ROOT_KEY, ownerId: OWNER_ID });
    await gateway.saveAgentThread({ rootKey: ROOT_KEY, ownerId: OWNER_ID, thread: THREAD });
    await gateway.deleteAgentThread({
      rootKey: ROOT_KEY,
      ownerId: OWNER_ID,
      threadId: THREAD.threadId,
    });

    expect(snapshot).toEqual({ threads: [], unreadable: [], evicted: 0 });
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});

const FINISHED: AgentTurn = {
  turnId: "agt-2-0a1b",
  prompt: "design",
  status: { kind: "exited", exitCode: 0 },
  startedAtEpochMs: 1000,
  endedAtEpochMs: 2000,
  events: [{ kind: "assistantText", text: "[Preview](design.html)" }],
  eventsTruncated: false,
  lastStatusSequence: 1,
  lastOutputSequence: 1,
  launch: null,
  cliVersion: null,
};
const RUNNING: AgentTurn = {
  ...FINISHED,
  turnId: "agt-3-0a1b",
  status: { kind: "running" },
  endedAtEpochMs: null,
  events: [{ kind: "assistantText", text: "[Running](later.html)" }],
};
const METADATA = {
  id: "a".repeat(64),
  taskId: "agt-2-0a1b",
  name: "design.html",
  mediaType: "text/html",
  sizeBytes: 20,
  sha256: "b".repeat(64),
};

function resolveCalls(invokeCommand: ReturnType<typeof vi.fn<InvokeAgentThreadStoreCommand>>) {
  return invokeCommand.mock.calls.filter(
    ([command]) => command === "resolve_agent_output_artifact",
  );
}

function save(gateway: TauriAgentThreadStoreGateway, thread: AgentThread): Promise<void> {
  return gateway.saveAgentThread({ rootKey: ROOT_KEY, ownerId: OWNER_ID, thread });
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

it.each(["claudeCode", "codex"] as const)(
  "snapshots %s outputs after persistence settles without extending the save",
  async (provider) => {
    let finish!: () => void;
    const captured = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let captureSettled = false;
    const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>(async (command) => {
      if (command === "resolve_agent_output_artifact") {
        await captured;
        captureSettled = true;
        return METADATA;
      }
      return null;
    });
    const gateway = new TauriAgentThreadStoreGateway(invokeCommand, available);
    const thread: AgentThread = {
      ...THREAD,
      provider: { kind: provider, sessionId: null },
      turns: [FINISHED],
    };
    let settled = false;
    const saving = save(gateway, thread).then(() => {
      settled = true;
    });

    await saving;

    expect(settled).toBe(true);
    expect(captureSettled).toBe(false);
    expect(invokeCommand.mock.calls[0]?.[0]).toBe("save_agent_thread");
    await vi.waitFor(() =>
      expect(invokeCommand).toHaveBeenCalledWith("resolve_agent_output_artifact", {
        request: {
          workspaceId: OWNER_ID,
          threadId: THREAD.threadId,
          turnId: "agt-2-0a1b",
          path: "design.html",
        },
      }),
    );
    finish();
    await flush();
  },
);

it("captures the newest terminal turn even when a queued follow-up already started the next one", async () => {
  const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>().mockResolvedValue(null);
  const gateway = new TauriAgentThreadStoreGateway(invokeCommand, available);

  await save(gateway, { ...THREAD, turns: [FINISHED, RUNNING] });
  await flush();

  expect(invokeCommand).toHaveBeenCalledWith("resolve_agent_output_artifact", {
    request: {
      workspaceId: OWNER_ID,
      threadId: THREAD.threadId,
      turnId: "agt-2-0a1b",
      path: "design.html",
    },
  });
  expect(resolveCalls(invokeCommand)).toHaveLength(1);
});

it("stops resolving once the newest terminal turn has settled", async () => {
  const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>(async (command) =>
    command === "resolve_agent_output_artifact" ? METADATA : null,
  );
  const gateway = new TauriAgentThreadStoreGateway(invokeCommand, available);

  await save(gateway, { ...THREAD, turns: [FINISHED] });
  await vi.waitFor(() => expect(resolveCalls(invokeCommand)).toHaveLength(1));
  await flush();
  for (let index = 0; index < 5; index += 1) {
    await save(gateway, { ...THREAD, turns: [FINISHED, RUNNING] });
    await flush();
  }

  expect(resolveCalls(invokeCommand)).toHaveLength(1);
});

it("drops an in-flight capture when a newer save claims the same thread", async () => {
  const gates: Array<() => void> = [];
  const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>(async (command) => {
    if (command !== "resolve_agent_output_artifact") return null;
    await new Promise<void>((resolve) => gates.push(resolve));
    return METADATA;
  });
  const gateway = new TauriAgentThreadStoreGateway(invokeCommand, available);

  await save(gateway, { ...THREAD, turns: [FINISHED] });
  await vi.waitFor(() => expect(gates).toHaveLength(1));
  await save(gateway, { ...THREAD, turns: [FINISHED] });
  await vi.waitFor(() => expect(gates).toHaveLength(2));
  for (const gate of gates) gate();
  await flush();

  expect(resolveCalls(invokeCommand)).toHaveLength(2);

  await save(gateway, { ...THREAD, turns: [FINISHED] });
  await flush();

  expect(resolveCalls(invokeCommand)).toHaveLength(2);
});

it("never fails a save because its capture was refused", async () => {
  const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>(async (command) => {
    if (command === "resolve_agent_output_artifact") throw new Error("Artifact storage is busy.");
    return null;
  });
  const gateway = new TauriAgentThreadStoreGateway(invokeCommand, available);

  await expect(save(gateway, { ...THREAD, turns: [FINISHED] })).resolves.toBeUndefined();
  await flush();

  expect(resolveCalls(invokeCommand)).toHaveLength(1);
});

it("bounds how many references one save may capture", async () => {
  const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>().mockResolvedValue(null);
  const gateway = new TauriAgentThreadStoreGateway(invokeCommand, available);
  const turns: readonly AgentTurn[] = Array.from({ length: 6 }, (_, index) => ({
    ...FINISHED,
    turnId: `agt-${index + 2}-0a1b`,
    events: [
      {
        kind: "assistantText" as const,
        text: Array.from({ length: 10 }, (_, item) => `[P](t${index}-${item}.html)`).join(" "),
      },
    ],
  }));

  await save(gateway, { ...THREAD, turns });
  await flush();

  const resolved = resolveCalls(invokeCommand);
  expect(resolved).toHaveLength(10);
  for (const [, args] of resolved)
    expect(args).toMatchObject({ request: { turnId: "agt-7-0a1b" } });
});

it("captures at most the shared reference limit from one terminal turn", async () => {
  const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>().mockResolvedValue(null);
  const gateway = new TauriAgentThreadStoreGateway(invokeCommand, available);
  const text = Array.from({ length: 40 }, (_, item) => `[P](file-${item}.html)`).join(" ");

  await save(gateway, {
    ...THREAD,
    turns: [{ ...FINISHED, events: [{ kind: "assistantText", text }] }],
  });
  await flush();

  expect(resolveCalls(invokeCommand)).toHaveLength(32);
});

it("captures a window truncated turn through the injected evidence lookup", async () => {
  const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>().mockResolvedValue(null);
  const gateway = new TauriAgentThreadStoreGateway(invokeCommand, available, () => ({
    loss: { kind: "none" },
    sealed: true,
    live: false,
    hydration: "complete",
  }));

  await save(gateway, { ...THREAD, turns: [{ ...FINISHED, eventsTruncated: true }] });
  await flush();

  expect(resolveCalls(invokeCommand)).toHaveLength(1);
});

it("captures nothing from a truncated turn when no evidence lookup was injected", async () => {
  const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>().mockResolvedValue(null);
  const gateway = new TauriAgentThreadStoreGateway(invokeCommand, available);

  await save(gateway, { ...THREAD, turns: [{ ...FINISHED, eventsTruncated: true }] });
  await flush();

  expect(resolveCalls(invokeCommand)).toEqual([]);
});
