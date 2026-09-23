// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../domain/remoteRunner";
import type { AgentThreadStartRequest } from "./agentThreadPorts";
import type { AgentLaunchOptions } from "../domain/agentLaunch";
import {
  REMOTE_CONVERSATION_BUSY_NOTICE,
  REMOTE_STOP_UNAPPLIED_NOTICE,
  useRemoteAgentMutations,
} from "./useRemoteAgentMutations";
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
    collectInstructions: vi.fn().mockResolvedValue({ version: 1, files: [] }),
    listServers: vi.fn(),
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    removeServer: vi.fn(),
    getRunner: vi
      .fn()
      .mockResolvedValue({ runnerId: "r", capabilities: { instructionSync: true } }),
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

    const [wire] = vi.mocked<RemoteRunnerGateway["createTask"]>(h.gw.createTask).mock.calls[0] as [
      { readonly launch: AgentLaunchOptions },
    ];
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
    expect(vi.mocked<RemoteRunnerGateway["createTask"]>(h.gw.createTask).mock.calls[0]).toEqual(
      vi.mocked<RemoteRunnerGateway["createTask"]>(h.gw.createTask).mock.calls[1],
    );
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
    expect(vi.mocked<RemoteRunnerGateway["createTask"]>(h.gw.createTask).mock.calls[0]).toEqual(
      vi.mocked<RemoteRunnerGateway["createTask"]>(h.gw.createTask).mock.calls[1],
    );
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

const instructionSnapshot = (content: string) => ({
  version: 1 as const,
  files: [{ scope: "global" as const, path: "CLAUDE.md", content }],
});
const claudeRequest: AgentThreadStartRequest = {
  ...request,
  launch: { provider: "claudeCode", model: "default", mode: "default", effort: "high" },
};
function synchronizingGateway() {
  const gw = gateway();
  const claudeTask = (overrides: Partial<RemoteRunnerTask> = {}) =>
    task({ provider: "claude", launch: claudeRequest.launch, ...overrides });
  gw.createTask.mockResolvedValue({
    task: claudeTask({ status: "draft", projectId: undefined }),
    created: true,
  });
  gw.startTask.mockResolvedValue(claudeTask());
  gw.getTask.mockResolvedValue(claudeTask({ status: "succeeded" }));
  gw.continueTask.mockResolvedValue({
    task: claudeTask({ id: "child", sequence: 2, parentTaskId: "t", conversationId: "t" }),
    created: true,
  });
  gw.getRunner.mockResolvedValue({ runnerId: "r", capabilities: { instructionSync: true } });
  return { ...gw, collectInstructions: vi.fn().mockResolvedValue(instructionSnapshot("first")) };
}
describe("automatic instruction snapshots", () => {
  const request = claudeRequest;
  it("collects fresh rules on each confirmed send but pins rules across uncertain retries", async () => {
    const gw = synchronizingGateway();
    gw.createTask.mockRejectedValueOnce(new Error("connection lost"));
    const h = await render(gw);
    await act(async () => {
      await h.current().start(request, target);
    });
    const first = vi.mocked<RemoteRunnerGateway["createTask"]>(gw.createTask).mock.calls[0]?.[0];
    gw.collectInstructions.mockResolvedValue(instructionSnapshot("edited"));
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(vi.mocked<RemoteRunnerGateway["createTask"]>(gw.createTask).mock.calls[1]?.[0]).toEqual(
      first,
    );
    expect(gw.collectInstructions).toHaveBeenCalledTimes(1);
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(gw.collectInstructions).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked<RemoteRunnerGateway["createTask"]>(gw.createTask).mock.calls[2]?.[0],
    ).toMatchObject({ instructions: instructionSnapshot("edited") });
  });
  it.each(["Cannot read rules", "x".repeat(2000), { detail: "private" }])(
    "handles native instruction failures safely: %s",
    async (failure) => {
      const gw = synchronizingGateway();
      gw.collectInstructions.mockRejectedValue(failure);
      const h = await render(gw);
      await act(async () => {
        await h.current().start(request, target);
      });
      expect(gw.createTask).not.toHaveBeenCalled();
      expect(h.report).toHaveBeenCalledWith(
        failure === "Cannot read rules" ? failure : "Remote execution failed.",
      );
    },
  );
  it("does not dispatch when collecting fails or the server lacks support", async () => {
    const gw = synchronizingGateway();
    gw.collectInstructions.mockRejectedValue(new Error("Cannot read rules"));
    const h = await render(gw);
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(gw.createTask).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenCalledWith("Cannot read rules");
    gw.getRunner.mockResolvedValue({ runnerId: "r", capabilities: {} });
    gw.collectInstructions.mockClear();
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(gw.collectInstructions).not.toHaveBeenCalled();
    expect(gw.createTask).not.toHaveBeenCalled();
  });
  it("revokes a collected snapshot when the workspace owner changes", async () => {
    const gw = synchronizingGateway();
    let resolve!: (value: ReturnType<typeof instructionSnapshot>) => void;
    gw.collectInstructions.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const h = await render(gw);
    let sending!: Promise<RemoteRunnerTask | null>;
    await act(async () => {
      sending = h.current().start(request, target);
    });
    await h.replace();
    await act(async () => {
      resolve(instructionSnapshot("stale"));
      await sending;
    });
    expect(gw.createTask).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });
  it("includes fresh instructions in a continuation", async () => {
    const gw = synchronizingGateway();
    const h = await render(gw);
    await act(async () => {
      await h
        .current()
        .followUp(
          { threadId: "thread", prompt: request.prompt, launch: request.launch },
          { ...target, latestTaskId: "t", conversationId: "t" },
        );
    });
    expect(gw.continueTask).toHaveBeenCalledWith(
      expect.objectContaining({ instructions: instructionSnapshot("first") }),
    );
  });
});

