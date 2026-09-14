// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../domain/remoteRunner";
import type { AgentThreadStartRequest } from "./agentThreadPorts";
import type { AgentLaunchOptions } from "../domain/agentLaunch";
import { useRemoteAgentMutations } from "./useRemoteAgentMutations";
const target = { serverId: "s", runnerId: "r", projectId: "p" };
const request: AgentThreadStartRequest = {
  projectRootKey: "",
  repositoryRoot: "",
  prompt: "hello",
  isolation: "worktree",
  unsafeInPlaceConfirmationKey: null,
  launch: { provider: "codex", model: "default", mode: "default" },
};
const task = (overrides: Partial<RemoteRunnerTask> = {}): RemoteRunnerTask => ({
  id: "t",
  runnerId: "r",
  sequence: 1,
  provider: "codex",
  launch: request.launch,
  projectId: "p",
  status: "queued",
  parts: [{ type: "text", text: "hello" }],
  createdAt: "now",
  ...overrides,
});
function gateway() {
  return {
    listServers: vi.fn(),
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    removeServer: vi.fn(),
    getRunner: vi.fn(),
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
    cancelTask: vi.fn().mockResolvedValue(task({ status: "cancelled" })),
    listEvents: vi.fn(),
    getDiff: vi.fn(),
    uploadAttachment: vi.fn(),
  } satisfies RemoteRunnerGateway;
}
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});
async function render(
  gw = gateway(),
  resolveAttachments?: Parameters<typeof useRemoteAgentMutations>[0]["resolveAttachments"],
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
      resolveAttachments,
    });
    return null;
  }
  async function rerender() {
    await act(async () => {
      root.render(createElement(Harness));
    });
  }
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
describe("remote agent mutations", () => {
  it("creates and starts the original launch on the explicit remote project", async () => {
    const h = await render();
    await act(async () => {
      expect(await h.current().start(request, target)).toEqual(task());
    });
    expect(h.gw.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ launch: request.launch, provider: "codex" }),
    );
    expect(h.gw.startTask).toHaveBeenCalledWith({ serverId: "s", taskId: "t", projectId: "p" });
    expect(h.publish).toHaveBeenCalledOnce();
  });
  it("never puts the local browser flag on the wire for a remote runner", async () => {
    const claudeLaunch: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "sonnet",
      mode: "acceptEdits",
      effort: "high",
      context: "1m",
      chrome: false,
    };
    const wireLaunch: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "sonnet",
      mode: "acceptEdits",
      effort: "high",
      context: "1m",
    };
    const claudeTask = task({ provider: "claude", launch: wireLaunch });
    const gw = gateway();
    gw.createTask.mockResolvedValue({
      task: task({ provider: "claude", launch: wireLaunch, status: "draft", projectId: undefined }),
      created: true,
    });
    gw.startTask.mockResolvedValue(claudeTask);
    const h = await render(gw);

    await act(async () => {
      expect(await h.current().start({ ...request, launch: claudeLaunch }, target)).toEqual(
        claudeTask,
      );
    });

    const [wire] = h.gw.createTask.mock.calls[0] as [{ readonly launch: AgentLaunchOptions }];
    expect(wire.launch).not.toHaveProperty("chrome");
    expect(wire.launch).toEqual(wireLaunch);
    expect(h.report).not.toHaveBeenCalled();
  });
  it("reuses the exact request after unknown create failure and blocks changed intent", async () => {
    const h = await render();
    h.gw.createTask.mockRejectedValueOnce(new Error("disconnected"));
    await act(async () => {
      await h.current().start(request, target);
    });
    await act(async () => {
      await h.current().start({ ...request, prompt: "changed" }, target);
    });
    expect(h.gw.createTask).toHaveBeenCalledTimes(1);
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(h.gw.createTask.mock.calls[0]).toEqual(h.gw.createTask.mock.calls[1]);
  });
  it("recovers a lost start by idempotent create without another start", async () => {
    const h = await render();
    h.gw.startTask.mockRejectedValueOnce(new Error("disconnected"));
    await act(async () => {
      await h.current().start(request, target);
    });
    h.gw.createTask.mockResolvedValueOnce({ task: task(), created: false });
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(h.gw.startTask).toHaveBeenCalledTimes(1);
    expect(h.publish).toHaveBeenCalledOnce();
  });
  it("retries uncertain continuation without invalidating it through newer-turn preflight", async () => {
    const h = await render();
    h.gw.continueTask.mockRejectedValueOnce(new Error("disconnected"));
    const follow = { prompt: "hello", launch: request.launch, threadId: "display" };
    const destination = { ...target, conversationId: "t", latestTaskId: "t" };
    await act(async () => {
      await h.current().followUp(follow, destination);
    });
    await act(async () => {
      await h.current().followUp(follow, { ...destination, latestTaskId: "child" });
    });
    expect(h.gw.getTaskResume).toHaveBeenCalledTimes(1);
    expect(h.gw.continueTask.mock.calls[0]).toEqual(h.gw.continueTask.mock.calls[1]);
    expect(h.publish).toHaveBeenCalledOnce();
  });
  it("blocks foreign parent before continuation", async () => {
    const h = await render();
    h.gw.getTask.mockResolvedValueOnce(task({ runnerId: "foreign" }));
    await act(async () => {
      await h
        .current()
        .followUp(
          { ...request, threadId: "display" },
          { ...target, conversationId: "t", latestTaskId: "t" },
        );
    });
    expect(h.gw.continueTask).not.toHaveBeenCalled();
  });
  it("rejects stale creation before starting or publishing", async () => {
    const h = await render();
    let resolve!: (value: { task: RemoteRunnerTask; created: boolean }) => void;
    h.gw.createTask.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    let operation!: Promise<RemoteRunnerTask | null>;
    await act(async () => {
      operation = h.current().start(request, target);
    });
    await h.replace();
    await act(async () => {
      resolve({ task: task({ status: "draft" }), created: true });
      await operation;
    });
    expect(h.gw.startTask).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });
  it("retains uploaded parts on uncertain retry", async () => {
    const upload = vi.fn().mockResolvedValue([{ type: "attachment", attachmentId: "image" }]);
    const h = await render(gateway(), upload);
    h.gw.createTask.mockRejectedValue(new Error("disconnected"));
    const imageRequest = {
      ...request,
      attachments: [
        { kind: "reference" as const, path: "/image.png", name: "image.png", bytes: 10 },
      ],
    };
    await act(async () => {
      await h.current().start(imageRequest, target);
    });
    await act(async () => {
      await h.current().start(imageRequest, target);
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(h.gw.createTask.mock.calls[0]).toEqual(h.gw.createTask.mock.calls[1]);
  });
  it.each(["draft", "start"])("rejects foreign root lineage from %s", async (stage) => {
    const h = await render();
    if (stage === "draft")
      h.gw.createTask.mockResolvedValueOnce({
        task: task({ status: "draft", conversationId: "foreign" }),
        created: true,
      });
    else h.gw.startTask.mockResolvedValueOnce(task({ parentTaskId: "foreign" }));
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(h.publish).not.toHaveBeenCalled();
  });
  it("rejects an omitted or different launch echo", async () => {
    const h = await render();
    h.gw.createTask.mockResolvedValueOnce({
      task: task({ status: "draft", launch: undefined }),
      created: true,
    });
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(h.gw.startTask).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });
  it("rejects foreign cancellation lineage", async () => {
    const h = await render();
    h.gw.cancelTask.mockResolvedValueOnce(task({ status: "cancelled", conversationId: "foreign" }));
    await act(async () => {
      await h.current().stop({ ...target, conversationId: "t", latestTaskId: "t" });
    });
    expect(h.publish).not.toHaveBeenCalled();
  });
  it("serializes mutations and verifies stop ownership", async () => {
    const h = await render();
    h.gw.getTask.mockResolvedValueOnce(task({ projectId: "foreign" }));
    await act(async () => {
      await h.current().stop({ ...target, conversationId: "t", latestTaskId: "t" });
    });
    expect(h.gw.cancelTask).not.toHaveBeenCalled();
  });
});
