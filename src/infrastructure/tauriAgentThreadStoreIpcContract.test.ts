import { describe, expect, it, vi } from "vitest";
import { agentRootOwnerId } from "../domain/agentProject";
import { serializeAgentThread, type AgentThread } from "../domain/agentThread";
import {
  DELETE_AGENT_THREAD_IPC_COMMAND,
  LOAD_AGENT_THREADS_IPC_COMMAND,
  SAVE_AGENT_THREAD_IPC_COMMAND,
  invokeDeleteAgentThreadIpc,
  invokeLoadAgentThreadsIpc,
  invokeSaveAgentThreadIpc,
  parseAgentThreadStoreSnapshot,
  type InvokeAgentThreadStoreCommand,
} from "./tauriAgentThreadStoreIpcContract";

const ROOT_KEY = "/workspace/app";
const OWNER_ID = agentRootOwnerId(ROOT_KEY);

const THREAD: AgentThread = {
  threadId: "agt-1-0a1b",
  owner: { rootKey: ROOT_KEY, ownerId: OWNER_ID, repositoryRoot: "/workspace/app" },
  target: { isolation: "worktree", worktreePath: "/workspace/app/.worktrees/agt-1-0a1b" },
  provider: { kind: "claudeCode", sessionId: null },
  title: "Fix the parser",
  pinned: false,
  archived: false,
  createdAtEpochMs: 1_000,
  updatedAtEpochMs: 2_000,
  turns: [],
  turnsTruncated: false,
  viewedAtEpochMs: null,
  externalOrigin: null,
  integration: null,
};

const OWNER_REQUEST = { rootKey: ROOT_KEY, ownerId: OWNER_ID };

describe("agent thread store IPC command names", () => {
  it("pins the snake_case store commands", () => {
    expect(LOAD_AGENT_THREADS_IPC_COMMAND).toBe("load_agent_threads");
    expect(SAVE_AGENT_THREAD_IPC_COMMAND).toBe("save_agent_thread");
    expect(DELETE_AGENT_THREAD_IPC_COMMAND).toBe("delete_agent_thread");
  });
});