it("sends Codex starts and continuations without collecting rules or requiring runner support", async () => {
  const gw = gateway();
  gw.getRunner.mockResolvedValue({ runnerId: "r", capabilities: {} });
  gw.collectInstructions.mockRejectedValue(new Error("must not collect"));
  const h = await render(gw);
  await act(async () => {
    expect(await h.current().start(request, target)).not.toBeNull();
  });
  await act(async () => {
    expect(
      await h
        .current()
        .followUp(
          { threadId: "thread", prompt: request.prompt, launch: request.launch },
          { ...target, latestTaskId: "t", conversationId: "t" },
        ),
    ).not.toBeNull();
  });
  expect(gw.collectInstructions).not.toHaveBeenCalled();
  expect(gw.getRunner).toHaveBeenCalledTimes(1);
  expect(
    vi.mocked<RemoteRunnerGateway["createTask"]>(gw.createTask).mock.calls[0]?.[0],
  ).not.toHaveProperty("instructions");
  expect(
    vi.mocked<RemoteRunnerGateway["continueTask"]>(gw.continueTask).mock.calls[0]?.[0],
  ).not.toHaveProperty("instructions");
});

describe("remote checkout isolation", () => {
  it("rejects in-place on legacy runners before creating a task", async () => {
    const h = await render();
    await act(async () => {
      expect(await h.current().start({ ...request, isolation: "in-place" }, target)).toBeNull();
    });
    expect(h.gw.createTask).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenCalledWith(expect.stringContaining("Update the server runner"));
  });
  it("sends the selected mode to capable runners and rejects mismatched drafts", async () => {
    const gw = gateway();
    gw.getRunner.mockResolvedValue({
      runnerId: "r",
      capabilities: { instructionSync: true, taskIsolation: true },
    });
    const h = await render(gw);
    await act(async () => {
      expect(await h.current().start({ ...request, isolation: "in-place" }, target)).toBeNull();
    });
    expect(gw.createTask).toHaveBeenCalledWith(expect.objectContaining({ isolation: "in-place" }));
    expect(gw.startTask).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });
  it("starts in-place and freezes the mode during an uncertain retry", async () => {
    const gw = gateway();
    gw.getRunner.mockResolvedValue({
      runnerId: "r",
      capabilities: { instructionSync: true, taskIsolation: true },
    });
    gw.createTask.mockRejectedValueOnce(new Error("timeout"));
    gw.createTask.mockResolvedValue({
      task: task({ isolation: "in-place", status: "draft" }),
      created: true,
    });
    gw.startTask.mockResolvedValue(task({ isolation: "in-place" }));
    const h = await render(gw);
    await act(async () => {
      await h.current().start({ ...request, isolation: "in-place" }, target);
    });
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(gw.createTask).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await h.current().start({ ...request, isolation: "in-place" }, target)).toEqual(
        task({ isolation: "in-place" }),
      );
    });
    expect(gw.getRunner).toHaveBeenCalledTimes(1);
    expect(gw.createTask.mock.calls[0]).toEqual(gw.createTask.mock.calls[1]);
  });
  it("rejects continuation responses changing the parent isolation", async () => {
    const gw = gateway();
    gw.getTask.mockResolvedValue(task({ isolation: "in-place", status: "succeeded" }));
    const h = await render(gw);
    await act(async () => {
      expect(
        await h
          .current()
          .followUp(
            { ...request, threadId: "thread" },
            { ...target, latestTaskId: "t", conversationId: "t" },
          ),
      ).toBeNull();
    });
    expect(h.publish).not.toHaveBeenCalled();
  });
});

