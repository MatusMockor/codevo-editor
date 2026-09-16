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

it.each(["claudeCode", "codex"] as const)(
  "snapshots %s outputs before terminal persistence settles",
  async (provider) => {
    let finish!: () => void;
    const captured = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const invokeCommand = vi.fn<InvokeAgentThreadStoreCommand>(async (command) => {
      if (command === "resolve_agent_output_artifact") {
        await captured;
        return {
          id: "a".repeat(64),
          taskId: "agt-2-0a1b",
          name: "design.html",
          mediaType: "text/html",
          sizeBytes: 20,
          sha256: "b".repeat(64),
        };
      }
      return null;
    });
    const gateway = new TauriAgentThreadStoreGateway(invokeCommand, available);
    const thread: AgentThread = {
      ...THREAD,
      provider: { kind: provider, sessionId: null },
      turns: [
        {
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
        },
      ],
    };
    let settled = false;
    const saving = gateway
      .saveAgentThread({ rootKey: ROOT_KEY, ownerId: OWNER_ID, thread })
      .then(() => {
        settled = true;
      });
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
    expect(invokeCommand.mock.calls[0]?.[0]).toBe("save_agent_thread");
    expect(settled).toBe(false);
    finish();
    await saving;
    expect(settled).toBe(true);
  },
);