describe("invokeLoadAgentThreadsIpc", () => {
  it("sends the validated owner request and parses the snapshot", async () => {
    const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>().mockResolvedValue({
      threads: [serializeAgentThread(THREAD)],
      unreadable: [],
      evicted: 2,
    });

    const snapshot = await invokeLoadAgentThreadsIpc(invokeCommand, OWNER_REQUEST);

    expect(invokeCommand).toHaveBeenCalledWith("load_agent_threads", { request: OWNER_REQUEST });
    expect(snapshot.threads).toEqual([THREAD]);
    expect(snapshot.unreadable).toEqual([]);
    expect(snapshot.evicted).toBe(2);
  });

  it("rejects a blank owner before touching the transport", async () => {
    const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>();

    await expect(
      invokeLoadAgentThreadsIpc(invokeCommand, { rootKey: "", ownerId: OWNER_ID }),
    ).rejects.toThrow(TypeError);
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});

describe("persistent owner id contract", () => {
  it("rejects a runtime workspace owner id before touching the transport", async () => {
    const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>();

    await expect(
      invokeLoadAgentThreadsIpc(invokeCommand, { rootKey: ROOT_KEY, ownerId: "ws-7f3a2c" }),
    ).rejects.toThrow(/persistent agent root owner id/);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects saving a thread whose owner is not the persistent root owner", async () => {
    const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>();

    await expect(
      invokeSaveAgentThreadIpc(invokeCommand, {
        rootKey: ROOT_KEY,
        ownerId: OWNER_ID,
        thread: { ...THREAD, owner: { ...THREAD.owner, ownerId: "ws-7f3a2c" } },
      }),
    ).rejects.toThrow(TypeError);
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});

describe("parseAgentThreadStoreSnapshot", () => {
  it("treats an unparseable thread as unreadable instead of failing the load", () => {
    const snapshot = parseAgentThreadStoreSnapshot(
      {
        threads: [
          { ...serializeAgentThread(THREAD), threadId: "agt-2-0a1b", pinned: "yes" },
          serializeAgentThread(THREAD),
        ],
        unreadable: [{ threadId: "agt-9-0a1b", reason: "invalid json" }],
        evicted: 0,
      },
      OWNER_REQUEST,
    );

    expect(snapshot.threads).toEqual([THREAD]);
    expect(snapshot.unreadable.map((report) => report.threadId)).toEqual([
      "agt-9-0a1b",
      "agt-2-0a1b",
    ]);
  });

  it("reports a foreign owner as unreadable rather than admitting it", () => {
    const foreign = serializeAgentThread({
      ...THREAD,
      threadId: "agt-3-0a1b",
      owner: { ...THREAD.owner, ownerId: "agent-root:ffffffffffffffff" },
    });

    const snapshot = parseAgentThreadStoreSnapshot(
      { threads: [foreign], unreadable: [], evicted: 0 },
      OWNER_REQUEST,
    );

    expect(snapshot.threads).toEqual([]);
    expect(snapshot.unreadable).toEqual([{ threadId: "agt-3-0a1b", reason: "foreign owner" }]);
  });

  it("rejects unknown fields and unbounded collections", () => {
    expect(() =>
      parseAgentThreadStoreSnapshot(
        { threads: [], unreadable: [], evicted: 0, extra: 1 },
        OWNER_REQUEST,
      ),
    ).toThrow(TypeError);
    expect(() =>
      parseAgentThreadStoreSnapshot({ threads: [], unreadable: [], evicted: -1 }, OWNER_REQUEST),
    ).toThrow(TypeError);
    expect(() =>
      parseAgentThreadStoreSnapshot(
        {
          threads: Array.from({ length: 65 }, () => serializeAgentThread(THREAD)),
          unreadable: [],
          evicted: 0,
        },
        OWNER_REQUEST,
      ),
    ).toThrow(TypeError);
  });
});

describe("invokeSaveAgentThreadIpc", () => {
  it("sends the serialized thread and accepts only a null result", async () => {
    const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>().mockResolvedValue(null);

    await invokeSaveAgentThreadIpc(invokeCommand, { ...OWNER_REQUEST, thread: THREAD });

    expect(invokeCommand).toHaveBeenCalledWith("save_agent_thread", {
      request: { ...OWNER_REQUEST, thread: serializeAgentThread(THREAD) },
    });
  });

  it("rejects a thread whose owner does not match the request", async () => {
    const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>();

    await expect(
      invokeSaveAgentThreadIpc(invokeCommand, {
        rootKey: "/workspace/other",
        ownerId: OWNER_ID,
        thread: THREAD,
      }),
    ).rejects.toThrow(TypeError);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects a non-null result", async () => {
    const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>().mockResolvedValue({});

    await expect(
      invokeSaveAgentThreadIpc(invokeCommand, { ...OWNER_REQUEST, thread: THREAD }),
    ).rejects.toThrow(TypeError);
  });
});

describe("invokeDeleteAgentThreadIpc", () => {
  it("sends the validated reference", async () => {
    const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>().mockResolvedValue(null);

    await invokeDeleteAgentThreadIpc(invokeCommand, {
      ...OWNER_REQUEST,
      threadId: "agt-1-0a1b",
    });

    expect(invokeCommand).toHaveBeenCalledWith("delete_agent_thread", {
      request: { ...OWNER_REQUEST, threadId: "agt-1-0a1b" },
    });
  });

  it("rejects an unsafe thread id before touching the transport", async () => {
    const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>();

    await expect(
      invokeDeleteAgentThreadIpc(invokeCommand, { ...OWNER_REQUEST, threadId: "../escape" }),
    ).rejects.toThrow(TypeError);
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});
