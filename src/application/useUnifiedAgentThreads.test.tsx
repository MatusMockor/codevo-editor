// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RemoteRunnerGateway,
  RemoteRunnerServer,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import {
  surfaceThreadView,
  surfaceChangedFile,
} from "../components/agentMode/agentSurfaceTestFixtures";
import {
  projectFixture,
  threadsSurfaceFixture,
} from "../components/agentMode/agentThreadsSurfaceTestFixtures";
import { remoteAgentProjectKey, remoteAgentThreadKey } from "./remoteAgentProjection";
import { useUnifiedAgentThreads, type UnifiedAgentThreadsOptions } from "./useUnifiedAgentThreads";
import type { AgentThreadStartRequest } from "./agentThreadPorts";

const server: RemoteRunnerServer = {
  id: "server",
  name: "Linux",
  host: "linux",
  username: "user",
  port: 22,
  connected: true,
};
const launch = { provider: "codex", model: "default", mode: "default" } as const;
const task = (overrides: Partial<RemoteRunnerTask> = {}): RemoteRunnerTask => ({
  id: "root",
  runnerId: "runner",
  sequence: 1,
  provider: "codex",
  launch,
  projectId: "project",
  status: "succeeded",
  parts: [{ type: "text", text: "First prompt" }],
  createdAt: "2026-09-13T00:00:00Z",
  ...overrides,
});
const child = task({
  id: "child",
  sequence: 2,
  conversationId: "root",
  parentTaskId: "root",
  parts: [{ type: "text", text: "Second prompt" }],
});
const remoteId = remoteAgentThreadKey(server.id, "runner", "root");
const projectKey = remoteAgentProjectKey(server.id, "runner", "project");
const start: AgentThreadStartRequest = {
  projectRootKey: projectKey,
  repositoryRoot: projectKey,
  prompt: "First prompt",
  launch,
  isolation: "worktree",
  unsafeInPlaceConfirmationKey: null,
};
function gateway() {
  return {
    listServers: vi.fn(),
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    removeServer: vi.fn(),
    getRunner: vi.fn().mockResolvedValue({
      protocolVersion: 1,
      runnerId: "runner",
      name: "Linux",
      capabilities: {
        taskExecution: true,
        eventReplay: true,
        taskContinuation: true,
        taskLaunchOptions: true,
      },
    }),
    listProjects: vi.fn().mockResolvedValue({ items: [{ id: "project", name: "App" }] }),
    cloneProject: vi.fn(),
    getProjectClone: vi.fn(),
    cancelProjectClone: vi.fn(),
    listTasks: vi
      .fn()
      .mockImplementation(async ({ after, serverId }: { after: number; serverId: string }) => ({
        items: after === 0 && serverId === server.id ? [task(), child] : [],
        nextCursor: null,
      })),
    createTask: vi.fn().mockResolvedValue({
      task: task({ id: "new", sequence: 3, status: "draft", projectId: undefined }),
      created: true,
    }),
    startTask: vi.fn().mockResolvedValue(task({ id: "new", sequence: 3, status: "queued" })),
    getTask: vi
      .fn()
      .mockImplementation(async ({ taskId }: { taskId: string }) =>
        taskId === "child" ? child : task({ id: taskId }),
      ),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
    continueTask: vi.fn().mockResolvedValue({
      task: task({
        id: "third",
        sequence: 3,
        parentTaskId: "child",
        conversationId: "root",
        status: "queued",
        parts: [{ type: "text", text: "Third prompt" }],
      }),
      created: true,
    }),
    cancelTask: vi.fn(),
    listEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getDiff: vi.fn(),
    uploadAttachment: vi.fn(),
  } satisfies RemoteRunnerGateway;
}
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
async function setup() {
  const gw = gateway();
  const local = threadsSurfaceFixture({
    threads: [surfaceThreadView()],
    startThread: vi.fn().mockResolvedValue({ threadId: "local-new" }),
    sendFollowUp: vi.fn().mockResolvedValue(true),
    showChanges: vi.fn(),
    revealAttachment: vi.fn(),
    markThreadViewed: vi.fn(),
    refreshShipStatus: vi.fn(),
    openChangedFile: vi.fn(),
  });
  let options: UnifiedAgentThreadsOptions = {
    local,
    gateway: gw,
    servers: [server],
    selectedServerId: null,
    workspaceOwner: "A",
    selectedThreadId: null,
    localProjects: [projectFixture()],
  };
  let current!: ReturnType<typeof useUnifiedAgentThreads>;
  const root = createRoot(document.createElement("div"));
  function Harness() {
    current = useUnifiedAgentThreads(options);
    return null;
  }
  async function render(patch: Partial<UnifiedAgentThreadsOptions> = {}) {
    options = { ...options, ...patch };
    await act(async () => {
      root.render(createElement(Harness));
    });
  }
  disposers.push(() => act(() => root.unmount()));
  await render();
  return {
    gw,
    local,
    render,
    get current() {
      return current;
    },
  };
}
describe("unified original agent surface", () => {
  it("keeps local and grouped remote conversations in the same rail across environment selection", async () => {
    const h = await setup();
    expect(h.current.agents.threads.map((view) => view.thread.threadId)).toEqual([
      remoteId,
      "agt-1",
    ]);
    expect(h.current.agents.threads[0]!.thread.turns.map((turn) => turn.prompt)).toEqual([
      "First prompt",
      "Second prompt",
    ]);
    await h.render({ selectedServerId: server.id });
    expect(h.current.agents.threads).toHaveLength(2);
    expect(h.current.agents.threads[1]).toBe(h.local.threads[0]);
  });
  it("starts the selected remote project through the server only", async () => {
    const h = await setup();
    await h.render({ selectedServerId: server.id });
    await act(async () => {
      expect(await h.current.agents.startThread(start)).toEqual({
        threadId: remoteAgentThreadKey(server.id, "runner", "new"),
      });
    });
    expect(h.gw.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: server.id, provider: "codex", launch }),
    );
    expect(h.gw.startTask).toHaveBeenCalledWith({
      serverId: server.id,
      projectId: "project",
      taskId: "new",
    });
    expect(h.local.startThread).not.toHaveBeenCalled();
  });
  it("follows the conversation's server even after the new conversation picker changes", async () => {
    const h = await setup();
    await h.render({ selectedThreadId: remoteId, selectedServerId: "other" });
    await act(async () => {
      expect(
        await h.current.agents.sendFollowUp({ threadId: remoteId, prompt: "Third prompt", launch }),
      ).toBe(true);
    });
    expect(h.gw.continueTask).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: server.id, taskId: "child", launch }),
    );
    expect(h.local.sendFollowUp).not.toHaveBeenCalled();
  });
  it("retains offline conversations but disables their execution", async () => {
    const h = await setup();
    await h.render({ selectedThreadId: remoteId, servers: [{ ...server, connected: false }] });
    expect(h.current.agents.threads.some((view) => view.thread.threadId === remoteId)).toBe(true);
    expect(h.current.agents.agentCliConfigured).toBe(false);
    await act(async () => {
      expect(
        await h.current.agents.sendFollowUp({ threadId: remoteId, prompt: "Third prompt", launch }),
      ).toBe(false);
    });
    expect(h.gw.continueTask).not.toHaveBeenCalled();
    expect(h.local.sendFollowUp).not.toHaveBeenCalled();
  });
  it("preserves local admission and follow-up even when a server is selected for new conversations", async () => {
    const h = await setup();
    const localStart = {
      ...start,
      projectRootKey: projectFixture().rootKey,
      repositoryRoot: projectFixture().rootPath,
    };
    await act(async () => {
      expect(await h.current.agents.startThread(localStart)).toEqual({ threadId: "local-new" });
    });
    await h.render({ selectedThreadId: "agt-1", selectedServerId: server.id });
    const follow = { threadId: "agt-1", prompt: "Local follow-up", launch };
    await act(async () => {
      expect(await h.current.agents.sendFollowUp(follow)).toBe(true);
    });
    expect(h.local.startThread).toHaveBeenCalledWith(localStart);
    expect(h.local.sendFollowUp).toHaveBeenCalledWith(follow);
    expect(h.current.agents.attachments).toBe(h.local.attachments);
    expect(h.gw.createTask).not.toHaveBeenCalled();
    expect(h.gw.continueTask).not.toHaveBeenCalled();
  });
  it("never opens local tools for a remote conversation", async () => {
    const h = await setup();
    await act(async () => {
      await h.current.agents.showChanges(remoteId);
      await h.current.agents.openChangedFile(remoteId, surfaceChangedFile("src/app.ts"));
    });
    expect(h.local.showChanges).not.toHaveBeenCalled();
    expect(h.local.openChangedFile).not.toHaveBeenCalled();
    expect(h.current.agents.notice?.message).toContain("not available");
  });
  it("revokes an in-flight create across workspace A to B to A before starting a provider", async () => {
    const h = await setup();
    await h.render({ selectedServerId: server.id });
    let resolve!: (value: { task: RemoteRunnerTask; created: boolean }) => void;
    h.gw.createTask.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    let pending!: ReturnType<typeof h.current.agents.startThread>;
    await act(async () => {
      pending = h.current.agents.startThread(start);
    });
    await h.render({ workspaceOwner: "B" });
    await h.render({ workspaceOwner: "A" });
    await act(async () => {
      resolve({
        task: task({ id: "new", sequence: 3, status: "draft", projectId: undefined }),
        created: true,
      });
      expect(await pending).toBeNull();
    });
    expect(h.gw.startTask).not.toHaveBeenCalled();
    expect(h.current.agents.threads.some((view) => view.execution?.latestTaskId === "new")).toBe(
      false,
    );
  });
  it("keeps remote identity guards after the last server is removed", async () => {
    const h = await setup();
    const capturedId = h.current.agents.threads.find((view) => view.execution)?.thread.threadId;
    expect(capturedId).toBe(remoteId);
    await h.render({ servers: [], selectedThreadId: null, selectedServerId: null });
    expect(h.current.agents.threads.every((view) => view.execution === undefined)).toBe(true);
    await act(async () => {
      expect(
        await h.current.agents.sendFollowUp({
          threadId: capturedId!,
          prompt: "Late callback",
          launch,
        }),
      ).toBe(false);
      await h.current.agents.showChanges(capturedId!);
      await h.current.agents.revealAttachment(capturedId!, "image-id");
    });
    expect(h.local.sendFollowUp).not.toHaveBeenCalled();
    expect(h.local.showChanges).not.toHaveBeenCalled();
    expect(h.local.revealAttachment).not.toHaveBeenCalled();
    expect(h.gw.continueTask).not.toHaveBeenCalled();
  });

  it("keeps effect callbacks stable while routing to the latest local surface during streaming", async () => {
    const h = await setup();
    const markViewed = h.current.agents.markThreadViewed;
    const refreshShip = h.current.agents.refreshShipStatus;
    const nextLocal = {
      ...h.local,
      threads: [surfaceThreadView({ lifecycle: "running" })],
      markThreadViewed: vi.fn(),
      refreshShipStatus: vi.fn(),
    };
    await h.render({ local: nextLocal });
    expect(h.current.agents.markThreadViewed).toBe(markViewed);
    expect(h.current.agents.refreshShipStatus).toBe(refreshShip);
    await act(async () => {
      markViewed("agt-1");
      await refreshShip("agt-1");
    });
    expect(nextLocal.markThreadViewed).toHaveBeenCalledWith("agt-1");
    expect(nextLocal.refreshShipStatus).toHaveBeenCalledWith("agt-1");
    expect(h.local.markThreadViewed).not.toHaveBeenCalled();
    expect(h.local.refreshShipStatus).not.toHaveBeenCalled();
  });
});
