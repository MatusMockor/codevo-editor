// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentLaunchOptions } from "../domain/agentLaunch";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../domain/remoteRunner";
import type { RemoteRunnerMcpDeviceSyncReport } from "../domain/remoteRunnerMcpDeviceSync";
import type { AgentFollowUpRequest, AgentThreadStartRequest } from "./agentThreadPorts";
import type { RemoteDeviceMcpSourceResolver } from "./remoteDeviceMcpSource";
import { REMOTE_PROJECT_KIND_CHANGED } from "./remoteFolderProjectLaunch";
import { REMOTE_DEVICE_MCP_SYNC_TIMEOUT_MS } from "./syncRemoteDeviceMcpServers";
import { useRemoteAgentMutations } from "./useRemoteAgentMutations";

const target = { serverId: "s", runnerId: "r", projectId: "p" };
const claudeLaunch: AgentLaunchOptions = {
  provider: "claudeCode",
  model: "sonnet",
  mode: "acceptEdits",
  effort: "high",
  context: "1m",
};
const codexLaunch: AgentLaunchOptions = { provider: "codex", model: "default", mode: "default" };
const request: AgentThreadStartRequest = {
  projectRootKey: "",
  repositoryRoot: "",
  prompt: "hello",
  isolation: "worktree",
  unsafeInPlaceConfirmationKey: null,
  launch: claudeLaunch,
};
const source = { rootPath: "/Users/dev/p", projectKind: "git" } as const;
const added: RemoteRunnerMcpDeviceSyncReport = {
  version: 1,
  results: [{ name: "files", transport: "stdio", outcome: "added", hints: [] }],
  omitted: 0,
};
const ADDED_NOTICE = "Synced MCP servers from this Mac to the server: files.";

function task(overrides: Partial<RemoteRunnerTask> = {}): RemoteRunnerTask {
  return {
    id: "t",
    runnerId: "r",
    sequence: 1,
    provider: "claude",
    launch: claudeLaunch,
    projectId: "p",
    status: "queued",
    parts: [{ type: "text", text: "hello" }],
    createdAt: "now",
    ...overrides,
  };
}

function gateway() {
  return {
    collectInstructions: vi.fn().mockResolvedValue({ version: 1, files: [] }),
    syncDeviceMcpServers: vi.fn().mockResolvedValue(added),
    listServers: vi.fn(),
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    removeServer: vi.fn(),
    getRunner: vi.fn().mockResolvedValue({
      protocolVersion: 1,
      runnerId: "r",
      name: "Linux",
      capabilities: {
        taskExecution: true,
        eventReplay: true,
        instructionSync: true,
        mcpDeviceSync: true,
      },
    }),
    listProjects: vi.fn(),
    cloneProject: vi.fn(),
    getProjectClone: vi.fn(),
    cancelProjectClone: vi.fn(),
    listTasks: vi.fn(),
    createTask: vi
      .fn()
      .mockResolvedValue({ task: task({ status: "draft", projectId: undefined }), created: true }),
    startTask: vi.fn().mockResolvedValue(task()),
    getTask: vi.fn().mockResolvedValue(task({ status: "succeeded" })),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
    continueTask: vi.fn().mockResolvedValue({
      task: task({ id: "child", sequence: 2, parentTaskId: "t", conversationId: "t" }),
      created: true,
    }),
    cancelTask: vi.fn(),
    listEvents: vi.fn(),
    getDiff: vi.fn(),
    uploadAttachment: vi.fn(),
  } satisfies RemoteRunnerGateway;
}

const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
});

async function render(
  gw = gateway(),
  deviceMcpSource: RemoteDeviceMcpSourceResolver = () => source,
  projectKind?: Parameters<typeof useRemoteAgentMutations>[0]["projectKind"],
) {
  const root = createRoot(document.createElement("div"));
  const publish = vi.fn();
  const report = vi.fn();
  let owner = {};
  let surface!: ReturnType<typeof useRemoteAgentMutations>;
  function Harness() {
    surface = useRemoteAgentMutations({
      gateway: gw,
      owner,
      valid: (candidate) => candidate === owner,
      publish,
      report,
      deviceMcpSource,
      projectKind,
    });
    return null;
  }
  const rerender = () =>
    act(async () => {
      root.render(createElement(Harness));
    });
  await rerender();
  disposers.push(() => act(() => root.unmount()));
  return {
    gw,
    publish,
    report,
    current: () => surface,
    replace: async () => {
      owner = {};
      await rerender();
    },
  };
}

