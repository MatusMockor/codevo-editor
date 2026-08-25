import { describe, expect, it, vi } from "vitest";
import { agentRootOwnerId } from "../domain/agentProject";
import { serializeAgentThread, type AgentThread } from "../domain/agentThread";
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