describe("per-conversation remote run control", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((settle) => {
      resolve = settle;
    });
    return { promise, resolve };
  }

  it("sends Stop for one conversation while another conversation is still starting", async () => {
    const h = await render();
    const created = deferred<{ task: RemoteRunnerTask; created: boolean }>();
    h.gw.createTask.mockReturnValueOnce(created.promise);
    let starting!: Promise<RemoteRunnerTask | null>;
    await act(async () => {
      starting = h.current().start(request, target, "new:remote-project");
    });
    expect(h.current().busyKeys).toEqual(new Set(["new:remote-project"]));
    expect(h.current().busy).toBe(true);

    h.gw.getTask.mockResolvedValueOnce(task({ id: "other", status: "running" }));
    h.gw.cancelTask.mockResolvedValueOnce(task({ id: "other", status: "cancelled" }));
    await act(async () => {
      await h.current().stop({ ...target, conversationId: "other", latestTaskId: "other" });
    });
    expect(h.gw.cancelTask).toHaveBeenCalledWith({ serverId: "s", taskId: "other" });

    await act(async () => {
      created.resolve({ task: task({ status: "draft", projectId: undefined }), created: true });
      await starting;
    });
    expect(h.current().busyKeys.size).toBe(0);
    expect(h.current().busy).toBe(false);
  });

  it("applies a Stop pressed during a continuation to the task it creates", async () => {
    const h = await render();
    const continued = deferred<{ task: RemoteRunnerTask; created: boolean }>();
    h.gw.continueTask.mockReturnValueOnce(continued.promise);
    const destination = { ...target, conversationId: "t", latestTaskId: "t" };
    let sending!: Promise<RemoteRunnerTask | null>;
    await act(async () => {
      sending = h
        .current()
        .followUp(
          { prompt: "hello", launch: request.launch, threadId: "display" },
          destination,
          "display",
        );
    });
    await vi.waitFor(() => expect(h.gw.continueTask).toHaveBeenCalledTimes(1));
    expect(h.current().busyKeys).toEqual(new Set(["display"]));
    await act(async () => {
      await h.current().stop(destination);
    });
    expect(h.gw.cancelTask).not.toHaveBeenCalled();

    const child = task({ id: "child", sequence: 2, parentTaskId: "t", conversationId: "t" });
    h.gw.getTask.mockResolvedValueOnce(child);
    h.gw.cancelTask.mockResolvedValueOnce({ ...child, status: "cancelled" });
    await act(async () => {
      continued.resolve({ task: child, created: true });
      await sending;
    });
    expect(h.gw.cancelTask).toHaveBeenCalledWith({ serverId: "s", taskId: "child" });
    expect(h.report).not.toHaveBeenCalled();
  });

  it("tells the user when a Stop recorded during an unconfirmed continuation cannot be applied", async () => {
    const h = await render();
    let failContinuation!: (error: Error) => void;
    h.gw.continueTask.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        failContinuation = reject;
      }),
    );
    const destination = { ...target, conversationId: "t", latestTaskId: "t" };
    let sending!: Promise<RemoteRunnerTask | null>;
    await act(async () => {
      sending = h
        .current()
        .followUp(
          { prompt: "hello", launch: request.launch, threadId: "display" },
          destination,
          "display",
        );
    });
    await vi.waitFor(() => expect(h.gw.continueTask).toHaveBeenCalledTimes(1));
    await act(async () => {
      await h.current().stop({ ...destination, latestTaskId: undefined });
      failContinuation(new Error("disconnected"));
      expect(await sending).toBeNull();
    });
    expect(h.gw.cancelTask).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenLastCalledWith(REMOTE_STOP_UNAPPLIED_NOTICE);
  });

  it("refuses a second send to the same conversation with a visible notice", async () => {
    const h = await render();
    const created = deferred<{ task: RemoteRunnerTask; created: boolean }>();
    h.gw.createTask.mockReturnValueOnce(created.promise);
    let starting!: Promise<RemoteRunnerTask | null>;
    await act(async () => {
      starting = h.current().start(request, target);
    });
    await act(async () => {
      expect(await h.current().start(request, target)).toBeNull();
    });
    expect(h.report).toHaveBeenCalledWith(REMOTE_CONVERSATION_BUSY_NOTICE);
    await act(async () => {
      created.resolve({ task: task({ status: "draft", projectId: undefined }), created: true });
      await starting;
    });
  });
});