describe("remote agent mutations MCP device sync", () => {
  it("syncs the local MCP servers once before creating a new Claude task", async () => {
    const h = await render();
    await act(async () => {
      expect(await h.current().start(request, target)).toEqual(task());
    });
    expect(h.gw.syncDeviceMcpServers).toHaveBeenCalledOnce();
    expect(h.gw.syncDeviceMcpServers).toHaveBeenCalledWith({ ...target, ...source });
    expect(h.gw.syncDeviceMcpServers.mock.invocationCallOrder[0]).toBeLessThan(
      h.gw.createTask.mock.invocationCallOrder[0]!,
    );
    expect(h.report).toHaveBeenCalledWith(ADDED_NOTICE);
    expect(h.publish).toHaveBeenCalledOnce();
  });

  it("reports nothing when every server is unchanged", async () => {
    const gw = gateway();
    gw.syncDeviceMcpServers.mockResolvedValue({
      ...added,
      results: [{ ...added.results[0]!, outcome: "unchanged" }],
    });
    const h = await render(gw);
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(h.report).not.toHaveBeenCalled();
    expect(h.publish).toHaveBeenCalledOnce();
  });

  it("still creates the task and reports a notice when the sync fails", async () => {
    const gw = gateway();
    gw.syncDeviceMcpServers.mockRejectedValue("Runner request failed (HTTP 503).");
    const h = await render(gw);
    await act(async () => {
      expect(await h.current().start(request, target)).toEqual(task());
    });
    expect(h.report).toHaveBeenCalledWith(
      "MCP servers from this Mac could not be synced to the server. Runner request failed (HTTP 503). The conversation starts with the server's current MCP servers.",
    );
    expect(h.gw.createTask).toHaveBeenCalledOnce();
    expect(h.publish).toHaveBeenCalledOnce();
  });

  it("stops waiting after the timeout and still creates the task", async () => {
    vi.useFakeTimers();
    const gw = gateway();
    gw.syncDeviceMcpServers.mockReturnValue(new Promise(() => undefined));
    const h = await render(gw);
    let started: Promise<RemoteRunnerTask | null> | undefined;
    await act(async () => {
      started = h.current().start(request, target);
      await vi.advanceTimersByTimeAsync(REMOTE_DEVICE_MCP_SYNC_TIMEOUT_MS);
    });
    await act(async () => {
      expect(await started).toEqual(task());
    });
    expect(h.report).toHaveBeenCalledWith(
      "MCP server sync from this Mac did not finish within 20 seconds. The conversation starts with the server's current MCP servers.",
    );
    expect(h.gw.createTask).toHaveBeenCalledOnce();
  });

  it("does not sync for Codex threads", async () => {
    const gw = gateway();
    const codexTask = task({ provider: "codex", launch: codexLaunch });
    gw.createTask.mockResolvedValue({
      task: { ...codexTask, status: "draft", projectId: undefined },
      created: true,
    });
    gw.startTask.mockResolvedValue(codexTask);
    const h = await render(gw);
    await act(async () => {
      expect(await h.current().start({ ...request, launch: codexLaunch }, target)).toEqual(
        codexTask,
      );
    });
    expect(h.gw.syncDeviceMcpServers).not.toHaveBeenCalled();
    expect(h.report).not.toHaveBeenCalled();
  });

  it("does not sync when continuing a conversation", async () => {
    const h = await render();
    const followUp: AgentFollowUpRequest = { threadId: "t", prompt: "next", launch: claudeLaunch };
    await act(async () => {
      await h.current().followUp(followUp, {
        ...target,
        conversationId: "t",
        latestTaskId: "t",
      });
    });
    expect(h.gw.continueTask).toHaveBeenCalledOnce();
    expect(h.gw.syncDeviceMcpServers).not.toHaveBeenCalled();
  });

  it("does not sync again when retrying the same pending message", async () => {
    const gw = gateway();
    gw.createTask.mockRejectedValueOnce(new Error("disconnected"));
    const h = await render(gw);
    await act(async () => {
      await h.current().start(request, target);
    });
    await act(async () => {
      expect(await h.current().start(request, target)).toEqual(task());
    });
    expect(h.gw.createTask).toHaveBeenCalledTimes(2);
    expect(h.gw.syncDeviceMcpServers).toHaveBeenCalledOnce();
  });

  it("does not sync again when preparation fails and the same message is retried", async () => {
    const gw = gateway();
    gw.collectInstructions.mockRejectedValueOnce(new Error("Instruction files are unreadable."));
    const h = await render(gw);
    await act(async () => {
      expect(await h.current().start(request, target)).toBeNull();
    });
    expect(h.report).toHaveBeenLastCalledWith("Instruction files are unreadable.");
    await act(async () => {
      expect(await h.current().start(request, target)).toEqual(task());
    });
    expect(h.gw.collectInstructions).toHaveBeenCalledTimes(2);
    expect(h.gw.syncDeviceMcpServers).toHaveBeenCalledOnce();
    expect(h.gw.createTask).toHaveBeenCalledOnce();
  });

  it("keeps the synced command for a retry after the owner changed during the sync", async () => {
    const gw = gateway();
    let finish!: (report: RemoteRunnerMcpDeviceSyncReport) => void;
    gw.syncDeviceMcpServers.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const h = await render(gw);
    let started: Promise<RemoteRunnerTask | null> | undefined;
    await act(async () => {
      started = h.current().start(request, target);
    });
    await vi.waitFor(() => expect(gw.syncDeviceMcpServers).toHaveBeenCalled());
    await h.replace();
    await act(async () => {
      finish(added);
      expect(await started).toBeNull();
    });
    await act(async () => {
      expect(await h.current().start(request, target)).toEqual(task());
    });
    expect(h.gw.syncDeviceMcpServers).toHaveBeenCalledOnce();
    expect(h.gw.createTask).toHaveBeenCalledOnce();
  });

  it("shows unchanged persistent states once per project while changes keep reporting", async () => {
    const gw = gateway();
    const kept = {
      name: "mine",
      transport: "http",
      outcome: "keptServerEntry",
      hints: [],
    } as const;
    gw.syncDeviceMcpServers.mockResolvedValue({ ...added, results: [kept] });
    const h = await render(gw);
    const send = async (prompt: string) => {
      gw.createTask.mockResolvedValueOnce({
        task: task({
          status: "draft",
          projectId: undefined,
          parts: [{ type: "text", text: prompt }],
        }),
        created: true,
      });
      gw.startTask.mockResolvedValueOnce(task({ parts: [{ type: "text", text: prompt }] }));
      await act(async () => {
        await h.current().start({ ...request, prompt }, target);
      });
    };
    await send("first");
    await send("second");
    expect(h.report.mock.calls).toEqual([["Kept the server's own settings for: mine."]]);
    gw.syncDeviceMcpServers.mockResolvedValue({ ...added, results: [kept, added.results[0]!] });
    await send("third");
    expect(h.report).toHaveBeenLastCalledWith(ADDED_NOTICE);
    expect(h.report).toHaveBeenCalledTimes(2);
  });

  it("refuses the start when the server project changed during the sync", async () => {
    const gw = gateway();
    let listed: "repository" | "folder" = "repository";
    gw.syncDeviceMcpServers.mockImplementation(async () => {
      listed = "folder";
      return added;
    });
    const h = await render(
      gw,
      () => source,
      () => listed,
    );
    await act(async () => {
      expect(await h.current().start(request, target)).toBeNull();
    });
    expect(h.report.mock.calls).toEqual([[ADDED_NOTICE], [REMOTE_PROJECT_KIND_CHANGED]]);
    expect(h.gw.createTask).not.toHaveBeenCalled();
  });

  it("does not sync without a local source", async () => {
    const h = await render(gateway(), () => null);
    await act(async () => {
      expect(await h.current().start(request, target)).toEqual(task());
    });
    expect(h.gw.syncDeviceMcpServers).not.toHaveBeenCalled();
    expect(h.report).not.toHaveBeenCalled();
  });

  it("reports nothing and creates nothing after the owner changes during the sync", async () => {
    const gw = gateway();
    let finish!: (report: RemoteRunnerMcpDeviceSyncReport) => void;
    gw.syncDeviceMcpServers.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const h = await render(gw);
    let started: Promise<RemoteRunnerTask | null> | undefined;
    await act(async () => {
      started = h.current().start(request, target);
    });
    await vi.waitFor(() => expect(gw.syncDeviceMcpServers).toHaveBeenCalled());
    await h.replace();
    await act(async () => {
      finish(added);
      expect(await started).toBeNull();
    });
    expect(h.report).not.toHaveBeenCalled();
    expect(h.gw.createTask).not.toHaveBeenCalled();
  });
});
